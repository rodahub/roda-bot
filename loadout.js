/**
 * RØDA Loadout Routes Module
 * Questo file esporta una funzione che registra le rotte sull'istanza Express passata.
 * NON usare app.get() al top-level.
 */

const fs = require('fs');
const path = require('path');

// Helper per leggere/scrivere JSON in modo sicuro
const readJSON = (filename) => {
  const filePath = path.join(__dirname, 'data', filename);
  if (!fs.existsSync(filePath)) return [];
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    console.error(`Errore lettura ${filename}:`, e.message);
    return [];
  }
};

const writeJSON = (filename, data) => {
  const filePath = path.join(__dirname, 'data', filename);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
};

/**
 * Registra tutte le rotte Loadout sull'app Express fornita.
 * @param {Express.Application} app 
 */
module.exports = function registerLoadoutRoutes(app) {
  if (!app) {
    throw new Error('registerLoadoutRoutes: app non definita');
  }

  // ==========================================
  // API PUBBLICHE
  // ==========================================

  /**
   * GET /api/loadout/weapons
   * Restituisce lista armi pubbliche ordinate (BO7 prima, nuove sopra vecchie).
   */
  app.get('/api/loadout/weapons', (req, res) => {
    try {
      let weapons = readJSON('loadout-weapons.json');

      // Filtra solo armi pubbliche/attive
      const publicWeapons = weapons.filter(w => 
        w.attiva === true && 
        w.verificata === true && 
        w.bloccatoManuale !== true &&
        (!w.stato || w.stato === 'pubblico')
      );

      // Ordinamento: gamePriority DESC -> releaseOrder DESC -> codmunityOrder ASC
      publicWeapons.sort((a, b) => {
        const gpA = Number(a.gamePriority || 0);
        const gpB = Number(b.gamePriority || 0);
        if (gpB !== gpA) return gpB - gpA;

        const roA = Number(a.releaseOrder || 0);
        const roB = Number(b.releaseOrder || 0);
        if (roB !== roA) return roB - roA;

        const coA = Number(a.codmunityOrder || 999999);
        const coB = Number(b.codmunityOrder || 999999);
        if (coA !== coB) return coA - coB;

        return (a.nome || '').localeCompare(b.nome || '');
      });

      res.json({ ok: true, weapons: publicWeapons });
    } catch (err) {
      console.error('Errore API weapons:', err);
      res.status(500).json({ ok: false, error: err.message, weapons: [] });
    }
  });

  /**
   * GET /api/loadout/attachments?weaponId=...
   * Restituisce accessori compatibili con l'arma specifica.
   */
  app.get('/api/loadout/attachments', async (req, res) => {
    try {
      const weaponId = req.query.weaponId;
      if (!weaponId) {
        return res.json({ ok: false, error: 'weaponId mancante', attachments: [] });
      }

      const attachmentsDB = readJSON('loadout-attachments.json');
      const compatibilityDB = readJSON('loadout-compatibility.json');

      // 1. Trova compatibilità valide per quest'arma
      const validCompatibility = compatibilityDB.filter(c => {
        const matchId = (c.armaId === weaponId || c.weaponId === weaponId);
        const isPublic = c.compatibile === true && c.verificato === true && c.bloccatoManuale !== true;
        const stateOk = !c.stato || c.stato === 'pubblico';
        return matchId && isPublic && stateOk;
      });

      if (validCompatibility.length === 0) {
        return res.json({ ok: true, attachments: [], message: 'Nessun accessorio compatibile' });
      }

      // 2. Estrai ID accessori permessi
      const allowedIds = validCompatibility.map(c => c.accessorioId || c.attachmentId);

      // 3. Filtra accessori reali
      const slotOrder = ['Ottica', 'Volata', 'Canna', 'Sottocanna', 'Caricatore', 'Impugnatura', 'Calcio', 'Laser', 'Mod fuoco'];
      const slotMap = {
        'Optic': 'Ottica', 'Muzzle': 'Volata', 'Barrel': 'Canna', 
        'Underbarrel': 'Sottocanna', 'Magazine': 'Caricatore', 
        'Rear Grip': 'Impugnatura', 'Stock': 'Calcio', 
        'Fire Mods': 'Mod fuoco', 'Laser': 'Laser'
      };

      const result = attachmentsDB
        .filter(a => {
          const isAllowed = allowedIds.includes(a.id);
          const isActive = a.attivo === true && a.verificato === true && a.bloccatoManuale !== true;
          const stateOk = !a.stato || a.stato === 'pubblico';
          return isAllowed && isActive && stateOk;
        })
        .map(a => ({
          ...a,
          slot: slotMap[a.tipo] || a.tipo || 'Altro',
          tipo: slotMap[a.tipo] || a.tipo || 'Altro'
        }))
        .sort((a, b) => {
          const slotA = slotOrder.indexOf(a.slot);
          const slotB = slotOrder.indexOf(b.slot);
          if (slotA !== slotB) return slotA - slotB;
          if (a.codmunityOrder && b.codmunityOrder) return a.codmunityOrder - b.codmunityOrder;
          return (a.nome || '').localeCompare(b.nome || '');
        });

      res.json({ ok: true, attachments: result });

    } catch (err) {
      console.error('Errore API attachments:', err);
      res.status(500).json({ ok: false, error: err.message, attachments: [] });
    }
  });

  // ==========================================
  // API ADMIN LOADOUT
  // ==========================================

  /**
   * GET /api/admin/loadout/database
   * Restituisce tutto il DB (armi, accessori, compatibilità) per la dashboard admin.
   */
  app.get('/api/admin/loadout/database', (req, res) => {
    try {
      const weapons = readJSON('loadout-weapons.json');
      const attachments = readJSON('loadout-attachments.json');
      const compatibility = readJSON('loadout-compatibility.json');
      res.json({ weapons, attachments, compatibility });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/admin/loadout/builds
   * Restituisce le build inviate dagli utenti.
   */
  app.get('/api/admin/loadout/builds', (req, res) => {
    try {
      const builds = readJSON('loadout-builds.json');
      res.json(Array.isArray(builds) ? builds : []);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/admin/loadout/sync-report
   * Restituisce il report dell'ultimo sync.
   */
  app.get('/api/admin/loadout/sync-report', (req, res) => {
    try {
      const report = readJSON('loadout-import-report.json');
      res.json(report || {});
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- AZIONI CRUD ADMIN ---

  const updateItemState = (type, id, updates) => {
    const fileMap = {
      weapon: 'loadout-weapons.json',
      attachment: 'loadout-attachments.json',
      compatibility: 'loadout-compatibility.json'
    };
    const fileName = fileMap[type];
    if (!fileName) throw new Error('Tipo non valido');

    const db = readJSON(fileName);
    const item = db.find(i => i.id === id);
    
    if (!item) throw new Error('Elemento non trovato');

    Object.assign(item, updates);
    writeJSON(fileName, db);
    return true;
  };

  app.post('/api/admin/loadout/publish', (req, res) => {
    try {
      const { type, id } = req.body;
      const updates = {
        stato: 'pubblico',
        verificato: true,
        verificata: true, // per armi
        attiva: true,     // per armi
        attivo: true,     // per accessori
        compatibile: true // per compatibilità
      };
      updateItemState(type, id, updates);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/admin/loadout/disable', (req, res) => {
    try {
      const { type, id } = req.body;
      const updates = {
        stato: 'disattivato',
        attiva: false,
        attivo: false,
        compatibile: false
      };
      updateItemState(type, id, updates);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/admin/loadout/block', (req, res) => {
    try {
      const { type, id, reason } = req.body;
      const updates = {
        stato: 'bloccato',
        bloccatoManuale: true,
        bloccatoMotivo: reason || 'Blocco manuale admin'
      };
      updateItemState(type, id, updates);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/admin/loadout/reactivate', (req, res) => {
    try {
      const { type, id } = req.body;
      const updates = {
        stato: 'pubblico',
        bloccatoManuale: false,
        bloccatoMotivo: '',
        attiva: true,
        attivo: true,
        compatibile: true
      };
      updateItemState(type, id, updates);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  app.delete('/api/admin/loadout/database/:type/:id', (req, res) => {
    try {
      const { type, id } = req.params;
      const fileMap = {
        weapon: 'loadout-weapons.json',
        attachment: 'loadout-attachments.json',
        compatibility: 'loadout-compatibility.json'
      };
      const fileName = fileMap[type];
      if (!fileName) throw new Error('Tipo non valido');

      let db = readJSON(fileName);
      const initialLen = db.length;
      db = db.filter(i => i.id !== id);

      if (db.length === initialLen) throw new Error('Elemento non trovato');

      writeJSON(fileName, db);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  // --- GESTIONE BUILD ---

  app.post('/api/admin/loadout/builds/approve', (req, res) => {
    try {
      const { id } = req.body;
      let builds = readJSON('loadout-builds.json');
      const build = builds.find(b => b.id === id);
      if (!build) throw new Error('Build non trovata');
      
      build.stato = 'approvato';
      writeJSON('loadout-builds.json', builds);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/admin/loadout/builds/reject', (req, res) => {
    try {
      const { id } = req.body;
      let builds = readJSON('loadout-builds.json');
      const build = builds.find(b => b.id === id);
      if (!build) throw new Error('Build non trovata');
      
      build.stato = 'rifiutato';
      writeJSON('loadout-builds.json', builds);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  app.delete('/api/admin/loadout/builds/:id', (req, res) => {
    try {
      const { id } = req.params;
      let builds = readJSON('loadout-builds.json');
      const initialLen = builds.length;
      builds = builds.filter(b => b.id !== id);
      
      if (builds.length === initialLen) throw new Error('Build non trovata');
      
      writeJSON('loadout-builds.json', builds);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  console.log('✅ Rotte Loadout registrate con successo.');
};
