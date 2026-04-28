/**
 * RØDA Loadabot — build-loadout-db-from-codmunity.js
 *
 * Legge data/codmunity-weapon-urls.json, visita ogni URL CODMunity,
 * estrae arma + accessori + compatibilità e li scrive nei 3 file DB:
 *   data/loadout-weapons.json
 *   data/loadout-attachments.json
 *   data/loadout-compatibility.json
 *
 * Report: data/loadout-import-report.json
 *
 * Strategia fetch (in ordine):
 *  1. fetch() nativo (Node 18+) — legge HTML e cerca __NEXT_DATA__
 *  2. Puppeteer (se installato) — per siti SPA/CSR
 *
 * Uso: node scripts/build-loadout-db-from-codmunity.js
 *      npm run build:loadout-db
 *
 * NON richiede puppeteer se il sito serve SSR (Next.js con __NEXT_DATA__).
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const http  = require('http');
const https = require('https');

// ─── Percorsi ─────────────────────────────────────────────────────────────────
const ROOT         = path.join(__dirname, '..');
const DATA_DIR     = path.join(ROOT, 'data');
const URLS_FILE    = path.join(DATA_DIR, 'codmunity-weapon-urls.json');
const WEAPONS_FILE = path.join(DATA_DIR, 'loadout-weapons.json');
const ATT_FILE     = path.join(DATA_DIR, 'loadout-attachments.json');
const COMPAT_FILE  = path.join(DATA_DIR, 'loadout-compatibility.json');
const REPORT_FILE  = path.join(DATA_DIR, 'loadout-import-report.json');

// ─── Mappature ────────────────────────────────────────────────────────────────
const CATEGORY_MAP = {
  'assault rifle'    : "Fucile d'assalto",
  'smg'              : 'Mitraglietta',
  'submachine gun'   : 'Mitraglietta',
  'lmg'              : 'Mitragliatrice leggera',
  'light machine gun': 'Mitragliatrice leggera',
  'marksman rifle'   : 'Fucile tattico',
  'battle rifle'     : 'Fucile da battaglia',
  'sniper rifle'     : 'Cecchino',
  'sniper'           : 'Cecchino',
  'shotgun'          : 'Shotgun',
  'pistol'           : 'Pistola',
  'handgun'          : 'Pistola',
};

const SLOT_MAP = {
  'optic'        : 'Ottica',
  'optics'       : 'Ottica',
  'muzzle'       : 'Volata',
  'barrel'       : 'Canna',
  'underbarrel'  : 'Sottocanna',
  'under barrel' : 'Sottocanna',
  'magazine'     : 'Caricatore',
  'mag'          : 'Caricatore',
  'rear grip'    : 'Impugnatura',
  'grip'         : 'Impugnatura',
  'stock'        : 'Calcio',
  'laser'        : 'Laser',
  'fire mods'    : 'Mod fuoco',
  'fire mod'     : 'Mod fuoco',
  // passthrough IT
  'ottica'       : 'Ottica',
  'volata'       : 'Volata',
  'canna'        : 'Canna',
  'sottocanna'   : 'Sottocanna',
  'caricatore'   : 'Caricatore',
  'impugnatura'  : 'Impugnatura',
  'calcio'       : 'Calcio',
  'mod fuoco'    : 'Mod fuoco',
};

const VALID_SLOTS = new Set([
  'Ottica','Volata','Canna','Sottocanna','Caricatore',
  'Impugnatura','Calcio','Laser','Mod fuoco'
]);

// ─── Helpers ──────────────────────────────────────────────────────────────────
function toSlug(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
function normalizeSlot(raw) {
  if (!raw) return null;
  return SLOT_MAP[String(raw).trim().toLowerCase()] || null;
}
function normalizeCategory(raw) {
  if (!raw) return "Fucile d'assalto";
  const k = String(raw).trim().toLowerCase();
  return CATEGORY_MAP[k] || raw.trim();
}
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
        'Accept'         : 'text/html,application/xhtml+xml,*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control'  : 'no-cache',
      },
      timeout: 20000,
    }, res => {
      if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location) {
        req.destroy();
        const loc = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        return resolve(httpGet(loc, redirects - 1));
      }
      if (res.statusCode === 404) {
        const e = new Error(`HTTP 404`);
        e.isNotFound = true;
        req.destroy();
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
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

// ─── Parser __NEXT_DATA__ ─────────────────────────────────────────────────────
function extractFromNextData(html) {
  const match = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) return null;
  try { return JSON.parse(match[1]); }
  catch { return null; }
}

/** Cerca ricorsivamente un oggetto che sembra un'arma */
function findWeaponObject(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 8) return null;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const r = findWeaponObject(item, depth + 1);
      if (r) return r;
    }
    return null;
  }
  const hasName = obj.name || obj.weapon_name || obj.title || obj.weaponName;
  const hasAtts = obj.attachments || obj.slots || obj.attachment_list || obj.categories || obj.attachmentCategories;
  if (hasName && hasAtts) return obj;
  for (const key of Object.keys(obj)) {
    const r = findWeaponObject(obj[key], depth + 1);
    if (r) return r;
  }
  return null;
}

/** Normalizza i vari formati di dati arma in { name, category, attachments[] } */
function normalizeWeaponData(raw) {
  if (!raw) return null;
  const name = String(raw.name || raw.weapon_name || raw.weaponName || raw.title || '').trim();
  const catRaw = raw.category || raw.weapon_type || raw.type || raw.class || raw.weaponClass || '';
  const category = normalizeCategory(catRaw);

  const attachments = [];

  // Formato 1: array piatto [{slot, name}]
  const flatArr = raw.attachments || raw.attachment_list || raw.attachmentList || null;
  if (Array.isArray(flatArr)) {
    for (const a of flatArr) {
      if (!a || typeof a !== 'object') continue;
      const slot = normalizeSlot(a.slot || a.type || a.category || a.attachmentType || a.slotName || '');
      const attName = String(a.name || a.attachment_name || a.attachmentName || a.title || '').trim();
      if (slot && attName) attachments.push({ slot, name: attName });
    }
  }

  // Formato 2: oggetto slot->{items[]}
  const slotsObj = raw.slots || raw.attachmentSlots || null;
  if (!attachments.length && slotsObj && typeof slotsObj === 'object' && !Array.isArray(slotsObj)) {
    for (const [slotKey, items] of Object.entries(slotsObj)) {
      const slot = normalizeSlot(slotKey);
      if (!slot) continue;
      const arr = Array.isArray(items) ? items : (items ? [items] : []);
      for (const a of arr) {
        const attName = typeof a === 'string' ? a : String(a.name || a.title || '').trim();
        if (attName) attachments.push({ slot, name: attName });
      }
    }
  }

  // Formato 3: array di categorie [{name/slot, items/attachments}]
  const catsArr = raw.categories || raw.attachmentCategories || null;
  if (!attachments.length && Array.isArray(catsArr)) {
    for (const cat of catsArr) {
      const slot = normalizeSlot(cat.name || cat.slot || cat.type || cat.category || '');
      if (!slot) continue;
      const items = cat.items || cat.attachments || cat.list || cat.options || [];
      for (const a of (Array.isArray(items) ? items : [])) {
        const attName = typeof a === 'string' ? a : String(a.name || a.title || '').trim();
        if (attName) attachments.push({ slot, name: attName });
      }
    }
  }

  return { name, category, attachments };
}

// ─── Parser HTML fallback (regex sul testo grezzo) ────────────────────────────
/**
 * Quando __NEXT_DATA__ non contiene i dati strutturati,
 * cerca nel testo HTML le sezioni degli slot con regex.
 * CODMunity usa pattern tipo:
 *   <div class="...slot-name...">Muzzle</div>
 *   <div class="...attachment-name...">Monolithic Suppressor</div>
 */
function extractFromHTML(html) {
  // Prova a trovare il nome dell'arma dal titolo o heading
  let name = '';
  const titleMatch = html.match(/<title[^>]*>([^<]+)/i);
  if (titleMatch) {
    // "XM4 Best Loadouts & Attachments - CODMunity" → "XM4"
    name = titleMatch[1].split(/[|–\-]/)[0].trim();
    name = name.replace(/best\s+(loadout|attachments?).*/i, '').trim();
  }
  if (!name) {
    const h1 = html.match(/<h1[^>]*>([^<]+)/i);
    if (h1) name = h1[1].trim();
  }

  // Cerca tipo arma (assault rifle, smg, etc.)
  let category = "Fucile d'assalto";
  for (const k of Object.keys(CATEGORY_MAP)) {
    // case-insensitive cerca nel body
    if (new RegExp('\\b' + k.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + '\\b', 'i').test(html)) {
      category = CATEGORY_MAP[k];
      break;
    }
  }

  const attachments = [];
  // Cerca ogni slot noto nel testo e raccoglie i nomi vicini
  for (const [slotKey, slotIT] of Object.entries(SLOT_MAP)) {
    if (!VALID_SLOTS.has(slotIT)) continue;
    const escaped = slotKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // pattern: cerca "Muzzle" (case-insensitive) poi i prossimi ~500 char
    const re = new RegExp(escaped + '[\\s\\S]{0,600}', 'gi');
    const section = html.match(re);
    if (!section) continue;
    // Cerca nomi di accessori (parole con maiuscola, non tag HTML)
    const names = section[0]
      .replace(/<[^>]+>/g, ' ')          // strip HTML
      .replace(/&[a-z]+;/g, ' ')         // strip entities
      .split(/[\n\r]+/)                  // per riga
      .map(l => l.trim())
      .filter(l => l.length > 2 && l.length < 80)
      .filter(l => /[A-Z]/.test(l))      // ha almeno una maiuscola (nome accessorio)
      .filter(l => !/<|>|{|}/.test(l));  // non è HTML/JS
    for (const n of names.slice(0, 20)) {
      if (n.toLowerCase().includes(slotKey)) continue; // salta l'header stesso
      attachments.push({ slot: slotIT, name: n });
    }
  }

  return { name, category, attachments };
}

// ─── Pupeteer fallback (opzionale) ───────────────────────────────────────────
let puppeteer = null;
let pBrowser  = null;
async function initPuppeteer() {
  if (puppeteer !== null) return puppeteer !== false;
  try {
    puppeteer = require('puppeteer');
    return true;
  } catch {
    puppeteer = false;
    console.log('  ℹ Puppeteer non disponibile — uso solo fetch+HTML (OK per SSR)');
    return false;
  }
}
async function getPuppeteerPage() {
  if (!pBrowser) {
    pBrowser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu']
    });
  }
  const page = await pBrowser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36');
  await page.setRequestInterception(true);
  page.on('request', req => {
    if (['image','media','font'].includes(req.resourceType())) req.abort();
    else req.continue();
  });
  return page;
}

// ─── Processa singola URL ─────────────────────────────────────────────────────
async function processUrl(url) {
  // Tentativo 1: fetch nativo + __NEXT_DATA__
  let html = null;
  try {
    const resp = await httpGet(url);
    html = resp.html;
  } catch (e) {
    if (e.isNotFound || e.message.includes('404')) {
      const err = new Error(`HTTP 404 — slug probabilmente errato`);
      err.isNotFound = true;
      throw err;
    }
    // Altri errori HTTP: tenta con Puppeteer se disponibile
    const hasPuppeteer = await initPuppeteer();
    if (!hasPuppeteer) throw e;
    console.log('  ↪ fetch fallito, provo con Puppeteer...');
    const page = await getPuppeteerPage();
    try {
      const resp = await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      if (resp && resp.status() === 404) {
        await page.close();
        const err = new Error('HTTP 404');
        err.isNotFound = true;
        throw err;
      }
      await page.waitForSelector('h1', { timeout: 8000 }).catch(() => {});
      html = await page.content();
      await page.close();
    } catch (pe) {
      try { await page.close(); } catch {}
      throw pe;
    }
  }

  if (!html) throw new Error('Nessun contenuto ricevuto');

  // Prova __NEXT_DATA__
  let result = null;
  const nextDataRaw = extractFromNextData(html);
  if (nextDataRaw) {
    // Cerca l'oggetto arma a vari livelli
    const weaponObj = findWeaponObject(nextDataRaw);
    result = normalizeWeaponData(weaponObj);
  }

  // Se __NEXT_DATA__ non ha dati strutturati, usa HTML parser
  if (!result || (!result.name && !result.attachments.length)) {
    result = extractFromHTML(html);
    result._method = 'HTML-regex';
  } else {
    result._method = '__NEXT_DATA__';
  }

  // Nome fallback dall'URL slug
  if (!result.name) {
    const slug = url.split('/').pop();
    result.name = slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    result._method += '+slug-fallback';
  }

  return result;
}

// ─── Rileva gioco dall'URL ────────────────────────────────────────────────────
function getGame(url) {
  const m = url.match(/\/weapon\/(bo\d+)\//i);
  return m ? m[1].toUpperCase() : 'UNKNOWN';
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n══════════════════════════════════════════════════');
  console.log('  RØDA Loadabot — Build DB from CODMunity');
  console.log('══════════════════════════════════════════════════');
  console.log(`  Node.js: ${process.version}`);
  console.log(`  Data: ${nowISO()}\n`);

  if (!fs.existsSync(URLS_FILE)) {
    console.error(`File non trovato: ${URLS_FILE}`);
    process.exit(1);
  }

  const allUrls = JSON.parse(fs.readFileSync(URLS_FILE, 'utf8'))
    .map(u => String(u).trim())
    .filter(Boolean);
  console.log(`URL da processare: ${allUrls.length}\n`);

  // Carica DB esistenti
  const weaponsMap     = new Map(readJSON(WEAPONS_FILE).map(w => [w.id, w]));
  const attachmentsMap = new Map(readJSON(ATT_FILE).map(a => [a.id, a]));
  const compatList     = readJSON(COMPAT_FILE);
  const compatSet      = new Set(compatList.map(c => `${c.armaId}::${c.accessorioId}`));

  // Conta URL per gioco
  const bo6Count = allUrls.filter(u => /\/weapon\/bo6\//i.test(u)).length;
  const bo7Count = allUrls.filter(u => /\/weapon\/bo7\//i.test(u)).length;
  console.log(`  BO6: ${bo6Count} URL | BO7: ${bo7Count} URL\n`);

  // Report
  const report = {
    generatedAt              : nowISO(),
    totalUrls                : allUrls.length,
    bo6Urls                  : { total: bo6Count, ok: 0, failed: 0, duplicated: 0 },
    bo7Urls                  : { total: bo7Count, ok: 0, failed: 0, duplicated: 0 },
    processedUrls            : [],
    failedUrls               : [],
    duplicatedWeaponsSkipped : [],
    weaponsImported          : 0,
    attachmentsImported      : 0,
    compatibilityImported    : 0,
    ignoredSlots             : [],
    errors                   : [],
  };

  // Traccia nomi arma visti per deduplicazione slug
  const seenWeaponNames = new Map(); // slug-nome → { url, id }

  for (let i = 0; i < allUrls.length; i++) {
    const url  = allUrls[i];
    const game = getGame(url);  // 'BO6' | 'BO7' | 'UNKNOWN'
    const gameKey = game === 'BO7' ? 'bo7Urls' : 'bo6Urls';
    process.stdout.write(`[${String(i+1).padStart(2)}/${allUrls.length}] [${game}] ${url}\n`);

    try {
      const data = await processUrl(url);

      const nameSlug = toSlug(data.name);

      // Gestione duplicati slug (es. swat-556 vs swat-5-56, mk-78 vs mk78)
      if (nameSlug && seenWeaponNames.has(nameSlug)) {
        const prev = seenWeaponNames.get(nameSlug);
        console.log(`      ⚠ Duplicato: "${data.name}" già visto da ${prev.url} → skip`);
        report.duplicatedWeaponsSkipped.push({ url, game, duplicateOf: prev.url, name: data.name });
        report.processedUrls.push({ url, game, status: 'duplicate', name: data.name });
        report[gameKey].duplicated++;
        const delay = 1200 + Math.floor(Math.random() * 400);
        await sleep(delay);
        continue;
      }

      const weaponId = nameSlug || toSlug(url.split('/').pop());
      if (!weaponId) throw new Error('Impossibile ricavare un ID arma valido');

      if (nameSlug) seenWeaponNames.set(nameSlug, { url, id: weaponId });

      // Upsert arma
      const isNewWeapon = !weaponsMap.has(weaponId);
      weaponsMap.set(weaponId, {
        id        : weaponId,
        nome      : data.name,
        categoria : data.category || "Fucile d'assalto",
        gioco     : game,
        attiva    : true,
        verificata: false,
        fonte     : 'CODMunity',
        fonteUrl  : url,
        note      : 'Importato automaticamente da CODMunity. Da verificare.',
        updatedAt : nowISO(),
      });
      if (isNewWeapon) report.weaponsImported++;

      // Accessori
      const ignoredHere = [];
      let validAtts = 0;
      for (const att of (data.attachments || [])) {
        const slotIT = VALID_SLOTS.has(att.slot) ? att.slot : normalizeSlot(att.slot);
        if (!slotIT) {
          const entry = `[${data.name}] slot ignorato: "${att.slot}" → "${att.name}"`;
          if (!report.ignoredSlots.find(s => s === entry)) report.ignoredSlots.push(entry);
          ignoredHere.push(att.slot);
          continue;
        }
        const attId = toSlug(att.name);
        if (!attId) continue;

        if (!attachmentsMap.has(attId)) {
          attachmentsMap.set(attId, {
            id             : attId,
            nome           : att.name,
            tipo           : slotIT,
            armiCompatibili: [],
            attivo         : true,
            verificato     : false,
            fonte          : 'CODMunity',
            fonteUrl       : url,
            note           : 'Importato automaticamente da CODMunity. Da verificare.',
            updatedAt      : nowISO(),
          });
          report.attachmentsImported++;
        }
        const attEntry = attachmentsMap.get(attId);
        if (!Array.isArray(attEntry.armiCompatibili)) attEntry.armiCompatibili = [];
        if (!attEntry.armiCompatibili.includes(weaponId)) attEntry.armiCompatibili.push(weaponId);

        // Compatibilità
        const ck = `${weaponId}::${attId}`;
        if (!compatSet.has(ck)) {
          compatList.push({
            armaId       : weaponId,
            accessorioId : attId,
            compatibile  : true,
            verificato   : false,
            fonte        : 'CODMunity',
            fonteUrl     : url,
            note         : 'Importato automaticamente da CODMunity. Da verificare.',
            updatedAt    : nowISO(),
          });
          compatSet.add(ck);
          report.compatibilityImported++;
        }
        validAtts++;
      }

      const ignored = [...new Set(ignoredHere)];
      console.log(`      ✓ "${data.name}" [${data.category}] — ${validAtts} acc (${data._method})${ignored.length ? ` | slot ignorati: ${ignored.join(', ')}` : ''}`);
      report.processedUrls.push({
        url, game, status: 'ok',
        name       : data.name,
        category   : data.category,
        attachments: validAtts,
        method     : data._method,
      });
      report[gameKey].ok++;

    } catch (err) {
      const msg = err.message || String(err);
      console.log(`      ✗ ${msg}`);
      report.failedUrls.push({ url, game, error: msg });
      report.errors.push({ url, game, error: msg });
      report[gameKey].failed++;
    }

    // Delay anti-rate-limit
    if (i < allUrls.length - 1) {
      await sleep(1200 + Math.floor(Math.random() * 600));
    }
  }

  // ─── Chiudi Puppeteer se aperto ───────────────────────────────────────────
  if (pBrowser) { try { await pBrowser.close(); } catch {} }

  // ─── Salvataggio ──────────────────────────────────────────────────────────
  console.log('\n══ Salvataggio file DB... ══');
  writeJSON(WEAPONS_FILE,  Array.from(weaponsMap.values()));
  writeJSON(ATT_FILE,      Array.from(attachmentsMap.values()));
  writeJSON(COMPAT_FILE,   compatList);
  writeJSON(REPORT_FILE,   report);
  console.log('  ✓ loadout-weapons.json');
  console.log('  ✓ loadout-attachments.json');
  console.log('  ✓ loadout-compatibility.json');
  console.log('  ✓ loadout-import-report.json');

  // ─── Riepilogo ────────────────────────────────────────────────────────────
  const ok  = report.processedUrls.filter(u => u.status === 'ok').length;
  const dup = report.duplicatedWeaponsSkipped.length;
  const fail= report.failedUrls.length;
  console.log('\n══════════════════════════════════════════════════');
  console.log('  RIEPILOGO');
  console.log('══════════════════════════════════════════════════');
  console.log(`  URL totali                : ${allUrls.length}`);
  console.log(`  ─────────────────────────────────────────────`);
  console.log(`  BO6  ✓ ok: ${report.bo6Urls.ok}  ✗ fail: ${report.bo6Urls.failed}  ⚠ dup: ${report.bo6Urls.duplicated}  (tot: ${report.bo6Urls.total})`);
  console.log(`  BO7  ✓ ok: ${report.bo7Urls.ok}  ✗ fail: ${report.bo7Urls.failed}  ⚠ dup: ${report.bo7Urls.duplicated}  (tot: ${report.bo7Urls.total})`);
  console.log(`  ─────────────────────────────────────────────`);
  console.log(`  ✓ Processati con successo : ${ok}`);
  console.log(`  ⚠ Duplicati saltati       : ${dup}`);
  console.log(`  ✗ URL falliti             : ${fail}`);
  console.log(`  ─────────────────────────────────────────────`);
  console.log(`  Armi importate            : ${report.weaponsImported}`);
  console.log(`  Accessori importati       : ${report.attachmentsImported}`);
  console.log(`  Compatibilità importate   : ${report.compatibilityImported}`);
  console.log(`  Slot ignorati (non validi): ${report.ignoredSlots.length}`);
  console.log('══════════════════════════════════════════════════');

  if (fail > 0) {
    console.log('\n⚠  URL falliti:');
    report.failedUrls.forEach(f => console.log(`   - ${f.url}\n     → ${f.error}`));
  }
  if (report.ignoredSlots.length > 0) {
    console.log('\nℹ  Slot non riconosciuti (saltati):');
    report.ignoredSlots.forEach(s => console.log(`   ${s}`));
  }

  console.log('\n✅ Build completato.');
  console.log('   Tutti i dati sono NON verificati.');
  console.log('   Vai su /admin-loadout → Database → Da verificare per approvarli.\n');
}

main().catch(e => {
  console.error('\n[ERRORE FATALE]', e.message);
  try {
    const r = readJSON(REPORT_FILE);
    writeJSON(REPORT_FILE, { ...r, fatalError: e.message, fatalStack: e.stack });
  } catch {}
  if (pBrowser) { try { pBrowser.close(); } catch {} }
  process.exit(1);
});
