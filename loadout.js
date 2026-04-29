// SOSTITUISCI LA VECCHIA ROTTA CON QUESTA
app.get('/api/loadout/attachments', async (req, res) => {
  try {
    const weaponId = req.query.weaponId;
    if (!weaponId) {
      return res.json({ ok: false, error: 'weaponId mancante', attachments: [] });
    }

    const attachmentsDB = require('./data/loadout-attachments.json');
    const compatibilityDB = require('./data/loadout-compatibility.json');

    // 1. Trova tutte le compatibilità per quest'arma
    const validCompatibility = compatibilityDB.filter(c => {
      // Supporta sia armaId che weaponId
      const matchId = (c.armaId === weaponId || c.weaponId === weaponId);
      const isPublic = c.compatibile === true && c.verificato === true && c.bloccatoManuale !== true;
      const stateOk = !c.stato || c.stato === 'pubblico';
      return matchId && isPublic && stateOk;
    });

    if (validCompatibility.length === 0) {
      return res.json({ ok: true, attachments: [], message: 'Nessun accessorio compatibile trovato' });
    }

    // 2. Estrai gli ID degli accessori compatibili
    const allowedAttachmentIds = validCompatibility.map(c => c.accessorioId || c.attachmentId);

    // 3. Filtra gli accessori reali
    const publicAttachments = attachmentsDB.filter(a => {
      const isAllowed = allowedAttachmentIds.includes(a.id);
      const isActive = a.attivo === true && a.verificato === true && a.bloccatoManuale !== true;
      const stateOk = !a.stato || a.stato === 'pubblico';
      return isAllowed && isActive && stateOk;
    });

    // 4. Normalizza slot e ordina
    const slotOrder = ['Ottica', 'Volata', 'Canna', 'Sottocanna', 'Caricatore', 'Impugnatura', 'Calcio', 'Laser', 'Mod fuoco'];
    const slotMap = {
      'Optic': 'Ottica', 'Muzzle': 'Volata', 'Barrel': 'Canna', 
      'Underbarrel': 'Sottocanna', 'Magazine': 'Caricatore', 
      'Rear Grip': 'Impugnatura', 'Stock': 'Calcio', 
      'Fire Mods': 'Mod fuoco', 'Laser': 'Laser'
    };

    const result = publicAttachments.map(a => ({
      ...a,
      slot: slotMap[a.tipo] || a.tipo || 'Altro', // Usa 'tipo' come source dello slot
      tipo: slotMap[a.tipo] || a.tipo || 'Altro'   // Normalizza anche il campo tipo
    })).sort((a, b) => {
      const slotA = slotOrder.indexOf(a.slot);
      const slotB = slotOrder.indexOf(b.slot);
      if (slotA !== slotB) return slotA - slotB;
      if (a.codmunityOrder && b.codmunityOrder) return a.codmunityOrder - b.codmunityOrder;
      return (a.nome || '').localeCompare(b.nome || '');
    });

    res.json({ ok: true, attachments: result });

  } catch (err) {
    console.error('Errore API accessori:', err);
    res.status(500).json({ ok: false, error: err.message, attachments: [] });
  }
});
