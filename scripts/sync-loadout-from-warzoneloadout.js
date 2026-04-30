'use strict';

/**
 * RØDA Loadout Sync — WarzoneLoadout.games
 *
 * Fonte pubblica più ricca: https://warzoneloadout.games/meta/
 * Importa SOLO database per creazione build:
 * - armi
 * - accessori
 * - compatibilità arma/accessorio
 *
 * NON pubblica build già fatte nel sito pubblico.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const WEAPONS_FILE = path.join(DATA, 'loadout-weapons.json');
const ATTACHMENTS_FILE = path.join(DATA, 'loadout-attachments.json');
const COMPAT_FILE = path.join(DATA, 'loadout-compatibility.json');
const BUILDS_FILE = path.join(DATA, 'loadout-builds.json');
const REPORT_FILE = path.join(DATA, 'loadout-warzoneloadout-sync-report.json');

const SOURCE = 'WarzoneLoadout';
const SOURCE_URLS = [
  'https://warzoneloadout.games/meta/',
  'https://warzoneloadout.games/warzone-meta/',
  'https://warzoneloadout.games/'
];
const LIMIT = Number((process.argv.find(a => /^--limit=\d+$/.test(a)) || '').split('=')[1] || 0) || null;
const DELAY = Number(process.env.WARZONELOADOUT_SYNC_DELAY_MS || 900);

const SLOT_MAP = new Map([
  ['optic', 'Ottica'], ['optics', 'Ottica'], ['ottica', 'Ottica'],
  ['muzzle', 'Volata'], ['volata', 'Volata'],
  ['barrel', 'Canna'], ['canna', 'Canna'],
  ['underbarrel', 'Sottocanna'], ['under barrel', 'Sottocanna'], ['sottocanna', 'Sottocanna'],
  ['magazine', 'Caricatore'], ['mag', 'Caricatore'], ['caricatore', 'Caricatore'],
  ['rear grip', 'Impugnatura'], ['rear-grip', 'Impugnatura'], ['grip', 'Impugnatura'], ['impugnatura', 'Impugnatura'],
  ['stock', 'Calcio'], ['calcio', 'Calcio'],
  ['laser', 'Laser'],
  ['fire mods', 'Mod fuoco'], ['fire mod', 'Mod fuoco'], ['fire-mods', 'Mod fuoco'], ['fire mods.', 'Mod fuoco'], ['mod fuoco', 'Mod fuoco'],
  ['ammunition', 'Munizioni'], ['ammo', 'Munizioni'], ['munizioni', 'Munizioni'],
  ['conversion kit', 'Kit conversione']
]);
const SLOT_ORDER = ['Ottica', 'Volata', 'Canna', 'Sottocanna', 'Caricatore', 'Impugnatura', 'Calcio', 'Laser', 'Mod fuoco', 'Munizioni', 'Kit conversione'];
const CATEGORY_MAP = new Map([
  ['assault rifle', 'Fucile d\'assalto'], ['ar', 'Fucile d\'assalto'],
  ['smg', 'Mitraglietta'], ['submachine gun', 'Mitraglietta'],
  ['lmg', 'Mitragliatrice leggera'], ['light machine gun', 'Mitragliatrice leggera'],
  ['sniper rifle', 'Cecchino'], ['sniper', 'Cecchino'],
  ['marksman rifle', 'Fucile tattico'], ['marksman', 'Fucile tattico'], ['tactical rifle', 'Fucile tattico'],
  ['battle rifle', 'Fucile da battaglia'],
  ['shotgun', 'Shotgun'], ['pistol', 'Pistola'], ['launcher', 'Lanciarazzi'], ['melee', 'Corpo a corpo']
]);
const BAD_RX = /\b(cookie|privacy|terms|login|register|subscribe|newsletter|discord|telegram|twitter|instagram|youtube|tiktok|promo|discount|coupon|code|store|shop|premium|advertisement|sponsored|patch notes|tier list|home|menu|search|filter|sort|copy link|share|follow|best loadouts|updated|open accordion|image:|loadout|loadouts|warzone meta|recommended|absolute meta)\b/i;
const STAT_RX = /\b(ads speed|aim down sight|recoil control|damage range|bullet velocity|sprint to fire|movement speed|fire rate|mobility|handling|accuracy|damage|control|ttk|rpm|reload speed|magazine size)\b/i;

function read(file, fallback = []) { try { if (!fs.existsSync(file)) return fallback; const raw = fs.readFileSync(file, 'utf8'); return raw.trim() ? JSON.parse(raw) : fallback; } catch (_) { return fallback; } }
function write(file, data) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8'); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function clean(v) { return String(v || '').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim(); }
function slug(v) { return clean(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
function today() { return new Date().toISOString().slice(0, 10); }
function nowIso() { return new Date().toISOString(); }
function normalizeSlot(v) { return SLOT_MAP.get(clean(v).toLowerCase().replace(/\.$/, '')) || null; }
function normalizeCategory(v) {
  const k = clean(v).toLowerCase();
  for (const [key, value] of CATEGORY_MAP) if (k.includes(key)) return value;
  return 'Da verificare';
}
function isAttachmentName(v) {
  const n = clean(v);
  if (!n || n.length < 2 || n.length > 78 || !/[a-zA-Z0-9]/.test(n)) return false;
  if (normalizeSlot(n)) return false;
  if (/^#?\d+$/.test(n) || /^updated:/i.test(n)) return false;
  if (/^level\s*\d+$/i.test(n) || /unlock|unlocked|required|weapon level|player level|max level/i.test(n)) return false;
  if (/^\+?\-?\d+(\.\d+)?%?$/.test(n)) return false;
  if (BAD_RX.test(n) || STAT_RX.test(n)) return false;
  if (n.includes('://') || n.includes('.gg') || n.includes('@')) return false;
  if (n.split(' ').length > 9) return false;
  return true;
}
function isWeaponName(v) {
  const n = clean(v);
  if (!n || n.length < 2 || n.length > 34) return false;
  if (BAD_RX.test(n) || STAT_RX.test(n) || normalizeSlot(n)) return false;
  if (/^#?\d+$/.test(n) || /^updated:/i.test(n)) return false;
  if (/attachments|long range|close range|sniper support|resurgence|battle royale|meta|s tier|a tier|b tier/i.test(n)) return false;
  return true;
}
function cleanAttachment(v) { return clean(v).replace(/^[-–—•*]\s*/, '').replace(/\s+Level\s*\d+$/i, '').trim(); }

function parseText(text, sourceUrl) {
  const lines = String(text || '').split(/\r?\n/).map(clean).filter(Boolean);
  const builds = [];
  const seen = new Set();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const weaponMatch = line.match(/^#?\d+\s+(.+?)\s+(Long Range|Close Range|Sniper Support|Sniper|Versatile|Mobility|Resurgence|Battle Royale)\s+(.+?)(?:\s+bo\d+)?$/i);
    let weaponName = '';
    let category = 'Da verificare';
    if (weaponMatch) {
      weaponName = clean(weaponMatch[1]);
      category = normalizeCategory(weaponMatch[3]);
    } else if (isWeaponName(line) && /^image:/i.test(lines[i - 1] || '') && /loadout/i.test(lines[i + 1] || '')) {
      weaponName = line;
    }
    if (!weaponName || !isWeaponName(weaponName)) continue;

    const pairs = [];
    for (let j = i + 1; j < Math.min(lines.length, i + 70); j++) {
      if (j > i + 3 && isWeaponName(lines[j]) && /^image:/i.test(lines[j - 1] || '')) break;
      const slot = normalizeSlot(lines[j]);
      if (!slot) continue;
      const name = cleanAttachment(lines[j + 1] || '');
      if (isAttachmentName(name)) pairs.push({ slot, name });
    }

    const uniquePairs = [];
    const seenPairs = new Set();
    for (const p of pairs) {
      const key = p.slot + '__' + slug(p.name);
      if (!seenPairs.has(key)) { seenPairs.add(key); uniquePairs.push(p); }
    }
    if (uniquePairs.length < 3) continue;

    const weaponId = slug(weaponName);
    const buildKey = weaponId + '__' + uniquePairs.map(p => p.slot + p.name).join('|');
    if (seen.has(buildKey)) continue;
    seen.add(buildKey);
    builds.push({ weaponId, weaponName, category, pairs: uniquePairs, sourceUrl });
  }
  return builds;
}

function merge(state, build) {
  const { weapons, attachments, compatibility } = state;
  const todayStr = today();
  if (!weapons.some(w => w.id === build.weaponId)) {
    weapons.push({ id: build.weaponId, nome: build.weaponName, categoria: build.category, gioco: 'Warzone', attiva: true, verificata: true, fonte: SOURCE, fonteUrl: build.sourceUrl, note: 'Arma importata da WarzoneLoadout. Gli utenti creano le build dal sito RØDA.', stato: 'pubblico', discoveredAt: todayStr, updatedAt: todayStr });
  }
  const attMap = new Map(attachments.map(a => [a.id, a]));
  const compMap = new Map(compatibility.map(c => [`${c.armaId}__${c.accessorioId}`, c]));
  build.pairs.forEach((p, index) => {
    const name = cleanAttachment(p.name);
    const attId = slug(name);
    if (!attId || !p.slot || !isAttachmentName(name)) return;
    if (!attMap.has(attId)) {
      const att = { id: attId, nome: name, tipo: p.slot, attivo: true, verificato: true, fonte: SOURCE, fonteUrl: build.sourceUrl, note: 'Accessorio verificato tramite WarzoneLoadout.', stato: 'pubblico', updatedAt: todayStr, codmunityOrder: index + 1 };
      attachments.push(att);
      attMap.set(attId, att);
    }
    const key = `${build.weaponId}__${attId}`;
    if (!compMap.has(key)) {
      const row = { id: key, armaId: build.weaponId, accessorioId: attId, slot: p.slot, compatibile: true, verificato: true, fonte: SOURCE, fonteUrl: build.sourceUrl, note: 'Compatibilità vista su WarzoneLoadout.', stato: 'pubblico', updatedAt: todayStr, codmunityOrder: index + 1 };
      compatibility.push(row);
      compMap.set(key, row);
    }
  });
}

async function main() {
  const report = { startedAt: nowIso(), source: SOURCE, mode: 'warzoneloadout-weapons-attachments-only', checkedUrls: [], importedBuilds: 0, weaponsImported: 0, attachmentsImported: 0, compatibilityImported: 0, removedPreviousDatabase: { weapons: read(WEAPONS_FILE, []).length, attachments: read(ATTACHMENTS_FILE, []).length, compatibility: read(COMPAT_FILE, []).length, builds: read(BUILDS_FILE, []).length }, errors: [], finishedAt: null };
  const weapons = [];
  const attachments = [];
  const compatibility = [];
  const builds = read(BUILDS_FILE, []).filter(b => ![SOURCE, 'FPSMeta', 'WZLoad', 'CODMunity'].includes(b.fonte));

  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1800 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36');
    const found = [];
    for (const url of SOURCE_URLS.slice(0, LIMIT || SOURCE_URLS.length)) {
      try {
        console.log(`Apro ${url}`);
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 70000 });
        await sleep(DELAY);
        for (let i = 0; i < 14; i++) { await page.evaluate(() => window.scrollBy(0, Math.floor(window.innerHeight * 0.82))).catch(() => {}); await sleep(160); }
        const text = await page.evaluate(() => document.body ? document.body.innerText : '');
        const items = parseText(text, url);
        report.checkedUrls.push({ url, buildsFound: items.length, textLength: text.length });
        found.push(...items);
        console.log(`${url}: ${items.length} fonti compatibilità WarzoneLoadout`);
      } catch (error) {
        report.checkedUrls.push({ url, error: error.message });
        console.log(`${url}: ERRORE ${error.message}`);
      }
    }
    const unique = new Map();
    for (const b of found) unique.set(`${b.weaponId}__${b.pairs.map(p => p.slot + p.name).join('|')}`, b);
    for (const b of unique.values()) merge({ weapons, attachments, compatibility }, b);
    if (!unique.size) report.errors.push('Nessuna fonte WarzoneLoadout trovata.');
  } finally { await browser.close().catch(() => {}); }

  weapons.sort((a, b) => a.nome.localeCompare(b.nome, 'it'));
  attachments.sort((a, b) => a.tipo.localeCompare(b.tipo, 'it') || a.nome.localeCompare(b.nome, 'it'));
  compatibility.sort((a, b) => a.armaId.localeCompare(b.armaId) || a.codmunityOrder - b.codmunityOrder);
  report.weaponsImported = weapons.length;
  report.attachmentsImported = attachments.length;
  report.compatibilityImported = compatibility.length;
  report.finishedAt = nowIso();
  write(WEAPONS_FILE, weapons);
  write(ATTACHMENTS_FILE, attachments);
  write(COMPAT_FILE, compatibility);
  write(BUILDS_FILE, builds);
  write(REPORT_FILE, report);
  console.log('Sync WarzoneLoadout completato:', report);
}

main().catch(error => { console.error(error); process.exit(1); });
