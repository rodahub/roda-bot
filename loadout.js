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

  // ── ROTTA PAGINA PUBBLICA LOADOUT ──────────────────────────────────────────
  app.get('/loadout', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'loadout.html'));
  });

  // ── ROTTA PAGINA ADMIN LOADOUT ─────────────────────────────────────────────
  app.get('/admin-loadout', authRequired, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin-loadout.html'));
  });

  // ── API PUBBLICHE ──────────────────────────────────────────────────────────

  // GET /api/loadout/weapons  →  armi attive
  app.get('/api/loadout/weapons', (req, res) => {
    const weapons = readWeapons().filter(w => w.attiva);
    res.json({ ok: true, weapons });
  });

  // GET /api/loadout/attachments?weaponId=xxx  →  accessori attivi compatibili
  app.get('/api/loadout/attachments', (req, res) => {
    const { weaponId } = req.query;
    let attachments = readAttachments().filter(a => a.attivo);
    if (weaponId) {
      attachments = attachments.filter(a =>
        Array.isArray(a.armiCompatibili) && a.armiCompatibili.includes(weaponId)
      );
    }
    res.json({ ok: true, attachments });
  });

  // GET /api/loadout/builds  →  equipaggiamenti approvati
  app.get('/api/loadout/builds', (req, res) => {
    const builds = readBuilds().filter(b => b.stato === 'approvato');
    res.json({ ok: true, builds });
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
      const tipiUsati = new Set();
      const accessoriNormalizzati = [];

      for (const accId of accessori) {
        if (!accId) return res.json({ ok: false, message: 'Accessorio non valido.' });
        const acc = allAttachments.find(a => a.id === accId);
        if (!acc) return res.json({ ok: false, message: `Accessorio "${accId}" non trovato.` });
        if (!acc.attivo) return res.json({ ok: false, message: `Accessorio "${acc.nome}" non disponibile.` });
        if (!acc.armiCompatibili.includes(armaId)) return res.json({ ok: false, message: `Accessorio "${acc.nome}" non compatibile con questa arma.` });
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
      const { id, nome, categoria, attiva } = req.body;
      if (!id || !nome || !categoria) return res.json({ ok: false, message: 'id, nome e categoria sono obbligatori.' });
      const weapons = readWeapons();
      const idx = weapons.findIndex(w => w.id === id);
      const weapon = { id: sanitize(id), nome: sanitize(nome), categoria: sanitize(categoria), attiva: attiva !== false };
      if (idx === -1) weapons.push(weapon);
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
      const { id, nome, tipo, armiCompatibili, attivo } = req.body;
      if (!id || !nome || !tipo) return res.json({ ok: false, message: 'id, nome e tipo sono obbligatori.' });
      const attachments = readAttachments();
      const idx = attachments.findIndex(a => a.id === id);
      const att = {
        id: sanitize(id), nome: sanitize(nome), tipo: sanitize(tipo),
        armiCompatibili: Array.isArray(armiCompatibili) ? armiCompatibili : [],
        attivo: attivo !== false
      };
      if (idx === -1) attachments.push(att);
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

};
