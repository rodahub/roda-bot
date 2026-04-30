'use strict';

/**
 * RØDA Loadout Sync — CODMunity Mobile Diagnostic
 *
 * IMPORTANTE:
 * - Non svuota mai il database se non trova accessori.
 * - Serve a capire cosa vede Railway dentro CODMunity mobile.
 * - Salva debug nel report: data/loadout-codmunity-mobile-sync-report.json
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
const DEBUG_LIMIT = Number(process.env.CODMUNITY_DEBUG_LIMIT || 10);

function read(file, fallback = []) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, 'utf8');
    return raw.trim() ? JSON.parse(raw) : fallback;
  } catch (_) { return fallback; }
}
function write(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}
function clean(v) { return String(v || '').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim(); }
function nowIso() { return new Date().toISOString(); }
function weaponIdFromUrl(url) { return String(url || '').split('/').filter(Boolean).pop() || ''; }
function gameFromUrl(url, entry = {}) { const m = String(url || '').match(/\/weapon\/(bo\d+)\//i); return String(entry.game || (m && m[1]) || 'Warzone').toUpperCase(); }
function nameFromId(id) { return String(id || '').split('-').map(p => p.length <= 3 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1)).join(' '); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function norm(v) { return clean(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim(); }

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
    out.push({ id, game, url, nome: (entry && (entry.nome || entry.name)) || nameFromId(id), order: i + 1 });
  }
  return out.slice(0, LIMIT || undefined);
}

async function collectDiagnostics(page) {
  return page.evaluate(() => {
    const clean = v => String(v || '').replace(/\s+/g, ' ').trim();
    const visible = el => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 10 && r.height > 8 && r.bottom > 0 && r.top < innerHeight && s.display !== 'none' && s.visibility !== 'hidden';
    };
    const selects = Array.from(document.querySelectorAll('select')).map((s, index) => ({
      index,
      disabled: s.disabled,
      value: s.value,
      name: s.name || '',
      id: s.id || '',
      aria: s.getAttribute('aria-label') || '',
      options: Array.from(s.options || []).map(o => clean(o.textContent || o.value)).filter(Boolean).slice(0, 100)
    }));
    const inputs = Array.from(document.querySelectorAll('input')).filter(visible).map(i => ({
      placeholder: clean(i.placeholder),
      value: clean(i.value),
      type: i.type,
      name: i.name || '',
      id: i.id || '',
      aria: clean(i.getAttribute('aria-label'))
    })).slice(0, 50);
    const buttons = Array.from(document.querySelectorAll('button,a,[role="button"],[role="option"],label,[class*="select"],[class*="dropdown"]'))
      .filter(visible)
      .map(el => clean(el.innerText || el.textContent || el.getAttribute('aria-label') || el.getAttribute('title') || ''))
      .filter(Boolean)
      .slice(0, 180);
    const hrefs = Array.from(document.querySelectorAll('a[href]')).map(a => ({ href: a.href, text: clean(a.innerText || a.textContent) })).filter(x => x.href).slice(0, 80);
    return {
      url: location.href,
      title: document.title,
      bodySample: clean(document.body && document.body.innerText || '').slice(0, 4000),
      selects,
      inputs,
      buttons,
      hrefs
    };
  }).catch(e => ({ error: e.message }));
}

async function tryBasicSelection(page, weapon) {
  const names = [weapon.nome, weapon.id.replace(/-/g, ' '), weapon.id].filter(Boolean);
  const normalizedNames = names.map(norm);
  const result = await page.evaluate((names) => {
    const norm = v => String(v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
    const wanted = names.map(norm).filter(Boolean);
    function fire(el) { el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }

    for (const select of Array.from(document.querySelectorAll('select')).filter(s => !s.disabled)) {
      const option = Array.from(select.options || []).find(o => wanted.some(w => norm(o.textContent).includes(w) || norm(o.value).includes(w) || w.includes(norm(o.textContent))));
      if (option) { select.value = option.value; fire(select); return { ok: true, method: 'select', value: option.textContent || option.value }; }
    }

    const input = Array.from(document.querySelectorAll('input')).find(i => !i.disabled);
    if (input) {
      input.focus();
      input.value = names[0];
      fire(input);
    }

    const visible = el => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 10 && r.height > 8 && r.bottom > 0 && r.top < innerHeight && s.display !== 'none' && s.visibility !== 'hidden';
    };
    const clickEl = Array.from(document.querySelectorAll('button,a,[role="button"],[role="option"],li,div,span,label'))
      .filter(visible)
      .find(el => {
        const t = norm(el.innerText || el.textContent || el.getAttribute('aria-label') || '');
        return t && wanted.some(w => t.includes(w) || w.includes(t));
      });
    if (clickEl) { clickEl.scrollIntoView({ block: 'center' }); clickEl.click(); return { ok: true, method: 'click-text', value: clickEl.innerText || clickEl.textContent || '' }; }
    return { ok: false, method: 'none' };
  }, names).catch(e => ({ ok: false, method: 'error', error: e.message }));
  await sleep(1000);
  const state = await page.evaluate((normalizedNames) => {
    const body = String(document.body && document.body.innerText || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ');
    const hasWeapon = normalizedNames.some(n => n && body.includes(n));
    const hasSlots = ['optic','ottica','muzzle','volata','barrel','canna','underbarrel','sottocanna','magazine','caricatore'].some(s => body.includes(s));
    return { hasWeapon, hasSlots, bodySample: body.slice(0, 1200) };
  }, normalizedNames).catch(e => ({ hasWeapon: false, hasSlots: false, error: e.message }));
  return { attempt: result, state };
}

async function main() {
  const report = {
    startedAt: nowIso(),
    source: SOURCE,
    mode: 'codmunity-mobile-diagnostic-preserve-db',
    previousDatabase: {
      weapons: read(WEAPONS_FILE, []).length,
      attachments: read(ATTACHMENTS_FILE, []).length,
      compatibility: read(COMPAT_FILE, []).length,
      builds: read(BUILDS_FILE, []).length
    },
    processedWeapons: [],
    debug: [],
    errors: [],
    preservedPreviousDatabase: true,
    finishedAt: null
  };

  const weapons = getWeapons();
  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
    await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');

    for (let i = 0; i < weapons.length; i++) {
      const weapon = weapons[i];
      console.log(`[${i + 1}/${weapons.length}] CODMunity diagnostic: ${weapon.nome}`);
      const row = { armaId: weapon.id, nome: weapon.nome, game: weapon.game, selected: false, attachmentsFound: 0 };
      try {
        await page.goto(BUILDER_URL, { waitUntil: 'networkidle2', timeout: 70000 });
        await sleep(1000);
        const before = report.debug.length < DEBUG_LIMIT ? await collectDiagnostics(page) : null;
        const selection = await tryBasicSelection(page, weapon);
        const after = report.debug.length < DEBUG_LIMIT ? await collectDiagnostics(page) : null;
        row.selected = !!(selection.state && selection.state.hasWeapon && selection.state.hasSlots);
        row.method = selection.attempt && selection.attempt.method;
        report.processedWeapons.push(row);
        console.log(`  ${row.selected ? 'selezionata' : 'NON selezionata'} (${row.method || 'none'}) · 0 accessori`);
        if (!row.selected && report.debug.length < DEBUG_LIMIT) report.debug.push({ weapon: row, before, selection, after });
      } catch (error) {
        row.error = error.message;
        report.processedWeapons.push(row);
        report.errors.push({ weapon: row, error: error.message });
        console.log(`  ERRORE ${error.message}`);
      }
      report.finishedAt = nowIso();
      write(REPORT_FILE, report);
      await sleep(250);
    }
  } finally {
    await browser.close().catch(() => {});
  }

  report.finishedAt = nowIso();
  report.errors.push('Diagnostica completata: database precedente preservato. Inviami codmunityMobileReport.debug dal pannello admin Report.');
  write(REPORT_FILE, report);
  console.log('Sync CODMunity mobile diagnostic completato:', report);
}

main().catch(error => { console.error(error); process.exit(1); });
