'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const WEAPONS_FILE = path.join(DATA, 'loadout-weapons.json');
const ATTACHMENTS_FILE = path.join(DATA, 'loadout-attachments.json');
const COMPAT_FILE = path.join(DATA, 'loadout-compatibility.json');
const BUILDS_FILE = path.join(DATA, 'loadout-builds.json');
const REPORT_FILE = path.join(DATA, 'loadout-wzload-sync-report.json');

const SOURCE = 'WZLoad';
const ROOT_URL = 'https://wzload.com';
const LIMIT = Number((process.argv.find(a => /^--limit=\d+$/.test(a)) || '').split('=')[1] || 0) || null;
const DELAY = Number(process.env.WZLOAD_SYNC_DELAY_MS || 1200);

const START_URLS = [
  'https://wzload.com/',
  'https://www.wzload.com/',
  'https://wzload.com/bo6',
  'https://www.wzload.com/bo6',
  'https://wzload.com/loadouts',
  'https://wzload.com/warzone-loadouts',
  'https://wzload.com/meta',
  'https://wzload.com/weapons'
];

const SLOT_MAP = new Map([
  ['optic', 'Ottica'], ['optics', 'Ottica'], ['muzzle', 'Volata'], ['barrel', 'Canna'], ['underbarrel', 'Sottocanna'], ['under barrel', 'Sottocanna'], ['magazine', 'Caricatore'], ['mag', 'Caricatore'], ['rear grip', 'Impugnatura'], ['grip', 'Impugnatura'], ['stock', 'Calcio'], ['laser', 'Laser'], ['fire mods', 'Mod fuoco'], ['fire mod', 'Mod fuoco'], ['ammunition', 'Munizioni'], ['ammo', 'Munizioni'], ['conversion kit', 'Kit conversione'], ['sling', 'Cinghia']
]);
const SLOT_ORDER = ['Ottica', 'Volata', 'Canna', 'Sottocanna', 'Caricatore', 'Impugnatura', 'Calcio', 'Laser', 'Mod fuoco', 'Munizioni', 'Kit conversione', 'Cinghia'];
const CATEGORY_MAP = new Map([
  ['assault rifle', 'Fucile d\'assalto'], ['ar', 'Fucile d\'assalto'], ['smg', 'Mitraglietta'], ['submachine gun', 'Mitraglietta'], ['lmg', 'Mitragliatrice leggera'], ['light machine gun', 'Mitragliatrice leggera'], ['marksman rifle', 'Fucile tattico'], ['tactical rifle', 'Fucile tattico'], ['battle rifle', 'Fucile da battaglia'], ['sniper rifle', 'Cecchino'], ['sniper', 'Cecchino'], ['shotgun', 'Shotgun'], ['pistol', 'Pistola'], ['rifle', 'Fucile tattico']
]);
const STYLE_MAP = new Map([['long range', 'Lungo raggio'], ['close range', 'Corto raggio'], ['sniper support', 'Supporto cecchino'], ['mobility', 'Mobilità'], ['versatile', 'Versatile'], ['resurgence', 'Resurgence'], ['meta', 'Meta']]);
const BAD_RX = /\b(cookie|privacy|terms|login|register|subscribe|newsletter|discord|telegram|twitter|instagram|youtube|tiktok|promo|discount|coupon|code|store|shop|premium|advertisement|sponsored|patch notes|tier list|home|menu|search|filter|sort|copy link|share|follow|choose option|played by|image)\b/i;
const STAT_RX = /\b(ads speed|aim down sight|recoil control|damage range|bullet velocity|sprint to fire|movement speed|fire rate|mobility|handling|accuracy|damage|control|ttk|rpm|reload speed|magazine size)\b/i;

function read(file, fallback = []) { try { if (!fs.existsSync(file)) return fallback; const raw = fs.readFileSync(file, 'utf8'); return raw.trim() ? JSON.parse(raw) : fallback; } catch (_) { return fallback; } }
function write(file, data) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8'); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function clean(v) { return String(v || '').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim(); }
function slug(v) { return clean(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
function nowIso() { return new Date().toISOString(); }
function today() { return new Date().toISOString().slice(0, 10); }
function normalizeSlot(v) { return SLOT_MAP.get(clean(v).toLowerCase()) || null; }
function normalizeCategory(v) { const k = clean(v).toLowerCase(); for (const [key, value] of CATEGORY_MAP) if (k.includes(key)) return value; return 'Da verificare'; }
function normalizeStyle(v) { const k = clean(v).toLowerCase(); for (const [key, value] of STYLE_MAP) if (k.includes(key)) return value; return 'Meta'; }
function badName(v) { const n = clean(v); if (!n || n.length < 2 || n.length > 72 || !/[a-zA-Z0-9]/.test(n)) return true; if (normalizeSlot(n)) return true; if (/^level\s*\d+$/i.test(n) || /unlock|unlocked|required|weapon level|player level|max level/i.test(n)) return true; if (/^\+?\-?\d+(\.\d+)?%?$/.test(n)) return true; if (BAD_RX.test(n) || STAT_RX.test(n)) return true; if (n.includes('://') || n.includes('.gg') || n.includes('@')) return true; if (n.split(' ').length > 8) return true; return false; }
function cleanAttachment(v) { return clean(v).replace(/^[-–—•*]\s*/, '').replace(/\s+Level\s*\d+$/i, '').trim(); }
function toAbsolute(href) { try { return new URL(href, ROOT_URL).toString().split('#')[0]; } catch { return ''; } }
function buildId(weaponId, style, sourceUrl) { return 'wzload-' + slug(`${weaponId}-${style}-${sourceUrl}`).slice(0, 80); }

function splitCategoryStyle(line) {
  const lower = clean(line).toLowerCase();
  let best = ['', ''];
  for (const [key, val] of CATEGORY_MAP) if (lower.startsWith(key) && key.length > best[0].length) best = [key, val];
  return { category: best[1] || normalizeCategory(line), style: normalizeStyle(clean(line).slice(best[0].length) || line) };
}
function parsePairLine(line) {
  const m = clean(line).match(/^([A-Za-z ]{2,20})\s*[:\-–—]\s*(.+)$/);
  if (!m) return null;
  const slot = normalizeSlot(m[1]);
  const name = cleanAttachment(m[2]);
  if (!slot || badName(name)) return null;
  return { slot, name };
}
function isLikelyWeaponName(line) {
  const x = clean(line);
  if (!x || x.length > 34 || x.length < 2) return false;
  if (/^#?\d+$/.test(x) || BAD_RX.test(x) || STAT_RX.test(x) || normalizeSlot(x)) return false;
  if (/attachments|loadout|filter|option|season|builds|quickest|choose|played by/i.test(x)) return false;
  return true;
}
function parseWzLoadFullText(text, url) {
  const lines = String(text || '').split(/\r?\n/).map(clean).filter(Boolean);
  const builds = [];
  const seen = new Set();
  for (let i = 0; i < lines.length; i++) {
    if (!/^attachments:?$/i.test(lines[i])) continue;
    const pairs = [];
    for (let j = i + 1; j < Math.min(lines.length, i + 40); j++) {
      const line = lines[j];
      if (/^image:?/i.test(line) || /^played by/i.test(line) || /^#?\d+$/.test(line) || /^attachments:?$/i.test(line)) break;
      const pair = parsePairLine(line);
      if (pair) pairs.push(pair);
    }
    if (pairs.length < 3) continue;
    let weaponName = '';
    let metaLine = '';
    for (let b = i - 1; b >= Math.max(0, i - 10); b--) {
      const line = lines[b];
      if (!metaLine && normalizeCategory(line) !== 'Da verificare') { metaLine = line; continue; }
      if (isLikelyWeaponName(line)) { weaponName = line; break; }
    }
    if (!weaponName) continue;
    const info = splitCategoryStyle(metaLine);
    const weaponId = slug(weaponName);
    const key = weaponId + '__' + pairs.map(p => p.slot + p.name).join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    builds.push({ weaponId, weaponName, category: info.category, style: info.style, pairs, sourceUrl: url });
  }
  return builds;
}

async function collectLinks(page) {
  const links = new Set(START_URLS);
  for (const start of START_URLS) {
    try {
      await page.goto(start, { waitUntil: 'networkidle2', timeout: 60000 });
      await sleep(900);
      for (let i = 0; i < 10; i++) { await page.evaluate(() => window.scrollBy(0, Math.floor(window.innerHeight * 0.85))).catch(() => {}); await sleep(250); }
      const found = await page.evaluate(() => Array.from(document.querySelectorAll('a[href]')).map(a => a.href));
      found.map(toAbsolute).filter(Boolean).forEach(url => { if (!/^https:\/\/(www\.)?wzload\.com/.test(url)) return; if (/\/(loadout|loadouts|weapon|weapons|meta|warzone|bo6)/i.test(new URL(url).pathname) || /\/\/?$/.test(new URL(url).pathname)) links.add(url); });
    } catch (_) {}
  }
  return Array.from(links).slice(0, LIMIT || undefined);
}
async function extractBuildsFromPage(page, url) {
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 65000 });
  await sleep(1200);
  for (let i = 0; i < 8; i++) { await page.evaluate(() => window.scrollBy(0, Math.floor(window.innerHeight * 0.85))).catch(() => {}); await sleep(220); }
  const fullText = await page.evaluate(() => document.body ? document.body.innerText : '');
  return parseWzLoadFullText(fullText, url);
}
function mergeBuildData(state, build) {
  const { weapons, attachments, compatibility, builds } = state;
  const todayStr = today();
  if (!weapons.some(w => w.id === build.weaponId)) weapons.push({ id: build.weaponId, nome: build.weaponName, categoria: build.category, gioco: 'Warzone', attiva: true, verificata: true, fonte: SOURCE, fonteUrl: build.sourceUrl, note: 'Importato da build reali WZLoad e tradotto in italiano.', stato: 'pubblico', discoveredAt: todayStr, updatedAt: todayStr });
  const attMap = new Map(attachments.map(a => [a.id, a]));
  const compMap = new Map(compatibility.map(c => [`${c.armaId}__${c.accessorioId}`, c]));
  const buildAccessories = [];
  build.pairs.forEach((pair, index) => {
    const name = cleanAttachment(pair.name);
    const attId = slug(name);
    if (!attId || !pair.slot || badName(name)) return;
    if (!attMap.has(attId)) { const att = { id: attId, nome: name, tipo: pair.slot, attivo: true, verificato: true, fonte: SOURCE, fonteUrl: build.sourceUrl, note: 'Accessorio trovato in una build WZLoad reale.', stato: 'pubblico', updatedAt: todayStr, codmunityOrder: index + 1 }; attachments.push(att); attMap.set(attId, att); }
    const compKey = `${build.weaponId}__${attId}`;
    if (!compMap.has(compKey)) { const row = { id: compKey, armaId: build.weaponId, accessorioId: attId, slot: pair.slot, compatibile: true, verificato: true, fonte: SOURCE, fonteUrl: build.sourceUrl, note: 'Compatibilità vista in una build WZLoad reale.', stato: 'pubblico', updatedAt: todayStr, codmunityOrder: index + 1 }; compatibility.push(row); compMap.set(compKey, row); }
    buildAccessories.push({ slot: pair.slot, accessorioId: attId, nome: name });
  });
  if (buildAccessories.length >= 3) {
    const id = buildId(build.weaponId, build.style, build.sourceUrl);
    if (!builds.some(b => b.id === id)) builds.unshift({ id, creatorName: SOURCE, gioco: 'Warzone', categoria: build.category, armaId: build.weaponId, armaNome: build.weaponName, stile: build.style, accessori: buildAccessories.slice(0, 8), note: `Build importata da ${SOURCE}. Slot tradotti in italiano.`, stato: 'approvato', fonte: SOURCE, fonteUrl: build.sourceUrl, createdAt: nowIso(), updatedAt: nowIso() });
  }
}

async function main() {
  const report = { startedAt: nowIso(), source: SOURCE, mode: 'wzload-full-text-parser-replace-full-database', checkedUrls: [], importedBuilds: 0, attachmentsImported: 0, compatibilityImported: 0, weaponsImported: 0, removedPreviousDatabase: {}, errors: [], finishedAt: null };
  report.removedPreviousDatabase = { weapons: read(WEAPONS_FILE, []).length, attachments: read(ATTACHMENTS_FILE, []).length, compatibility: read(COMPAT_FILE, []).length, builds: read(BUILDS_FILE, []).length };
  const weapons = [], attachments = [], compatibility = [], builds = [];
  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1600 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36');
    const urls = await collectLinks(page);
    const foundBuilds = [];
    for (const url of urls) {
      try { const extracted = await extractBuildsFromPage(page, url); report.checkedUrls.push({ url, buildsFound: extracted.length }); foundBuilds.push(...extracted); console.log(`${url}: ${extracted.length} build`); }
      catch (error) { report.checkedUrls.push({ url, error: error.message }); }
      await sleep(DELAY);
    }
    const unique = new Map();
    for (const b of foundBuilds) unique.set(buildId(b.weaponId, b.style, b.sourceUrl), b);
    for (const build of unique.values()) mergeBuildData({ weapons, attachments, compatibility, builds }, build);
    report.importedBuilds = unique.size;
    if (!unique.size) report.errors.push('Nessuna build WZLoad trovata. Il parser full-text non ha trovato sezioni Attachments leggibili.');
  } finally { await browser.close().catch(() => {}); }
  report.weaponsImported = weapons.length;
  report.attachmentsImported = attachments.length;
  report.compatibilityImported = compatibility.length;
  report.finishedAt = nowIso();
  write(WEAPONS_FILE, weapons);
  write(ATTACHMENTS_FILE, attachments);
  write(COMPAT_FILE, compatibility);
  write(BUILDS_FILE, builds);
  write(REPORT_FILE, report);
  console.log('Sync WZLoad completato:', report);
}
main().catch(error => { console.error(error); process.exit(1); });
