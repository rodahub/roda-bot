'use strict';

/**
 * RØDA Loadout Sync — WZLoad
 *
 * Fonte principale: https://wzload.com
 * Lo script sostituisce il vecchio database Loadout e ricrea armi, accessori,
 * compatibilità e build usando solo dati WZLoad tradotti in italiano.
 */

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
  'https://wzload.com/loadouts',
  'https://wzload.com/warzone-loadouts',
  'https://wzload.com/meta',
  'https://wzload.com/weapons'
];

const SLOT_MAP = new Map([
  ['optic', 'Ottica'], ['optics', 'Ottica'], ['ottica', 'Ottica'],
  ['muzzle', 'Volata'], ['volata', 'Volata'],
  ['barrel', 'Canna'], ['canna', 'Canna'],
  ['underbarrel', 'Sottocanna'], ['under barrel', 'Sottocanna'], ['sottocanna', 'Sottocanna'],
  ['magazine', 'Caricatore'], ['mag', 'Caricatore'], ['caricatore', 'Caricatore'],
  ['rear grip', 'Impugnatura'], ['rear-grip', 'Impugnatura'], ['grip', 'Impugnatura'], ['impugnatura', 'Impugnatura'],
  ['stock', 'Calcio'], ['calcio', 'Calcio'], ['laser', 'Laser'],
  ['fire mods', 'Mod fuoco'], ['fire mod', 'Mod fuoco'], ['fire-mods', 'Mod fuoco'], ['mod fuoco', 'Mod fuoco'],
  ['ammunition', 'Mod fuoco'], ['ammo', 'Mod fuoco'], ['munizioni', 'Mod fuoco']
]);
const SLOT_ORDER = ['Ottica', 'Volata', 'Canna', 'Sottocanna', 'Caricatore', 'Impugnatura', 'Calcio', 'Laser', 'Mod fuoco'];

const CATEGORY_MAP = new Map([
  ['assault rifle', 'Fucile d\'assalto'], ['ar', 'Fucile d\'assalto'], ['fucile d\'assalto', 'Fucile d\'assalto'],
  ['smg', 'Mitraglietta'], ['submachine gun', 'Mitraglietta'], ['mitraglietta', 'Mitraglietta'],
  ['lmg', 'Mitragliatrice leggera'], ['light machine gun', 'Mitragliatrice leggera'],
  ['marksman rifle', 'Fucile tattico'], ['tactical rifle', 'Fucile tattico'],
  ['battle rifle', 'Fucile da battaglia'], ['sniper rifle', 'Cecchino'], ['sniper', 'Cecchino'],
  ['shotgun', 'Shotgun'], ['pistol', 'Pistola']
]);
const STYLE_MAP = new Map([
  ['long range', 'Lungo raggio'], ['range', 'Lungo raggio'], ['meta', 'Meta'], ['resurgence', 'Resurgence'],
  ['sniper support', 'Supporto cecchino'], ['close range', 'Corto raggio'], ['mobility', 'Mobilità'],
  ['small map', 'Mappe piccole'], ['ranked', 'Ranked'], ['zombies', 'Zombie'], ['multiplayer', 'Multiplayer']
]);
const BAD_RX = /\b(cookie|privacy|terms|login|register|sign in|subscribe|newsletter|discord|telegram|twitter|instagram|youtube|tiktok|promo|discount|coupon|code|store|shop|premium|advertisement|sponsored|patch notes|tier list|home|menu|search|filter|sort|copy link|share|follow)\b/i;
const STAT_RX = /\b(ads speed|aim down sight|recoil control|damage range|bullet velocity|sprint to fire|movement speed|fire rate|mobility|handling|accuracy|damage|control|ttk|rpm|reload speed|magazine size)\b/i;

function read(file, fallback = []) { try { if (!fs.existsSync(file)) return fallback; const raw = fs.readFileSync(file, 'utf8'); return raw.trim() ? JSON.parse(raw) : fallback; } catch (_) { return fallback; } }
function write(file, data) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8'); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function clean(v) { return String(v || '').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim(); }
function slug(v) { return clean(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
function today() { return new Date().toISOString().slice(0, 10); }
function nowIso() { return new Date().toISOString(); }
function normalizeSlot(v) { return SLOT_MAP.get(clean(v).toLowerCase()) || null; }
function normalizeCategory(v) { const k = clean(v).toLowerCase(); if (CATEGORY_MAP.has(k)) return CATEGORY_MAP.get(k); for (const [key, value] of CATEGORY_MAP) if (k.includes(key)) return value; return 'Da verificare'; }
function normalizeStyle(text) { const k = clean(text).toLowerCase(); for (const [key, value] of STYLE_MAP) if (k.includes(key)) return value; return 'Meta'; }
function badName(v) { const n = clean(v); if (!n || n.length < 2 || n.length > 64 || !/[a-zA-Z0-9]/.test(n)) return true; if (normalizeSlot(n)) return true; if (/^level\s*\d+$/i.test(n) || /unlock|unlocked|required|weapon level|player level|max level/i.test(n)) return true; if (/^\+?\-?\d+(\.\d+)?%?$/.test(n)) return true; if (BAD_RX.test(n) || STAT_RX.test(n)) return true; if (n.includes('://') || n.includes('.gg') || n.includes('@')) return true; if (n.split(' ').length > 7) return true; return false; }
function cleanAttachment(v) { return clean(v).replace(/^[-–—•]\s*/, '').replace(/\s+Level\s*\d+$/i, '').replace(/\s+Unlock(?:ed)?\s+at\s+Level\s*\d+$/i, '').replace(/\s+Required\s+Level\s*\d+$/i, '').trim(); }
function toAbsolute(href) { try { return new URL(href, ROOT_URL).toString().split('#')[0]; } catch { return ''; } }

function parsePairsFromText(text) {
  const rawLines = String(text || '').split(/\r?\n|\s{2,}/).map(clean).filter(Boolean);
  const lines = rawLines.flatMap(line => line.split(/\s+[•|]\s+/).map(clean)).filter(Boolean);
  const out = [];
  const seen = new Set();
  for (const line of lines) {
    const colon = line.match(/^([A-Za-z ]{2,18})\s*[:\-–—]\s*(.+)$/);
    if (colon) {
      const sl = normalizeSlot(colon[1]);
      const name = cleanAttachment(colon[2]);
      if (sl && !badName(name)) {
        const key = sl + '__' + slug(name);
        if (!seen.has(key)) { seen.add(key); out.push({ slot: sl, name }); }
      }
    }
  }
  for (let i = 0; i < lines.length - 1; i++) {
    const sl = normalizeSlot(lines[i]);
    const name = cleanAttachment(lines[i + 1]);
    if (sl && !badName(name)) { const key = sl + '__' + slug(name); if (!seen.has(key)) { seen.add(key); out.push({ slot: sl, name }); } i++; continue; }
    const nameFirst = cleanAttachment(lines[i]);
    const slNext = normalizeSlot(lines[i + 1]);
    if (slNext && !badName(nameFirst)) { const key = slNext + '__' + slug(nameFirst); if (!seen.has(key)) { seen.add(key); out.push({ slot: slNext, name: nameFirst }); } i++; }
  }
  return out.sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot));
}
function guessWeaponName(text, url) { const candidates = String(text || '').split(/\r?\n/).map(clean).filter(Boolean); for (const c of candidates.slice(0, 12)) { if (c.length >= 2 && c.length <= 32 && !BAD_RX.test(c) && !STAT_RX.test(c) && !normalizeSlot(c) && !/loadout|attachments|class setup/i.test(c)) return c; } const last = url.split('/').filter(Boolean).pop() || 'weapon'; return last.split('-').map(p => p.length <= 3 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1)).join(' '); }
function buildId(weaponId, style, sourceUrl) { return 'wzload-' + slug(`${weaponId}-${style}-${sourceUrl}`).slice(0, 80); }

async function collectLinks(page) {
  const links = new Set(START_URLS);
  for (const start of START_URLS) {
    try {
      await page.goto(start, { waitUntil: 'networkidle2', timeout: 60000 });
      await sleep(900);
      for (let i = 0; i < 8; i++) { await page.evaluate(() => window.scrollBy(0, Math.floor(window.innerHeight * 0.8))).catch(() => {}); await sleep(250); }
      const found = await page.evaluate(() => Array.from(document.querySelectorAll('a[href]')).map(a => a.href));
      found.map(toAbsolute).filter(Boolean).forEach(url => { if (!url.startsWith('https://wzload.com')) return; if (/\/(loadout|loadouts|weapon|weapons|meta|warzone)/i.test(new URL(url).pathname)) links.add(url); });
    } catch (_) {}
  }
  return Array.from(links).slice(0, LIMIT || undefined);
}
async function extractBuildsFromPage(page, url) {
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 65000 });
  await sleep(900);
  for (let i = 0; i < 5; i++) { await page.evaluate(() => window.scrollBy(0, Math.floor(window.innerHeight * 0.8))).catch(() => {}); await sleep(220); }
  const blocks = await page.evaluate(() => {
    const bad = el => el.closest('header,footer,nav,[class*="cookie"],[class*="ad"],[class*="promo"],[class*="newsletter"],[class*="modal"]');
    const nodes = Array.from(document.querySelectorAll('article,section,[class*="loadout"],[class*="card"],[class*="build"],main,body'));
    return nodes.map(el => bad(el) ? '' : (el.innerText || el.textContent || '').trim()).filter(text => text && text.length > 40 && text.length < 3000);
  });
  const builds = [];
  const seen = new Set();
  for (const block of blocks) {
    const pairs = parsePairsFromText(block);
    if (pairs.length < 3) continue;
    const weaponName = guessWeaponName(block, url);
    const weaponId = slug(weaponName);
    const category = normalizeCategory(block);
    const style = normalizeStyle(block);
    const key = weaponId + '__' + pairs.map(p => p.slot + p.name).join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    builds.push({ weaponId, weaponName, category, style, pairs, sourceUrl: url });
  }
  return builds;
}
function mergeBuildData(state, build) {
  const { weapons, attachments, compatibility, builds } = state;
  const todayStr = today();
  weapons.push({ id: build.weaponId, nome: build.weaponName, categoria: build.category, gioco: 'Warzone', attiva: true, verificata: true, fonte: SOURCE, fonteUrl: build.sourceUrl, note: 'Importato da build reali WZLoad e tradotto in italiano.', stato: 'pubblico', discoveredAt: todayStr, updatedAt: todayStr });
  const attMap = new Map(attachments.map(a => [a.id, a]));
  const compMap = new Map();
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
    builds.unshift({ id: buildId(build.weaponId, build.style, build.sourceUrl), creatorName: SOURCE, gioco: 'Warzone', categoria: build.category, armaId: build.weaponId, armaNome: build.weaponName, stile: build.style, accessori: buildAccessories.slice(0, 5), note: `Build importata da ${SOURCE}. Slot tradotti in italiano.`, stato: 'approvato', fonte: SOURCE, fonteUrl: build.sourceUrl, createdAt: nowIso(), updatedAt: nowIso() });
  }
}

async function main() {
  const report = { startedAt: nowIso(), source: SOURCE, mode: 'wzload-replace-full-database', checkedUrls: [], importedBuilds: 0, attachmentsImported: 0, compatibilityImported: 0, weaponsImported: 0, removedPreviousDatabase: {}, errors: [], finishedAt: null };
  const old = { weapons: read(WEAPONS_FILE, []).length, attachments: read(ATTACHMENTS_FILE, []).length, compatibility: read(COMPAT_FILE, []).length, builds: read(BUILDS_FILE, []).length };
  report.removedPreviousDatabase = old;
  const weapons = [];
  const attachments = [];
  const compatibility = [];
  const builds = [];
  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1300 });
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
    if (!unique.size) report.errors.push('Nessuna build WZLoad trovata. Il database viene comunque sostituito con liste vuote per eliminare dati CODMunity vecchi.');
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
