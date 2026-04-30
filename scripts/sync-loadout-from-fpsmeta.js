'use strict';

/**
 * RØDA Loadout Sync — FPSMeta
 *
 * Fonte: https://fpsmeta.gg/warzone-meta
 * Questo script NON pubblica build già pronte.
 * Usa le build FPSMeta solo come fonte per creare:
 * - armi
 * - accessori
 * - compatibilità arma/accessorio
 *
 * Gli utenti creano le loro build dal sito RØDA.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const WEAPONS_FILE = path.join(DATA, 'loadout-weapons.json');
const ATTACHMENTS_FILE = path.join(DATA, 'loadout-attachments.json');
const COMPAT_FILE = path.join(DATA, 'loadout-compatibility.json');
const BUILDS_FILE = path.join(DATA, 'loadout-builds.json');
const REPORT_FILE = path.join(DATA, 'loadout-fpsmeta-sync-report.json');

const SOURCE = 'FPSMeta';
const START_URLS = [
  'https://fpsmeta.gg/warzone-meta',
  'https://fpsmeta.gg/warzone-loadouts',
  'https://fpsmeta.gg/'
];
const LIMIT = Number((process.argv.find(a => /^--limit=\d+$/.test(a)) || '').split('=')[1] || 0) || null;
const DELAY = Number(process.env.FPSMETA_SYNC_DELAY_MS || 900);

const SLOT_MAP = new Map([
  ['optic', 'Ottica'], ['optics', 'Ottica'], ['ottica', 'Ottica'],
  ['muzzle', 'Volata'], ['volata', 'Volata'],
  ['barrel', 'Canna'], ['canna', 'Canna'],
  ['underbarrel', 'Sottocanna'], ['under barrel', 'Sottocanna'], ['sottocanna', 'Sottocanna'],
  ['magazine', 'Caricatore'], ['mag', 'Caricatore'], ['caricatore', 'Caricatore'],
  ['rear grip', 'Impugnatura'], ['rear-grip', 'Impugnatura'], ['grip', 'Impugnatura'], ['impugnatura', 'Impugnatura'],
  ['stock', 'Calcio'], ['calcio', 'Calcio'],
  ['laser', 'Laser'],
  ['fire mods', 'Mod fuoco'], ['fire mod', 'Mod fuoco'], ['fire-mods', 'Mod fuoco'], ['mod fuoco', 'Mod fuoco'],
  ['ammunition', 'Munizioni'], ['ammo', 'Munizioni'], ['munizioni', 'Munizioni'],
  ['conversion kit', 'Kit conversione'], ['sling', 'Cinghia']
]);
const CATEGORY_HINTS = [
  ['smg', 'Mitraglietta'], ['sniper', 'Cecchino'], ['lmg', 'Mitragliatrice leggera'], ['shotgun', 'Shotgun'], ['pistol', 'Pistola'], ['marksman', 'Fucile tattico'], ['battle rifle', 'Fucile da battaglia'], ['assault rifle', 'Fucile d\'assalto'], ['rifle', 'Fucile tattico']
];
const BAD_RX = /\b(cookie|privacy|terms|login|register|subscribe|newsletter|discord|telegram|twitter|instagram|youtube|tiktok|promo|discount|coupon|code|store|shop|premium|advertisement|sponsored|patch notes|tier list|home|menu|search|filter|sort|copy link|share|follow|view weapon stats|recommended for|warzone meta|absolute meta|download|image)\b/i;
const STAT_RX = /\b(ads speed|aim down sight|recoil control|damage range|bullet velocity|sprint to fire|movement speed|fire rate|mobility|handling|accuracy|damage|control|ttk|rpm|reload speed|magazine size)\b/i;

function read(file, fallback = []) { try { if (!fs.existsSync(file)) return fallback; const raw = fs.readFileSync(file, 'utf8'); return raw.trim() ? JSON.parse(raw) : fallback; } catch (_) { return fallback; } }
function write(file, data) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8'); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function clean(v) { return String(v || '').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim(); }
function slug(v) { return clean(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
function today() { return new Date().toISOString().slice(0, 10); }
function nowIso() { return new Date().toISOString(); }
function normalizeSlot(v) { return SLOT_MAP.get(clean(v).toLowerCase()) || null; }
function guessCategory(text) { const k = clean(text).toLowerCase(); for (const [key, value] of CATEGORY_HINTS) if (k.includes(key)) return value; return 'Da verificare'; }
function isNumericLine(v) { return /^\d+(\.\d+)?$/.test(clean(v)); }
function badName(v) {
  const n = clean(v);
  if (!n || n.length < 2 || n.length > 72 || !/[a-zA-Z0-9]/.test(n)) return true;
  if (normalizeSlot(n)) return true;
  if (/^level\s*\d+$/i.test(n) || /unlock|unlocked|required|weapon level|player level|max level/i.test(n)) return true;
  if (/^\+?\-?\d+(\.\d+)?%?$/.test(n)) return true;
  if (BAD_RX.test(n) || STAT_RX.test(n)) return true;
  if (n.includes('://') || n.includes('.gg') || n.includes('@')) return true;
  if (n.split(' ').length > 9) return true;
  return false;
}
function cleanAttachment(v) { return clean(v).replace(/^[-–—•*]\s*/, '').replace(/\s+Level\s*\d+$/i, '').trim(); }
function isLikelyWeaponName(line) {
  const x = clean(line);
  if (!x || x.length < 2 || x.length > 34) return false;
  if (isNumericLine(x) || BAD_RX.test(x) || STAT_RX.test(x) || normalizeSlot(x)) return false;
  if (/loadout|attachments|recommended|meta|absolute|season|view|for:/i.test(x)) return false;
  return true;
}

function parseFpsMetaText(text, sourceUrl) {
  const lines = String(text || '').split(/\r?\n/).map(clean).filter(Boolean);
  const builds = [];
  const seenBuilds = new Set();
  for (let i = 0; i < lines.length; i++) {
    const slot = normalizeSlot(lines[i]);
    if (!slot) continue;
    const pairs = [];
    const startIndex = i;
    for (let j = i; j < Math.min(lines.length, i + 24); j++) {
      const sl = normalizeSlot(lines[j]);
      if (!sl) continue;
      let name = cleanAttachment(lines[j + 1] || '');
      if (badName(name) && lines[j + 2] && !isNumericLine(lines[j + 2])) name = cleanAttachment(lines[j + 2]);
      if (!badName(name)) pairs.push({ slot: sl, name });
    }
    const uniquePairs = [];
    const seenPairs = new Set();
    for (const p of pairs) {
      const key = p.slot + '__' + slug(p.name);
      if (!seenPairs.has(key)) { seenPairs.add(key); uniquePairs.push(p); }
    }
    if (uniquePairs.length < 3) continue;
    let weaponName = '';
    let styleLine = '';
    for (let back = startIndex - 1; back >= Math.max(0, startIndex - 12); back--) {
      const line = lines[back];
      if (!styleLine && /long range|close range|sniper support|resurgence|mobility|versatile|meta/i.test(line)) { styleLine = line; continue; }
      if (isLikelyWeaponName(line)) { weaponName = line; break; }
    }
    if (!weaponName) continue;
    const weaponId = slug(weaponName);
    const buildKey = weaponId + '__' + uniquePairs.map(p => p.slot + p.name).join('|');
    if (seenBuilds.has(buildKey)) continue;
    seenBuilds.add(buildKey);
    builds.push({ weaponId, weaponName, category: guessCategory(weaponName + ' ' + styleLine), pairs: uniquePairs, sourceUrl });
    i += uniquePairs.length * 2;
  }
  return builds;
}

function mergeCompatibilityData(state, build) {
  const { weapons, attachments, compatibility } = state;
  const todayStr = today();
  if (!weapons.some(w => w.id === build.weaponId)) {
    weapons.push({
      id: build.weaponId,
      nome: build.weaponName,
      categoria: build.category,
      gioco: 'Warzone',
      attiva: true,
      verificata: true,
      fonte: SOURCE,
      fonteUrl: build.sourceUrl,
      note: 'Arma importata da FPSMeta. Gli utenti creano le build dal sito RØDA.',
      stato: 'pubblico',
      discoveredAt: todayStr,
      updatedAt: todayStr
    });
  }
  const attMap = new Map(attachments.map(a => [a.id, a]));
  const compMap = new Map(compatibility.map(c => [`${c.armaId}__${c.accessorioId}`, c]));
  build.pairs.forEach((pair, index) => {
    const name = cleanAttachment(pair.name);
    const attId = slug(name);
    if (!attId || !pair.slot || badName(name)) return;
    if (!attMap.has(attId)) {
      const att = { id: attId, nome: name, tipo: pair.slot, attivo: true, verificato: true, fonte: SOURCE, fonteUrl: build.sourceUrl, note: 'Accessorio verificato tramite FPSMeta.', stato: 'pubblico', updatedAt: todayStr, codmunityOrder: index + 1 };
      attachments.push(att);
      attMap.set(attId, att);
    }
    const compKey = `${build.weaponId}__${attId}`;
    if (!compMap.has(compKey)) {
      const row = { id: compKey, armaId: build.weaponId, accessorioId: attId, slot: pair.slot, compatibile: true, verificato: true, fonte: SOURCE, fonteUrl: build.sourceUrl, note: 'Compatibilità vista in una build FPSMeta reale.', stato: 'pubblico', updatedAt: todayStr, codmunityOrder: index + 1 };
      compatibility.push(row);
      compMap.set(compKey, row);
    }
  });
}

async function main() {
  const report = {
    startedAt: nowIso(), source: SOURCE, mode: 'fpsmeta-weapons-attachments-only', checkedUrls: [], importedBuilds: 0, attachmentsImported: 0, compatibilityImported: 0, weaponsImported: 0,
    removedPreviousDatabase: { weapons: read(WEAPONS_FILE, []).length, attachments: read(ATTACHMENTS_FILE, []).length, compatibility: read(COMPAT_FILE, []).length, builds: read(BUILDS_FILE, []).length },
    errors: [], finishedAt: null
  };
  const existingBuilds = read(BUILDS_FILE, []).filter(b => b.fonte !== SOURCE && b.stato !== 'approvato-da-sync');
  const weapons = [];
  const attachments = [];
  const compatibility = [];
  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1600 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36');
    const foundBuilds = [];
    for (const url of START_URLS.slice(0, LIMIT || START_URLS.length)) {
      try {
        console.log(`Apro ${url}`);
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 65000 });
        await sleep(DELAY);
        for (let i = 0; i < 8; i++) { await page.evaluate(() => window.scrollBy(0, Math.floor(window.innerHeight * 0.85))).catch(() => {}); await sleep(180); }
        const text = await page.evaluate(() => document.body ? document.body.innerText : '');
        const extracted = parseFpsMetaText(text, url);
        report.checkedUrls.push({ url, buildsFound: extracted.length, textLength: text.length });
        foundBuilds.push(...extracted);
        console.log(`${url}: ${extracted.length} fonti compatibilità FPSMeta`);
      } catch (error) { report.checkedUrls.push({ url, error: error.message }); console.log(`${url}: ERRORE ${error.message}`); }
    }
    const unique = new Map();
    for (const b of foundBuilds) unique.set(`${b.weaponId}__${b.pairs.map(p => p.slot + p.name).join('|')}`, b);
    for (const build of unique.values()) mergeCompatibilityData({ weapons, attachments, compatibility }, build);
    report.importedBuilds = 0;
    if (!unique.size) report.errors.push('Nessuna fonte FPSMeta trovata.');
  } finally { await browser.close().catch(() => {}); }
  report.weaponsImported = weapons.length;
  report.attachmentsImported = attachments.length;
  report.compatibilityImported = compatibility.length;
  report.finishedAt = nowIso();
  write(WEAPONS_FILE, weapons);
  write(ATTACHMENTS_FILE, attachments);
  write(COMPAT_FILE, compatibility);
  write(BUILDS_FILE, existingBuilds);
  write(REPORT_FILE, report);
  console.log('Sync FPSMeta completato:', report);
}

main().catch(error => { console.error(error); process.exit(1); });
