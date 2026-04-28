/**
 * RØDA Loadabot — build-loadout-db-from-codmunity.js
 *
 * Legge data/codmunity-weapon-urls.json, visita ogni URL CODMunity
 * con Puppeteer (CSR React), estrae arma + accessori + compatibilità
 * e li scrive nei 3 file DB.
 *
 * Uso:
 *   node scripts/build-loadout-db-from-codmunity.js
 *   node scripts/build-loadout-db-from-codmunity.js --limit=3
 *   npm run build:loadout-db
 *   npm run build:loadout-db -- --limit=3
 *
 * Tutti i dati importati restano verificata/verificato:false.
 */

'use strict';

const fs    = require('fs');
const path  = require('path');
const http  = require('http');
const https = require('https');

// ─── Argomenti CLI ────────────────────────────────────────────────────────────
const args  = process.argv.slice(2);
const LIMIT = (() => {
  const a = args.find(a => /^--limit=\d+$/.test(a));
  return a ? parseInt(a.split('=')[1], 10) : null;
})();

// ─── Percorsi ─────────────────────────────────────────────────────────────────
const ROOT         = path.join(__dirname, '..');
const DATA_DIR     = path.join(ROOT, 'data');
const URLS_FILE    = path.join(DATA_DIR, 'codmunity-weapon-urls.json');
const WEAPONS_FILE = path.join(DATA_DIR, 'loadout-weapons.json');
const ATT_FILE     = path.join(DATA_DIR, 'loadout-attachments.json');
const COMPAT_FILE  = path.join(DATA_DIR, 'loadout-compatibility.json');
const REPORT_FILE  = path.join(DATA_DIR, 'loadout-import-report.json');

// ─── Mappature ────────────────────────────────────────────────────────────────
const CATEGORY_MAP = {
  // ── Inglese ────────────────────────────────────────────────────────────────
  'assault rifle'        : "Fucile d'assalto",
  'ar'                   : "Fucile d'assalto",
  'smg'                  : 'Mitraglietta',
  'submachine gun'       : 'Mitraglietta',
  'lmg'                  : 'Mitragliatrice leggera',
  'light machine gun'    : 'Mitragliatrice leggera',
  'marksman rifle'       : 'Fucile tattico',
  'battle rifle'         : 'Fucile da battaglia',
  'sniper rifle'         : 'Cecchino',
  'sniper'               : 'Cecchino',
  'shotgun'              : 'Shotgun',
  'pistol'               : 'Pistola',
  'handgun'              : 'Pistola',
  'melee'                : 'Corpo a corpo',
  'launcher'             : 'Lanciarazzi',
  'rocket launcher'      : 'Lanciarazzi',
  // ── Italiano passthrough + normalizzazione ─────────────────────────────────
  "fucile d'assalto"     : "Fucile d'assalto",
  'mitraglietta'         : 'Mitraglietta',
  'mitragliatrice leggera': 'Mitragliatrice leggera',
  'fucile tattico'       : 'Fucile tattico',
  'fucile da battaglia'  : 'Fucile da battaglia',
  'cecchino'             : 'Cecchino',
  'fucile di precisione' : 'Cecchino',
  'fucile a pompa'       : 'Shotgun',
  'pistola'              : 'Pistola',
  'corpo a corpo'        : 'Corpo a corpo',
  'lanciarazzi'          : 'Lanciarazzi',
};

// ─── Fallback manuale per armi note (usato solo se CODMunity non fornisce categoria) ──
const WEAPON_CATEGORY_FALLBACK = {
  // BO6 — Fucili d'assalto
  'xm4'         : "Fucile d'assalto",
  'ak-74'       : "Fucile d'assalto",
  'ames-85'     : "Fucile d'assalto",
  'gpr-91'      : "Fucile d'assalto",
  'model-l'     : "Fucile d'assalto",
  'goblin-mk2'  : "Fucile d'assalto",
  'as-val'      : "Fucile d'assalto",
  'krig-c'      : "Fucile d'assalto",
  'cypher-091'  : "Fucile d'assalto",
  'ffar-1'      : "Fucile d'assalto",
  'kilo-141'    : "Fucile d'assalto",
  'cr-56-amax'  : "Fucile d'assalto",
  // BO6 — Mitragliette
  'c9'          : 'Mitraglietta',
  'ksv'         : 'Mitraglietta',
  'tanto-22'    : 'Mitraglietta',
  'pp-919'      : 'Mitraglietta',
  'jackal-pdw'  : 'Mitraglietta',
  'kompakt-92'  : 'Mitraglietta',
  'saug'        : 'Mitraglietta',
  'ppsh-41'     : 'Mitraglietta',
  'lc10'        : 'Mitraglietta',
  'ladra'       : 'Mitraglietta',
  // BO6 — Mitragliatrici leggere
  'pu-21'       : 'Mitragliatrice leggera',
  'xmg'         : 'Mitragliatrice leggera',
  'gpmg-7'      : 'Mitragliatrice leggera',
  'feng-82'     : 'Mitragliatrice leggera',
  // BO6 — Fucili tattici (Marksman)
  'swat-556'    : 'Fucile tattico',
  'swat-5-56'   : 'Fucile tattico',
  'tsarkov-762' : 'Fucile tattico',
  'tsarkov-7-62': 'Fucile tattico',
  'aek-973'     : 'Fucile tattico',
  'dm-10'       : 'Fucile tattico',
  'tr2'         : 'Fucile tattico',
  // BO6 — Cecchini
  'lw3a1-frostline': 'Cecchino',
  'svd'         : 'Cecchino',
  'lr-762'      : 'Cecchino',
  'lr-7-62'     : 'Cecchino',
  'amr-mod-4'   : 'Cecchino',
  'hdr'         : 'Cecchino',
  // BO6 — Shotgun
  'marine-sp'   : 'Shotgun',
  'asg-89'      : 'Shotgun',
  'maelstrom'   : 'Shotgun',
  // BO6 — Pistole
  '9mm-pm'      : 'Pistola',
  'grekhova'    : 'Pistola',
  'gs45'        : 'Pistola',
  'stryder-22'  : 'Pistola',
  '1911'        : 'Pistola',
};

// Slot: chiavi inglesi → valori italiani
// IMPORTANTE: nessun valore inglese deve mai finire nel database.
const SLOT_MAP = {
  'optic'        : 'Ottica',
  'optics'       : 'Ottica',
  'muzzle'       : 'Volata',
  'barrel'       : 'Canna',
  'underbarrel'  : 'Sottocanna',
  'under barrel' : 'Sottocanna',
  'magazine'     : 'Caricatore',
  'mag'          : 'Caricatore',
  'rear grip'    : 'Impugnatura',
  'grip'         : 'Impugnatura',
  'stock'        : 'Calcio',
  'laser'        : 'Laser',
  'fire mods'    : 'Mod fuoco',
  'fire mod'     : 'Mod fuoco',
  // passthrough IT (nel caso la pagina usi già italiano)
  'ottica'       : 'Ottica',
  'volata'       : 'Volata',
  'canna'        : 'Canna',
  'sottocanna'   : 'Sottocanna',
  'caricatore'   : 'Caricatore',
  'impugnatura'  : 'Impugnatura',
  'calcio'       : 'Calcio',
  'mod fuoco'    : 'Mod fuoco',
};

// Versioni pre-serializzate per passarle a page.evaluate()
const SLOT_MAP_ENTRIES  = Object.entries(SLOT_MAP);
const VALID_SLOTS_ARRAY = [
  'Ottica','Volata','Canna','Sottocanna','Caricatore',
  'Impugnatura','Calcio','Laser','Mod fuoco',
];
const VALID_SLOTS = new Set(VALID_SLOTS_ARRAY);

// Slot da scartare (non devono mai finire nel DB)
const BANNED_SLOT_NAMES = new Set([
  'munizioni','poggiaguancia','ammunition','perk',
  'conversion kit','rear grip wrap',
]);

// ─── Helpers ──────────────────────────────────────────────────────────────────
function toSlug(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeSlot(raw) {
  if (!raw) return null;
  const k = String(raw).trim().toLowerCase();
  if (BANNED_SLOT_NAMES.has(k)) return null;
  return SLOT_MAP[k] || null;
}

function normalizeCategory(raw) {
  if (!raw) return 'Da verificare';
  const k = String(raw).trim().toLowerCase();
  // 1. Match esatto
  if (CATEGORY_MAP[k]) return CATEGORY_MAP[k];
  // 2. Match parziale: il testo contiene una chiave nota (es. "assault rifle weapons")
  for (const [key, val] of Object.entries(CATEGORY_MAP)) {
    if (key.length >= 3 && k.includes(key)) return val;
  }
  return 'Da verificare';
}

/**
 * Cerca ricorsivamente un campo categoria in qualunque oggetto (es. __NEXT_DATA__).
 * Restituisce { category: string (IT), source: string } o null.
 */
function findCategoryInObject(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 12) return null;
  if (Array.isArray(obj)) {
    for (const v of obj) {
      const r = findCategoryInObject(v, depth + 1);
      if (r) return r;
    }
    return null;
  }
  // Campi che possono contenere la categoria direttamente
  const CAT_FIELDS = [
    'category', 'weaponCategory', 'weapon_category',
    'type', 'class', 'weaponClass', 'weaponType', 'weapon_type',
    'family', 'gun_type', 'gameWeaponType', 'weaponFamily', 'classType',
  ];
  for (const f of CAT_FIELDS) {
    if (obj[f] && typeof obj[f] === 'string') {
      const cat = normalizeCategory(obj[f]);
      if (cat !== 'Da verificare') return { category: cat, source: `__NEXT_DATA__.${f}` };
    }
  }
  // Ricerca ricorsiva nei sotto-oggetti (priorità: weapon, gameWeapon, data, props, pageProps)
  const PRIORITY_KEYS = ['weapon', 'gameWeapon', 'weaponData', 'data', 'props', 'pageProps'];
  for (const k of PRIORITY_KEYS) {
    if (obj[k] && typeof obj[k] === 'object') {
      const r = findCategoryInObject(obj[k], depth + 1);
      if (r) return r;
    }
  }
  for (const [, v] of Object.entries(obj)) {
    if (v && typeof v === 'object') {
      const r = findCategoryInObject(v, depth + 1);
      if (r) return r;
    }
  }
  return null;
}

function nowISO()   { return new Date().toISOString(); }
function todayDate(){ return new Date().toISOString().slice(0, 10); }
function sleep(ms)  { return new Promise(r => setTimeout(r, ms)); }

function readJSON(filePath) {
  try {
    if (!fs.existsSync(filePath)) return [];
    const c = fs.readFileSync(filePath, 'utf8').trim();
    return c ? JSON.parse(c) : [];
  } catch { return []; }
}

function writeJSON(filePath, data) {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

function decodeHtmlEntities(str) {
  return String(str || '')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function cleanWeaponName(raw) {
  let name = decodeHtmlEntities(raw || '').trim();
  name = name.replace(/^best\s+/i, '');
  name = name.replace(/\s+loadouts?\s+for.*/i, '');
  name = name.replace(/\s+attachments?\s*$/i, '');
  name = name.replace(/\s*[-–|]\s*CODMunity.*/i, '').trim();
  name = name.replace(/\s*best\s*$/i, '').trim();
  if (name === name.toLowerCase() && name.length <= 6) name = name.toUpperCase();
  return name || raw;
}

function getGame(url) {
  const m = url.match(/\/weapon\/(bo\d+)\//i);
  return m ? m[1].toUpperCase() : 'UNKNOWN';
}

// ─── HTTP get leggero (solo per 404/redirect check, non per accessori) ────────
function httpGet(url, redirects = 4) {
  return new Promise((resolve, reject) => {
    if (redirects < 0) return reject(new Error('Troppi redirect'));
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, {
      headers: {
        'User-Agent'     : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36',
        'Accept'         : 'text/html,*/*',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      timeout: 15000,
    }, res => {
      if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location) {
        req.destroy();
        const loc = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        return resolve(httpGet(loc, redirects - 1));
      }
      if (res.statusCode === 404) {
        req.destroy();
        return reject(Object.assign(new Error('HTTP 404'), { isNotFound: true }));
      }
      if (res.statusCode >= 400) {
        req.destroy();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      // Legge solo i primi 6KB per l'og:url check (evita di scaricare tutto)
      const chunks = [];
      let size = 0;
      res.on('data', c => {
        chunks.push(c);
        size += c.length;
        if (size > 8192) { req.destroy(); resolve({ partial: true, html: Buffer.concat(chunks).toString('utf8') }); }
      });
      res.on('end', () => resolve({ partial: false, html: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout HTTP')); });
  });
}

// ─── Puppeteer ────────────────────────────────────────────────────────────────
let puppeteer = null;
let pBrowser  = null;

async function initPuppeteer() {
  if (puppeteer !== null) return puppeteer !== false;
  try {
    puppeteer = require('puppeteer');
    console.log('  ✓ Puppeteer disponibile');
    return true;
  } catch {
    puppeteer = false;
    console.log('  ⚠ Puppeteer NON trovato — accessori non estraibili.');
    console.log('    Esegui: npm install  quindi riprova.');
    return false;
  }
}

async function getBrowser() {
  if (!pBrowser) {
    pBrowser = await puppeteer.launch({
      headless : 'new',   // headless moderno
      args     : [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--disable-extensions',
        '--disable-background-networking',
      ],
    });
  }
  return pBrowser;
}

async function newPage() {
  const browser = await getBrowser();
  const page    = await browser.newPage();
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
    'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
  );
  // Blocca risorse pesanti — accelera il caricamento
  await page.setRequestInterception(true);
  page.on('request', req => {
    const t = req.resourceType();
    if (['image', 'media', 'font', 'stylesheet'].includes(t)) req.abort();
    else req.continue();
  });
  return page;
}

// ─── Estrazione __NEXT_DATA__ (Node.js context, sul HTML grezzo) ──────────────
function parseNextData(html) {
  const m = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

function findWeaponInNextData(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 10) return null;
  if (Array.isArray(obj)) {
    for (const v of obj) { const r = findWeaponInNextData(v, depth+1); if (r) return r; }
    return null;
  }
  const hasName = obj.name || obj.weapon_name || obj.weaponName || obj.title;
  const hasAtts = obj.attachments || obj.slots || obj.attachment_list
               || obj.categories || obj.attachmentCategories;
  if (hasName && hasAtts) return obj;
  for (const v of Object.values(obj)) { const r = findWeaponInNextData(v, depth+1); if (r) return r; }
  return null;
}

function parseWeaponObject(raw) {
  if (!raw) return null;
  const name = String(raw.name || raw.weapon_name || raw.weaponName || raw.title || '').trim();

  // Cerca categoria: prima i campi diretti, poi ricerca ricorsiva nell'intero oggetto
  let category       = 'Da verificare';
  let _categorySource = null;
  const directCatRaw = raw.category || raw.weapon_type || raw.type || raw.class
                     || raw.weaponClass || raw.weaponType || raw.family || '';
  if (directCatRaw) {
    const cat = normalizeCategory(directCatRaw);
    if (cat !== 'Da verificare') {
      category        = cat;
      _categorySource = 'direct-field';
    }
  }
  if (category === 'Da verificare') {
    const found = findCategoryInObject(raw);
    if (found) {
      category        = found.category;
      _categorySource = found.source;
    }
  }

  const attachments = [];

  const flatArr = raw.attachments || raw.attachment_list || raw.attachmentList;
  if (Array.isArray(flatArr)) {
    for (const a of flatArr) {
      if (!a || typeof a !== 'object') continue;
      const slot = normalizeSlot(a.slot || a.type || a.category || a.attachmentType || a.slotName || '');
      const attName = String(a.name || a.attachment_name || a.attachmentName || a.title || '').trim();
      if (slot && attName) attachments.push({ slot, name: attName });
    }
  }
  const slotsObj = raw.slots || raw.attachmentSlots;
  if (!attachments.length && slotsObj && typeof slotsObj === 'object' && !Array.isArray(slotsObj)) {
    for (const [k, items] of Object.entries(slotsObj)) {
      const slot = normalizeSlot(k);
      if (!slot) continue;
      for (const a of (Array.isArray(items) ? items : [items])) {
        const n = typeof a === 'string' ? a : String(a.name || a.title || '').trim();
        if (n) attachments.push({ slot, name: n });
      }
    }
  }
  const catsArr = raw.categories || raw.attachmentCategories;
  if (!attachments.length && Array.isArray(catsArr)) {
    for (const cat of catsArr) {
      const slot = normalizeSlot(cat.name || cat.slot || cat.type || cat.category || '');
      if (!slot) continue;
      const items = cat.items || cat.attachments || cat.list || cat.options || [];
      for (const a of (Array.isArray(items) ? items : [])) {
        const n = typeof a === 'string' ? a : String(a.name || a.title || '').trim();
        if (n) attachments.push({ slot, name: n });
      }
    }
  }
  return { name, category, _categorySource, attachments };
}

// ─── Estrazione Puppeteer: DOM renderizzato + window.__NEXT_DATA__ ────────────
async function extractWithPuppeteer(url) {
  const page = await newPage();
  try {
    // Naviga — aspetta networkidle0 (React completamente idratato)
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 45000 });

    // Verifica homepage redirect tramite URL effettivo (affidabile al 100%)
    const finalUrl = page.url();
    const isHomepage = finalUrl === 'https://codmunity.gg'
                    || finalUrl === 'https://codmunity.gg/'
                    || (!finalUrl.includes('/weapon/'));
    if (isHomepage) {
      throw Object.assign(
        new Error(`Redirect homepage (URL finale: ${finalUrl})`),
        { isNotFound: true }
      );
    }

    // Aspetta contenuto arma (h1 + minimo DOM)
    await Promise.race([
      page.waitForSelector('h1', { timeout: 12000 }),
      page.waitForFunction(
        () => document.querySelectorAll('li, [class*="attachment"]').length > 2,
        { timeout: 12000 }
      ),
    ]).catch(() => {});

    // Pausa breve per JS asincrono post-render
    await sleep(800);

    // ── Strategia 1: window.__NEXT_DATA__ nel contesto browser ────────────
    const nextDataRaw = await page.evaluate(() => {
      try { return window.__NEXT_DATA__ || null; } catch { return null; }
    });
    // Salva categoria + source trovati in __NEXT_DATA__ anche se poi usiamo il DOM per gli accessori
    let nextDataCategory       = 'Da verificare';
    let nextDataCategorySource = null;
    if (nextDataRaw) {
      const wObj   = findWeaponInNextData(nextDataRaw);
      const result = parseWeaponObject(wObj);
      if (result) {
        if (result.category !== 'Da verificare') {
          nextDataCategory       = result.category;
          nextDataCategorySource = result._categorySource || '__NEXT_DATA__';
        }
        if (result.attachments.length > 0) {
          result.name    = cleanWeaponName(result.name);
          result._method = 'Puppeteer+__NEXT_DATA__';
          return result; // _categorySource già impostato
        }
      }
    }

    // ── Strategia 2: DOM traversal nel browser ─────────────────────────────
    const domResult = await page.evaluate(
      ({ slotEntries, validSlotsArr, bannedArr, catMapEntries }) => {

        const slotMap    = Object.fromEntries(slotEntries);
        const validSlots = new Set(validSlotsArr);
        const banned     = new Set(bannedArr);
        const catMap     = Object.fromEntries(catMapEntries);

        function mapSlot(raw) {
          if (!raw) return null;
          const k = raw.trim().toLowerCase();
          if (banned.has(k)) return null;
          return slotMap[k] || null;
        }
        function mapCategory(raw) {
          if (!raw) return 'Da verificare';
          return catMap[raw.trim().toLowerCase()] || 'Da verificare';
        }

        // Nome arma
        const h1 = document.querySelector('h1');
        const name = h1 ? h1.textContent.trim() : document.title || '';

        // ── Categoria: più strategie in ordine di affidabilità ─────────────
        let category       = 'Da verificare';
        let categorySource = null;

        // Strategia A: badge / pill / tag categoria espliciti
        const catSelectors = [
          '[class*="weapon-type"]','[class*="weaponType"]','[class*="weaponClass"]',
          '[class*="weapon_type"]','[class*="weapon_class"]',
          '[class*="type-badge"]','[class*="typeBadge"]',
          '[class*="category-badge"]','[class*="categoryBadge"]',
          '[class*="gun-type"]','[class*="gunType"]',
          '[data-weapon-type]','[data-category]',
        ];
        for (const sel of catSelectors) {
          const el = document.querySelector(sel);
          if (el) {
            const mapped = mapCategory(el.textContent.trim());
            if (mapped !== 'Da verificare') { category = mapped; categorySource = 'DOM-badge'; break; }
          }
        }

        // Strategia B: breadcrumb (spesso: Home > Weapons > Assault Rifle > XM4)
        if (category === 'Da verificare') {
          const breadItems = document.querySelectorAll(
            '[class*="breadcrumb"] li, [class*="breadcrumb"] a, [class*="breadcrumb"] span,' +
            'nav[aria-label*="breadcrumb"] *'
          );
          for (const el of breadItems) {
            const mapped = mapCategory(el.textContent.trim());
            if (mapped !== 'Da verificare') { category = mapped; categorySource = 'DOM-breadcrumb'; break; }
          }
        }

        // Strategia C: meta tag og:description o og:title
        if (category === 'Da verificare') {
          const metas = [
            document.querySelector('meta[property="og:description"]'),
            document.querySelector('meta[name="description"]'),
            document.querySelector('meta[property="og:title"]'),
          ];
          for (const m of metas) {
            if (!m) continue;
            const content = m.getAttribute('content') || '';
            const mapped  = mapCategory(content);
            if (mapped !== 'Da verificare') { category = mapped; categorySource = 'DOM-meta'; break; }
          }
        }

        // Strategia D: scan testo pagina per keyword categoria
        if (category === 'Da verificare') {
          const bodyText = (document.body.textContent || '').toLowerCase().slice(0, 8000);
          const catKeys  = Object.keys(Object.fromEntries(catMapEntries));
          for (const k of catKeys) {
            if (k.length < 3) continue;
            // Cerca il pattern come parola intera o frase
            const re = new RegExp('(^|[\\s\\(\\["/])' + k.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + '([\\s\\)\\]",:/]|$)');
            if (re.test(bodyText)) {
              const catMap2 = Object.fromEntries(catMapEntries);
              const mapped  = catMap2[k];
              if (mapped && mapped !== 'Da verificare') {
                category = mapped; categorySource = 'DOM-text-scan'; break;
              }
            }
          }
        }

        const attachments = [];
        const seen        = new Set();
        const slotKeys    = Object.keys(slotMap);

        // ── Approccio A: heading slot → items nel container ──────────────
        const headings = document.querySelectorAll(
          'h2,h3,h4,h5,strong,[class*="slot-header"],[class*="slotHeader"],' +
          '[class*="slot-title"],[class*="attachment-category"],[class*="category-name"]'
        );
        for (const hEl of headings) {
          const txt  = hEl.textContent.trim().toLowerCase();
          const slot = slotKeys.find(k => txt === k || (txt.includes(k) && txt.length <= k.length + 3));
          if (!slot) continue;
          const slotIT = mapSlot(slot);
          if (!slotIT) continue;

          // Cerca container padre che racchiude heading + lista
          const container = hEl.closest(
            'section,[class*="slot-section"],[class*="slotSection"],' +
            '[class*="attachment-group"],[class*="attachments"],[class*="slot-container"]'
          ) || hEl.parentElement?.parentElement || hEl.parentElement;
          if (!container) continue;

          const items = container.querySelectorAll(
            'li,[class*="attachment-item"],[class*="attachmentItem"],' +
            '[class*="attachment-name"],[class*="item-name"],[class*="option-label"]'
          );
          for (const item of items) {
            const attName = item.textContent.trim();
            if (attName.length < 2 || attName.length > 100) continue;
            if (slotKeys.some(k => attName.toLowerCase() === k)) continue;
            const key = slotIT + '::' + attName.toLowerCase();
            if (!seen.has(key)) { seen.add(key); attachments.push({ slot: slotIT, name: attName }); }
          }
        }

        // ── Approccio B: TreeWalker su tutti i nodi testo ────────────────
        if (attachments.length === 0) {
          const walker    = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          const textNodes = [];
          let node;
          while ((node = walker.nextNode())) {
            const t = node.textContent.trim();
            if (t.length > 1 && t.length < 120) textNodes.push(t);
          }
          for (let i = 0; i < textNodes.length; i++) {
            const txt  = textNodes[i].toLowerCase();
            const slot = slotKeys.find(k => txt === k);
            if (!slot) continue;
            const slotIT = mapSlot(slot);
            if (!slotIT) continue;
            for (let j = i + 1; j < Math.min(i + 25, textNodes.length); j++) {
              const att = textNodes[j];
              if (att.length < 2 || att.length > 100) continue;
              if (slotKeys.some(k => att.toLowerCase() === k)) break; // nuovo slot → stop
              const key = slotIT + '::' + att.toLowerCase();
              if (!seen.has(key)) { seen.add(key); attachments.push({ slot: slotIT, name: att }); }
            }
          }
        }

        // ── Approccio C: cerca sezioni con "attachment" nel class e raccoglie testo ──
        if (attachments.length === 0) {
          const sections = document.querySelectorAll('[class*="attachment"],[class*="Attachment"]');
          let currentSlot = null;
          for (const sec of sections) {
            const txt = sec.textContent.trim();
            const slotMatch = slotKeys.find(k => txt.toLowerCase().startsWith(k));
            if (slotMatch) {
              currentSlot = mapSlot(slotMatch);
            } else if (currentSlot && txt.length > 1 && txt.length < 80) {
              const key = currentSlot + '::' + txt.toLowerCase();
              if (!seen.has(key)) { seen.add(key); attachments.push({ slot: currentSlot, name: txt }); }
            }
          }
        }

        return { name, category, categorySource, attachments };
      },
      {
        slotEntries   : SLOT_MAP_ENTRIES,
        validSlotsArr : VALID_SLOTS_ARRAY,
        bannedArr     : [...BANNED_SLOT_NAMES],
        catMapEntries : Object.entries(CATEGORY_MAP),
      }
    );

    domResult.name   = cleanWeaponName(domResult.name || '');
    domResult._method = 'Puppeteer+DOM';

    // Se il DOM non ha trovato categoria ma __NEXT_DATA__ sì, usa quella
    if ((!domResult.categorySource || domResult.category === 'Da verificare') && nextDataCategory !== 'Da verificare') {
      domResult.category        = nextDataCategory;
      domResult._categorySource = nextDataCategorySource;
    } else {
      domResult._categorySource = domResult.categorySource || null;
    }
    delete domResult.categorySource;
    return domResult;

  } finally {
    try { await page.close(); } catch {}
  }
}

// ─── Processa un singolo URL ──────────────────────────────────────────────────
async function processUrl(url, hasPuppeteer) {

  // Se Puppeteer è disponibile: usalo direttamente (CODMunity è CSR)
  if (hasPuppeteer) {
    return await extractWithPuppeteer(url);
  }

  // Fallback senza Puppeteer: fetch HTTP + HTML parser
  let html;
  try {
    const resp = await httpGet(url);
    html = resp.html;
  } catch (e) {
    if (e.isNotFound || e.message.includes('404')) {
      throw Object.assign(new Error('HTTP 404 — slug non trovato'), { isNotFound: true });
    }
    throw e;
  }

  // Homepage detection (solo per fallback senza Puppeteer)
  const titleTag = (html.match(/<title[^>]*>([^<]*)/i) || [])[1] || '';
  const ogUrl    = (html.match(/property=["']og:url["'][^>]+content=["']([^"']+)/i)
                || html.match(/content=["']([^"']+)["'][^>]+property=["']og:url["']/i)
                || [])[1] || '';
  const isHomepage = /^CODMunity\s*[–\-]\s*Best Warzone Meta/i.test(titleTag.trim())
                  || titleTag.trim() === 'CODMunity'
                  || ogUrl === 'https://codmunity.gg'
                  || ogUrl === 'https://codmunity.gg/';
  if (isHomepage) {
    throw Object.assign(
      new Error('Redirect homepage — slug non trovato'),
      { isNotFound: true }
    );
  }

  // __NEXT_DATA__ (SSR parziale)
  const nextDataRaw = parseNextData(html);
  if (nextDataRaw) {
    const wObj   = findWeaponInNextData(nextDataRaw);
    const result = parseWeaponObject(wObj);
    if (result && result.name) {
      result.name    = cleanWeaponName(result.name);
      result._method = '__NEXT_DATA__';
      return result;
    }
  }

  // HTML regex come ultimo tentativo (molto limitato su CODMunity CSR)
  let name = '';
  const titleM = html.match(/<title[^>]*>([^<]+)/i);
  if (titleM) name = cleanWeaponName(titleM[1]);
  if (!name || name.toLowerCase() === 'codmunity') {
    const ogT = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i);
    if (ogT) name = cleanWeaponName(ogT[1]);
  }
  if (!name || name.toLowerCase() === 'codmunity') {
    name = url.split('/').pop().replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  let category = 'Da verificare';
  for (const k of Object.keys(CATEGORY_MAP)) {
    if (new RegExp('\\b' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(html)) {
      category = CATEGORY_MAP[k];
      break;
    }
  }

  return { name, category, attachments: [], _method: 'HTML-fallback' };
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n══════════════════════════════════════════════════');
  console.log('  RØDA Loadabot — Build DB from CODMunity');
  console.log('══════════════════════════════════════════════════');
  console.log(`  Node.js : ${process.version}`);
  console.log(`  Data    : ${nowISO()}`);
  if (LIMIT) console.log(`  Limite  : ${LIMIT} URL (modalità test)`);
  console.log('');

  if (!fs.existsSync(URLS_FILE)) {
    console.error(`File non trovato: ${URLS_FILE}`);
    process.exit(1);
  }

  let allUrls = JSON.parse(fs.readFileSync(URLS_FILE, 'utf8'))
    .map(u => String(u).trim())
    .filter(Boolean);
  if (LIMIT) allUrls = allUrls.slice(0, LIMIT);

  const bo6Count = allUrls.filter(u => /\/weapon\/bo6\//i.test(u)).length;
  const bo7Count = allUrls.filter(u => /\/weapon\/bo7\//i.test(u)).length;
  console.log(`  URL da processare: ${allUrls.length}  (BO6: ${bo6Count}, BO7: ${bo7Count})\n`);

  // Inizializza Puppeteer (una volta sola)
  const hasPuppeteer = await initPuppeteer();
  console.log('');

  // Carica DB esistenti
  const weaponsMap     = new Map(readJSON(WEAPONS_FILE).map(w => [w.id, w]));
  const attachmentsMap = new Map(readJSON(ATT_FILE).map(a => [a.id, a]));
  const compatList     = readJSON(COMPAT_FILE);
  const compatSet      = new Set(compatList.map(c => `${c.armaId}::${c.accessorioId}`));

  // Report
  const report = {
    startedAt                    : nowISO(),
    finishedAt                   : null,
    totalUrls                    : allUrls.length,
    limit                        : LIMIT || null,
    usedPuppeteer                : hasPuppeteer,
    puppeteerPagesSucceeded      : 0,
    puppeteerPagesFailed         : 0,
    bo6Urls                      : { total: bo6Count, ok: 0, failed: 0, duplicated: 0 },
    bo7Urls                      : { total: bo7Count, ok: 0, failed: 0, duplicated: 0 },
    processedUrls                : [],
    failedUrls                   : [],
    duplicatedWeaponsSkipped     : [],
    duplicatedAttachmentsSkipped : [],
    weaponsImported              : 0,
    weaponsUpdated               : 0,
    attachmentsImported          : 0,
    attachmentsUpdated           : 0,
    compatibilityImported        : 0,
    compatibilityUpdated         : 0,
    ignoredSlots                 : [],
    warnings                     : [],
    errors                       : [],
    // ── Tracking categoria ──────────────────────────────────────────────────
    categoryDetected             : [],   // categoria trovata automaticamente
    categoryFallback             : [],   // categoria da mappa manuale
    categoryFailed               : [],   // categoria non trovata → Da verificare
  };

  const seenWeaponNames = new Map();

  for (let i = 0; i < allUrls.length; i++) {
    const url     = allUrls[i];
    const game    = getGame(url);
    const gameKey = game === 'BO7' ? 'bo7Urls' : 'bo6Urls';
    process.stdout.write(`[${String(i+1).padStart(2)}/${allUrls.length}] [${game}] ${url}\n`);

    try {
      const data = await processUrl(url, hasPuppeteer);

      // Aggiorna stat Puppeteer
      if (hasPuppeteer) {
        if (data._method && data._method.startsWith('Puppeteer')) {
          report.puppeteerPagesSucceeded++;
        } else {
          report.puppeteerPagesFailed++;
        }
      }

      const nameSlug = toSlug(data.name);

      // Deduplicazione arma (swat-556 vs swat-5-56, mk-78 vs mk78, ecc.)
      if (nameSlug && seenWeaponNames.has(nameSlug)) {
        const prev = seenWeaponNames.get(nameSlug);
        console.log(`      ⚠ Duplicato: "${data.name}" già da ${prev.url} → skip`);
        report.duplicatedWeaponsSkipped.push({ url, game, duplicateOf: prev.url, name: data.name });
        report.processedUrls.push({ url, game, status: 'duplicate', name: data.name });
        report[gameKey].duplicated++;
        await sleep(1500 + Math.floor(Math.random() * 500));
        continue;
      }

      const weaponId = nameSlug || toSlug(url.split('/').pop());
      if (!weaponId) throw new Error('Impossibile ricavare un ID arma valido');
      if (nameSlug) seenWeaponNames.set(nameSlug, { url, id: weaponId });

      // ── Risoluzione categoria finale ───────────────────────────────────────
      let finalCategory       = data.category       || 'Da verificare';
      let finalCategorySource = data._categorySource || null;

      // Se ancora "Da verificare", prova la mappa manuale con l'ID arma
      if (finalCategory === 'Da verificare' && WEAPON_CATEGORY_FALLBACK[weaponId]) {
        finalCategory       = WEAPON_CATEGORY_FALLBACK[weaponId];
        finalCategorySource = 'manual-map';
      }
      // Altrimenti prova con lo slug dell'URL (es. "xm4" anche quando nome non deducibile)
      if (finalCategory === 'Da verificare') {
        const urlSlug = url.split('/').pop();
        if (WEAPON_CATEGORY_FALLBACK[urlSlug]) {
          finalCategory       = WEAPON_CATEGORY_FALLBACK[urlSlug];
          finalCategorySource = 'manual-map';
        }
      }

      // Traccia nel report
      const existingWeapon = weaponsMap.get(weaponId) || {};
      if (finalCategory !== 'Da verificare') {
        if (finalCategorySource === 'manual-map') {
          // Categoria da mappa manuale
          report.categoryFallback.push({
            armaId   : weaponId,
            nome     : data.name,
            categoria: finalCategory,
            source   : 'manual-map',
          });
        } else {
          // Categoria trovata automaticamente (CODMunity o DB esistente)
          report.categoryDetected.push({
            armaId   : weaponId,
            nome     : data.name,
            categoria: finalCategory,
            source   : finalCategorySource || 'unknown',
          });
        }
      } else {
        // Controlla se esisteva già una categoria valida nel DB
        if (existingWeapon.categoria && existingWeapon.categoria !== 'Da verificare') {
          finalCategory       = existingWeapon.categoria;
          finalCategorySource = 'existing-db';
          report.categoryDetected.push({
            armaId   : weaponId,
            nome     : data.name,
            categoria: finalCategory,
            source   : 'existing-db',
          });
        } else {
          report.categoryFailed.push({
            armaId: weaponId,
            url,
            reason: `Categoria non trovata (metodo: ${data._method || 'n/a'})`,
          });
        }
      }

      // Upsert arma
      // Regola categoria: non sovrascrivere una categoria valida esistente con "Da verificare"
      const resolvedCategory =
        (finalCategory !== 'Da verificare')               ? finalCategory :
        (existingWeapon.categoria !== 'Da verificare' && existingWeapon.categoria)
                                                           ? existingWeapon.categoria :
        'Da verificare';

      const isNewWeapon = !weaponsMap.has(weaponId);
      weaponsMap.set(weaponId, {
        ...existingWeapon,
        id        : weaponId,
        nome      : data.name || existingWeapon.nome || weaponId,
        categoria : resolvedCategory,
        gioco     : game,
        attiva    : existingWeapon.attiva !== undefined ? existingWeapon.attiva : true,
        verificata: existingWeapon.verificata || false,
        fonte     : 'CODMunity',
        fonteUrl  : url,
        note      : 'Importato automaticamente da CODMunity. Da verificare.',
        updatedAt : todayDate(),
      });
      if (isNewWeapon) report.weaponsImported++;
      else             report.weaponsUpdated++;

      // Accessori + Compatibilità
      const ignoredHere = [];
      let validAtts = 0;

      for (const att of (data.attachments || [])) {
        const slotIT = VALID_SLOTS.has(att.slot) ? att.slot : normalizeSlot(att.slot);
        if (!slotIT) {
          const entry = `[${data.name}] slot ignorato: "${att.slot}" → "${att.name}"`;
          if (!report.ignoredSlots.includes(entry)) report.ignoredSlots.push(entry);
          ignoredHere.push(att.slot);
          continue;
        }
        const attId = toSlug(att.name);
        if (!attId || attId.length < 2) continue;

        // Accessorio: preserva verificato se già true, non duplicare
        const isNewAtt    = !attachmentsMap.has(attId);
        const existingAtt = attachmentsMap.get(attId) || {};
        attachmentsMap.set(attId, {
          ...existingAtt,
          id        : attId,
          nome      : att.name || existingAtt.nome || attId,
          tipo      : slotIT,
          attivo    : existingAtt.attivo !== undefined ? existingAtt.attivo : true,
          verificato: existingAtt.verificato || false,
          fonte     : 'CODMunity',
          fonteUrl  : url,
          note      : 'Importato automaticamente da CODMunity. Da verificare.',
          updatedAt : todayDate(),
        });
        if (isNewAtt) report.attachmentsImported++;
        else          report.attachmentsUpdated++;

        // Compatibilità — ID: armaId__accessorioId, unica per coppia
        const ck = `${weaponId}::${attId}`;
        if (!compatSet.has(ck)) {
          compatList.push({
            id           : `${weaponId}__${attId}`,
            armaId       : weaponId,
            accessorioId : attId,
            compatibile  : true,
            verificato   : false,
            fonte        : 'CODMunity',
            fonteUrl     : url,
            note         : 'Importato automaticamente da CODMunity. Da verificare.',
            updatedAt    : todayDate(),
          });
          compatSet.add(ck);
          report.compatibilityImported++;
        } else {
          report.compatibilityUpdated++;
        }
        validAtts++;
      }

      if (validAtts === 0) {
        report.warnings.push({
          url,
          message: `Accessori non trovati per "${data.name}" (metodo: ${data._method})`
        });
      }

      const ignored  = [...new Set(ignoredHere)];
      const attLog   = validAtts > 0 ? ` — ${validAtts} acc` : ' ⚠ 0 acc';
      const catLabel = resolvedCategory !== 'Da verificare'
        ? `${resolvedCategory}${finalCategorySource ? ' ('+finalCategorySource+')' : ''}`
        : '⚠ Da verificare';
      console.log(
        `      ✓ "${data.name}" [${catLabel}]${attLog}` +
        ` (${data._method})` +
        (ignored.length ? ` | ignorati: ${ignored.join(', ')}` : '')
      );

      report.processedUrls.push({
        url, game, status: 'ok',
        name            : data.name,
        category        : resolvedCategory,
        categorySource  : finalCategorySource,
        attachmentsFound: validAtts,
        method          : data._method,
      });
      report[gameKey].ok++;

    } catch (err) {
      const msg = err.message || String(err);
      console.log(`      ✗ ${msg}`);
      if (hasPuppeteer) report.puppeteerPagesFailed++;
      report.failedUrls.push({ url, game, error: msg });
      report.errors.push({ url, game, error: msg });
      report[gameKey].failed++;
    }

    // Delay anti-rate-limit (minimo 1500ms come da spec)
    if (i < allUrls.length - 1) {
      await sleep(1500 + Math.floor(Math.random() * 700));
    }
  }

  // ─── Chiudi browser ───────────────────────────────────────────────────────
  if (pBrowser) { try { await pBrowser.close(); pBrowser = null; } catch {} }

  // ─── Salvataggio ──────────────────────────────────────────────────────────
  report.finishedAt = nowISO();
  const weaponsArr  = Array.from(weaponsMap.values());
  const attsArr     = Array.from(attachmentsMap.values());
  writeJSON(WEAPONS_FILE,  weaponsArr);
  writeJSON(ATT_FILE,      attsArr);
  writeJSON(COMPAT_FILE,   compatList);
  writeJSON(REPORT_FILE,   report);

  console.log('\n══ File salvati ══');
  console.log(`  ✓ loadout-weapons.json        (${weaponsArr.length} armi)`);
  console.log(`  ✓ loadout-attachments.json    (${attsArr.length} accessori)`);
  console.log(`  ✓ loadout-compatibility.json  (${compatList.length} compatibilità)`);
  console.log(`  ✓ loadout-import-report.json`);

  // ─── Riepilogo ────────────────────────────────────────────────────────────
  const ok   = report.processedUrls.filter(u => u.status === 'ok').length;
  const fail = report.failedUrls.length;
  const dup  = report.duplicatedWeaponsSkipped.length;
  const warn = report.warnings.length;

  console.log('\n══════════════════════════════════════════════════');
  console.log('  RIEPILOGO');
  console.log('══════════════════════════════════════════════════');
  console.log(`  URL processati            : ${allUrls.length}${LIMIT ? ` (limite: ${LIMIT})` : ''}`);
  console.log(`  ─────────────────────────────────────────────`);
  console.log(`  BO6  ✓${report.bo6Urls.ok} ✗${report.bo6Urls.failed} ⚠dup:${report.bo6Urls.duplicated}  (tot: ${report.bo6Urls.total})`);
  console.log(`  BO7  ✓${report.bo7Urls.ok} ✗${report.bo7Urls.failed} ⚠dup:${report.bo7Urls.duplicated}  (tot: ${report.bo7Urls.total})`);
  console.log(`  ─────────────────────────────────────────────`);
  console.log(`  Puppeteer usato           : ${hasPuppeteer ? 'Sì' : 'No'}`);
  if (hasPuppeteer) {
    console.log(`  Puppeteer pagine OK       : ${report.puppeteerPagesSucceeded}`);
    console.log(`  Puppeteer pagine fallite  : ${report.puppeteerPagesFailed}`);
  }
  console.log(`  ─────────────────────────────────────────────`);
  console.log(`  ✓ Successi                : ${ok}`);
  console.log(`  ✗ Falliti                 : ${fail}`);
  console.log(`  ⚠ Duplicati saltati       : ${dup}`);
  console.log(`  ⚠ Warning (0 acc)        : ${warn}`);
  console.log(`  ─────────────────────────────────────────────`);
  console.log(`  Armi nuove / aggiornate   : ${report.weaponsImported} / ${report.weaponsUpdated}`);
  console.log(`  Accessori nuovi / agg.    : ${report.attachmentsImported} / ${report.attachmentsUpdated}`);
  console.log(`  Compatibilità nuove / agg.: ${report.compatibilityImported} / ${report.compatibilityUpdated}`);
  console.log(`  Slot ignorati             : ${report.ignoredSlots.length}`);
  console.log(`  ─────────────────────────────────────────────`);
  console.log(`  Categoria rilevata (auto) : ${report.categoryDetected.length}`);
  console.log(`  Categoria da mappa manuale: ${report.categoryFallback.length}`);
  console.log(`  Categoria non trovata     : ${report.categoryFailed.length}`);
  console.log('══════════════════════════════════════════════════');

  if (fail > 0) {
    console.log('\n⚠  URL falliti:');
    report.failedUrls.forEach(f => console.log(`   ✗ [${f.game}] ${f.url}\n     → ${f.error}`));
  }
  if (warn > 0 && warn <= 10) {
    console.log('\n⚠  Armi senza accessori:');
    report.warnings.forEach(w => console.log(`   ⚠ ${w.url}\n     → ${w.message}`));
  } else if (warn > 10) {
    console.log(`\n⚠  ${warn} armi senza accessori — vedi report JSON per dettagli.`);
  }
  if (report.ignoredSlots.length > 0) {
    console.log('\nℹ  Slot ignorati (non validi):');
    report.ignoredSlots.slice(0, 15).forEach(s => console.log(`   ${s}`));
    if (report.ignoredSlots.length > 15) console.log(`   ...e altri ${report.ignoredSlots.length - 15}`);
  }

  console.log('\n✅ Build completato.');
  console.log('   Dati NON verificati (verificata/verificato: false).');
  console.log('   Approva su /admin-loadout → Database → Da verificare.\n');
}

main().catch(e => {
  console.error('\n[ERRORE FATALE]', e.message);
  if (process.env.DEBUG) console.error(e.stack);
  try {
    const r = readJSON(REPORT_FILE);
    writeJSON(REPORT_FILE, { ...r, fatalError: e.message, fatalStack: e.stack, finishedAt: nowISO() });
  } catch {}
  if (pBrowser) { try { pBrowser.close(); } catch {} }
  process.exit(1);
});
