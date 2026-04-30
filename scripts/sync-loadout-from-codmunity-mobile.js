'use strict';

/**
 * RØDA Loadout Sync — CODMunity Mobile Builder
 *
 * Replica la logica vista da cellulare su https://codmunity.gg/create-loadout:
 * 1. entra nel builder mobile
 * 2. seleziona l'arma
 * 3. apre ogni slot accessorio
 * 4. legge le opzioni visibili nel menu dello slot
 * 5. crea SOLO armi, accessori e compatibilità
 *
 * Non pubblica build automatiche.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const URLS_FILE = path.join(DATA, 'codmunity-weapon-urls.json');
const WEAPONS_FILE = path.join(DATA, 'loadout-weapons.json');
const ATTACHMENTS_FILE = path.join(DATA, 'loadout-attachments.json');
const COMPAT_FILE = path.join(DATA, 'loadout-compatibility.json');
const BUILDS_FILE = path.join(DATA, 'loadout-builds.json');
const REPORT_FILE = path.join(DATA, 'loadout-codmunity-mobile-sync-report.json');

const SOURCE = 'CODMunity Mobile Builder';
const BUILDER_URL = 'https://codmunity.gg/create-loadout';
const LIMIT = Number((process.argv.find(a => /^--limit=\d+$/.test(a)) || '').split('=')[1] || 0) || null;
const DELAY = Number(process.env.CODMUNITY_MOBILE_SYNC_DELAY_MS || 900);
const DEBUG = process.env.LOADOUT_SYNC_DEBUG === 'true';

const SLOT_ALIASES = {
  Ottica: ['Ottica', 'Optic', 'Optics'],
  Volata: ['Volata', 'Muzzle'],
  Canna: ['Canna', 'Barrel'],
  Sottocanna: ['Sottocanna', 'Underbarrel', 'Under Barrel'],
  Caricatore: ['Caricatore', 'Magazine', 'Mag'],
  Impugnatura: ['Impugnatura', 'Rear Grip', 'Grip'],
  Calcio: ['Calcio', 'Stock'],
  Laser: ['Laser'],
  'Mod fuoco': ['Mod fuoco', 'Fire Mods', 'Fire Mod'],
  Munizioni: ['Munizioni', 'Ammunition', 'Ammo'],
  'Kit conversione': ['Kit conversione', 'Conversion Kit']
};
const SLOT_ORDER = Object.keys(SLOT_ALIASES);
const SLOT_MAP = new Map(Object.entries(SLOT_ALIASES).flatMap(([it, arr]) => arr.map(x => [x.toLowerCase(), it])));

const CATEGORY_FALLBACK = new Map([
  ['xm4', 'Fucile d\'assalto'], ['ak-74', 'Fucile d\'assalto'], ['ames-85', 'Fucile d\'assalto'], ['gpr-91', 'Fucile d\'assalto'], ['model-l', 'Fucile d\'assalto'], ['goblin-mk2', 'Fucile d\'assalto'], ['as-val', 'Fucile d\'assalto'], ['krig-c', 'Fucile d\'assalto'], ['maddox-rfb', 'Fucile d\'assalto'],
  ['c9', 'Mitraglietta'], ['jackal-pdw', 'Mitraglietta'], ['tanto-22', 'Mitraglietta'], ['ksv', 'Mitraglietta'], ['kompakt-92', 'Mitraglietta'], ['saug', 'Mitraglietta'], ['ppsh-41', 'Mitraglietta'], ['ladra', 'Mitraglietta'],
  ['pu-21', 'Mitragliatrice leggera'], ['xmg', 'Mitragliatrice leggera'], ['gpmg-7', 'Mitragliatrice leggera'], ['feng-82', 'Mitragliatrice leggera'],
  ['tsarkov-7-62', 'Fucile tattico'], ['aek-973', 'Fucile tattico'], ['swat-5-56', 'Fucile tattico'], ['dm-10', 'Fucile tattico'], ['tr2', 'Fucile tattico'],
  ['lw3a1-frostline', 'Cecchino'], ['svd', 'Cecchino'], ['lr-7-62', 'Cecchino'], ['hdr', 'Cecchino'],
  ['marine-sp', 'Shotgun'], ['asg-89', 'Shotgun'], ['maeltrom', 'Shotgun'],
  ['gs45', 'Pistola'], ['9mm-pm', 'Pistola'], ['grekhova', 'Pistola'], ['stryder-22', 'Pistola']
]);

const BAD_RX = /\b(cookie|privacy|terms|login|register|subscribe|newsletter|discord|telegram|twitter|instagram|youtube|tiktok|promo|discount|coupon|code|store|shop|premium|advertisement|sponsored|patch notes|tier list|home|menu|search|filter|sort|copy link|share|follow|prestige|unlock|sblocca|scatta una foto|loadout name|description|codice di condivisione|accessori popolari|selezione rapida)\b/i;
const STAT_RX = /\b(ads speed|ads movement|aim down sight|recoil control|rinculo|damage range|bullet velocity|sprint to fire|movement speed|fire rate|mobility|handling|accuracy|damage|control|ttk|rpm|reload speed|magazine size)\b/i;

function read(file, fallback = []) { try { if (!fs.existsSync(file)) return fallback; const raw = fs.readFileSync(file, 'utf8'); return raw.trim() ? JSON.parse(raw) : fallback; } catch (_) { return fallback; } }
function write(file, data) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8'); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function clean(v) { return String(v || '').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim(); }
function slug(v) { return clean(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
function today() { return new Date().toISOString().slice(0, 10); }
function nowIso() { return new Date().toISOString(); }
function normalizeSlot(v) { return SLOT_MAP.get(clean(v).toLowerCase()) || null; }
function weaponIdFromUrl(url) { return String(url || '').split('/').filter(Boolean).pop() || ''; }
function gameFromUrl(url, item = {}) { const m = String(url || '').match(/\/weapon\/(bo\d+)\//i); return String(item.game || (m && m[1]) || 'Warzone').toUpperCase(); }
function nameFromId(id) { return String(id || '').split('-').map(p => p.length <= 3 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1)).join(' '); }
function categoryForWeapon(id) { return CATEGORY_FALLBACK.get(id) || 'Da verificare'; }
function isBadAttachmentName(v) {
  const n = clean(v);
  if (!n || n.length < 2 || n.length > 74 || !/[a-zA-Z0-9]/.test(n)) return true;
  if (normalizeSlot(n)) return true;
  if (/^level\s*\d+$/i.test(n) || /^lvl\s*\d+$/i.test(n)) return true;
  if (/^\+?\-?\d+(\.\d+)?%?$/.test(n)) return true;
  if (BAD_RX.test(n)) return true;
  if (n.includes('://') || n.includes('.gg') || n.includes('@')) return true;
  if (n.split(' ').length > 8) return true;
  return false;
}
function cleanAttachmentName(v) {
  return clean(v)
    .replace(/^[-–—•*]\s*/, '')
    .replace(/\s+Level\s*\d+$/i, '')
    .replace(/\s+Unlock(?:ed)?\s+at\s+Level\s*\d+$/i, '')
    .replace(/\s+Required\s+Level\s*\d+$/i, '')
    .trim();
}
function getWeaponItems() {
  const raw = read(URLS_FILE, []);
  return raw.map((entry, index) => {
    const url = typeof entry === 'string' ? entry : entry.url;
    const id = weaponIdFromUrl(url);
    return { id, url, game: gameFromUrl(url, entry || {}), nome: (entry && (entry.nome || entry.name)) || nameFromId(id), codmunityOrder: Number((entry && entry.codmunityOrder) || index + 1), discoveredAt: (entry && entry.discoveredAt) || today() };
  }).filter(w => w.id && w.url).slice(0, LIMIT || undefined);
}

async function safeScreenshot(page, name) {
  if (!DEBUG) return null;
  try {
    const file = path.join(DATA, `debug-${name}.png`);
    await page.screenshot({ path: file, fullPage: true });
    return file;
  } catch (_) { return null; }
}

async function acceptBanners(page) {
  await page.evaluate(() => {
    const words = ['accept', 'agree', 'ok', 'accetta', 'acconsento'];
    for (const el of Array.from(document.querySelectorAll('button,[role="button"]'))) {
      const t = (el.innerText || el.textContent || '').toLowerCase().trim();
      if (words.some(w => t.includes(w))) el.click();
    }
  }).catch(() => {});
}

async function openBuilder(page) {
  await page.goto(BUILDER_URL, { waitUntil: 'networkidle2', timeout: 70000 });
  await sleep(900);
  await acceptBanners(page);
}

async function typeIntoBestSearch(page, text) {
  return page.evaluate((value) => {
    const inputs = Array.from(document.querySelectorAll('input'))
      .filter(i => !i.disabled && i.offsetParent !== null)
      .map(i => ({ i, score: `${i.placeholder || ''} ${i.getAttribute('aria-label') || ''} ${i.type || ''}`.toLowerCase() }))
      .sort((a, b) => (b.score.includes('search') ? 1 : 0) - (a.score.includes('search') ? 1 : 0));
    const target = inputs[0] && inputs[0].i;
    if (!target) return false;
    target.focus();
    target.value = '';
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.value = value;
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, text);
}

async function clickText(page, texts, opts = {}) {
  const arr = Array.isArray(texts) ? texts : [texts];
  return page.evaluate(({ arr, exact, maxLen }) => {
    const wanted = arr.map(x => String(x || '').toLowerCase().trim()).filter(Boolean);
    const candidates = Array.from(document.querySelectorAll('button,a,[role="button"],[role="option"],li,div,span'))
      .filter(el => {
        const rect = el.getBoundingClientRect();
        if (rect.width < 18 || rect.height < 12 || rect.bottom < 0 || rect.top > innerHeight) return false;
        const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
        if (!text || text.length > maxLen) return false;
        const low = text.toLowerCase();
        return wanted.some(w => exact ? low === w : low.includes(w));
      })
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    if (!candidates[0]) return false;
    candidates[0].scrollIntoView({ block: 'center', inline: 'center' });
    candidates[0].click();
    return true;
  }, { arr, exact: !!opts.exact, maxLen: opts.maxLen || 110 });
}

async function selectWeapon(page, weapon) {
  const weaponName = weapon.nome || nameFromId(weapon.id);
  const candidates = [weaponName, weapon.id.replace(/-/g, ' '), weapon.id].filter(Boolean);

  // Prova: se c'è un campo/cerca arma nel builder, digita e clicca il risultato.
  await typeIntoBestSearch(page, weaponName).catch(() => false);
  await sleep(700);
  if (await clickText(page, candidates, { maxLen: 90 })) return true;

  // Prova ad aprire un selettore arma/weapon e cercare di nuovo.
  await clickText(page, ['arma', 'weapon', 'select weapon', 'scegli arma'], { maxLen: 120 }).catch(() => false);
  await sleep(500);
  await typeIntoBestSearch(page, weaponName).catch(() => false);
  await sleep(700);
  if (await clickText(page, candidates, { maxLen: 90 })) return true;

  // Alcuni builder accettano URL parametrici: proviamo e poi verifichiamo se compare l'arma.
  const urls = [
    `${BUILDER_URL}?weapon=${encodeURIComponent(weapon.id)}`,
    `${BUILDER_URL}?weapon=${encodeURIComponent(weaponName)}`,
    `${BUILDER_URL}?w=${encodeURIComponent(weapon.id)}`
  ];
  for (const url of urls) {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 70000 }).catch(() => null);
    await sleep(900);
    const found = await page.evaluate((names) => {
      const body = (document.body && document.body.innerText || '').toLowerCase();
      return names.some(n => body.includes(String(n).toLowerCase()));
    }, candidates);
    if (found) return true;
  }
  return false;
}

async function openSlot(page, slotName) {
  const aliases = SLOT_ALIASES[slotName] || [slotName];
  return clickText(page, aliases, { exact: false, maxLen: 80 });
}

async function extractOpenDropdownOptions(page, slotName) {
  return page.evaluate(({ slotName }) => {
    const badRx = /cookie|privacy|terms|login|register|subscribe|newsletter|discord|telegram|twitter|instagram|youtube|tiktok|promo|discount|coupon|code|store|shop|premium|advertisement|sponsored|patch notes|tier list|home|menu|search|filter|sort|copy link|share|follow|prestige|unlock|sblocca|scatta una foto|loadout name|description|codice di condivisione|accessori popolari|selezione rapida/i;
    const statRx = /ads speed|ads movement|aim down sight|recoil control|rinculo|damage range|bullet velocity|sprint to fire|movement speed|fire rate|mobility|handling|accuracy|damage|control|ttk|rpm|reload speed|magazine size/i;
    const clean = v => String(v || '').replace(/\s+/g, ' ').trim();
    const visible = el => {
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      return r.width > 20 && r.height > 12 && r.bottom > 0 && r.top < innerHeight && st.display !== 'none' && st.visibility !== 'hidden';
    };
    const badContainer = el => !!el.closest('header,footer,nav,[class*="cookie"],[class*="promo"],[class*="discount"],[class*="social"],[class*="ad"]');
    const badName = n => {
      n = clean(n);
      if (!n || n.length < 2 || n.length > 74 || !/[a-zA-Z0-9]/.test(n)) return true;
      if (/^level\s*\d+$/i.test(n) || /^lvl\s*\d+$/i.test(n)) return true;
      if (/^\+?\-?\d+(\.\d+)?%?$/.test(n)) return true;
      if (badRx.test(n)) return true;
      if (n.includes('://') || n.includes('.gg') || n.includes('@')) return true;
      if (n.split(' ').length > 8) return true;
      return false;
    };
    const roots = Array.from(document.querySelectorAll('[role="listbox"],[role="menu"],[role="dialog"],[class*="dropdown"],[class*="popover"],[class*="select"],[class*="modal"]'))
      .filter(el => visible(el) && !badContainer(el));
    const scanRoots = roots.length ? roots : [document.body];
    const raw = [];
    for (const root of scanRoots) {
      const els = Array.from(root.querySelectorAll('[data-name],[data-value],[role="option"],button,li,div'))
        .filter(el => visible(el) && !badContainer(el));
      for (const el of els) {
        let text = clean(el.getAttribute('data-name') || el.getAttribute('data-value') || el.getAttribute('aria-label') || el.getAttribute('title') || el.innerText || el.textContent);
        const lines = text.split('\n').map(clean).filter(Boolean);
        if (lines.length > 1) text = lines.find(x => !badName(x) && !statRx.test(x)) || '';
        text = clean(text).replace(/\s+Level\s*\d+$/i, '').trim();
        if (badName(text)) continue;
        raw.push(text);
      }
    }
    const seen = new Set();
    return raw.filter(name => {
      const key = name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).map(name => ({ slot: slotName, name }));
  }, { slotName });
}

async function extractWeaponAttachments(page, weapon) {
  const out = [];
  for (const slotName of SLOT_ORDER) {
    const opened = await openSlot(page, slotName);
    if (!opened) continue;
    await sleep(650);
    let items = await extractOpenDropdownOptions(page, slotName);
    items = items.map(x => ({ slot: x.slot, name: cleanAttachmentName(x.name) })).filter(x => !isBadAttachmentName(x.name));
    out.push(...items);
    await page.keyboard.press('Escape').catch(() => {});
    await sleep(180);
  }
  const seen = new Set();
  return out.filter(item => {
    const key = item.slot + '__' + slug(item.name);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mergeWeapon(weapons, weapon) {
  const todayStr = today();
  if (weapons.some(w => w.id === weapon.id)) return;
  weapons.push({
    id: weapon.id,
    nome: weapon.nome || nameFromId(weapon.id),
    categoria: categoryForWeapon(weapon.id),
    gioco: weapon.game || 'Warzone',
    attiva: true,
    verificata: true,
    fonte: SOURCE,
    fonteUrl: BUILDER_URL,
    note: 'Arma importata dal builder mobile CODMunity. Gli utenti creano le build dal sito RØDA.',
    stato: 'pubblico',
    codmunityOrder: weapon.codmunityOrder,
    discoveredAt: weapon.discoveredAt || todayStr,
    updatedAt: todayStr
  });
}

function mergeCompatibility(state, weapon, items) {
  const { weapons, attachments, compatibility } = state;
  mergeWeapon(weapons, weapon);
  const attMap = new Map(attachments.map(a => [a.id, a]));
  const compMap = new Map(compatibility.map(c => [`${c.armaId}__${c.accessorioId}`, c]));
  const todayStr = today();
  items.forEach((item, index) => {
    const name = cleanAttachmentName(item.name);
    const id = slug(name);
    if (!id || isBadAttachmentName(name)) return;
    if (!attMap.has(id)) {
      const att = { id, nome: name, tipo: item.slot, attivo: true, verificato: true, fonte: SOURCE, fonteUrl: BUILDER_URL, note: 'Accessorio letto dallo slot reale del builder mobile CODMunity.', stato: 'pubblico', updatedAt: todayStr, codmunityOrder: index + 1 };
      attachments.push(att);
      attMap.set(id, att);
    }
    const key = `${weapon.id}__${id}`;
    if (!compMap.has(key)) {
      const row = { id: key, armaId: weapon.id, accessorioId: id, slot: item.slot, compatibile: true, verificato: true, fonte: SOURCE, fonteUrl: BUILDER_URL, note: 'Compatibilità letta dallo slot reale del builder mobile CODMunity.', stato: 'pubblico', updatedAt: todayStr, codmunityOrder: index + 1 };
      compatibility.push(row);
      compMap.set(key, row);
    }
  });
}

async function main() {
  const report = {
    startedAt: nowIso(),
    source: SOURCE,
    mode: 'codmunity-mobile-builder-slot-options',
    processedWeapons: [],
    failedWeapons: [],
    weaponsImported: 0,
    attachmentsImported: 0,
    compatibilityImported: 0,
    removedPreviousDatabase: {
      weapons: read(WEAPONS_FILE, []).length,
      attachments: read(ATTACHMENTS_FILE, []).length,
      compatibility: read(COMPAT_FILE, []).length,
      builds: read(BUILDS_FILE, []).length
    },
    finishedAt: null
  };

  const weapons = [];
  const attachments = [];
  const compatibility = [];
  const builds = read(BUILDS_FILE, []).filter(b => ![SOURCE, 'FPSMeta', 'WZLoad', 'WarzoneLoadout', 'CODMunity'].includes(b.fonte));
  const list = getWeaponItems();

  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
    await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');

    for (let i = 0; i < list.length; i++) {
      const weapon = list[i];
      console.log(`[${i + 1}/${list.length}] CODMunity mobile: ${weapon.nome}`);
      try {
        await openBuilder(page);
        const selected = await selectWeapon(page, weapon);
        await sleep(900);
        const items = selected ? await extractWeaponAttachments(page, weapon) : [];
        if (items.length) mergeCompatibility({ weapons, attachments, compatibility }, weapon, items);
        report.processedWeapons.push({ armaId: weapon.id, nome: weapon.nome, selected, attachmentsFound: items.length });
        console.log(`  ${selected ? 'selezionata' : 'NON selezionata'} · ${items.length} accessori`);
        if (DEBUG && (!selected || !items.length)) await safeScreenshot(page, `codmunity-${weapon.id}`);
      } catch (error) {
        report.failedWeapons.push({ armaId: weapon.id, nome: weapon.nome, error: error.message });
        console.log(`  ERRORE ${error.message}`);
      }
      write(WEAPONS_FILE, weapons);
      write(ATTACHMENTS_FILE, attachments);
      write(COMPAT_FILE, compatibility);
      write(REPORT_FILE, { ...report, finishedAt: nowIso() });
      await sleep(DELAY);
    }
  } finally {
    await browser.close().catch(() => {});
  }

  report.weaponsImported = weapons.length;
  report.attachmentsImported = attachments.length;
  report.compatibilityImported = compatibility.length;
  report.finishedAt = nowIso();
  write(WEAPONS_FILE, weapons);
  write(ATTACHMENTS_FILE, attachments);
  write(COMPAT_FILE, compatibility);
  write(BUILDS_FILE, builds);
  write(REPORT_FILE, report);
  console.log('Sync CODMunity mobile completato:', report);
}

main().catch(error => { console.error(error); process.exit(1); });
