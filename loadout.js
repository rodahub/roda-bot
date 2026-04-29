/**
 * RØDA Loadout — route Express
 * Gestione equipaggiamenti Warzone: submit, approvazione, admin.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ─── Percorsi file ────────────────────────────────────────────────────────────

const STORAGE_DIR =
  process.env.STORAGE_DIR ||
  process.env.RAILWAY_VOLUME_MOUNT_PATH ||
  path.join(__dirname, 'storage-data');

const BUILDS_FILE = path.join(STORAGE_DIR, 'loadout-builds.json');

const WEAPONS_FILE  = path.join(__dirname, 'data', 'loadout-weapons.json');
const ATT_FILE      = path.join(__dirname, 'data', 'loadout-attachments.json');
const COMPAT_FILE   = path.join(__dirname, 'data', 'loadout-compatibility.json');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ensureBuildsFile() {
  if (!fs.existsSync(STORAGE_DIR)) fs.mkdirSync(STORAGE_DIR, { recursive: true });
  if (!fs.existsSync(BUILDS_FILE)) fs.writeFileSync(BUILDS_FILE, '[]', 'utf8');
}

function readBuilds() {
  ensureBuildsFile();
  try { return JSON.parse(fs.readFileSync(BUILDS_FILE, 'utf8')); }
  catch { return []; }
}

function writeBuilds(builds) {
  ensureBuildsFile();
  const tmp = BUILDS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(builds, null, 2), 'utf8');
  fs.renameSync(tmp, BUILDS_FILE);
}

function readWeapons() {
  try { return JSON.parse(fs.readFileSync(WEAPONS_FILE, 'utf8')); }
  catch { return []; }
}

function readAttachments() {
  try { return JSON.parse(fs.readFileSync(ATT_FILE, 'utf8')); }
  catch { return []; }
}

function saveWeapons(weapons) {
  fs.writeFileSync(WEAPONS_FILE, JSON.stringify(weapons, null, 2), 'utf8');
}

function saveAttachments(attachments) {
  fs.writeFileSync(ATT_FILE, JSON.stringify(attachments, null, 2), 'utf8');
}

function readCompatibility() {
  try {
    if (!fs.existsSync(COMPAT_FILE)) return [];
    return JSON.parse(fs.readFileSync(COMPAT_FILE, 'utf8'));
  } catch { return []; }
}
function saveCompatibility(data) {
  const tmp = COMPAT_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, COMPAT_FILE);
}

// ─── Slot normalization ────────────────────────────────────────────────────
const SLOT_MAP = {
  'optic':'Ottica','optics':'Ottica','muzzle':'Volata','barrel':'Canna',
  'underbarrel':'Sottocanna','under barrel':'Sottocanna','magazine':'Caricatore',
  'mag':'Caricatore','rear grip':'Impugnatura','grip':'Impugnatura',
  'stock':'Calcio','laser':'Laser','fire mods':'Mod fuoco','fire mod':'Mod fuoco',
  // passthrough IT
  'ottica':'Ottica','volata':'Volata','canna':'Canna','sottocanna':'Sottocanna',
  'caricatore':'Caricatore','impugnatura':'Impugnatura','calcio':'Calcio',
  'mod fuoco':'Mod fuoco'
};
const VALID_SLOTS = ['Ottica','Volata','Canna','Sottocanna','Caricatore','Impugnatura','Calcio','Laser','Mod fuoco'];

function normalizeSlot(tipo) {
  if (!tipo) return null;
  return SLOT_MAP[String(tipo).trim().toLowerCase()] || null;
}

function toSlug(str) {
  return String(str || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function nowISO() { return new Date().toISOString(); }

// ─── Normalizzazione categoria arma ───────────────────────────────────────────
const WEAPON_CATEGORY_MAP = {
  'assault rifle':"Fucile d'assalto",'assault rifles':"Fucile d'assalto",'ar':"Fucile d'assalto",
  'smg':'Mitraglietta','submachine gun':'Mitraglietta','submachine guns':'Mitraglietta',
  'lmg':'Mitragliatrice leggera','light machine gun':'Mitragliatrice leggera',
  'marksman rifle':'Fucile tattico','marksman rifles':'Fucile tattico','tactical rifle':'Fucile tattico',
  'battle rifle':'Fucile da battaglia','battle rifles':'Fucile da battaglia',
  'sniper rifle':'Cecchino','sniper rifles':'Cecchino','sniper':'Cecchino',
  'shotgun':'Shotgun','shotguns':'Shotgun',
  'pistol':'Pistola','pistols':'Pistola','handgun':'Pistola',
  'melee':'Corpo a corpo','launcher':'Lanciarazzi','launchers':'Lanciarazzi',
  // IT passthrough
  "fucile d'assalto":"Fucile d'assalto","fucili d'assalto":"Fucile d'assalto",
  'mitraglietta':'Mitraglietta','mitragliatrice leggera':'Mitragliatrice leggera',
  'fucile tattico':'Fucile tattico','fucile da battaglia':'Fucile da battaglia',
  'cecchino':'Cecchino','fucile di precisione':'Cecchino','fucile a pompa':'Shotgun',
  'pistola':'Pistola','corpo a corpo':'Corpo a corpo','lanciarazzi':'Lanciarazzi',
};

// Fallback per ID arma — copre tutti i 80 weapon ID noti (BO6 + BO7)
// Categorie BO7 corrette secondo spec ufficiale RØDA
const WEAPON_ID_CATEGORY = {
  // BO6 — Fucili d'assalto
  'xm4':"Fucile d'assalto",'ak-74':"Fucile d'assalto",'ames-85':"Fucile d'assalto",
  'gpr-91':"Fucile d'assalto",'model-l':"Fucile d'assalto",'goblin-mk2':"Fucile d'assalto",
  'as-val':"Fucile d'assalto",'krig-c':"Fucile d'assalto",'cypher-091':"Fucile d'assalto",
  'ffar-1':"Fucile d'assalto",'kilo-141':"Fucile d'assalto",'cr-56-amax':"Fucile d'assalto",
  // BO6 — Mitragliette
  'c9':'Mitraglietta','ksv':'Mitraglietta','tanto-22':'Mitraglietta','pp-919':'Mitraglietta',
  'jackal-pdw':'Mitraglietta','kompakt-92':'Mitraglietta','saug':'Mitraglietta',
  'ppsh-41':'Mitraglietta','lc10':'Mitraglietta','ladra':'Mitraglietta',
  // BO6 — Mitragliatrici leggere
  'pu-21':'Mitragliatrice leggera','xmg':'Mitragliatrice leggera',
  'gpmg-7':'Mitragliatrice leggera','feng-82':'Mitragliatrice leggera',
  // BO6 — Fucili tattici
  'swat-556':'Fucile tattico','swat-5-56':'Fucile tattico','tsarkov-762':'Fucile tattico',
  'tsarkov-7-62':'Fucile tattico','aek-973':'Fucile tattico','dm-10':'Fucile tattico','tr2':'Fucile tattico',
  // BO6 — Cecchini
  'lw3a1-frostline':'Cecchino','svd':'Cecchino','lr-762':'Cecchino',
  'lr-7-62':'Cecchino','amr-mod-4':'Cecchino','hdr':'Cecchino',
  // BO6 — Shotgun
  'marine-sp':'Shotgun','asg-89':'Shotgun','maelstrom':'Shotgun',
  // BO6 — Pistole
  '9mm-pm':'Pistola','grekhova':'Pistola','gs45':'Pistola','stryder-22':'Pistola','1911':'Pistola',
  // BO7 — Fucili d'assalto
  'voyak-kt-3':"Fucile d'assalto",'egrt-17':"Fucile d'assalto",'m15-mod-0':"Fucile d'assalto",
  'x9-maverick':"Fucile d'assalto",'maddox-rfb':"Fucile d'assalto",'mxr-17':"Fucile d'assalto",
  'ak-27':"Fucile d'assalto",'sokol-545':"Fucile d'assalto",
  'peacekeeper-mk1':"Fucile d'assalto",'kogot-7':"Fucile d'assalto",'mk35-isr':"Fucile d'assalto",
  // BO7 — Mitragliette
  'ryden-45k':'Mitraglietta','sturmwolf-45':'Mitraglietta','rk-9':'Mitraglietta',
  'vst':'Mitraglietta','carbon-57':'Mitraglietta','razor-9mm':'Mitraglietta',
  'rev-46':'Mitraglietta','mpc-25':'Mitraglietta','dravec-45':'Mitraglietta',
  // BO7 — Mitragliatrici leggere
  'mk-78':'Mitragliatrice leggera','mk78':'Mitragliatrice leggera','xm325':'Mitragliatrice leggera',
  // BO7 — Fucili tattici
  'm8a1':'Fucile tattico','swordfish-a1':'Fucile tattico','warden-308':'Fucile tattico','ds20-mirage':'Fucile tattico',
  // BO7 — Cecchini
  'vs-recon':'Cecchino','strider-300':'Cecchino','shadow-sk':'Cecchino',
  'hawker-hx':'Cecchino','m34-novaline':'Cecchino',
  // BO7 — Shotgun
  'akita':'Shotgun',
};

const VALID_WEAPON_CATEGORIES = new Set([
  "Fucile d'assalto",'Mitraglietta','Mitragliatrice leggera','Fucile tattico',
  'Fucile da battaglia','Cecchino','Shotgun','Pistola','Corpo a corpo','Lanciarazzi',
]);

function normalizeWeaponCategoryServer(raw, weaponId) {
  // 1. ID-based lookup (massima priorità — sempre corretto)
  if (weaponId && WEAPON_ID_CATEGORY[weaponId]) return WEAPON_ID_CATEGORY[weaponId];
  if (!raw) return raw;
  // 2. String normalization
  const k = String(raw).trim().replace(/[''‚‛′''‚‛]/g,"'").replace(/\s+/g,' ').toLowerCase();
  if (WEAPON_CATEGORY_MAP[k]) return WEAPON_CATEGORY_MAP[k];
  for (const [key, val] of Object.entries(WEAPON_CATEGORY_MAP)) {
    if (key.length >= 4 && k.includes(key)) return val;
  }
  return raw;
}

// ─── Helpers stato ────────────────────────────────────────────────────────────
function isPublico(item) {
  return item.stato === 'pubblico' || (!item.bloccatoManuale && item.stato !== 'bloccato' && item.stato !== 'disattivato');
}

// ─── Startup: normalizza categorie + migra schema + auto-verifica ──────────────
function runStartupDataFix() {
  try {
    const weapons = readWeapons();
    let changed = 0;
    let nextOrder = Math.max(0, ...weapons.map(w => w.releaseOrder || 0)) + 1;
    const today = new Date().toISOString().slice(0, 10);

    const fixed = weapons.map((w, i) => {
      const correctCat  = normalizeWeaponCategoryServer(w.categoria, w.id);
      const catValid    = VALID_WEAPON_CATEGORIES.has(correctCat);
      const shouldPubbl = catValid && !w.bloccatoManuale && w.stato !== 'bloccato' && w.stato !== 'disattivato';

      // Stato derivato se mancante
      let stato = w.stato;
      if (!stato) {
        stato = shouldPubbl ? 'pubblico' : 'da_controllare';
      }
      // Se valido e non bloccato ma stato mancava → pubblicato
      if (!w.stato && shouldPubbl) stato = 'pubblico';

      const needsFix =
        correctCat !== w.categoria ||
        (shouldPubbl && !w.verificata) ||
        !w.stato ||
        w.releaseOrder === undefined ||
        !w.discoveredAt;

      if (!needsFix) return w;
      changed++;
      return {
        ...w,
        categoria     : correctCat,
        stato,
        verificata    : shouldPubbl ? true  : w.verificata,
        attiva        : shouldPubbl ? true  : w.attiva,
        bloccatoManuale: w.bloccatoManuale || false,
        bloccatoMotivo : w.bloccatoMotivo  || '',
        releaseOrder   : w.releaseOrder    || (nextOrder++),
        discoveredAt   : w.discoveredAt    || today,
        updatedAt      : today,
      };
    });
    if (changed > 0) {
      saveWeapons(fixed);
      console.log(`[Loadout] Startup fix: ${changed} armi aggiornate (schema+categorie+stato).`);
    }
  } catch (e) {
    console.warn('[Loadout] Startup fix fallito (non bloccante):', e.message);
  }
}

function sanitize(v) {
  return String(v || '').trim().slice(0, 200);
}

// Placeholder pubblicazione futura
async function publishApprovedLoadout(loadout) {
  // TODO futuro: genera immagine PNG e pubblica su Discord/Telegram
  console.log(`[Loadout] Approvato: ${loadout.armaNome} di ${loadout.creator}`);
}

// ─── Registra route sull'app Express ─────────────────────────────────────────

module.exports = function registerLoadoutRoutes(app, authRequired) {

  // Normalizza categorie e auto-verifica armi all'avvio (idempotente)
  runStartupDataFix();

  // ── ROTTA PAGINA PUBBLICA LOADOUT ──────────────────────────────────────────
  app.get('/loadout', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'loadout.html'));
  });

  // ── ROTTA PAGINA ADMIN LOADOUT ─────────────────────────────────────────────
  app.get('/admin-loadout', authRequired, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin-loadout.html'));
  });

  // ── API PUBBLICHE ──────────────────────────────────────────────────────────

  // GET /api/loadout/weapons  →  solo armi pubbliche, ordinate per CODMunity order
  app.get('/api/loadout/weapons', (req, res) => {
    // Funzione di ordinamento centralizzata
    function sortWeaponsForLoadout(a, b) {
      // 1. gamePriority DESC (BO7=500 prima di BO6=400)
      const gpA = Number(a.gamePriority || 0);
      const gpB = Number(b.gamePriority || 0);
      if (gpB !== gpA) return gpB - gpA;

      // 2. releaseOrder DESC (nuove armi prima)
      const roA = Number(a.releaseOrder || 0);
      const roB = Number(b.releaseOrder || 0);
      if (roB !== roA) return roB - roA;

      // 3. codmunityOrder ASC (ordine originale CODMunity)
      const coA = Number(a.codmunityOrder || 999999);
      const coB = Number(b.codmunityOrder || 999999);
      if (coA !== coB) return coA - coB;

      // 4. discoveredAt DESC (scoperte più recenti prima)
      const da = new Date(a.discoveredAt || 0).getTime();
      const db = new Date(b.discoveredAt || 0).getTime();
      if (db !== da) return db - da;

      // 5. nome ASC (fallback alfabetico)
      return String(a.nome || '').localeCompare(String(b.nome || ''), 'it');
    }

    const weapons = readWeapons()
      .filter(w =>
        w.attiva !== false &&
        w.verificata &&
        !w.bloccatoManuale &&
        w.stato !== 'bloccato' &&
        w.stato !== 'disattivato' &&
        w.stato !== 'da_controllare'
      )
      .sort(sortWeaponsForLoadout)
      .map(w => ({
        id           : w.id,
        nome         : w.nome,
        categoria    : normalizeWeaponCategoryServer(w.categoria, w.id),
        gioco        : w.gioco || 'BO6',
        attiva       : w.attiva,
        verificata   : w.verificata,
        gamePriority : w.gamePriority,
        releaseOrder : w.releaseOrder,
        codmunityOrder: w.codmunityOrder,
        discoveredAt : w.discoveredAt,
      }));
    res.json({ ok: true, weapons });
  });

  // GET /api/loadout/attachments?weaponId=xxx  →  accessori pubblici compatibili
  app.get('/api/loadout/attachments', (req, res) => {
    const { weaponId } = req.query;
    let attachments = readAttachments().filter(a =>
      a.attivo !== false &&
      a.verificato &&
      !a.bloccatoManuale &&
      a.stato !== 'bloccato' &&
      a.stato !== 'disattivato' &&
      a.stato !== 'da_controllare'
    );
    if (weaponId) {
      const compat = readCompatibility().filter(
        c => c.armaId === weaponId && c.compatibile !== false && c.verificato &&
             !c.bloccatoManuale && c.stato !== 'bloccato' && c.stato !== 'disattivato'
      );
      const compatIds = new Set(compat.map(c => c.accessorioId));
      attachments = attachments.filter(a => compatIds.has(a.id));
    }
    res.json({ ok: true, attachments });
  });

  // GET /api/loadout/builds  →  equipaggiamenti approvati
  app.get('/api/loadout/builds', (req, res) => {
    const builds = readBuilds().filter(b => b.stato === 'approvato');
    res.json({ ok: true, builds });
  });

  // POST /api/loadout/builds  →  invia nuovo loadout (con creatorName)
  app.post('/api/loadout/builds', (req, res) => {
    try {
      const { creatorName, gioco, categoria, armaId, armaNome, stile, accessori } = req.body;

      // Validazioni minime
      if (!creatorName || String(creatorName).trim().length < 2) {
        return res.json({ ok: false, message: 'La firma creator deve avere almeno 2 caratteri.' });
      }
      if (!armaId) {
        return res.json({ ok: false, message: 'Arma non specificata.' });
      }

      const weapons = readWeapons();
      const arma = weapons.find(w => w.id === armaId);
      if (!arma) {
        return res.json({ ok: false, message: 'Arma non trovata.' });
      }
      if (!arma.attiva) {
        return res.json({ ok: false, message: 'Arma non disponibile.' });
      }

      // Accessori opzionali ma max 5
      const safeAccessori = Array.isArray(accessori) ? accessori.slice(0, 5) : [];

      const build = {
        id: 'loadout_' + crypto.randomBytes(6).toString('hex'),
        stato: 'da_approvare',
        creatorName: sanitize(String(creatorName).slice(0, 30)),
        gioco: gioco || arma.gioco || 'BO6',
        categoria: categoria || arma.categoria || '',
        armaId: arma.id,
        armaNome: arma.nome,
        stile: stile || 'Personalizzato',
        accessori: safeAccessori.map(a => ({
          slot: a.slot || 'Vari',
          accessorioId: a.accessorioId || a.id || '',
          nome: a.nome || ''
        })),
        createdAt: new Date().toISOString(),
        approvedAt: null,
        approvedBy: null
      };

      const builds = readBuilds();
      builds.push(build);
      writeBuilds(builds);

      res.json({ ok: true, message: 'Loadout pronto per l\'invio.', buildId: build.id });
    } catch (e) {
      console.error('[Loadout] Errore submit build:', e);
      res.status(500).json({ ok: false, message: 'Errore server.' });
    }
  });

  // POST /api/loadout/submit  →  invia nuovo equipaggiamento
  app.post('/api/loadout/submit', (req, res) => {
    try {
      const {
        creator, firma, categoriaArma, armaId,
        tipoEquipaggiamento, accessori, nota
      } = req.body;

      // ── Validazioni ──
      if (!sanitize(creator)) return res.json({ ok: false, message: 'Il nome creator è obbligatorio.' });

      const weapons = readWeapons();
      const arma = weapons.find(w => w.id === armaId);
      if (!arma)      return res.json({ ok: false, message: 'Arma non trovata.' });
      if (!arma.attiva) return res.json({ ok: false, message: 'Arma non disponibile.' });

      if (!tipoEquipaggiamento) return res.json({ ok: false, message: 'Tipo equipaggiamento obbligatorio.' });

      const tipiValidi = ['Lungo raggio','Corto raggio','Supporto cecchino','Ranked','Resurgence','Generico'];
      if (!tipiValidi.includes(tipoEquipaggiamento)) return res.json({ ok: false, message: 'Tipo equipaggiamento non valido.' });

      if (!Array.isArray(accessori) || accessori.length === 0)
        return res.json({ ok: false, message: 'Inserisci almeno un accessorio.' });
      if (accessori.length > 5)
        return res.json({ ok: false, message: 'Massimo 5 accessori.' });

      const allAttachments = readAttachments();
      // Compatibilità autoritative da loadout-compatibility.json
      const compatSet = new Set(
        readCompatibility()
          .filter(c => c.armaId === armaId && c.compatibile !== false && c.verificato)
          .map(c => c.accessorioId)
      );
      const tipiUsati = new Set();
      const accessoriNormalizzati = [];

      for (const accId of accessori) {
        if (!accId) return res.json({ ok: false, message: 'Accessorio non valido.' });
        const acc = allAttachments.find(a => a.id === accId);
        if (!acc) return res.json({ ok: false, message: `Accessorio "${accId}" non trovato.` });
        if (!acc.attivo) return res.json({ ok: false, message: `Accessorio "${acc.nome}" non disponibile.` });
        if (!compatSet.has(accId)) return res.json({ ok: false, message: `Accessorio "${acc.nome}" non compatibile con questa arma.` });
        if (tipiUsati.has(acc.tipo)) return res.json({ ok: false, message: `Hai inserito due accessori dello stesso tipo: ${acc.tipo}.` });
        tipiUsati.add(acc.tipo);
        accessoriNormalizzati.push({ id: acc.id, tipo: acc.tipo, nome: acc.nome });
      }

      const build = {
        id: 'loadout_' + crypto.randomBytes(6).toString('hex'),
        stato: 'in_attesa',
        creator: sanitize(creator),
        firma: sanitize(firma),
        categoriaArma: arma.categoria,
        armaId: arma.id,
        armaNome: arma.nome,
        tipoEquipaggiamento,
        accessori: accessoriNormalizzati,
        nota: sanitize(nota).slice(0, 500),
        createdAt: new Date().toISOString(),
        approvedAt: null,
        approvedBy: null
      };

      const builds = readBuilds();
      builds.push(build);
      writeBuilds(builds);

      res.json({ ok: true, message: '✅ Equipaggiamento inviato correttamente! Lo staff lo controllerà. Se approvato, verrà pubblicato nella sezione Loadout ufficiale.' });
    } catch (e) {
      console.error('[Loadout] Errore submit:', e);
      res.status(500).json({ ok: false, message: 'Errore server.' });
    }
  });

  // ── API ADMIN ──────────────────────────────────────────────────────────────

  // GET /api/admin/loadout/weapons-all  →  tutte le armi (incluse inattive)
  app.get('/api/admin/loadout/weapons-all', authRequired, (req, res) => {
    res.json({ ok: true, weapons: readWeapons() });
  });

  // GET /api/admin/loadout/attachments-all  →  tutti gli accessori (inclusi inattivi)
  app.get('/api/admin/loadout/attachments-all', authRequired, (req, res) => {
    res.json({ ok: true, attachments: readAttachments() });
  });

  // GET /api/admin/loadout/builds  →  tutti gli equipaggiamenti
  app.get('/api/admin/loadout/builds', authRequired, (req, res) => {
    const builds = readBuilds();
    const in_attesa   = builds.filter(b => b.stato === 'in_attesa');
    const approvati   = builds.filter(b => b.stato === 'approvato');
    const rifiutati   = builds.filter(b => b.stato === 'rifiutato');
    res.json({ ok: true, in_attesa, approvati, rifiutati });
  });

  // POST /api/admin/loadout/approve/:id
  app.post('/api/admin/loadout/approve/:id', authRequired, async (req, res) => {
    try {
      const builds = readBuilds();
      const idx = builds.findIndex(b => b.id === req.params.id);
      if (idx === -1) return res.json({ ok: false, message: 'Equipaggiamento non trovato.' });
      builds[idx].stato = 'approvato';
      builds[idx].approvedAt = new Date().toISOString();
      builds[idx].approvedBy = req.staffUser || 'admin';
      writeBuilds(builds);
      await publishApprovedLoadout(builds[idx]);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, message: e.message });
    }
  });

  // POST /api/admin/loadout/reject/:id
  app.post('/api/admin/loadout/reject/:id', authRequired, (req, res) => {
    try {
      const builds = readBuilds();
      const idx = builds.findIndex(b => b.id === req.params.id);
      if (idx === -1) return res.json({ ok: false, message: 'Equipaggiamento non trovato.' });
      builds[idx].stato = 'rifiutato';
      writeBuilds(builds);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, message: e.message });
    }
  });

  // DELETE /api/admin/loadout/:id
  app.delete('/api/admin/loadout/:id', authRequired, (req, res) => {
    try {
      const builds = readBuilds();
      const filtered = builds.filter(b => b.id !== req.params.id);
      if (filtered.length === builds.length) return res.json({ ok: false, message: 'Equipaggiamento non trovato.' });
      writeBuilds(filtered);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, message: e.message });
    }
  });

  // POST /api/admin/loadout/weapons  →  aggiungi o modifica arma
  app.post('/api/admin/loadout/weapons', authRequired, (req, res) => {
    try {
      const { id, nome, categoria, gioco, attiva, verificata, fonte, note } = req.body;
      if (!id || !nome || !categoria) return res.json({ ok: false, message: 'id, nome e categoria sono obbligatori.' });
      const weapons = readWeapons();
      const idx = weapons.findIndex(w => w.id === id);
      const existing = idx !== -1 ? weapons[idx] : null;
      const isNew = !existing;
      const today = new Date().toISOString().slice(0, 10);
      const isVerified = verificata === true || verificata === 'true';
      const weapon = {
        id: sanitize(id), nome: sanitize(nome),
        categoria: sanitize(categoria),
        gioco: sanitize(gioco) || 'BO6',
        attiva: attiva !== false,
        verificata: isVerified,
        // Preserve admin-lock fields when editing; initialize for new records
        stato: existing?.stato || (isVerified ? 'pubblico' : 'da_controllare'),
        bloccatoManuale: existing?.bloccatoManuale || false,
        bloccatoMotivo: existing?.bloccatoMotivo || '',
        releaseOrder: existing?.releaseOrder || (Math.max(0, ...weapons.map(w => w.releaseOrder || 0)) + 1),
        discoveredAt: existing?.discoveredAt || today,
        fonte: sanitize(fonte) || '', note: sanitize(note) || '',
        updatedAt: nowISO()
      };
      // If admin explicitly verifies → auto-publish (unless manually blocked)
      if (isVerified && !weapon.bloccatoManuale && weapon.stato !== 'bloccato') {
        weapon.stato = 'pubblico';
        weapon.attiva = true;
      }
      if (isNew) weapons.push(weapon);
      else weapons[idx] = weapon;
      saveWeapons(weapons);
      res.json({ ok: true, weapon });
    } catch (e) {
      res.status(500).json({ ok: false, message: e.message });
    }
  });

  // POST /api/admin/loadout/attachments  →  aggiungi o modifica accessorio
  app.post('/api/admin/loadout/attachments', authRequired, (req, res) => {
    try {
      const { id, nome, tipo, armiCompatibili, attivo, verificato, fonte, note } = req.body;
      if (!id || !nome || !tipo) return res.json({ ok: false, message: 'id, nome e tipo sono obbligatori.' });
      const tipoNorm = normalizeSlot(tipo);
      if (!tipoNorm) return res.json({ ok: false, message: `Tipo slot "${tipo}" non valido. Usa: ${VALID_SLOTS.join(', ')}` });
      const attachments = readAttachments();
      const idx = attachments.findIndex(a => a.id === id);
      const existing = idx !== -1 ? attachments[idx] : null;
      const isVerif = verificato === true || verificato === 'true';
      const att = {
        id: sanitize(id), nome: sanitize(nome), tipo: tipoNorm,
        armiCompatibili: Array.isArray(armiCompatibili) ? armiCompatibili : (existing?.armiCompatibili || []),
        attivo: attivo !== false,
        verificato: isVerif,
        // Preserve admin-lock fields
        stato: existing?.stato || (isVerif ? 'pubblico' : 'da_controllare'),
        bloccatoManuale: existing?.bloccatoManuale || false,
        bloccatoMotivo: existing?.bloccatoMotivo || '',
        fonte: sanitize(fonte) || '', note: sanitize(note) || '',
        updatedAt: nowISO()
      };
      if (isVerif && !att.bloccatoManuale && att.stato !== 'bloccato') {
        att.stato = 'pubblico';
        att.attivo = true;
      }
      if (!existing) attachments.push(att);
      else attachments[idx] = att;
      saveAttachments(attachments);
      res.json({ ok: true, attachment: att });
    } catch (e) {
      res.status(500).json({ ok: false, message: e.message });
    }
  });

  // POST /api/admin/loadout/weapons/toggle/:id  →  attiva/disattiva arma
  app.post('/api/admin/loadout/weapons/toggle/:id', authRequired, (req, res) => {
    try {
      const weapons = readWeapons();
      const idx = weapons.findIndex(w => w.id === req.params.id);
      if (idx === -1) return res.json({ ok: false, message: 'Arma non trovata.' });
      weapons[idx].attiva = !weapons[idx].attiva;
      saveWeapons(weapons);
      res.json({ ok: true, attiva: weapons[idx].attiva });
    } catch (e) {
      res.status(500).json({ ok: false, message: e.message });
    }
  });

  // POST /api/admin/loadout/attachments/toggle/:id  →  attiva/disattiva accessorio
  app.post('/api/admin/loadout/attachments/toggle/:id', authRequired, (req, res) => {
    try {
      const attachments = readAttachments();
      const idx = attachments.findIndex(a => a.id === req.params.id);
      if (idx === -1) return res.json({ ok: false, message: 'Accessorio non trovato.' });
      attachments[idx].attivo = !attachments[idx].attivo;
      saveAttachments(attachments);
      res.json({ ok: true, attivo: attachments[idx].attivo });
    } catch (e) {
      res.status(500).json({ ok: false, message: e.message });
    }
  });

  // ── NUOVI ROUTE DATABASE ──────────────────────────────────────────────────

  // GET /api/admin/loadout/database  →  tutto il DB (armi/acc/compat) con split verificati/non
  app.get('/api/admin/loadout/database', authRequired, (req, res) => {
    try {
      const weapons        = readWeapons();
      const attachments    = readAttachments();
      const compatibility  = readCompatibility();
      res.json({ ok: true, weapons, attachments, compatibility });
    } catch (e) {
      res.status(500).json({ ok: false, message: e.message });
    }
  });

  // POST /api/admin/loadout/compatibility  →  aggiungi/aggiorna singola compat
  app.post('/api/admin/loadout/compatibility', authRequired, (req, res) => {
    try {
      const { armaId, accessorioId, compatibile, verificato, fonte, note } = req.body;
      if (!armaId || !accessorioId) return res.json({ ok: false, message: 'armaId e accessorioId sono obbligatori.' });
      const compat = readCompatibility();
      const idx = compat.findIndex(c => c.armaId === armaId && c.accessorioId === accessorioId);
      const entry = {
        armaId: sanitize(armaId), accessorioId: sanitize(accessorioId),
        compatibile: compatibile !== false,
        verificato: verificato === true || verificato === 'true',
        fonte: sanitize(fonte) || '', note: sanitize(note) || '',
        updatedAt: nowISO()
      };
      if (idx === -1) compat.push(entry); else compat[idx] = { ...compat[idx], ...entry };
      saveCompatibility(compat);
      // Aggiorna anche armiCompatibili sull'accessorio
      const atts = readAttachments();
      const attIdx = atts.findIndex(a => a.id === accessorioId);
      if (attIdx !== -1) {
        if (!Array.isArray(atts[attIdx].armiCompatibili)) atts[attIdx].armiCompatibili = [];
        if (entry.compatibile && !atts[attIdx].armiCompatibili.includes(armaId)) {
          atts[attIdx].armiCompatibili.push(armaId);
          saveAttachments(atts);
        } else if (!entry.compatibile) {
          atts[attIdx].armiCompatibili = atts[attIdx].armiCompatibili.filter(id => id !== armaId);
          saveAttachments(atts);
        }
      }
      res.json({ ok: true, entry });
    } catch (e) {
      res.status(500).json({ ok: false, message: e.message });
    }
  });

  // DELETE /api/admin/loadout/compatibility  →  rimuovi singola compat
  app.delete('/api/admin/loadout/compatibility', authRequired, (req, res) => {
    try {
      const { armaId, accessorioId } = req.body;
      const compat = readCompatibility();
      const filtered = compat.filter(c => !(c.armaId === armaId && c.accessorioId === accessorioId));
      if (filtered.length === compat.length) return res.json({ ok: false, message: 'Compatibilità non trovata.' });
      saveCompatibility(filtered);
      // Rimuove anche da armiCompatibili
      const atts = readAttachments();
      const attIdx = atts.findIndex(a => a.id === accessorioId);
      if (attIdx !== -1 && Array.isArray(atts[attIdx].armiCompatibili)) {
        atts[attIdx].armiCompatibili = atts[attIdx].armiCompatibili.filter(id => id !== armaId);
        saveAttachments(atts);
      }
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, message: e.message });
    }
  });

  // POST /api/admin/loadout/publish  →  pubblica manualmente un record
  app.post('/api/admin/loadout/publish', authRequired, (req, res) => {
    try {
      const { type, id, armaId, accessorioId } = req.body;
      const ts = nowISO();
      if (type === 'weapon') {
        const weapons = readWeapons();
        const idx = weapons.findIndex(w => w.id === id);
        if (idx === -1) return res.json({ ok: false, message: 'Arma non trovata.' });
        weapons[idx] = { ...weapons[idx], stato:'pubblico', verificata:true, attiva:true, bloccatoManuale:false, updatedAt:ts };
        saveWeapons(weapons);
      } else if (type === 'attachment') {
        const atts = readAttachments();
        const idx = atts.findIndex(a => a.id === id);
        if (idx === -1) return res.json({ ok: false, message: 'Accessorio non trovato.' });
        atts[idx] = { ...atts[idx], stato:'pubblico', verificato:true, attivo:true, bloccatoManuale:false, updatedAt:ts };
        saveAttachments(atts);
      } else if (type === 'compatibility') {
        const compat = readCompatibility();
        const idx = compat.findIndex(c => c.armaId === armaId && c.accessorioId === accessorioId);
        if (idx === -1) return res.json({ ok: false, message: 'Compatibilità non trovata.' });
        compat[idx] = { ...compat[idx], stato:'pubblico', verificato:true, compatibile:true, bloccatoManuale:false, updatedAt:ts };
        saveCompatibility(compat);
      } else {
        return res.json({ ok: false, message: 'Tipo non valido: weapon, attachment, compatibility.' });
      }
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, message: e.message });
    }
  });

  // POST /api/admin/loadout/block  →  blocca manualmente (il sync non lo riattiva)
  app.post('/api/admin/loadout/block', authRequired, (req, res) => {
    try {
      const { type, id, armaId, accessorioId, reason } = req.body;
      const ts = nowISO();
      if (type === 'weapon') {
        const weapons = readWeapons();
        const idx = weapons.findIndex(w => w.id === id);
        if (idx === -1) return res.json({ ok: false, message: 'Arma non trovata.' });
        weapons[idx] = { ...weapons[idx], stato:'bloccato', attiva:false, bloccatoManuale:true, bloccatoMotivo:sanitize(reason)||'', updatedAt:ts };
        saveWeapons(weapons);
      } else if (type === 'attachment') {
        const atts = readAttachments();
        const idx = atts.findIndex(a => a.id === id);
        if (idx === -1) return res.json({ ok: false, message: 'Accessorio non trovato.' });
        atts[idx] = { ...atts[idx], stato:'bloccato', attivo:false, bloccatoManuale:true, bloccatoMotivo:sanitize(reason)||'', updatedAt:ts };
        saveAttachments(atts);
      } else if (type === 'compatibility') {
        const compat = readCompatibility();
        const idx = compat.findIndex(c => c.armaId === armaId && c.accessorioId === accessorioId);
        if (idx === -1) return res.json({ ok: false, message: 'Compatibilità non trovata.' });
        compat[idx] = { ...compat[idx], stato:'bloccato', compatibile:false, bloccatoManuale:true, bloccatoMotivo:sanitize(reason)||'', updatedAt:ts };
        saveCompatibility(compat);
      } else {
        return res.json({ ok: false, message: 'Tipo non valido: weapon, attachment, compatibility.' });
      }
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, message: e.message });
    }
  });

  // POST /api/admin/loadout/reactivate  →  riattiva/sblocca un record
  app.post('/api/admin/loadout/reactivate', authRequired, (req, res) => {
    try {
      const { type, id, armaId, accessorioId } = req.body;
      const ts = nowISO();
      if (type === 'weapon') {
        const weapons = readWeapons();
        const idx = weapons.findIndex(w => w.id === id);
        if (idx === -1) return res.json({ ok: false, message: 'Arma non trovata.' });
        weapons[idx] = { ...weapons[idx], stato:'pubblico', attiva:true, verificata:true, bloccatoManuale:false, bloccatoMotivo:'', updatedAt:ts };
        saveWeapons(weapons);
      } else if (type === 'attachment') {
        const atts = readAttachments();
        const idx = atts.findIndex(a => a.id === id);
        if (idx === -1) return res.json({ ok: false, message: 'Accessorio non trovato.' });
        atts[idx] = { ...atts[idx], stato:'pubblico', attivo:true, verificato:true, bloccatoManuale:false, bloccatoMotivo:'', updatedAt:ts };
        saveAttachments(atts);
      } else if (type === 'compatibility') {
        const compat = readCompatibility();
        const idx = compat.findIndex(c => c.armaId === armaId && c.accessorioId === accessorioId);
        if (idx === -1) return res.json({ ok: false, message: 'Compatibilità non trovata.' });
        compat[idx] = { ...compat[idx], stato:'pubblico', compatibile:true, verificato:true, bloccatoManuale:false, bloccatoMotivo:'', updatedAt:ts };
        saveCompatibility(compat);
      } else {
        return res.json({ ok: false, message: 'Tipo non valido: weapon, attachment, compatibility.' });
      }
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, message: e.message });
    }
  });

  // POST /api/admin/loadout/verify  →  verifica + pubblica un record
  app.post('/api/admin/loadout/verify', authRequired, (req, res) => {
    try {
      const { type, id, armaId, accessorioId } = req.body;
      const ts = nowISO();
      if (type === 'weapon') {
        const weapons = readWeapons();
        const idx = weapons.findIndex(w => w.id === id);
        if (idx === -1) return res.json({ ok: false, message: 'Arma non trovata.' });
        weapons[idx] = { ...weapons[idx], verificata:true, attiva:true, stato:'pubblico', bloccatoManuale:false, updatedAt:ts };
        saveWeapons(weapons);
      } else if (type === 'attachment') {
        const atts = readAttachments();
        const idx = atts.findIndex(a => a.id === id);
        if (idx === -1) return res.json({ ok: false, message: 'Accessorio non trovato.' });
        atts[idx] = { ...atts[idx], verificato:true, attivo:true, stato:'pubblico', bloccatoManuale:false, updatedAt:ts };
        saveAttachments(atts);
      } else if (type === 'compatibility') {
        const compat = readCompatibility();
        const idx = compat.findIndex(c => c.armaId === armaId && c.accessorioId === accessorioId);
        if (idx === -1) return res.json({ ok: false, message: 'Compatibilità non trovata.' });
        compat[idx] = { ...compat[idx], verificato:true, compatibile:true, stato:'pubblico', bloccatoManuale:false, updatedAt:ts };
        saveCompatibility(compat);
      } else {
        return res.json({ ok: false, message: 'Tipo non valido: weapon, attachment, compatibility.' });
      }
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, message: e.message });
    }
  });

  // POST /api/admin/loadout/verify-all  →  verifica in blocco per tipo (rispetta bloccatoManuale)
  app.post('/api/admin/loadout/verify-all', authRequired, (req, res) => {
    try {
      const { type } = req.body;
      if (!['weapons','attachments','compatibility','all'].includes(type)) {
        return res.json({ ok: false, message: 'Tipo non valido: weapons, attachments, compatibility, all.' });
      }
      const ts = nowISO();
      let updated = 0;
      if (type === 'weapons' || type === 'all') {
        const weapons = readWeapons();
        weapons.forEach(w => {
          if (!w.bloccatoManuale && w.stato !== 'bloccato' && !w.verificata) {
            w.verificata = true; w.attiva = true; w.stato = 'pubblico'; w.updatedAt = ts; updated++;
          }
        });
        saveWeapons(weapons);
      }
      if (type === 'attachments' || type === 'all') {
        const atts = readAttachments();
        atts.forEach(a => {
          if (!a.bloccatoManuale && a.stato !== 'bloccato' && !a.verificato) {
            a.verificato = true; a.attivo = true; a.stato = 'pubblico'; a.updatedAt = ts; updated++;
          }
        });
        saveAttachments(atts);
      }
      if (type === 'compatibility' || type === 'all') {
        const compat = readCompatibility();
        compat.forEach(c => {
          if (!c.bloccatoManuale && c.stato !== 'bloccato' && !c.verificato) {
            c.verificato = true; c.compatibile = true; c.stato = 'pubblico'; c.updatedAt = ts; updated++;
          }
        });
        saveCompatibility(compat);
      }
      res.json({ ok: true, updated });
    } catch (e) {
      res.status(500).json({ ok: false, message: e.message });
    }
  });

  // POST /api/admin/loadout/disable  →  disattiva (non blocca — può essere riattivato)
  app.post('/api/admin/loadout/disable', authRequired, (req, res) => {
    try {
      const { type, id, armaId, accessorioId } = req.body;
      const ts = nowISO();
      if (type === 'weapon') {
        const weapons = readWeapons();
        const idx = weapons.findIndex(w => w.id === id);
        if (idx === -1) return res.json({ ok: false, message: 'Arma non trovata.' });
        weapons[idx] = { ...weapons[idx], stato:'disattivato', attiva:false, updatedAt:ts };
        saveWeapons(weapons);
      } else if (type === 'attachment') {
        const atts = readAttachments();
        const idx = atts.findIndex(a => a.id === id);
        if (idx === -1) return res.json({ ok: false, message: 'Accessorio non trovato.' });
        atts[idx] = { ...atts[idx], stato:'disattivato', attivo:false, updatedAt:ts };
        saveAttachments(atts);
      } else if (type === 'compatibility') {
        const compat = readCompatibility();
        const idx = compat.findIndex(c => c.armaId === (armaId||id) && c.accessorioId === accessorioId);
        if (idx === -1) return res.json({ ok: false, message: 'Compatibilità non trovata.' });
        compat[idx] = { ...compat[idx], stato:'disattivato', compatibile:false, updatedAt:ts };
        saveCompatibility(compat);
      } else {
        return res.json({ ok: false, message: 'Tipo non valido: weapon, attachment, compatibility.' });
      }
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, message: e.message });
    }
  });

  // GET /api/admin/loadout/sync-report  →  ultimo report di sync
  app.get('/api/admin/loadout/sync-report', authRequired, (req, res) => {
    try {
      const reportFile = path.join(__dirname, 'data', 'loadout-import-report.json');
      if (!fs.existsSync(reportFile)) return res.json({ ok: true, report: null });
      const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
      res.json({ ok: true, report });
    } catch (e) {
      res.status(500).json({ ok: false, message: e.message });
    }
  });

  // DELETE /api/admin/loadout/database/:type/:id  →  elimina definitivamente
  app.delete('/api/admin/loadout/database/:type/:id', authRequired, (req, res) => {
    try {
      const { type, id } = req.params;
      if (type === 'weapon') {
        const weapons = readWeapons().filter(w => w.id !== id);
        saveWeapons(weapons);
        // Rimuove anche compat con questa arma
        saveCompatibility(readCompatibility().filter(c => c.armaId !== id));
      } else if (type === 'attachment') {
        const atts = readAttachments().filter(a => a.id !== id);
        saveAttachments(atts);
        saveCompatibility(readCompatibility().filter(c => c.accessorioId !== id));
      } else {
        return res.json({ ok: false, message: 'Tipo non valido. Usa: weapon, attachment.' });
      }
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, message: e.message });
    }
  });

  // POST /api/admin/loadout/import/weapons
  app.post('/api/admin/loadout/import/weapons', authRequired, (req, res) => {
    try {
      const { items, fonte } = req.body;
      if (!Array.isArray(items) || !items.length) return res.json({ ok: false, message: 'items deve essere un array non vuoto.' });
      const weapons = readWeapons();
      let added = 0, updated = 0, skipped = 0;
      for (const raw of items) {
        const id = sanitize(raw.id) || toSlug(raw.nome || '');
        if (!id) { skipped++; continue; }
        const weapon = {
          id, nome: sanitize(raw.nome) || id,
          categoria: sanitize(raw.categoria) || 'Fucile d\'assalto',
          gioco: sanitize(raw.gioco) || 'Warzone',
          attiva: true, verificata: false,
          fonte: sanitize(raw.fonte) || sanitize(fonte) || '',
          note: sanitize(raw.note) || '', updatedAt: nowISO()
        };
        const idx = weapons.findIndex(w => w.id === id);
        if (idx === -1) { weapons.push(weapon); added++; }
        else { weapons[idx] = { ...weapons[idx], ...weapon, verificata: weapons[idx].verificata }; updated++; }
      }
      saveWeapons(weapons);
      res.json({ ok: true, added, updated, skipped });
    } catch (e) {
      res.status(500).json({ ok: false, message: e.message });
    }
  });

  // POST /api/admin/loadout/import/attachments
  app.post('/api/admin/loadout/import/attachments', authRequired, (req, res) => {
    try {
      const { items, fonte } = req.body;
      if (!Array.isArray(items) || !items.length) return res.json({ ok: false, message: 'items deve essere un array non vuoto.' });
      const atts = readAttachments();
      let added = 0, updated = 0, skipped = 0, errors = [];
      for (const raw of items) {
        const id = sanitize(raw.id) || toSlug(raw.nome || '');
        if (!id) { skipped++; continue; }
        const tipoNorm = normalizeSlot(raw.tipo);
        if (!tipoNorm) { errors.push(`Slot "${raw.tipo}" non valido per ${id}`); skipped++; continue; }
        const att = {
          id, nome: sanitize(raw.nome) || id, tipo: tipoNorm,
          armiCompatibili: Array.isArray(raw.armiCompatibili) ? raw.armiCompatibili : [],
          attivo: true, verificato: false,
          fonte: sanitize(raw.fonte) || sanitize(fonte) || '',
          note: sanitize(raw.note) || '', updatedAt: nowISO()
        };
        const idx = atts.findIndex(a => a.id === id);
        if (idx === -1) { atts.push(att); added++; }
        else { atts[idx] = { ...atts[idx], ...att, verificato: atts[idx].verificato }; updated++; }
      }
      saveAttachments(atts);
      res.json({ ok: true, added, updated, skipped, errors });
    } catch (e) {
      res.status(500).json({ ok: false, message: e.message });
    }
  });

  // POST /api/admin/loadout/import/compatibility
  app.post('/api/admin/loadout/import/compatibility', authRequired, (req, res) => {
    try {
      const { items, fonte } = req.body;
      if (!Array.isArray(items) || !items.length) return res.json({ ok: false, message: 'items deve essere un array non vuoto.' });
      const compat = readCompatibility();
      const atts   = readAttachments();
      let added = 0, updated = 0, skipped = 0;
      for (const raw of items) {
        const armaId = sanitize(raw.armaId);
        const accessorioId = sanitize(raw.accessorioId);
        if (!armaId || !accessorioId) { skipped++; continue; }
        const entry = {
          armaId, accessorioId, compatibile: raw.compatibile !== false,
          verificato: false,
          fonte: sanitize(raw.fonte) || sanitize(fonte) || '',
          note: sanitize(raw.note) || '', updatedAt: nowISO()
        };
        const idx = compat.findIndex(c => c.armaId === armaId && c.accessorioId === accessorioId);
        if (idx === -1) { compat.push(entry); added++; }
        else { compat[idx] = { ...compat[idx], ...entry, verificato: compat[idx].verificato }; updated++; }
        // Aggiorna anche armiCompatibili sull'accessorio se esiste
        const attIdx = atts.findIndex(a => a.id === accessorioId);
        if (attIdx !== -1 && entry.compatibile) {
          if (!Array.isArray(atts[attIdx].armiCompatibili)) atts[attIdx].armiCompatibili = [];
          if (!atts[attIdx].armiCompatibili.includes(armaId)) atts[attIdx].armiCompatibili.push(armaId);
        }
      }
      saveCompatibility(compat);
      saveAttachments(atts);
      res.json({ ok: true, added, updated, skipped });
    } catch (e) {
      res.status(500).json({ ok: false, message: e.message });
    }
  });

};
