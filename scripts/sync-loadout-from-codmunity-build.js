'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const URLS = path.join(DATA, 'codmunity-weapon-urls.json');
const WEAPONS = path.join(DATA, 'loadout-weapons.json');
const ATTS = path.join(DATA, 'loadout-attachments.json');
const COMPAT = path.join(DATA, 'loadout-compatibility.json');
const REPORT = path.join(DATA, 'loadout-build-sync-report.json');

const LIMIT = Number((process.argv.find(a => /^--limit=\d+$/.test(a)) || '').split('=')[1] || 0) || null;
const DELAY = Number(process.env.CODMUNITY_SYNC_DELAY_MS || 1400);

const SLOT_ALIASES = new Map([
  ['optic', 'Ottica'], ['ottica', 'Ottica'],
  ['muzzle', 'Volata'], ['volata', 'Volata'],
  ['barrel', 'Canna'], ['canna', 'Canna'],
  ['underbarrel', 'Sottocanna'], ['under barrel', 'Sottocanna'], ['sottocanna', 'Sottocanna'],
  ['magazine', 'Caricatore'], ['mag', 'Caricatore'], ['caricatore', 'Caricatore'],
  ['rear grip', 'Impugnatura'], ['grip', 'Impugnatura'], ['impugnatura', 'Impugnatura'],
  ['stock', 'Calcio'], ['calcio', 'Calcio'],
  ['laser', 'Laser'],
  ['fire mods', 'Mod fuoco'], ['fire mod', 'Mod fuoco'], ['mod fuoco', 'Mod fuoco'], ['munizioni', 'Mod fuoco'], ['ammunition', 'Mod fuoco']
]);
const SLOT_ORDER = ['Ottica', 'Volata', 'Canna', 'Sottocanna', 'Caricatore', 'Impugnatura', 'Calcio', 'Laser', 'Mod fuoco'];

const CATEGORY_MAP = new Map([
  ['assault rifle', 'Fucile d\'assalto'], ['fucile d\'assalto', 'Fucile d\'assalto'],
  ['smg', 'Mitraglietta'], ['submachine gun', 'Mitraglietta'], ['mitraglietta', 'Mitraglietta'],
  ['lmg', 'Mitragliatrice leggera'], ['light machine gun', 'Mitragliatrice leggera'], ['mitragliatrice leggera', 'Mitragliatrice leggera'],
  ['marksman rifle', 'Fucile tattico'], ['fucile tattico', 'Fucile tattico'],
  ['battle rifle', 'Fucile da battaglia'], ['fucile da battaglia', 'Fucile da battaglia'],
  ['sniper rifle', 'Cecchino'], ['cecchino', 'Cecchino'],
  ['shotgun', 'Shotgun'], ['pistol', 'Pistola'], ['pistola', 'Pistola']
]);

const BAD_RX = /\b(codmunity|discount|promo|coupon|creator code|support a creator|use code|shop|store|subscribe|newsletter|telegram|discord|twitter|instagram|youtube|tiktok|privacy|terms|cookie|login|register|tier list|patch notes|follow|download|copy link|like this|loadout by|profile|followers|ready to share|change font|game icon|separator icon|image:)\b/i;
const STAT_RX = /\b(ads speed|aim down sight|recoil control|damage range|bullet velocity|sprint to fire|movement speed|fire rate|mobility|handling|accuracy|damage|control|ttk|rpm|reload speed|magazine size|gun kick|horizontal recoil|vertical recoil|hipfire|crouch movement)\b/i;
const UI_RX = /^(search|select|none|empty|attachment|attachments|loadout|loadouts|build|meta|recommended|close|back|clear|filter|sort|all|save|share|copy|remove|delete|cancel|confirm|apply|reset|show loadouts|add to stats comparator|open in the stats comparator)$/i;

function read(file, fallback = []) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, 'utf8');
    return raw.trim() ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}
function write(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function clean(v) { return String(v || '').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim(); }
function slug(v) { return clean(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
function today() { return new Date().toISOString().slice(0, 10); }
function weaponIdFromUrl(url) { return String(url || '').split('/').filter(Boolean).pop(); }
function gameFromUrl(url, entry = {}) { const m = String(url || '').match(/\/weapon\/(bo\d+)\//i); return String(entry.game || (m && m[1]) || 'Warzone').toUpperCase(); }
function weaponNameFromId(id) { return String(id || '').split('-').map(p => p.length <= 3 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1)).join(' '); }
function normalizeSlot(v) { return SLOT_ALIASES.get(clean(v).toLowerCase()) || null; }
function normalizeCategory(v) { return CATEGORY_MAP.get(clean(v).toLowerCase()) || null; }
function isLevelLine(v) { return /^level\s*\d+$/i.test(clean(v)) || /^lvl\s*\d+$/i.test(clean(v)); }
function badAttachmentName(v) {
  const n = clean(v);
  if (!n || n.length < 2 || n.length > 60 || !/[a-zA-Z0-9]/.test(n)) return true;
  if (normalizeSlot(n)) return true;
  if (isLevelLine(n) || /unlock|unlocked|required|weapon level|player level|max level/i.test(n)) return true;
  if (/^\+?\-?\d+(\.\d+)?%?$/.test(n)) return true;
  if (BAD_RX.test(n) || STAT_RX.test(n) || UI_RX.test(n)) return true;
  if (n.includes('://') || n.includes('.gg') || n.includes('@')) return true;
  if (n.split(' ').length > 7) return true;
  return false;
}
function weaponList() {
  return read(URLS, []).map((entry, index) => {
    const url = typeof entry === 'string' ? entry : entry.url;
    return {
      id: weaponIdFromUrl(url),
      url,
      game: gameFromUrl(url, entry || {}),
      codmunityOrder: Number((entry && entry.codmunityOrder) || index + 1),
      discoveredAt: (entry && entry.discoveredAt) || today()
    };
  }).filter(x => x.id && x.url).slice(0, LIMIT || undefined);
}

function extractCategory(lines) {
  for (let i = 0; i < lines.length - 1; i++) {
    const l = lines[i].toLowerCase();
    if (l === 'weapon category' || l === 'categoria arma') {
      const cat = normalizeCategory(lines[i + 1]);
      if (cat) return cat;
    }
  }
  for (const line of lines.slice(0, 120)) {
    const cat = normalizeCategory(line);
    if (cat) return cat;
  }
  return '';
}

function extractAttachmentSection(lines, weaponName) {
  const lowerWeapon = clean(weaponName).toLowerCase();
  const starts = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].toLowerCase();
    if (l.includes(`${lowerWeapon} attachments`) || l.includes(`accessori per ${lowerWeapon}`) || l === 'attachments' || l === 'accessori') {
      starts.push(i);
    }
  }
  let start = starts.length ? starts[starts.length - 1] : -1;
  if (start === -1) start = lines.findIndex(l => /all the attachments available/i.test(l) || /tutti gli accessori disponibili/i.test(l));
  if (start === -1) return [];
  let end = lines.length;
  for (let i = start + 5; i < lines.length; i++) {
    if (/^(best |creator |camo |balancing|statistics|warzone .* statistics|migliori |loadouts dei creatori|mimetiche|statistiche)/i.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end);
}

function parseAttachments(lines) {
  const out = [];
  const seen = new Set();
  for (let i = 0; i < lines.length - 1; i++) {
    const name = clean(lines[i]);
    const next = clean(lines[i + 1]);
    const next2 = clean(lines[i + 2]);
    const next3 = clean(lines[i + 3]);
    let sl = normalizeSlot(next);
    let advance = 1;
    if (!sl && isLevelLine(next) && normalizeSlot(next2)) { sl = normalizeSlot(next2); advance = 2; }
    if (!sl && normalizeSlot(next2) && isLevelLine(next3)) { sl = normalizeSlot(next2); advance = 2; }
    if (!sl || badAttachmentName(name)) continue;
    const key = sl + '__' + slug(name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ slot: sl, name });
    i += advance;
  }
  return out.sort((a, b) => {
    const sa = SLOT_ORDER.indexOf(a.slot);
    const sb = SLOT_ORDER.indexOf(b.slot);
    if (sa !== sb) return sa - sb;
    return a.name.localeCompare(b.name, 'it');
  });
}

function resetCodmunityData(attachments, compatibility) {
  const codIds = new Set(attachments.filter(a => String(a.fonte || '').includes('CODMunity')).map(a => a.id));
  const keptAttachments = attachments.filter(a => !codIds.has(a.id));
  const keptIds = new Set(keptAttachments.map(a => a.id));
  const keptCompatibility = compatibility.filter(c => keptIds.has(c.accessorioId) && !String(c.fonte || '').includes('CODMunity'));
  const removed = { attachments: attachments.length - keptAttachments.length, compatibility: compatibility.length - keptCompatibility.length };
  attachments.splice(0, attachments.length, ...keptAttachments);
  compatibility.splice(0, compatibility.length, ...keptCompatibility);
  return removed;
}

function mergeWeapon(weapons, weapon, category) {
  const index = weapons.findIndex(w => w.id === weapon.id);
  const base = index >= 0 ? weapons[index] : {};
  const record = {
    ...base,
    id: weapon.id,
    nome: base.nome || weaponNameFromId(weapon.id),
    categoria: category || base.categoria || 'Da verificare',
    gioco: weapon.game || base.gioco || 'Warzone',
    attiva: true,
    verificata: true,
    fonte: 'CODMunity weapon page',
    fonteUrl: weapon.url,
    stato: base.stato && ['bloccato', 'disattivato'].includes(base.stato) ? base.stato : 'pubblico',
    codmunityOrder: base.codmunityOrder || weapon.codmunityOrder,
    discoveredAt: base.discoveredAt || weapon.discoveredAt,
    updatedAt: today()
  };
  if (index >= 0) weapons[index] = record;
  else weapons.push(record);
}

function mergeData(attachments, compatibility, weapon, items) {
  const attMap = new Map(attachments.map(a => [a.id, a]));
  const compMap = new Map(compatibility.map(c => [`${c.armaId}__${c.accessorioId}`, c]));
  let newA = 0;
  let newC = 0;
  items.forEach((item, index) => {
    if (!item.slot || badAttachmentName(item.name)) return;
    const id = slug(item.name);
    if (!id) return;
    if (!attMap.has(id)) {
      const att = { id, nome: item.name, tipo: item.slot, attivo: true, verificato: true, fonte: 'CODMunity weapon page', fonteUrl: weapon.url, note: 'Accessorio importato dalla sezione Attachments della pagina arma CODMunity.', updatedAt: today(), stato: 'pubblico', codmunityOrder: index + 1 };
      attachments.push(att); attMap.set(id, att); newA++;
    } else {
      const att = attMap.get(id);
      att.nome = item.name; att.tipo = item.slot; att.attivo = true; att.verificato = true; att.fonte = 'CODMunity weapon page'; att.fonteUrl = weapon.url; att.updatedAt = today(); if (!['bloccato', 'disattivato'].includes(att.stato)) att.stato = 'pubblico';
    }
    const key = `${weapon.id}__${id}`;
    if (!compMap.has(key)) {
      const row = { id: key, armaId: weapon.id, accessorioId: id, slot: item.slot, compatibile: true, verificato: true, fonte: 'CODMunity weapon page', fonteUrl: weapon.url, note: 'Compatibilità importata dalla sezione Attachments della pagina arma CODMunity.', updatedAt: today(), stato: 'pubblico', codmunityOrder: index + 1 };
      compatibility.push(row); compMap.set(key, row); newC++;
    } else {
      const row = compMap.get(key);
      row.slot = item.slot; row.compatibile = true; row.verificato = true; row.fonte = 'CODMunity weapon page'; row.fonteUrl = weapon.url; row.updatedAt = today(); if (!['bloccato', 'disattivato'].includes(row.stato)) row.stato = 'pubblico';
    }
  });
  return { newA, newC };
}

async function main() {
  const report = { startedAt: new Date().toISOString(), source: 'CODMunity weapon pages', mode: 'weapon-page-attachments-section', processedWeapons: [], failedWeapons: [], attachmentsImported: 0, compatibilityImported: 0, removedOldCodmunityData: null, finishedAt: null };
  const list = weaponList();
  const weapons = read(WEAPONS, []);
  const attachments = read(ATTS, []);
  const compatibility = read(COMPAT, []);
  report.removedOldCodmunityData = resetCodmunityData(attachments, compatibility);

  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1400 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36');
    for (let i = 0; i < list.length; i++) {
      const weapon = list[i];
      try {
        await page.goto(weapon.url, { waitUntil: 'networkidle2', timeout: 70000 });
        await sleep(DELAY);
        const pageText = await page.evaluate(() => document.body ? document.body.innerText : '');
        const lines = pageText.split(/\r?\n/).map(clean).filter(Boolean);
        const weaponName = (lines[0] && lines[0].length < 40) ? lines[0] : weaponNameFromId(weapon.id);
        const section = extractAttachmentSection(lines, weaponName);
        const items = parseAttachments(section);
        const category = extractCategory(lines);
        mergeWeapon(weapons, weapon, category);
        const merged = mergeData(attachments, compatibility, weapon, items);
        report.attachmentsImported += merged.newA;
        report.compatibilityImported += merged.newC;
        report.processedWeapons.push({ armaId: weapon.id, game: weapon.game, url: weapon.url, weaponName, category, sectionLines: section.length, attachmentsFound: items.length, attachmentsAdded: merged.newA, compatibilityAdded: merged.newC });
        console.log(`${weapon.id}: ${items.length} accessori dalla pagina arma`);
      } catch (error) {
        report.failedWeapons.push({ armaId: weapon.id, url: weapon.url, error: error.message });
        console.log(`${weapon.id}: ERRORE ${error.message}`);
      }
      write(WEAPONS, weapons); write(ATTS, attachments); write(COMPAT, compatibility); write(REPORT, { ...report, finishedAt: new Date().toISOString() });
    }
  } finally {
    await browser.close().catch(() => {});
  }
  report.finishedAt = new Date().toISOString();
  write(WEAPONS, weapons); write(ATTS, attachments); write(COMPAT, compatibility); write(REPORT, report);
  console.log('Sync CODMunity weapon pages completato:', report);
}

main().catch(error => { console.error(error); process.exit(1); });
