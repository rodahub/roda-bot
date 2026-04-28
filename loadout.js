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

  // GET /api/loadout/weapons  →  armi attive E verificate (solo pubblico)
  app.get('/api/loadout/weapons', (req, res) => {
    const weapons = readWeapons().filter(w => w.attiva && w.verificata);
    res.json({ ok: true, weapons });
  });

  // GET /api/loadout/attachments?weaponId=xxx  →  accessori attivi, verificati, compatibili
  app.get('/api/loadout/attachments', (req, res) => {
    const { weaponId } = req.query;
    let attachments = readAttachments().filter(a => a.attivo && a.verificato);
    if (weaponId) {
      // Fonte autoritativa: loadout-compatibility.json (solo voci verificate e compatibili)
      const compat = readCompatibility().filter(
        c => c.armaId === weaponId && c.compatibile !== false && c.verificato
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
      const weapon = {
        id: sanitize(id), nome: sanitize(nome), categoria: sanitize(categoria),
        gioco: sanitize(gioco) || 'Warzone',
        attiva: attiva !== false,
        verificata: verificata === true || verificata === 'true',
        fonte: sanitize(fonte) || '', note: sanitize(note) || '',
        updatedAt: nowISO()
      };
      if (idx === -1) weapons.push(weapon);
      else weapons[idx] = { ...weapons[idx], ...weapon };
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
      const att = {
        id: sanitize(id), nome: sanitize(nome), tipo: tipoNorm,
        armiCompatibili: Array.isArray(armiCompatibili) ? armiCompatibili : [],
        attivo: attivo !== false,
        verificato: verificato === true || verificato === 'true',
        fonte: sanitize(fonte) || '', note: sanitize(note) || '',
        updatedAt: nowISO()
      };
      if (idx === -1) attachments.push(att);
      else attachments[idx] = { ...attachments[idx], ...att };
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

  // POST /api/admin/loadout/verify  →  verifica un record
  app.post('/api/admin/loadout/verify', authRequired, (req, res) => {
    try {
      const { type, id, armaId, accessorioId } = req.body;
      if (type === 'weapon') {
        const weapons = readWeapons();
        const idx = weapons.findIndex(w => w.id === id);
        if (idx === -1) return res.json({ ok: false, message: 'Arma non trovata.' });
        weapons[idx].verificata = true; weapons[idx].updatedAt = nowISO();
        saveWeapons(weapons);
      } else if (type === 'attachment') {
        const atts = readAttachments();
        const idx = atts.findIndex(a => a.id === id);
        if (idx === -1) return res.json({ ok: false, message: 'Accessorio non trovato.' });
        atts[idx].verificato = true; atts[idx].updatedAt = nowISO();
        saveAttachments(atts);
      } else if (type === 'compatibility') {
        const compat = readCompatibility();
        const idx = compat.findIndex(c => c.armaId === armaId && c.accessorioId === accessorioId);
        if (idx === -1) return res.json({ ok: false, message: 'Compatibilità non trovata.' });
        compat[idx].verificato = true; compat[idx].updatedAt = nowISO();
        saveCompatibility(compat);
      } else {
        return res.json({ ok: false, message: 'Tipo non valido. Usa: weapon, attachment, compatibility.' });
      }
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, message: e.message });
    }
  });

  // POST /api/admin/loadout/disable  →  disattiva un record
  app.post('/api/admin/loadout/disable', authRequired, (req, res) => {
    try {
      const { type, id } = req.body;
      if (type === 'weapon') {
        const weapons = readWeapons();
        const idx = weapons.findIndex(w => w.id === id);
        if (idx === -1) return res.json({ ok: false, message: 'Arma non trovata.' });
        weapons[idx].attiva = false; weapons[idx].updatedAt = nowISO();
        saveWeapons(weapons);
      } else if (type === 'attachment') {
        const atts = readAttachments();
        const idx = atts.findIndex(a => a.id === id);
        if (idx === -1) return res.json({ ok: false, message: 'Accessorio non trovato.' });
        atts[idx].attivo = false; atts[idx].updatedAt = nowISO();
        saveAttachments(atts);
      } else {
        return res.json({ ok: false, message: 'Tipo non valido. Usa: weapon, attachment.' });
      }
      res.json({ ok: true });
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
