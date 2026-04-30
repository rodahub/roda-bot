'use strict';

/**
 * RØDA Loadout Sync — CODMunity Mobile Builder v4
 *
 * Il debug ha confermato che CODMunity NON usa <select> HTML: usa dropdown custom.
 * Questa versione clicca i dropdown custom in sequenza: gioco -> arma -> slot accessori.
 * Se non trova accessori NON svuota il database.
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

const BUILDER_URL = 'https://codmunity.gg/create-loadout';
const SOURCE = 'CODMunity Mobile Builder';
const LIMIT = Number((process.argv.find(a => /^--limit=\d+$/.test(a)) || '').split('=')[1] || 0) || null;
const DEBUG_LIMIT = Number(process.env.CODMUNITY_DEBUG_LIMIT || 8);
const DELAY = Number(process.env.CODMUNITY_MOBILE_SYNC_DELAY_MS || 450);

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
const SLOT_WORDS = Object.values(SLOT_ALIASES).flat().map(x => normalizeForCompare(x));

const CATEGORY_MAP = new Map([
  ['1911-pistol', 'Pistola'], ['1911', 'Pistola'], ['9mm-pm', 'Pistola'], ['grekhova', 'Pistola'], ['gs45', 'Pistola'], ['stryder-22', 'Pistola'],
  ['ak-27', 'Fucile d\'assalto'], ['xm4', 'Fucile d\'assalto'], ['ak-74', 'Fucile d\'assalto'], ['ames-85', 'Fucile d\'assalto'], ['gpr-91', 'Fucile d\'assalto'], ['model-l', 'Fucile d\'assalto'], ['krig-c', 'Fucile d\'assalto'], ['maddox-rfb', 'Fucile d\'assalto'], ['mxr-17', 'Fucile d\'assalto'], ['mk35-isr', 'Fucile d\'assalto'], ['peacekeeper-mk1', 'Fucile d\'assalto'], ['cr-56-amax', 'Fucile d\'assalto'], ['kilo-141', 'Fucile d\'assalto'],
  ['c9', 'Mitraglietta'], ['jackal-pdw', 'Mitraglietta'], ['ksv', 'Mitraglietta'], ['tanto-22', 'Mitraglietta'], ['saug', 'Mitraglietta'], ['ppsh-41', 'Mitraglietta'], ['ladra', 'Mitraglietta'], ['lc10', 'Mitraglietta'], ['razor-9mm', 'Mitraglietta'], ['coda-9', 'Mitraglietta'], ['carbon-57', 'Mitraglietta'], ['velox-57', 'Mitraglietta'], ['rk-9', 'Mitraglietta'],
  ['lw3a1-frostline', 'Cecchino'], ['svd', 'Cecchino'], ['lr-762', 'Cecchino'], ['lr-7-62', 'Cecchino'], ['hdr', 'Cecchino'], ['vs-recon', 'Cecchino'],
  ['pu-21', 'Mitragliatrice leggera'], ['xmg', 'Mitragliatrice leggera'], ['gpmg-7', 'Mitragliatrice leggera'], ['feng-82', 'Mitragliatrice leggera'], ['mk78', 'Mitragliatrice leggera'], ['mk-78', 'Mitragliatrice leggera'],
  ['dm-10', 'Fucile tattico'], ['tr2', 'Fucile tattico'], ['aek-973', 'Fucile tattico'], ['swat-556', 'Fucile tattico'], ['tsarkov-762', 'Fucile tattico'], ['m8a1', 'Fucile tattico'],
  ['marine-sp', 'Shotgun'], ['asg-89', 'Shotgun'], ['maelstrom', 'Shotgun'], ['sg-12', 'Shotgun']
]);

const BAD_RX = /cookie|privacy|terms|login|register|subscribe|newsletter|discord|telegram|twitter|instagram|youtube|tiktok|promo|discount|coupon|code|store|shop|premium|advertisement|sponsored|patch notes|tier list|home|menu|search|filter|sort|copy link|share|follow|prestige|unlock|sblocca|scatta una foto|loadout name|description|codice di condivisione|accessori popolari|selezione rapida|download|creator/i;
const STAT_RX = /ads speed|ads movement|aim down sight|recoil control|rinculo|damage range|bullet velocity|sprint to fire|movement speed|fire rate|mobility|handling|accuracy|damage|control|ttk|rpm|reload speed|magazine size/i;

function read(file, fallback = []) { try { if (!fs.existsSync(file)) return fallback; const raw = fs.readFileSync(file, 'utf8'); return raw.trim() ? JSON.parse(raw) : fallback; } catch (_) { return fallback; } }
function write(file, data) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8'); }
function clean(v) { return String(v || '').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim(); }
function normalizeForCompare(v) { return clean(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim(); }
function slug(v) { return clean(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
function nowIso() { return new Date().toISOString(); }
function today() { return new Date().toISOString().slice(0, 10); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function weaponIdFromUrl(url) { return String(url || '').split('/').filter(Boolean).pop() || ''; }
function gameFromUrl(url, entry = {}) { const m = String(url || '').match(/\/weapon\/(bo\d+)\//i); return String(entry.game || (m && m[1]) || 'Warzone').toUpperCase(); }
function nameFromId(id) { return String(id || '').split('-').map(p => p.length <= 3 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1)).join(' '); }
function gameLabels(game) { const g = String(game || '').toUpperCase(); if (g === 'BO7') return ['Black Ops 7', 'BO7', 'Black Ops Royale']; if (g === 'BO6') return ['Black Ops 6', 'BO6']; return ['Warzone']; }
function categoryFor(id) { return CATEGORY_MAP.get(id) || 'Da verificare'; }
function weaponNames(weapon) { return Array.from(new Set([weapon.nome, nameFromId(weapon.id), weapon.id.replace(/-/g, ' '), weapon.id].filter(Boolean))); }
function normalizeSlot(v) { const n = normalizeForCompare(v); for (const [slot, aliases] of Object.entries(SLOT_ALIASES)) if (aliases.some(a => normalizeForCompare(a) === n)) return slot; return null; }
function isBadAttachmentName(v) { const n = clean(v); if (!n || n.length < 2 || n.length > 76 || !/[a-zA-Z0-9]/.test(n)) return true; if (SLOT_WORDS.includes(normalizeForCompare(n))) return true; if (/^level\s*\d+$/i.test(n) || /^lvl\s*\d+$/i.test(n)) return true; if (/^\+?\-?\d+(\.\d+)?%?$/.test(n)) return true; if (BAD_RX.test(n) || STAT_RX.test(n)) return true; if (n.includes('://') || n.includes('.gg') || n.includes('@')) return true; if (n.split(' ').length > 8) return true; return false; }
function cleanAttachmentName(v) { return clean(v).replace(/^[-–—•*]\s*/, '').replace(/\s+Level\s*\d+$/i, '').replace(/\s+Unlock(?:ed)?\s+at\s+Level\s*\d+$/i, '').replace(/\s+Required\s+Level\s*\d+$/i, '').trim(); }

function getWeapons() {
  const raw = read(URLS_FILE, []);
  const seen = new Set();
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i];
    const url = typeof entry === 'string' ? entry : entry.url;
    const id = weaponIdFromUrl(url);
    const game = gameFromUrl(url, entry || {});
    const key = `${game}:${id}`;
    if (!id || !url || seen.has(key)) continue;
    seen.add(key);
    out.push({ id, game, url, nome: (entry && (entry.nome || entry.name)) || nameFromId(id), order: i + 1, codmunityOrder: i + 1 });
  }
  return out.slice(0, LIMIT || undefined);
}

async function collectDiagnostics(page) {
  return page.evaluate(() => {
    const clean = v => String(v || '').replace(/\s+/g, ' ').trim();
    const visible = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 10 && r.height > 8 && r.bottom > 0 && r.top < innerHeight && s.display !== 'none' && s.visibility !== 'hidden'; };
    const nodes = Array.from(document.querySelectorAll('button,a,[role="button"],[role="option"],[role="combobox"],label,[class*="select"],[class*="dropdown"],input')).filter(visible).map((el, i) => ({ i, tag: el.tagName, role: el.getAttribute('role') || '', text: clean(el.innerText || el.textContent || el.getAttribute('aria-label') || el.getAttribute('title') || el.placeholder || ''), aria: clean(el.getAttribute('aria-label')), cls: clean(el.className).slice(0, 120) })).filter(x => x.text || x.role || x.aria).slice(0, 220);
    return { url: location.href, title: document.title, bodySample: clean(document.body && document.body.innerText || '').slice(0, 4000), nodes };
  }).catch(e => ({ error: e.message }));
}

async function clickDropdownTrigger(page, index = 0) {
  return page.evaluate((index) => {
    const clean = v => String(v || '').replace(/\s+/g, ' ').trim();
    const visible = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 12 && r.height > 10 && r.bottom > 0 && r.top < innerHeight && s.display !== 'none' && s.visibility !== 'hidden'; };
    const badArea = el => !!el.closest('header,footer,nav');
    const candidates = Array.from(document.querySelectorAll('button,[role="button"],[role="combobox"],div,span'))
      .filter(el => visible(el) && !badArea(el))
      .map(el => ({ el, text: clean(el.innerText || el.textContent || el.getAttribute('aria-label') || el.getAttribute('title') || ''), rect: el.getBoundingClientRect() }))
      .filter(x => /dropdown trigger|select a game|select weapon|select a weapon|weapon|game|playstyle/i.test(x.text) || x.el.getAttribute('aria-haspopup') || x.el.getAttribute('aria-expanded') !== null)
      .sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);
    const picked = candidates[index] || candidates[0];
    if (!picked) return { ok: false, count: 0 };
    picked.el.scrollIntoView({ block: 'center', inline: 'center' });
    picked.el.click();
    return { ok: true, count: candidates.length, index, text: picked.text, top: picked.rect.top };
  }, index).catch(e => ({ ok: false, error: e.message }));
}

async function clickOption(page, labels) {
  return page.evaluate((labels) => {
    const norm = v => String(v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
    const clean = v => String(v || '').replace(/\s+/g, ' ').trim();
    const wanted = labels.map(norm).filter(Boolean);
    const visible = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 12 && r.height > 10 && r.bottom > 0 && r.top < innerHeight && s.display !== 'none' && s.visibility !== 'hidden'; };
    const badArea = el => !!el.closest('header,footer,nav');
    const primary = Array.from(document.querySelectorAll('[role="option"],[role="menuitem"],li,button,div,span'))
      .filter(el => visible(el) && !badArea(el) && !el.closest('a[href*="/weapon/"]'))
      .map(el => ({ el, text: clean(el.innerText || el.textContent || el.getAttribute('aria-label') || el.getAttribute('title') || ''), rect: el.getBoundingClientRect() }))
      .filter(x => x.text && x.text.length <= 100)
      .filter(x => wanted.some(w => norm(x.text) === w || norm(x.text).includes(w) || w.includes(norm(x.text))))
      .sort((a, b) => {
        const ar = a.el.getAttribute('role') === 'option' ? 0 : 1;
        const br = b.el.getAttribute('role') === 'option' ? 0 : 1;
        return ar - br || a.rect.top - b.rect.top;
      });
    const picked = primary[0];
    if (!picked) return { ok: false, labels };
    picked.el.scrollIntoView({ block: 'center', inline: 'center' });
    picked.el.click();
    return { ok: true, text: picked.text };
  }, labels).catch(e => ({ ok: false, error: e.message }));
}

async function chooseWithDropdowns(page, labels, maxTriggers = 8) {
  for (let i = 0; i < maxTriggers; i++) {
    const opened = await clickDropdownTrigger(page, i);
    await sleep(450);
    const picked = await clickOption(page, labels);
    if (picked.ok) { await sleep(650); return { ok: true, trigger: opened, picked }; }
    await page.keyboard.press('Escape').catch(() => {});
    await sleep(120);
    if (!opened.ok && i > 2) break;
  }
  return { ok: false, labels };
}

async function selectWeapon(page, weapon) {
  await page.goto(BUILDER_URL, { waitUntil: 'networkidle2', timeout: 70000 });
  await sleep(1000);
  const steps = [];
  steps.push({ step: 'game', result: await chooseWithDropdowns(page, gameLabels(weapon.game), 5) });
  steps.push({ step: 'weapon', result: await chooseWithDropdowns(page, weaponNames(weapon), 10) });
  await sleep(900);
  const state = await page.evaluate((names) => {
    const norm = v => String(v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
    const body = norm(document.body && document.body.innerText || '');
    const hasWeapon = names.map(norm).some(n => n && body.includes(n));
    const hasSlots = ['optic','ottica','muzzle','volata','barrel','canna','underbarrel','sottocanna','magazine','caricatore','add attachments','accessori'].some(s => body.includes(norm(s)));
    return { hasWeapon, hasSlots, bodySample: body.slice(0, 1200) };
  }, weaponNames(weapon));
  return { selected: !!(state.hasWeapon && state.hasSlots), steps, state };
}

async function extractVisibleOptions(page, slotName) {
  return page.evaluate(({ slotName, slotWords }) => {
    const clean = v => String(v || '').replace(/\s+/g, ' ').trim();
    const norm = v => clean(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
    const visible = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 12 && r.height > 10 && r.bottom > 0 && r.top < innerHeight && s.display !== 'none' && s.visibility !== 'hidden'; };
    const badName = n => { n = clean(n); const low = norm(n); if (!n || n.length < 2 || n.length > 76 || !/[a-zA-Z0-9]/.test(n)) return true; if (slotWords.includes(low)) return true; if (/^level\s*\d+$/i.test(n) || /^lvl\s*\d+$/i.test(n)) return true; if (/^\+?\-?\d+(\.\d+)?%?$/.test(n)) return true; if (/cookie|privacy|login|register|subscribe|discord|promo|coupon|download|creator|search|filter|sort|follow|weapon|loadout|description/i.test(n)) return true; if (/ads speed|aim down sight|recoil|damage|bullet velocity|sprint to fire|movement|accuracy|control|reload/i.test(n)) return true; if (n.includes('://') || n.includes('.gg') || n.includes('@')) return true; if (n.split(' ').length > 8) return true; return false; };
    const roots = Array.from(document.querySelectorAll('[role="listbox"],[role="menu"],[role="dialog"],[class*="dropdown"],[class*="popover"],[class*="select"],[class*="modal"]')).filter(visible);
    const scanRoots = roots.length ? roots : [document.body];
    const raw = [];
    for (const root of scanRoots) {
      const els = Array.from(root.querySelectorAll('[data-name],[data-value],[role="option"],button,li,div,span')).filter(visible);
      for (const el of els) {
        let text = clean(el.getAttribute('data-name') || el.getAttribute('data-value') || el.getAttribute('aria-label') || el.getAttribute('title') || el.innerText || el.textContent);
        const lines = text.split('\n').map(clean).filter(Boolean);
        if (lines.length > 1) text = lines.find(x => !badName(x)) || '';
        text = clean(text).replace(/\s+Level\s*\d+$/i, '').trim();
        if (!badName(text)) raw.push(text);
      }
    }
    const seen = new Set();
    return raw.filter(name => { const key = norm(name); if (seen.has(key)) return false; seen.add(key); return true; }).map(name => ({ slot: slotName, name }));
  }, { slotName, slotWords: SLOT_WORDS });
}

async function extractAttachments(page) {
  const items = [];
  const slotDebug = [];
  for (const slotName of SLOT_ORDER) {
    const open = await chooseWithDropdowns(page, SLOT_ALIASES[slotName], 12);
    await sleep(450);
    const found = open.ok ? await extractVisibleOptions(page, slotName) : [];
    const cleanFound = found.map(x => ({ slot: x.slot, name: cleanAttachmentName(x.name) })).filter(x => !isBadAttachmentName(x.name));
    slotDebug.push({ slot: slotName, opened: open.ok, count: cleanFound.length, sample: cleanFound.slice(0, 5).map(x => x.name) });
    items.push(...cleanFound);
    await page.keyboard.press('Escape').catch(() => {});
    await sleep(100);
  }
  const seen = new Set();
  return { items: items.filter(x => { const key = `${x.slot}:${slug(x.name)}`; if (seen.has(key)) return false; seen.add(key); return true; }), slotDebug };
}

function mergeWeapon(weapons, weapon) {
  const todayStr = today();
  if (weapons.some(w => w.id === weapon.id)) return;
  weapons.push({ id: weapon.id, nome: weapon.nome || nameFromId(weapon.id), categoria: categoryFor(weapon.id), gioco: weapon.game || 'Warzone', attiva: true, verificata: true, fonte: SOURCE, fonteUrl: BUILDER_URL, note: 'Arma importata dal builder mobile CODMunity. Gli utenti creano le build dal sito RØDA.', stato: 'pubblico', codmunityOrder: weapon.codmunityOrder || weapon.order, discoveredAt: todayStr, updatedAt: todayStr });
}

function mergeCompatibility(state, weapon, items) {
  mergeWeapon(state.weapons, weapon);
  const attMap = new Map(state.attachments.map(a => [a.id, a]));
  const compMap = new Map(state.compatibility.map(c => [`${c.armaId}__${c.accessorioId}`, c]));
  const todayStr = today();
  items.forEach((item, index) => {
    const name = cleanAttachmentName(item.name);
    const id = slug(name);
    if (!id || isBadAttachmentName(name)) return;
    if (!attMap.has(id)) {
      const att = { id, nome: name, tipo: item.slot, attivo: true, verificato: true, fonte: SOURCE, fonteUrl: BUILDER_URL, note: 'Accessorio letto dallo slot reale del builder mobile CODMunity.', stato: 'pubblico', updatedAt: todayStr, codmunityOrder: index + 1 };
      state.attachments.push(att);
      attMap.set(id, att);
    }
    const key = `${weapon.id}__${id}`;
    if (!compMap.has(key)) {
      const row = { id: key, armaId: weapon.id, accessorioId: id, slot: item.slot, compatibile: true, verificato: true, fonte: SOURCE, fonteUrl: BUILDER_URL, note: 'Compatibilità letta dallo slot reale del builder mobile CODMunity.', stato: 'pubblico', updatedAt: todayStr, codmunityOrder: index + 1 };
      state.compatibility.push(row);
      compMap.set(key, row);
    }
  });
}

async function main() {
  const previous = { weapons: read(WEAPONS_FILE, []), attachments: read(ATTACHMENTS_FILE, []), compatibility: read(COMPAT_FILE, []), builds: read(BUILDS_FILE, []) };
  const report = { startedAt: nowIso(), source: SOURCE, mode: 'codmunity-mobile-custom-dropdown-v4', previousDatabase: { weapons: previous.weapons.length, attachments: previous.attachments.length, compatibility: previous.compatibility.length, builds: previous.builds.length }, processedWeapons: [], debug: [], errors: [], preservedPreviousDatabase: true, finishedAt: null };
  const state = { weapons: [], attachments: [], compatibility: [] };
  const weapons = getWeapons();

  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
    await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');

    for (let i = 0; i < weapons.length; i++) {
      const weapon = weapons[i];
      console.log(`[${i + 1}/${weapons.length}] CODMunity mobile v4: ${weapon.nome}`);
      try {
        const before = report.debug.length < DEBUG_LIMIT ? await collectDiagnostics(page).catch(() => null) : null;
        const selected = await selectWeapon(page, weapon);
        const extracted = selected.selected ? await extractAttachments(page) : { items: [], slotDebug: [] };
        if (extracted.items.length) mergeCompatibility(state, weapon, extracted.items);
        const row = { armaId: weapon.id, nome: weapon.nome, game: weapon.game, selected: selected.selected, attachmentsFound: extracted.items.length, steps: selected.steps, slotDebug: extracted.slotDebug };
        report.processedWeapons.push(row);
        console.log(`  ${row.selected ? 'selezionata' : 'NON selezionata'} · ${row.attachmentsFound} accessori`);
        if ((!row.selected || !row.attachmentsFound) && report.debug.length < DEBUG_LIMIT) report.debug.push({ weapon: row, before, after: await collectDiagnostics(page).catch(() => null), state: selected.state });
      } catch (error) {
        report.errors.push({ armaId: weapon.id, nome: weapon.nome, error: error.message });
        console.log(`  ERRORE ${error.message}`);
      }
      report.finishedAt = nowIso();
      write(REPORT_FILE, report);
      await sleep(DELAY);
    }
  } finally {
    await browser.close().catch(() => {});
  }

  report.weaponsImported = state.weapons.length;
  report.attachmentsImported = state.attachments.length;
  report.compatibilityImported = state.compatibility.length;
  report.finishedAt = nowIso();

  if (state.compatibility.length > 0) {
    write(WEAPONS_FILE, state.weapons);
    write(ATTACHMENTS_FILE, state.attachments);
    write(COMPAT_FILE, state.compatibility);
    write(BUILDS_FILE, previous.builds.filter(b => ![SOURCE, 'FPSMeta', 'WZLoad', 'WarzoneLoadout', 'CODMunity'].includes(b.fonte)));
    report.preservedPreviousDatabase = false;
  } else {
    write(WEAPONS_FILE, previous.weapons);
    write(ATTACHMENTS_FILE, previous.attachments);
    write(COMPAT_FILE, previous.compatibility);
    write(BUILDS_FILE, previous.builds);
    report.errors.push('Nessuna compatibilità trovata: database precedente preservato.');
  }
  write(REPORT_FILE, report);
  console.log('Sync CODMunity mobile v4 completato:', report);
}

main().catch(error => { console.error(error); process.exit(1); });
