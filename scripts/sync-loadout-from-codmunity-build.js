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
const DELAY = Number(process.env.CODMUNITY_SYNC_DELAY_MS || 1400);

const SLOTS = ['Ottica','Volata','Canna','Sottocanna','Caricatore','Impugnatura','Calcio','Laser','Mod fuoco'];
const SLOT_MAP = {
  optic:'Ottica', optics:'Ottica', ottica:'Ottica', muzzle:'Volata', volata:'Volata', barrel:'Canna', canna:'Canna',
  underbarrel:'Sottocanna', 'under barrel':'Sottocanna', sottocanna:'Sottocanna', magazine:'Caricatore', mag:'Caricatore', caricatore:'Caricatore',
  'rear grip':'Impugnatura', 'rear-grip':'Impugnatura', grip:'Impugnatura', impugnatura:'Impugnatura', stock:'Calcio', calcio:'Calcio', laser:'Laser',
  'fire mods':'Mod fuoco', 'fire mod':'Mod fuoco', 'fire-mods':'Mod fuoco', 'mod fuoco':'Mod fuoco'
};

function read(file, fallback = []) { try { if (!fs.existsSync(file)) return fallback; const raw = fs.readFileSync(file, 'utf8'); return raw.trim() ? JSON.parse(raw) : fallback; } catch { return fallback; } }
function write(file, data) { fs.mkdirSync(path.dirname(file), { recursive:true }); fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8'); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function clean(v) { return String(v || '').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, ' ').trim(); }
function slug(v) { return clean(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
function slot(v) { return SLOT_MAP[clean(v).toLowerCase()] || null; }
function wid(url) { return String(url || '').split('/').filter(Boolean).pop(); }
function game(url, entry) { const m = String(url || '').match(/\/weapon\/(bo\d+)\//i); return String(entry.game || (m && m[1]) || 'Warzone').toUpperCase(); }
function today() { return new Date().toISOString().slice(0, 10); }
function badName(v) {
  const n = clean(v);
  if (!n || n.length < 2 || n.length > 64 || !/[a-zA-Z]/.test(n)) return true;
  if (SLOT_MAP[n.toLowerCase()]) return true;
  if (/^level\s*\d+$/i.test(n) || /^lvl\s*\d+$/i.test(n)) return true;
  if (/unlock|unlocked|required|weapon level|player level|max level/i.test(n)) return true;
  if (/^\+?\-?\d+(\.\d+)?%?$/.test(n)) return true;
  if (/^(search|select|none|empty|attachment|attachments|loadout|build|meta|recommended|close|back|clear|filter|sort)$/i.test(n)) return true;
  if (/\b(ads speed|recoil control|damage range|bullet velocity|sprint to fire)\b/i.test(n)) return true;
  if (n.split(' ').length > 7) return true;
  return false;
}
function cleanAttName(v) { return clean(v).replace(/\s+Level\s*\d+$/i, '').replace(/\s+Unlock(?:ed)?\s+at\s+Level\s*\d+$/i, '').replace(/\s+Required\s+Level\s*\d+$/i, '').trim(); }
function weaponList() { return read(URLS, []).map((e, i) => { const url = typeof e === 'string' ? e : e.url; return { id:wid(url), url, game:game(url, e || {}), codmunityOrder:Number(e.codmunityOrder || i + 1), discoveredAt:e.discoveredAt || today() }; }).filter(x => x.id && x.url).slice(0, LIMIT || undefined); }

async function openBuilder(page) {
  await page.goto(CREATE_URL, { waitUntil:'networkidle2', timeout:60000 });
  await page.evaluate(() => Array.from(document.querySelectorAll('button')).forEach(b => { const t=(b.innerText||'').toLowerCase(); if (t.includes('accept') || t.includes('agree') || t === 'ok') b.click(); })).catch(()=>{});
  await sleep(800);
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
  return page.evaluate(w => {
    const slug = v => String(v||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
    const ids = [w.id, w.id.replace(/-/g,' ')].map(slug);
    const els = Array.from(document.querySelectorAll('button,a,[role="button"],li,div')).filter(el => {
      const r = el.getBoundingClientRect(); if (r.width < 20 || r.height < 12) return false;
      const text = (el.innerText || el.textContent || '').trim(); if (!text || text.length > 90) return false;
      const s = slug(text); return ids.some(id => s === id || s.includes(id) || id.includes(s));
    });
    if (!els[0]) return false;
    els[0].scrollIntoView({block:'center'}); els[0].click(); return true;
  }, weapon);
}

async function extract(page) {
  return page.evaluate((SLOTS) => {
    const slotMap = { optic:'Ottica', optics:'Ottica', ottica:'Ottica', muzzle:'Volata', volata:'Volata', barrel:'Canna', canna:'Canna', underbarrel:'Sottocanna', 'under barrel':'Sottocanna', sottocanna:'Sottocanna', magazine:'Caricatore', mag:'Caricatore', caricatore:'Caricatore', 'rear grip':'Impugnatura', grip:'Impugnatura', impugnatura:'Impugnatura', stock:'Calcio', calcio:'Calcio', laser:'Laser', 'fire mods':'Mod fuoco', 'fire mod':'Mod fuoco', 'mod fuoco':'Mod fuoco' };
    const clean = v => String(v||'').replace(/\s+/g,' ').trim();
    const normSlot = v => slotMap[clean(v).toLowerCase()] || null;
    const bad = n => !n || n.length < 2 || n.length > 64 || !/[a-zA-Z]/.test(n) || slotMap[n.toLowerCase()] || /^level\s*\d+$/i.test(n) || /unlock|unlocked|required|weapon level|player level|max level/i.test(n) || /^\+?\-?\d+(\.\d+)?%?$/.test(n) || /^(search|select|none|empty|attachment|attachments|loadout|build|meta|recommended|close|back|clear|filter|sort)$/i.test(n);
    const textOf = el => clean(el.getAttribute('data-name') || el.getAttribute('data-value') || el.getAttribute('aria-label') || el.getAttribute('title') || el.innerText || el.textContent);
    function nearestSlot(el) {
      let cur = el;
      for (let d=0; cur && d<8; d++, cur=cur.parentElement) {
        const attrSlot = normSlot(`${cur.getAttribute('data-slot')||''} ${cur.getAttribute('data-type')||''} ${cur.getAttribute('aria-label')||''}`);
        if (attrSlot) return attrSlot;
        const heads = Array.from(cur.querySelectorAll('h1,h2,h3,h4,h5,h6,[class*="title"],[class*="label"],[class*="slot"],[class*="category"]')).slice(0,8);
        for (const h of heads) { const s = normSlot(h.innerText || h.textContent); if (s) return s; }
        const all = clean(cur.innerText || cur.textContent).toLowerCase();
        for (const a of Object.keys(slotMap)) { if (all.startsWith(a) || all.includes(` ${a} `) || all.includes(`${a}:`)) return slotMap[a]; }
      }
      return null;
    }
    const out=[];
    const els = Array.from(document.querySelectorAll('button,[role="option"],[role="button"],li,[class*="attachment"],[class*="option"],[class*="item"],[class*="card"]'));
    for (const el of els) {
      const r = el.getBoundingClientRect(); if (r.width < 25 || r.height < 12) continue;
      const s = nearestSlot(el); if (!s || !SLOTS.includes(s)) continue;
      let name = textOf(el);
      const lines = name.split('\n').map(clean).filter(Boolean);
      if (lines.length > 1) name = lines.find(x => !bad(x) && !normSlot(x)) || lines[0];
      name = clean(name).replace(/\s+Level\s*\d+$/i,'').replace(/\s+Unlock(?:ed)?\s+at\s+Level\s*\d+$/i,'').trim();
      if (bad(name)) continue;
      out.push({slot:s,name});
    }
    const seen=new Set();
    return out.filter(x => { const k=x.slot+'__'+x.name.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  }, SLOTS);
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
    const name = cleanAttName(it.name); const sl = slot(it.slot); if (!sl || badName(name)) return;
    const id = slug(name); if (!id) return;
    if (!attMap.has(id)) { const a = { id, nome:name, tipo:sl, attivo:true, verificato:true, fonte:'CODMunity Build', fonteUrl:CREATE_URL, note:'Accessorio importato da CODMunity Build.', updatedAt:today(), stato:'pubblico', codmunityOrder:idx+1 }; attachments.push(a); attMap.set(id,a); newA++; }
    else { const a = attMap.get(id); a.nome = name; a.tipo = sl; a.attivo = true; a.verificato = true; a.fonte = 'CODMunity Build'; a.updatedAt = today(); if (!['bloccato','disattivato'].includes(a.stato)) a.stato='pubblico'; }
    const key = `${w.id}__${id}`;
    if (!compMap.has(key)) { const c = { id:key, armaId:w.id, accessorioId:id, slot:sl, compatibile:true, verificato:true, fonte:'CODMunity Build', fonteUrl:CREATE_URL, note:'Compatibilità importata da CODMunity Build.', updatedAt:today(), stato:'pubblico', codmunityOrder:idx+1 }; compatibility.push(c); compMap.set(key,c); newC++; }
    else { const c = compMap.get(key); c.slot = sl; c.compatibile = true; c.verificato = true; c.fonte = 'CODMunity Build'; c.updatedAt = today(); if (!['bloccato','disattivato'].includes(c.stato)) c.stato='pubblico'; }
  });
  return { newA, newC };
}

async function main() {
  const report = { startedAt:new Date().toISOString(), source:CREATE_URL, processedWeapons:[], failedWeapons:[], attachmentsImported:0, compatibilityImported:0, finishedAt:null };
  const weapons = read(WEAPONS), attachments = read(ATTS), compatibility = read(COMPAT), list = weaponList();
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
        await sleep(1200);
        let items = selected ? await extract(page) : [];
        if (!items.length) { await page.goto(w.url, {waitUntil:'networkidle2', timeout:60000}); await sleep(1200); items = await extract(page); }
        items = items.map(x => ({slot:slot(x.slot), name:cleanAttName(x.name)})).filter(x => x.slot && !badName(x.name));
        const seen = new Set(); items = items.filter(x => { const k=x.slot+'__'+slug(x.name); if(seen.has(k)) return false; seen.add(k); return true; });
        const merged = mergeData(attachments, compatibility, w, items);
        report.attachmentsImported += merged.newA; report.compatibilityImported += merged.newC;
        report.processedWeapons.push({ armaId:w.id, game:w.game, selectedInBuilder:selected, attachmentsFound:items.length, attachmentsAdded:merged.newA, compatibilityAdded:merged.newC });
        console.log(`  ✓ ${items.length} accessori validi`);
      } catch (e) { report.failedWeapons.push({armaId:w.id, url:w.url, error:e.message}); console.log('  ✗ '+e.message); }
      write(WEAPONS,weapons); write(ATTS,attachments); write(COMPAT,compatibility); write(REPORT,{...report, finishedAt:new Date().toISOString()});
      await sleep(DELAY);
    }
  } finally { await browser.close().catch(()=>{}); }
  report.finishedAt = new Date().toISOString(); write(REPORT,report);
}
main().catch(e => { console.error(e); process.exit(1); });
