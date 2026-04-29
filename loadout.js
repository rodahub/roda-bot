'use strict';

/**
 * RØDA Loadout routes.
 *
 * Questo modulo esporta registerLoadoutRoutes(app), ma installa anche un
 * auto-hook sicuro su Express: se server.js fa solo require('./loadout') senza
 * chiamare la funzione, le rotte vengono registrate appena app.listen() parte.
 * Così evitiamo sia il crash app is not defined sia i click a vuoto su /loadout.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');

function readJSON(filename, fallback = []) {
  const filePath = path.join(DATA_DIR, filename);

  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch (error) {
    console.error(`[loadout] Errore lettura ${filename}:`, error.message);
    return fallback;
  }
}

function writeJSON(filename, data) {
  const filePath = path.join(DATA_DIR, filename);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function clean(value) {
  return String(value || '').trim();
}

function lower(value) {
  return clean(value).toLowerCase();
}

function isBlockedState(stato) {
  return ['bloccato', 'disattivato', 'da_controllare'].includes(lower(stato));
}

function isPublicWeapon(weapon) {
  return Boolean(
    weapon &&
    weapon.attiva === true &&
    weapon.verificata === true &&
    weapon.bloccatoManuale !== true &&
    !isBlockedState(weapon.stato)
  );
}

function isPublicAttachment(attachment) {
  return Boolean(
    attachment &&
    attachment.attivo === true &&
    attachment.verificato === true &&
    attachment.bloccatoManuale !== true &&
    !isBlockedState(attachment.stato)
  );
}

function isPublicCompatibility(row) {
  return Boolean(
    row &&
    row.compatibile === true &&
    row.verificato === true &&
    row.bloccatoManuale !== true &&
    !isBlockedState(row.stato)
  );
}

const SLOT_ORDER = [
  'Ottica',
  'Volata',
  'Canna',
  'Sottocanna',
  'Caricatore',
  'Impugnatura',
  'Calcio',
  'Laser',
  'Mod fuoco'
];

const SLOT_MAP = new Map([
  ['optic', 'Ottica'],
  ['ottica', 'Ottica'],
  ['muzzle', 'Volata'],
  ['volata', 'Volata'],
  ['barrel', 'Canna'],
  ['canna', 'Canna'],
  ['underbarrel', 'Sottocanna'],
  ['sottocanna', 'Sottocanna'],
  ['magazine', 'Caricatore'],
  ['caricatore', 'Caricatore'],
  ['rear grip', 'Impugnatura'],
  ['rear-grip', 'Impugnatura'],
  ['impugnatura', 'Impugnatura'],
  ['stock', 'Calcio'],
  ['calcio', 'Calcio'],
  ['laser', 'Laser'],
  ['fire mods', 'Mod fuoco'],
  ['fire-mods', 'Mod fuoco'],
  ['fire mod', 'Mod fuoco'],
  ['mod fuoco', 'Mod fuoco']
]);

function normalizeSlot(value) {
  const raw = clean(value).replace(/\s+/g, ' ');
  if (!raw) return '';
  return SLOT_MAP.get(raw.toLowerCase()) || raw;
}

function sortWeaponsForLoadout(a, b) {
  const gpA = Number(a.gamePriority || 0);
  const gpB = Number(b.gamePriority || 0);
  if (gpB !== gpA) return gpB - gpA;

  const roA = Number(a.releaseOrder || 0);
  const roB = Number(b.releaseOrder || 0);
  if (roB !== roA) return roB - roA;

  const coA = Number(a.codmunityOrder || 999999);
  const coB = Number(b.codmunityOrder || 999999);
  if (coA !== coB) return coA - coB;

  const da = new Date(a.discoveredAt || 0).getTime();
  const db = new Date(b.discoveredAt || 0).getTime();
  if (db !== da) return db - da;

  return clean(a.nome).localeCompare(clean(b.nome), 'it');
}

function sortAttachmentsForLoadout(a, b) {
  const slotA = normalizeSlot(a.slot || a.tipo);
  const slotB = normalizeSlot(b.slot || b.tipo);
  const indexA = SLOT_ORDER.indexOf(slotA);
  const indexB = SLOT_ORDER.indexOf(slotB);
  const safeA = indexA === -1 ? 999 : indexA;
  const safeB = indexB === -1 ? 999 : indexB;
  if (safeA !== safeB) return safeA - safeB;

  const orderA = Number(a.codmunityOrder || 999999);
  const orderB = Number(b.codmunityOrder || 999999);
  if (orderA !== orderB) return orderA - orderB;

  return clean(a.nome).localeCompare(clean(b.nome), 'it');
}

function getRecordId(record) {
  return clean(record && (record.id || record._id));
}

function getWeaponIdFromCompatibility(row) {
  return clean(row && (row.armaId || row.weaponId || row.weapon || row.arma));
}

function getAttachmentIdFromCompatibility(row) {
  return clean(row && (row.accessorioId || row.attachmentId || row.attachment || row.accessorio));
}

function findItem(list, id) {
  const target = lower(id);
  return list.find(item => lower(getRecordId(item)) === target) || null;
}

function getDatabase() {
  return {
    weapons: readJSON('loadout-weapons.json', []),
    attachments: readJSON('loadout-attachments.json', []),
    compatibility: readJSON('loadout-compatibility.json', []),
    builds: readJSON('loadout-builds.json', []),
    importReport: readJSON('loadout-import-report.json', {}),
    discoveryReport: readJSON('codmunity-discovery-report.json', {})
  };
}

function fileForType(type) {
  const normalized = lower(type);
  if (['weapon', 'weapons', 'arma', 'armi'].includes(normalized)) return 'loadout-weapons.json';
  if (['attachment', 'attachments', 'accessorio', 'accessori'].includes(normalized)) return 'loadout-attachments.json';
  if (['compatibility', 'compatibilita', 'compatibilità'].includes(normalized)) return 'loadout-compatibility.json';
  return '';
}

function updateItem(type, id, updater) {
  const filename = fileForType(type);
  if (!filename) throw new Error('Tipo non valido');

  const list = readJSON(filename, []);
  const target = lower(id);
  const index = list.findIndex(item => lower(getRecordId(item)) === target);
  if (index === -1) throw new Error('Elemento non trovato');

  list[index] = updater({ ...list[index] });
  writeJSON(filename, list);
  return list[index];
}

function deleteItem(type, id) {
  const filename = fileForType(type);
  if (!filename) throw new Error('Tipo non valido');

  const list = readJSON(filename, []);
  const target = lower(id);
  const next = list.filter(item => lower(getRecordId(item)) !== target);
  if (next.length === list.length) throw new Error('Elemento non trovato');

  writeJSON(filename, next);
  return true;
}

function registerLoadoutRoutes(app) {
  if (!app || typeof app.get !== 'function') {
    throw new Error('registerLoadoutRoutes: istanza Express app non valida');
  }

  if (app.__rodaLoadoutRoutesRegistered) {
    return;
  }

  Object.defineProperty(app, '__rodaLoadoutRoutesRegistered', {
    value: true,
    enumerable: false,
    configurable: false
  });

  // Pagina pubblica Loadout: risolve i menu che puntano a /loadout.
  app.get('/loadout', (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'loadout.html'));
  });

  app.get('/api/loadout/weapons', (req, res) => {
    try {
      const weapons = readJSON('loadout-weapons.json', [])
        .filter(isPublicWeapon)
        .sort(sortWeaponsForLoadout);

      res.json({ ok: true, weapons });
    } catch (error) {
      console.error('[loadout] Errore /api/loadout/weapons:', error);
      res.status(500).json({ ok: false, weapons: [], error: error.message });
    }
  });

  app.get('/api/loadout/attachments', (req, res) => {
    try {
      const weaponId = clean(req.query.weaponId || req.query.armaId);
      if (!weaponId) {
        return res.json({ ok: true, attachments: [], message: 'weaponId mancante' });
      }

      const attachments = readJSON('loadout-attachments.json', []);
      const compatibility = readJSON('loadout-compatibility.json', []);
      const weaponKey = lower(weaponId);

      const rows = compatibility.filter(row =>
        lower(getWeaponIdFromCompatibility(row)) === weaponKey && isPublicCompatibility(row)
      );

      const rowByAttachmentId = new Map();
      for (const row of rows) {
        const attachmentId = lower(getAttachmentIdFromCompatibility(row));
        if (attachmentId) rowByAttachmentId.set(attachmentId, row);
      }

      const result = attachments
        .filter(attachment => rowByAttachmentId.has(lower(getRecordId(attachment))) && isPublicAttachment(attachment))
        .map(attachment => {
          const row = rowByAttachmentId.get(lower(getRecordId(attachment))) || {};
          const slot = normalizeSlot(row.slot || attachment.slot || attachment.tipo);

          return {
            ...attachment,
            id: getRecordId(attachment),
            slot,
            tipo: slot,
            codmunityOrder: Number(row.codmunityOrder || attachment.codmunityOrder || 999999)
          };
        })
        .filter(attachment => SLOT_ORDER.includes(attachment.slot))
        .sort(sortAttachmentsForLoadout);

      res.json({ ok: true, attachments: result });
    } catch (error) {
      console.error('[loadout] Errore /api/loadout/attachments:', error);
      res.status(500).json({ ok: false, attachments: [], error: error.message });
    }
  });

  app.get('/api/admin/loadout/database', (req, res) => {
    try {
      const db = getDatabase();
      res.json({
        ok: true,
        weapons: db.weapons,
        attachments: db.attachments,
        compatibility: db.compatibility
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.get('/api/admin/loadout/builds', (req, res) => {
    try {
      res.json({ ok: true, builds: readJSON('loadout-builds.json', []) });
    } catch (error) {
      res.status(500).json({ ok: false, builds: [], error: error.message });
    }
  });

  app.get('/api/admin/loadout/sync-report', (req, res) => {
    try {
      res.json({
        ok: true,
        importReport: readJSON('loadout-import-report.json', {}),
        discoveryReport: readJSON('codmunity-discovery-report.json', {})
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post('/api/admin/loadout/publish', (req, res) => {
    try {
      const { type, id } = req.body || {};
      const item = updateItem(type, id, item => ({
        ...item,
        stato: 'pubblico',
        verificata: true,
        verificato: true,
        attiva: true,
        attivo: true,
        compatibile: item.compatibile !== false
      }));

      res.json({ ok: true, item });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.post('/api/admin/loadout/disable', (req, res) => {
    try {
      const { type, id } = req.body || {};
      const item = updateItem(type, id, item => ({
        ...item,
        stato: 'disattivato',
        attiva: false,
        attivo: false,
        compatibile: false
      }));

      res.json({ ok: true, item });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.post('/api/admin/loadout/block', (req, res) => {
    try {
      const { type, id, reason } = req.body || {};
      const item = updateItem(type, id, item => ({
        ...item,
        stato: 'bloccato',
        bloccatoManuale: true,
        bloccatoMotivo: clean(reason) || 'Blocco manuale admin'
      }));

      res.json({ ok: true, item });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.post('/api/admin/loadout/reactivate', (req, res) => {
    try {
      const { type, id } = req.body || {};
      const item = updateItem(type, id, item => ({
        ...item,
        stato: 'pubblico',
        bloccatoManuale: false,
        bloccatoMotivo: '',
        attiva: true,
        attivo: true,
        compatibile: item.compatibile !== false,
        verificata: true,
        verificato: true
      }));

      res.json({ ok: true, item });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.delete('/api/admin/loadout/database/:type/:id', (req, res) => {
    try {
      deleteItem(req.params.type, req.params.id);
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.post('/api/admin/loadout/builds/approve', (req, res) => {
    try {
      const id = clean((req.body || {}).id);
      const builds = readJSON('loadout-builds.json', []);
      const build = findItem(builds, id);
      if (!build) throw new Error('Build non trovata');
      build.stato = 'approvato';
      writeJSON('loadout-builds.json', builds);
      res.json({ ok: true, build });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.post('/api/admin/loadout/builds/reject', (req, res) => {
    try {
      const id = clean((req.body || {}).id);
      const builds = readJSON('loadout-builds.json', []);
      const build = findItem(builds, id);
      if (!build) throw new Error('Build non trovata');
      build.stato = 'rifiutato';
      writeJSON('loadout-builds.json', builds);
      res.json({ ok: true, build });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  app.delete('/api/admin/loadout/builds/:id', (req, res) => {
    try {
      const id = lower(req.params.id);
      const builds = readJSON('loadout-builds.json', []);
      const next = builds.filter(build => lower(getRecordId(build)) !== id);
      if (next.length === builds.length) throw new Error('Build non trovata');
      writeJSON('loadout-builds.json', next);
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  console.log('✅ Rotte RØDA Loadout registrate.');
}

function installAutoRegisterHook() {
  try {
    const express = require('express');
    const proto = express && express.application;

    if (!proto || proto.__rodaLoadoutAutoRegisterPatched) {
      return;
    }

    const originalListen = proto.listen;

    if (typeof originalListen !== 'function') {
      return;
    }

    Object.defineProperty(proto, '__rodaLoadoutAutoRegisterPatched', {
      value: true,
      enumerable: false,
      configurable: false
    });

    proto.listen = function patchedLoadoutListen(...args) {
      try {
        registerLoadoutRoutes(this);
      } catch (error) {
        console.error('[loadout] Auto-registrazione rotte fallita:', error.message);
      }

      return originalListen.apply(this, args);
    };
  } catch (error) {
    console.error('[loadout] Hook auto-register non installato:', error.message);
  }
}

module.exports = registerLoadoutRoutes;
installAutoRegisterHook();
