/**
 * RØDA Loadabot — discover-codmunity-weapons.js
 *
 * Scopre nuove armi BO6/BO7 su CODMunity visitando le pagine pubbliche
 * di riferimento, confronta con data/codmunity-weapon-urls.json e
 * aggiunge gli URL nuovi senza importare i dati.
 *
 * Uso:  node scripts/discover-codmunity-weapons.js
 *       npm run discover:codmunity-weapons
 *
 * NON importa dati, NON imposta verificata:true.
 * L'import vero si fa con: npm run build:loadout-db
 */

'use strict';

const fs    = require('fs');
const path  = require('path');
const http  = require('http');
const https = require('https');

// ─── Percorsi ─────────────────────────────────────────────────────────────────
const ROOT          = path.join(__dirname, '..');
const DATA_DIR      = path.join(ROOT, 'data');
const URLS_FILE     = path.join(DATA_DIR, 'codmunity-weapon-urls.json');
const REPORT_FILE   = path.join(DATA_DIR, 'codmunity-discovery-report.json');

// ─── Pagine di discovery ───────────────────────────────────────────────────────
// Pagine pubbliche CODMunity che contengono link alle armi.
// Aggiungi o rimuovi liberamente senza toccare il codice.
const DISCOVERY_PAGES = [
  'https://codmunity.gg/bo6',
  'https://codmunity.gg/bo7',
  'https://codmunity.gg/tier-list/bo6',
  'https://codmunity.gg/tier-list/bo7',
  'https://codmunity.gg/best-loadouts/bo6',
  'https://codmunity.gg/best-loadouts/bo7',
];

const BASE_URL    = 'https://codmunity.gg';
const DELAY_MS    = 1400;   // >= 1200ms come da spec
const JITTER_MS   = 500;    // delay aggiuntivo casuale

// Pattern per riconoscere un link arma: /weapon/bo6/slug o /weapon/bo7/slug
const WEAPON_LINK_RE = /href=["']\/weapon\/(bo[67])\/([a-z0-9][a-z0-9-]*[a-z0-9])["']/gi;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function nowISO() { return new Date().toISOString(); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function readJSON(filePath) {
  try {
    if (!fs.existsSync(filePath)) return [];
    const c = fs.readFileSync(filePath, 'utf8').trim();
    return c ? JSON.parse(c) : [];
  } catch { return []; }
}

function writeJSON(filePath, data) {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

// ─── HTTP fetch con redirect ──────────────────────────────────────────────────
function httpGet(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    if (redirects < 0) return reject(new Error('Troppi redirect'));
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, {
      headers: {
        'User-Agent'     : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36',
        'Accept'         : 'text/html,application/xhtml+xml,*/*;q=0.9',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control'  : 'no-cache',
      },
      timeout: 20000,
    }, res => {
      // Segui redirect
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        req.destroy();
        const loc = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        return resolve(httpGet(loc, redirects - 1));
      }
      if (res.statusCode === 404) {
        req.destroy();
        const e = new Error('HTTP 404');
        e.isNotFound = true;
        return reject(e);
      }
      if (res.statusCode >= 400) {
        req.destroy();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, html: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout dopo 20s')); });
  });
}

// ─── Estrae URL armi da HTML ──────────────────────────────────────────────────
/**
 * Cerca tutti i pattern href="/weapon/bo6/slug" e href="/weapon/bo7/slug"
 * nell'HTML e restituisce un Set di URL completi normalizzati.
 * Filtra slug validi (solo lettere, cifre e trattini).
 */
function extractWeaponUrls(html, sourcePageUrl) {
  const found = new Set();
  let match;

  // Reset lastIndex prima di ogni uso del regex globale
  WEAPON_LINK_RE.lastIndex = 0;
  while ((match = WEAPON_LINK_RE.exec(html)) !== null) {
    const game = match[1].toLowerCase(); // bo6 | bo7
    const slug = match[2].toLowerCase();
    // Sanity check: slug non deve essere troppo corto o generico
    if (slug.length < 2 || slug.length > 60) continue;
    // Ignora slug che sembrano categorie generiche
    if (['all', 'best', 'top', 'new', 'list', 'meta'].includes(slug)) continue;
    found.add(`${BASE_URL}/weapon/${game}/${slug}`);
  }

  // Cerca anche pattern nel __NEXT_DATA__ JSON (link nell'oggetto dati)
  // es: "slug":"xm4","game":"bo6" o "weaponUrl":"/weapon/bo6/xm4"
  const nextDataMatch = html.match(
    /<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i
  );
  if (nextDataMatch) {
    try {
      const nd = JSON.parse(nextDataMatch[1]);
      extractUrlsFromObject(nd, found);
    } catch { /* ignora errori JSON */ }
  }

  return found;
}

/**
 * Cerca ricorsivamente stringhe che contengono /weapon/bo6/ o /weapon/bo7/
 * all'interno dell'oggetto __NEXT_DATA__ per coprire siti SPA.
 */
function extractUrlsFromObject(obj, found, depth = 0) {
  if (!obj || depth > 10) return;
  if (typeof obj === 'string') {
    const m = obj.match(/\/weapon\/(bo[67])\/([a-z0-9][a-z0-9-]*[a-z0-9])/i);
    if (m) found.add(`${BASE_URL}/weapon/${m[1].toLowerCase()}/${m[2].toLowerCase()}`);
    return;
  }
  if (typeof obj === 'object') {
    for (const v of Object.values(obj)) extractUrlsFromObject(v, found, depth + 1);
  }
}

// ─── Normalizza lista URL (raggruppata BO7 prima di BO6, ordinata per slug) ─────────
// Supporta sia formato stringa semplice che formato oggetto ricco:
// { url: "...", game: "BO7", codmunityOrder: 1, sourcePage: "...", discoveredAt: "..." }
function normalizeUrlList(urls) {
  // Converti tutto in formato oggetto ricco se necessario
  const normalized = urls.map(u => {
    if (typeof u === 'string') {
      // Formato legacy: converti in oggetto ricco
      const m = u.match(/\/weapon\/(bo[67])\/([a-z0-9-]+)/i);
      const game = m ? m[1].toUpperCase() : 'UNKNOWN';
      return {
        url: u,
        game: game,
        codmunityOrder: 9999,
        sourcePage: 'https://codmunity.gg/' + (game === 'BO7' ? 'bo7' : 'bo6'),
        discoveredAt: new Date().toISOString().slice(0, 10),
      };
    }
    return u;
  });

  // Ordina: BO7 prima di BO6, poi per slug alfabetico
  const bo7 = normalized.filter(u => String(u.game || '').toUpperCase() === 'BO7').sort((a, b) => {
    const aSlug = String(a.url || a).split('/').pop().toLowerCase();
    const bSlug = String(b.url || b).split('/').pop().toLowerCase();
    return aSlug.localeCompare(bSlug);
  });
  const bo6 = normalized.filter(u => String(u.game || '').toUpperCase() === 'BO6').sort((a, b) => {
    const aSlug = String(a.url || a).split('/').pop().toLowerCase();
    const bSlug = String(b.url || b).split('/').pop().toLowerCase();
    return aSlug.localeCompare(bSlug);
  });
  const other = normalized.filter(u => {
    const g = String(u.game || '').toUpperCase();
    return g !== 'BO7' && g !== 'BO6';
  }).sort((a, b) => {
    const aUrl = String(a.url || a);
    const bUrl = String(b.url || b);
    return aUrl.localeCompare(bUrl);
  });

  return [...bo7, ...bo6, ...other];
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n══════════════════════════════════════════════════');
  console.log('  RØDA Loadabot — Discover New CODMunity Weapons');
  console.log('══════════════════════════════════════════════════');
  console.log(`  Node.js : ${process.version}`);
  console.log(`  Data    : ${nowISO()}\n`);

  // Leggi URL già noti
  const existingUrls = readJSON(URLS_FILE);
  const existingSet  = new Set(existingUrls.map(u => String(u).trim().toLowerCase()));
  console.log(`URL già presenti: ${existingUrls.length} (${existingSet.size} unici)\n`);

  // Report iniziale
  const report = {
    updatedAt           : nowISO(),
    checkedPages        : [],
    newUrlsFound        : [],
    alreadyExistingUrls : [],
    failedPages         : [],
    errors              : [],
  };

  // Raccoglie tutti i nuovi URL trovati nelle pagine
  const discoveredAll = new Set(); // tutti i weapon URL trovati (nuovi + esistenti)

  // ─── Visita ogni pagina di discovery ────────────────────────────────────────
  for (let i = 0; i < DISCOVERY_PAGES.length; i++) {
    const pageUrl = DISCOVERY_PAGES[i];
    process.stdout.write(`[${i + 1}/${DISCOVERY_PAGES.length}] ${pageUrl} ... `);

    try {
      const resp = await httpGet(pageUrl);
      const weaponUrls = extractWeaponUrls(resp.html, pageUrl);

      let foundOnPage = 0;
      let newOnPage   = 0;
      for (const wUrl of weaponUrls) {
        discoveredAll.add(wUrl);
        foundOnPage++;
        if (!existingSet.has(wUrl.toLowerCase())) newOnPage++;
      }

      console.log(`${foundOnPage} link arma trovati (${newOnPage} nuovi)`);
      report.checkedPages.push({
        url            : pageUrl,
        status         : 'ok',
        weaponLinksFound: foundOnPage,
        newFound       : newOnPage,
      });
    } catch (err) {
      const msg = err.message || String(err);
      console.log(`✗ ${msg}`);
      report.failedPages.push({ url: pageUrl, error: msg });
      report.errors.push({ url: pageUrl, error: msg });
    }

    // Delay anti-rate-limit (salta dopo l'ultima pagina)
    if (i < DISCOVERY_PAGES.length - 1) {
      await sleep(DELAY_MS + Math.floor(Math.random() * JITTER_MS));
    }
  }

  // ─── Confronto con URL esistenti ─────────────────────────────────────────
  console.log('\n── Analisi risultati ──────────────────────────────');
  for (const wUrl of discoveredAll) {
    if (existingSet.has(wUrl.toLowerCase())) {
      report.alreadyExistingUrls.push(wUrl);
    } else {
      report.newUrlsFound.push(wUrl);
    }
  }

  // Ordina per leggibilità
  report.newUrlsFound.sort();
  report.alreadyExistingUrls.sort();

  console.log(`  Totale link arma scoperti : ${discoveredAll.size}`);
  console.log(`  Già presenti              : ${report.alreadyExistingUrls.length}`);
  console.log(`  NUOVI trovati             : ${report.newUrlsFound.length}`);

  // ─── Aggiorna data/codmunity-weapon-urls.json se ci sono novità ──────────
  if (report.newUrlsFound.length > 0) {
    console.log('\n── Nuovi URL trovati ──────────────────────────────');
    report.newUrlsFound.forEach(u => console.log(`  + ${u}`));

    // Unisci esistenti + nuovi, normalizza (BO6 prima, poi BO7, ordinato)
    const merged = normalizeUrlList([...existingUrls, ...report.newUrlsFound]);
    writeJSON(URLS_FILE, merged);
    console.log(`\n  ✓ data/codmunity-weapon-urls.json aggiornato`);
    console.log(`    Totale URL: ${existingUrls.length} → ${merged.length} (+${report.newUrlsFound.length})`);
  } else {
    console.log('\n  ℹ Nessun URL nuovo trovato — file invariato.');
  }

  // ─── Salva report ─────────────────────────────────────────────────────────
  report.updatedAt = nowISO(); // aggiorna timestamp finale
  writeJSON(REPORT_FILE, report);
  console.log(`  ✓ data/codmunity-discovery-report.json salvato`);

  // ─── Riepilogo finale ─────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════');
  console.log('  RIEPILOGO DISCOVERY');
  console.log('══════════════════════════════════════════════════');
  console.log(`  Pagine controllate : ${report.checkedPages.length}`);
  console.log(`  Pagine fallite     : ${report.failedPages.length}`);
  console.log(`  URL nuovi trovati  : ${report.newUrlsFound.length}`);
  if (report.newUrlsFound.length > 0) {
    console.log('\n  Prossimo passo:');
    console.log('    npm run build:loadout-db');
    console.log('  (importa i dati, resta NON verificato finché admin non approva)');
  } else {
    console.log('\n  Database URLs già aggiornato. Nessuna azione necessaria.');
  }
  console.log('══════════════════════════════════════════════════\n');
}

main().catch(e => {
  console.error('\n[ERRORE FATALE]', e.message);
  try {
    writeJSON(REPORT_FILE, {
      updatedAt  : nowISO(),
      fatalError : e.message,
      fatalStack : e.stack,
    });
  } catch {}
  process.exit(1);
});
