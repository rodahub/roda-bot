'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const CREATE_URL = 'https://codmunity.gg/create-loadout';
const URLS = path.join(DATA, 'codmunity-weapon-urls.json');
const WEAPONS = path.join(DATA, 'loadout-weapons.json');
const ATTS = path.join(DATA, 'loadout-attachments.json');
const COMPAT = path.join(DATA, 'loadout-compatibility.json');
const REPORT = path.join(DATA, 'loadout-build-sync-report.json');
const LIMIT = Number((process.argv.find(a => /^--limit=\d+$/.test(a)) || '').split('=')[1] || 0) || null;
const DELAY = Number(process.env.CODMUNITY_SYNC_DELAY_MS || 1500);

const SLOTS = ['Ottica','Volata','Canna','Sottocanna','Caricatore','Impugnatura','Calcio','Laser','Mod fuoco'];
const SLOT_ALIASES = {
  'Ottica': ['optic','optics','ottica'],
  'Volata': ['muzzle','volata'],
  'Canna': ['barrel','canna'],
  'Sottocanna': ['underbarrel','under barrel','sottocanna'],
  'Caricatore': ['magazine','mag','caricatore'],
  'Impugnatura': ['rear grip','rear-grip','grip','impugnatura'],
  'Calcio': ['stock','calcio'],
  'Laser': ['laser'],
  'Mod fuoco': ['fire mods','fire mod','fire-mods','mod fuoco']
};
const SLOT_MAP = Object.fromEntries(Object.entries(SLOT_ALIASES).flatMap(([it, arr]) => arr.map(a => [a, it])));

const PROMO_RX = /\b(codmunity|cod\s*munity|discount|promo|coupon|creator\s*code|support\s*a\s*creator|use\s+code|shop|store|sale|deal|subscribe|newsletter|telegram|discord|twitter|x\.com|instagram|youtube|tiktok|privacy|terms|cookie|login|sign\s*in|register|premium|pro|bundle|battle\s*pass|blackcell|warzone\s*meta|best\s*loadout|patch\s*notes|tier\s*list)\b/i;
const UI_RX = /^(search|select|none|empty|attachment|attachments|loadout|build|meta|recommended|close|back|clear|filter|sort|all|any|save|share|copy|remove|delete|cancel|confirm|apply|reset|next|previous|primary|secondary)$/i;
const STAT_RX = /\b(ads\s*speed|aim\s*down\s*sight|recoil\s*control|damage\s*range|bullet\s*velocity|sprint\s*to\s*fire|movement\s*speed|hipfire|hip\s*fire|fire\s*rate|flinch|idle\s*sway|gun\s*kick|horizontal|vertical|mobility|handling|accuracy|range|damage|control)\b/i;

function read(file, fallback = []) { try { if (!fs.existsSync(file)) return fallback; const raw = fs.readFileSync(file, 'utf8'); return raw.trim() ? JSON.parse(raw) : fallback; } catch { return fallback; } }
function write(file, data) { fs.mkdirSync(path.dirname(file), { recursive:true }); fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8'); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function clean(v) { return String(v || '').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, ' ').trim(); }
function slug(v) { return clean(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
function slot(v) { return SLOT_MAP[clean(v).toLowerCase()] || null; }
function wid(url) { return String(url || '').split('/').filter(Boolean).pop(); }
function game(url, entry) { const m = String(url || '').match(/\/weapon\/(bo\d+)\//i); return String(entry.game || (m && m[1]) || 'Warzone').toUpperCase(); }
function today() { return new Date().toISOString().slice(0, 10); }
function cleanAttName(v) { return clean(v).replace(/\s+Level\s*\d+$/i, '').replace(/\s+Unlock(?:ed)?\s+at\s+Level\s*\d+$/i, '').replace(/\s+Required\s+Level\s*\d+$/i, '').replace(/\s+\+?\-?\d+(\.\d+)?%$/i, '').trim(); }
function badName(v) {
  const n = cleanAttName(v);
  const s = slug(n);
  if (!n || n.length < 2 || n.length > 48 || !/[a-zA-Z]/.test(n)) return true;
  if (SLOT_MAP[n.toLowerCase()]) return true;
  if (/^level\s*\d+$/i.test(n) || /^lvl\s*\d+$/i.test(n)) return true;
  if (/unlock|unlocked|required|weapon\s*level|player\s*level|max\s*level/i.test(n)) return true;
  if (/^\+?\-?\d+(\.\d+)?%?$/.test(n)) return true;
  if (UI_RX.test(n) || PROMO_RX.test(n) || STAT_RX.test(n)) return true;
  if (n.includes('://') || n.includes('.gg') || n.includes('@')) return true;
  if (/^\d+\s*(round|rounds|mag|mags)$/i.test(n)) return false;
  if (n.split(' ').length > 5) return true;
  if (s.includes('level-') || s.includes('unlock-at') || s.includes('codmunity') || s.includes('discount-code') || s.includes('use-code')) return true;
  return false;
}
function weaponList() { return read(URLS, []).map((e, i) => { const url = typeof e === 'string' ? e : e.url; return { id:wid(url), url, game:game(url, e || {}), codmunityOrder:Number(e.codmunityOrder || i + 1), discoveredAt:e.discoveredAt || today() }; }).filter(x => x.id && x.url).slice(0, LIMIT || undefined); }

function removeCodmunityBuildData(attachments, compatibility) {
  const codIds = new Set(attachments.filter(a => String(a.fonte || '').includes('CODMunity')).map(a => a.id));
  const keptAttachments = attachments.filter(a => !codIds.has(a.id) && !badName(a.nome || a.name || a.id));
  const keptIds = new Set(keptAttachments.map(a => a.id));
  const keptCompat = compatibility.filter(c => keptIds.has(c.accessorioId) && !String(c.fonte || '').includes('CODMunity'));
  const removed = { attachments: attachments.length - keptAttachments.length, compatibility: compatibility.length - keptCompat.length };
  attachments.splice(0, attachments.length, ...keptAttachments);
  compatibility.splice(0, compatibility.length, ...keptCompat);
  return removed;
}

async function openBuilder(page) {
  await page.goto(CREATE_URL, { waitUntil:'networkidle2', timeout:60000 });
  await page.evaluate(() => Array.from(document.querySelectorAll('button')).forEach(b => { const t=(b.innerText||'').toLowerCase(); if (t.includes('accept') || t.includes('agree') || t === 'ok') b.click(); })).catch(()=>{});
  await sleep(1000);
}

async function pickWeapon(page, weapon) {
  const query = weapon.id.replace(/-/g, ' ');
  await page.evaluate(q => {
    const inputs = Array.from(document.querySelectorAll('input'));
    const input = inputs.find(i => !i.disabled && (/search|weapon|arma/i.test(`${i.placeholder||''} ${i.getAttribute('aria-label')||''}`) || ['search','text'].includes(i.type)));
    if (!input) return false;
    input.focus(); input.value=''; input.dispatchEvent(new Event('input',{bubbles:true})); input.value=q; input.dispatchEvent(new Event('input',{bubbles:true})); input.dispatchEvent(new Event('change',{bubbles:true}));
    return true;
  }, query).catch(()=>false);
  await sleep(900);
  const clicked = await page.evaluate(w => {
    const slug = v => String(v||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
    const ids = [w.id, w.id.replace(/-/g,' ')].map(slug);
    const els = Array.from(document.querySelectorAll('button,a,[role="button"],li')).filter(el => {
      if (el.closest('header,footer,nav,[class*="cookie"],[class*="modal"],[class*="ad"],[class*="promo"],[class*="discount"]')) return false;
      const r = el.getBoundingClientRect(); if (r.width < 20 || r.height < 12) return false;
      const text = (el.innerText || el.textContent || '').trim(); if (!text || text.length > 80) return false;
      const s = slug(text); return ids.some(id => s === id || s.includes(id) || id.includes(s));
    });
    if (!els[0]) return false;
    els[0].scrollIntoView({block:'center'}); els[0].click(); return true;
  }, weapon);
  await sleep(1200);
  return clicked;
}

async function clickSlot(page, italianSlot) {
  const aliases = SLOT_ALIASES[italianSlot];
  return page.evaluate((aliases) => {
    const norm = v => String(v || '').toLowerCase().replace(/\s+/g, ' ').trim();
    const badAnc = el => el.closest('header,footer,nav,[class*="cookie"],[class*="promo"],[class*="discount"],[class*="social"],[class*="ad"]');
    const exact = el => {
      const text = norm(el.innerText || el.textContent || el.getAttribute('aria-label') || el.getAttribute('title'));
      if (!text || text.length > 48) return false;
      return aliases.some(a => text === a || text.startsWith(a + ' ') || text.includes('\n' + a));
    };
    const candidates = Array.from(document.querySelectorAll('button,[role="button"],[data-slot],[data-type]')).filter(el => {
      if (badAnc(el)) return false;
      const r = el.getBoundingClientRect();
      if (r.width < 30 || r.height < 16) return false;
      const attrs = norm(`${el.getAttribute('data-slot')||''} ${el.getAttribute('data-type')||''} ${el.getAttribute('aria-label')||''}`);
      return aliases.some(a => attrs.includes(a)) || exact(el);
    });
    if (!candidates[0]) return false;
    candidates[0].scrollIntoView({ block:'center', inline:'center' });
    candidates[0].click();
    return true;
  }, aliases);
}

async function extractVisibleOptionsForSlot(page, italianSlot) {
  return page.evaluate((italianSlot) => {
    const PROMO = /\b(codmunity|discount|promo|coupon|creator\s*code|support\s*a\s*creator|use\s+code|shop|store|subscribe|telegram|discord|twitter|instagram|youtube|tiktok|privacy|terms|cookie|login|register|tier\s*list|patch\s*notes)\b/i;
    const STAT = /\b(ads\s*speed|aim\s*down\s*sight|recoil\s*control|damage\s*range|bullet\s*velocity|sprint\s*to\s*fire|movement\s*speed|fire\s*rate|mobility|handling|accuracy|damage|control)\b/i;
    const slotWords = ['optic','optics','muzzle','barrel','underbarrel','magazine','rear grip','stock','laser','fire mods','ottica','volata','canna','sottocanna','caricatore','impugnatura','calcio','mod fuoco'];
    const clean = v => String(v || '').replace(/\s+/g, ' ').trim();
    const slug = v => clean(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
    const badContainer = el => el.closest('header,footer,nav,[class*="cookie"],[class*="promo"],[class*="discount"],[class*="social"],[class*="ad"]');
    const bad = n => !n || n.length < 2 || n.length > 48 || !/[a-zA-Z]/.test(n) || /^level\s*\d+$/i.test(n) || /unlock|unlocked|required|weapon level|player level|max level/i.test(n) || /^\+?\-?\d+(\.\d+)?%?$/.test(n) || /^(search|select|none|empty|attachment|attachments|loadout|build|meta|recommended|close|back|clear|filter|sort|all|save|share|copy|remove|delete|cancel|confirm|apply|reset)$/i.test(n) || PROMO.test(n) || STAT.test(n) || n.includes('://') || n.includes('.gg') || n.includes('@') || n.split(' ').length > 5 || slotWords.includes(n.toLowerCase());
    const visible = el => { const r = el.getBoundingClientRect(); const style = getComputedStyle(el); return r.width >= 25 && r.height >= 12 && style.visibility !== 'hidden' && style.display !== 'none' && r.bottom > 0 && r.top < innerHeight; };
    const optionRoots = Array.from(document.querySelectorAll('[role="listbox"],[role="menu"],[role="dialog"],[class*="popover"],[class*="dropdown"],[class*="modal"],[class*="option"],[class*="attachment"]')).filter(el => visible(el) && !badContainer(el));
    const roots = optionRoots.length ? optionRoots : [document.body];
    const out = [];
    for (const root of roots) {
      const elements = Array.from(root.querySelectorAll('[data-name],[data-value],[role="option"],button,li')).filter(el => visible(el) && !badContainer(el));
      for (const el of elements) {
        let text = clean(el.getAttribute('data-name') || el.getAttribute('data-value') || el.getAttribute('aria-label') || el.getAttribute('title') || el.innerText || el.textContent);
        const lines = text.split('\n').map(clean).filter(Boolean);
        if (lines.length > 1) text = lines.find(x => !bad(x)) || '';
        text = clean(text).replace(/\s+Level\s*\d+$/i,'').replace(/\s+Unlock(?:ed)?\s+at\s+Level\s*\d+$/i,'').replace(/\s+Required\s+Level\s*\d+$/i,'').trim();
        if (bad(text)) continue;
        out.push({ slot: italianSlot, name: text, key: slug(text) });
      }
    }
    const seen = new Set();
    return out.filter(x => x.key && !seen.has(x.key) && seen.add(x.key)).map(({slot,name}) => ({slot,name}));
  }, italianSlot);
}

async function extractStrictBySlots(page) {
  const all = [];
  for (const italianSlot of SLOTS) {
    const opened = await clickSlot(page, italianSlot);
    if (!opened) continue;
    await sleep(700);
    const items = await extractVisibleOptionsForSlot(page, italianSlot);
    all.push(...items);
    await page.keyboard.press('Escape').catch(() => {});
    await sleep(250);
  }
  const seen = new Set();
  return all.map(x => ({ slot: slot(x.slot) || x.slot, name: cleanAttName(x.name) })).filter(x => x.slot && !badName(x.name)).filter(x => { const k = x.slot + '__' + slug(x.name); if (seen.has(k)) return false; seen.add(k); return true; });
}

function mergeWeapon(weapons, w) {
  const i = weapons.findIndex(x => x.id === w.id);
  const base = i >= 0 ? weapons[i] : {};
  const rec = { ...base, id:w.id, nome:base.nome || w.id.split('-').map(p => p.length <= 3 ? p.toUpperCase() : p[0].toUpperCase()+p.slice(1)).join(' '), gioco:w.game, attiva:true, verificata:true, fonte:'CODMunity Build', fonteUrl:w.url, stato:base.stato && ['bloccato','disattivato'].includes(base.stato) ? base.stato : 'pubblico', codmunityOrder:base.codmunityOrder || w.codmunityOrder, discoveredAt:base.discoveredAt || w.discoveredAt, updatedAt:today() };
  if (i >= 0) weapons[i] = rec; else weapons.push(rec);
}
function mergeData(attachments, compatibility, w, items) {
  const attMap = new Map(attachments.map(a => [a.id,a]));
  const compMap = new Map(compatibility.map(c => [`${c.armaId}__${c.accessorioId}`,c]));
  let newA=0, newC=0;
  items.forEach((it, idx) => {
    const name = cleanAttName(it.name); const sl = slot(it.slot) || it.slot; if (!sl || badName(name)) return;
    const id = slug(name); if (!id) return;
    if (!attMap.has(id)) { const a = { id, nome:name, tipo:sl, attivo:true, verificato:true, fonte:'CODMunity Build', fonteUrl:CREATE_URL, note:'Accessorio importato solo da slot aperto nel builder CODMunity.', updatedAt:today(), stato:'pubblico', codmunityOrder:idx+1 }; attachments.push(a); attMap.set(id,a); newA++; }
    else { const a = attMap.get(id); a.nome = name; a.tipo = sl; a.attivo = true; a.verificato = true; a.fonte = 'CODMunity Build'; a.updatedAt = today(); if (!['bloccato','disattivato'].includes(a.stato)) a.stato='pubblico'; }
    const key = `${w.id}__${id}`;
    if (!compMap.has(key)) { const c = { id:key, armaId:w.id, accessorioId:id, slot:sl, compatibile:true, verificato:true, fonte:'CODMunity Build', fonteUrl:CREATE_URL, note:'Compatibilità importata solo da slot aperto nel builder CODMunity.', updatedAt:today(), stato:'pubblico', codmunityOrder:idx+1 }; compatibility.push(c); compMap.set(key,c); newC++; }
    else { const c = compMap.get(key); c.slot = sl; c.compatibile = true; c.verificato = true; c.fonte = 'CODMunity Build'; c.updatedAt = today(); if (!['bloccato','disattivato'].includes(c.stato)) c.stato='pubblico'; }
  });
  return { newA, newC };
}

async function main() {
  const report = { startedAt:new Date().toISOString(), source:CREATE_URL, strictSlotMode:true, processedWeapons:[], failedWeapons:[], attachmentsImported:0, compatibilityImported:0, removedOldCodmunityBuildData:null, finishedAt:null };
  const weapons = read(WEAPONS), attachments = read(ATTS), compatibility = read(COMPAT), list = weaponList();
  report.removedOldCodmunityBuildData = removeCodmunityBuildData(attachments, compatibility);
  write(ATTS, attachments); write(COMPAT, compatibility);
  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({ headless:'new', args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({width:1440,height:1200});
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36');
    for (let i=0; i<list.length; i++) {
      const w = list[i]; console.log(`[${i+1}/${list.length}] ${w.game} ${w.id}`);
      try {
        mergeWeapon(weapons, w);
        await openBuilder(page);
        const selected = await pickWeapon(page, w);
        let items = [];
        if (selected) items = await extractStrictBySlots(page);
        const merged = mergeData(attachments, compatibility, w, items);
        report.attachmentsImported += merged.newA; report.compatibilityImported += merged.newC;
        report.processedWeapons.push({ armaId:w.id, game:w.game, selectedInBuilder:selected, extractionMode:'strict-slot-click', attachmentsFound:items.length, attachmentsAdded:merged.newA, compatibilityAdded:merged.newC });
        console.log(`  ✓ ${items.length} accessori validi da slot reali`);
      } catch (e) { report.failedWeapons.push({armaId:w.id, url:w.url, error:e.message}); console.log('  ✗ '+e.message); }
      write(WEAPONS,weapons); write(ATTS,attachments); write(COMPAT,compatibility); write(REPORT,{...report, finishedAt:new Date().toISOString()});
      await sleep(DELAY);
    }
  } finally { await browser.close().catch(()=>{}); }
  report.finishedAt = new Date().toISOString(); write(REPORT,report);
}
main().catch(e => { console.error(e); process.exit(1); });
