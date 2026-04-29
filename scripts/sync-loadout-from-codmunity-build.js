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
const PROFILE_URLS = [
  'https://codmunity.gg/profile/CODMunity',
  'https://codmunity.gg/it/profile/CODMunity'
];

const SLOT_LABELS = [
  ['Ottica', ['Optic', 'Ottica']],
  ['Volata', ['Muzzle', 'Volata']],
  ['Canna', ['Barrel', 'Canna']],
  ['Sottocanna', ['Underbarrel', 'Under Barrel', 'Sottocanna']],
  ['Caricatore', ['Magazine', 'Mag', 'Caricatore']],
  ['Impugnatura', ['Rear Grip', 'Grip', 'Impugnatura']],
  ['Calcio', ['Stock', 'Calcio']],
  ['Laser', ['Laser']],
  ['Mod fuoco', ['Fire Mods', 'Fire Mod', 'Mod fuoco', 'Munizioni', 'Ammunition']]
];
const ALL_SLOT_WORDS = SLOT_LABELS.flatMap(([, aliases]) => aliases).sort((a, b) => b.length - a.length);

const BAD_RX = /\b(codmunity|discount|promo|coupon|creator code|support a creator|use code|shop|store|subscribe|newsletter|telegram|discord|twitter|instagram|youtube|tiktok|privacy|terms|cookie|login|register|tier list|patch notes|follow|download|copy link|like this|loadout by|profile|followers|seguaci|mi piace|copia link|immagini|social|last updated|ultimo aggiornamento|ready to share|change font|image|game icon)\b/i;
const STAT_RX = /\b(ads speed|aim down sight|recoil control|damage range|bullet velocity|sprint to fire|movement speed|fire rate|mobility|handling|accuracy|damage|control)\b/i;
const UI_RX = /^(search|select|none|empty|attachment|attachments|loadout|build|meta|recommended|close|back|clear|filter|sort|all|save|share|copy|remove|delete|cancel|confirm|apply|reset)$/i;

function read(file, fallback = []) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, 'utf8');
    return raw.trim() ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function write(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function clean(v) { return String(v || '').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, ' ').trim(); }
function slug(v) { return clean(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
function today() { return new Date().toISOString().slice(0, 10); }
function wid(url) { return String(url || '').split('/').filter(Boolean).pop(); }
function game(url, entry = {}) { const m = String(url || '').match(/\/weapon\/(bo\d+)\//i); return String(entry.game || (m && m[1]) || 'Warzone').toUpperCase(); }
function weaponNameFromId(id) { return String(id || '').split('-').map(p => p.length <= 3 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1)).join(' '); }
function weaponList() {
  return read(URLS, []).map((entry, index) => {
    const url = typeof entry === 'string' ? entry : entry.url;
    return {
      id: wid(url),
      url,
      game: game(url, entry || {}),
      codmunityOrder: Number((entry && entry.codmunityOrder) || index + 1),
      discoveredAt: (entry && entry.discoveredAt) || today()
    };
  }).filter(x => x.id && x.url).slice(0, LIMIT || undefined);
}
function normalizeSlot(label) {
  const key = clean(label).toLowerCase();
  for (const [italian, aliases] of SLOT_LABELS) {
    if (aliases.some(a => a.toLowerCase() === key)) return italian;
  }
  return null;
}
function badAttachmentName(name) {
  const n = clean(name);
  if (!n || n.length < 2 || n.length > 58 || !/[a-zA-Z0-9]/.test(n)) return true;
  if (/^level\s*\d+$/i.test(n) || /unlock|unlocked|required|weapon level|player level|max level/i.test(n)) return true;
  if (/^\+?\-?\d+(\.\d+)?%?$/.test(n)) return true;
  if (BAD_RX.test(n) || STAT_RX.test(n) || UI_RX.test(n)) return true;
  if (n.includes('://') || n.includes('.gg') || n.includes('@')) return true;
  if (ALL_SLOT_WORDS.some(s => s.toLowerCase() === n.toLowerCase())) return true;
  if (n.split(' ').length > 6) return true;
  return false;
}
function cleanAttachmentName(name) {
  return clean(name)
    .replace(/\s+Level\s*\d+$/i, '')
    .replace(/\s+Unlock(?:ed)?\s+at\s+Level\s*\d+$/i, '')
    .replace(/\s+Required\s+Level\s*\d+$/i, '')
    .replace(/\s+\+?\-?\d+(\.\d+)?%$/i, '')
    .trim();
}

function parseAttachmentsFromText(text) {
  const compact = clean(text.replace(/\n+/g, ' '));
  const labels = ALL_SLOT_WORDS.map(x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const rx = new RegExp(`\\b(${labels})\\b\\s+(.+?)(?=\\b(?:${labels})\\b|Last Updated|Ultimo aggiornamento|Playstyle|Stile di gioco|Like this|Mi piace|Copy|Copia|Follow|CODMUNITY|$)`, 'gi');
  const out = [];
  let match;
  while ((match = rx.exec(compact))) {
    const slot = normalizeSlot(match[1]);
    let name = cleanAttachmentName(match[2]);
    name = name.replace(/^(Image|Immagine)\s+/i, '').trim();
    if (!slot || badAttachmentName(name)) continue;
    out.push({ slot, name });
  }
  const seen = new Set();
  return out.filter(item => {
    const key = item.slot + '__' + slug(item.name);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function textMatchesWeapon(text, weapon, weaponRecord) {
  const s = slug(text);
  const names = [weapon.id, weaponNameFromId(weapon.id), weaponRecord && weaponRecord.nome]
    .filter(Boolean)
    .map(slug)
    .filter(Boolean);
  return names.some(n => s.includes(n));
}

async function collectOfficialCodmunityLoadouts(page, weapons, weaponRecords) {
  const map = new Map();
  const debug = [];

  for (const url of PROFILE_URLS) {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 70000 });
    await sleep(1500);
    for (let i = 0; i < 14; i++) {
      await page.evaluate(() => window.scrollBy(0, Math.floor(window.innerHeight * 0.85))).catch(() => {});
      await sleep(450);
    }

    const cards = await page.evaluate(() => {
      const bad = el => el.closest('header,footer,nav,[class*="cookie"],[class*="modal"],[class*="ad"],[class*="promo"],[class*="discount"],[class*="social"]');
      const texts = [];
      const selectors = 'article,a,[class*="loadout"],[class*="card"],[class*="grid"] > div,li';
      for (const el of Array.from(document.querySelectorAll(selectors))) {
        if (bad(el)) continue;
        const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
        if (text.length < 35 || text.length > 900) continue;
        if (!/\b(Optic|Muzzle|Barrel|Underbarrel|Magazine|Rear Grip|Stock|Laser|Fire Mods|Ottica|Volata|Canna|Sottocanna|Caricatore|Impugnatura|Calcio|Mod fuoco)\b/i.test(text)) continue;
        texts.push(text);
      }
      return Array.from(new Set(texts));
    });

    debug.push({ url, cardsFound: cards.length });

    for (const cardText of cards) {
      const attachments = parseAttachmentsFromText(cardText);
      if (!attachments.length) continue;
      for (const weapon of weapons) {
        const record = weaponRecords.find(w => w.id === weapon.id);
        if (!textMatchesWeapon(cardText, weapon, record)) continue;
        const current = map.get(weapon.id) || [];
        map.set(weapon.id, mergeAttachmentArrays(current, attachments));
      }
    }
  }

  return { map, debug };
}

function mergeAttachmentArrays(a, b) {
  const out = [...a];
  const seen = new Set(out.map(x => x.slot + '__' + slug(x.name)));
  for (const item of b) {
    const key = item.slot + '__' + slug(item.name);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

function resetCodmunityData(attachments, compatibility) {
  const keptAttachments = attachments.filter(a => !String(a.fonte || '').includes('CODMunity'));
  const keptIds = new Set(keptAttachments.map(a => a.id));
  const keptCompatibility = compatibility.filter(c => keptIds.has(c.accessorioId) && !String(c.fonte || '').includes('CODMunity'));
  const removed = {
    attachments: attachments.length - keptAttachments.length,
    compatibility: compatibility.length - keptCompatibility.length
  };
  attachments.splice(0, attachments.length, ...keptAttachments);
  compatibility.splice(0, compatibility.length, ...keptCompatibility);
  return removed;
}

function mergeWeapon(weapons, weapon) {
  const index = weapons.findIndex(w => w.id === weapon.id);
  const base = index >= 0 ? weapons[index] : {};
  const record = {
    ...base,
    id: weapon.id,
    nome: base.nome || weaponNameFromId(weapon.id),
    gioco: weapon.game || base.gioco || 'Warzone',
    attiva: true,
    verificata: true,
    fonte: 'CODMunity official profile',
    fonteUrl: 'https://codmunity.gg/profile/CODMunity',
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
    const name = cleanAttachmentName(item.name);
    const sl = item.slot;
    if (!sl || badAttachmentName(name)) return;
    const id = slug(name);
    if (!id) return;

    if (!attMap.has(id)) {
      const att = {
        id,
        nome: name,
        tipo: sl,
        attivo: true,
        verificato: true,
        fonte: 'CODMunity official profile',
        fonteUrl: 'https://codmunity.gg/profile/CODMunity',
        note: 'Accessorio importato da loadout ufficiali CODMunity, non da testo generico della pagina.',
        updatedAt: today(),
        stato: 'pubblico',
        codmunityOrder: index + 1
      };
      attachments.push(att);
      attMap.set(id, att);
      newA++;
    } else {
      const att = attMap.get(id);
      att.nome = name;
      att.tipo = sl;
      att.attivo = true;
      att.verificato = true;
      att.fonte = 'CODMunity official profile';
      att.fonteUrl = att.fonteUrl || 'https://codmunity.gg/profile/CODMunity';
      att.updatedAt = today();
      if (!['bloccato', 'disattivato'].includes(att.stato)) att.stato = 'pubblico';
    }

    const key = `${weapon.id}__${id}`;
    if (!compMap.has(key)) {
      const row = {
        id: key,
        armaId: weapon.id,
        accessorioId: id,
        slot: sl,
        compatibile: true,
        verificato: true,
        fonte: 'CODMunity official profile',
        fonteUrl: 'https://codmunity.gg/profile/CODMunity',
        note: 'Compatibilità importata da build/loadout ufficiali CODMunity.',
        updatedAt: today(),
        stato: 'pubblico',
        codmunityOrder: index + 1
      };
      compatibility.push(row);
      compMap.set(key, row);
      newC++;
    }
  });

  return { newA, newC };
}

async function main() {
  const report = {
    startedAt: new Date().toISOString(),
    source: 'CODMunity official profile loadouts',
    mode: 'official-profile-loadout-cards',
    profileDebug: [],
    processedWeapons: [],
    failedWeapons: [],
    attachmentsImported: 0,
    compatibilityImported: 0,
    removedOldCodmunityData: null,
    finishedAt: null
  };

  const weaponsToSync = weaponList();
  const weapons = read(WEAPONS, []);
  const attachments = read(ATTS, []);
  const compatibility = read(COMPAT, []);

  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1400 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36');

    const official = await collectOfficialCodmunityLoadouts(page, weaponsToSync, weapons);
    report.profileDebug = official.debug;

    const totalFound = Array.from(official.map.values()).reduce((sum, arr) => sum + arr.length, 0);
    if (totalFound > 0) {
      report.removedOldCodmunityData = resetCodmunityData(attachments, compatibility);
    } else {
      report.failedWeapons.push({ armaId: '*', error: 'Nessun accessorio trovato dai loadout ufficiali CODMunity. Database precedente non cancellato.' });
    }

    for (const weapon of weaponsToSync) {
      mergeWeapon(weapons, weapon);
      const items = official.map.get(weapon.id) || [];
      const merged = items.length ? mergeData(attachments, compatibility, weapon, items) : { newA: 0, newC: 0 };
      report.attachmentsImported += merged.newA;
      report.compatibilityImported += merged.newC;
      report.processedWeapons.push({
        armaId: weapon.id,
        game: weapon.game,
        extractionMode: 'official-profile-loadout-cards',
        attachmentsFound: items.length,
        attachmentsAdded: merged.newA,
        compatibilityAdded: merged.newC
      });
      console.log(`${weapon.id}: ${items.length} accessori ufficiali CODMunity`);
    }
  } finally {
    await browser.close().catch(() => {});
  }

  report.finishedAt = new Date().toISOString();
  write(WEAPONS, weapons);
  write(ATTS, attachments);
  write(COMPAT, compatibility);
  write(REPORT, report);
  console.log('Sync CODMunity official profile completato:', report);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
