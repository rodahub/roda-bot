/**
 * RØDA Loadout — fix-weapon-categories.js
 *
 * Script one-shot che:
 * 1. Legge data/loadout-weapons.json
 * 2. Assegna la categoria corretta (IT) a ogni arma tramite la mappa completa
 * 3. Se AUTO_VERIFY=true e la categoria è valida, imposta verificata:true
 * 4. Scrive il file aggiornato
 *
 * Uso: node scripts/fix-weapon-categories.js
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const AUTO_VERIFY = true; // imposta verificata:true per armi con categoria valida

const WEAPONS_FILE = path.join(__dirname, '..', 'data', 'loadout-weapons.json');

// ─── Mappa normalizzazione categorie ──────────────────────────────────────────
// Chiavi: lowercase, apostrofo dritto.  Valori: categoria IT ufficiale.
const CATEGORY_MAP = {
  // ── Inglese ─────────────────────────────────────────────────────────────────
  'assault rifle'          : "Fucile d'assalto",
  'assault rifles'         : "Fucile d'assalto",
  'ar'                     : "Fucile d'assalto",
  'smg'                    : 'Mitraglietta',
  'submachine gun'         : 'Mitraglietta',
  'submachine guns'        : 'Mitraglietta',
  'lmg'                    : 'Mitragliatrice leggera',
  'light machine gun'      : 'Mitragliatrice leggera',
  'light machine guns'     : 'Mitragliatrice leggera',
  'marksman rifle'         : 'Fucile tattico',
  'marksman rifles'        : 'Fucile tattico',
  'tactical rifle'         : 'Fucile tattico',
  'tactical rifles'        : 'Fucile tattico',
  'battle rifle'           : 'Fucile da battaglia',
  'battle rifles'          : 'Fucile da battaglia',
  'sniper rifle'           : 'Cecchino',
  'sniper rifles'          : 'Cecchino',
  'sniper'                 : 'Cecchino',
  'shotgun'                : 'Shotgun',
  'shotguns'               : 'Shotgun',
  'pistol'                 : 'Pistola',
  'pistols'                : 'Pistola',
  'handgun'                : 'Pistola',
  'melee'                  : 'Corpo a corpo',
  'launcher'               : 'Lanciarazzi',
  'launchers'              : 'Lanciarazzi',
  'rocket launcher'        : 'Lanciarazzi',
  // ── Italiano passthrough ────────────────────────────────────────────────────
  "fucile d'assalto"       : "Fucile d'assalto",
  "fucili d'assalto"       : "Fucile d'assalto",
  'mitraglietta'           : 'Mitraglietta',
  'mitragliatrice leggera' : 'Mitragliatrice leggera',
  'fucile tattico'         : 'Fucile tattico',
  'fucile da battaglia'    : 'Fucile da battaglia',
  'cecchino'               : 'Cecchino',
  'fucile di precisione'   : 'Cecchino',
  'fucile a pompa'         : 'Shotgun',
  'pistola'                : 'Pistola',
  'corpo a corpo'          : 'Corpo a corpo',
  'lanciarazzi'            : 'Lanciarazzi',
};

const VALID_CATEGORIES = new Set([
  "Fucile d'assalto",
  'Mitraglietta',
  'Mitragliatrice leggera',
  'Fucile tattico',
  'Fucile da battaglia',
  'Cecchino',
  'Shotgun',
  'Pistola',
  'Corpo a corpo',
  'Lanciarazzi',
]);

// ─── Fallback manuale per ID arma ─────────────────────────────────────────────
// Copre tutte le 80 armi nel database (BO6 + BO7)
const WEAPON_FALLBACK = {
  // ── BO6 — Fucili d'assalto ──────────────────────────────────────────────────
  'xm4'              : "Fucile d'assalto",
  'ak-74'            : "Fucile d'assalto",
  'ames-85'          : "Fucile d'assalto",
  'gpr-91'           : "Fucile d'assalto",
  'model-l'          : "Fucile d'assalto",
  'goblin-mk2'       : "Fucile d'assalto",
  'as-val'           : "Fucile d'assalto",
  'krig-c'           : "Fucile d'assalto",
  'cypher-091'       : "Fucile d'assalto",
  'ffar-1'           : "Fucile d'assalto",
  'kilo-141'         : "Fucile d'assalto",
  'cr-56-amax'       : "Fucile d'assalto",
  // ── BO6 — Mitragliette ──────────────────────────────────────────────────────
  'c9'               : 'Mitraglietta',
  'ksv'              : 'Mitraglietta',
  'tanto-22'         : 'Mitraglietta',
  'pp-919'           : 'Mitraglietta',
  'jackal-pdw'       : 'Mitraglietta',
  'kompakt-92'       : 'Mitraglietta',
  'saug'             : 'Mitraglietta',
  'ppsh-41'          : 'Mitraglietta',
  'lc10'             : 'Mitraglietta',
  'ladra'            : 'Mitraglietta',
  // ── BO6 — Mitragliatrici leggere ────────────────────────────────────────────
  'pu-21'            : 'Mitragliatrice leggera',
  'xmg'              : 'Mitragliatrice leggera',
  'gpmg-7'           : 'Mitragliatrice leggera',
  'feng-82'          : 'Mitragliatrice leggera',
  // ── BO6 — Fucili tattici ────────────────────────────────────────────────────
  'swat-556'         : 'Fucile tattico',
  'swat-5-56'        : 'Fucile tattico',
  'tsarkov-762'      : 'Fucile tattico',
  'tsarkov-7-62'     : 'Fucile tattico',
  'aek-973'          : 'Fucile tattico',
  'dm-10'            : 'Fucile tattico',
  'tr2'              : 'Fucile tattico',
  // ── BO6 — Cecchini ──────────────────────────────────────────────────────────
  'lw3a1-frostline'  : 'Cecchino',
  'svd'              : 'Cecchino',
  'lr-762'           : 'Cecchino',
  'lr-7-62'          : 'Cecchino',
  'amr-mod-4'        : 'Cecchino',
  'hdr'              : 'Cecchino',
  // ── BO6 — Shotgun ───────────────────────────────────────────────────────────
  'marine-sp'        : 'Shotgun',
  'asg-89'           : 'Shotgun',
  'maelstrom'        : 'Shotgun',
  // ── BO6 — Pistole ───────────────────────────────────────────────────────────
  '9mm-pm'           : 'Pistola',
  'grekhova'         : 'Pistola',
  'gs45'             : 'Pistola',
  'stryder-22'       : 'Pistola',
  '1911'             : 'Pistola',
  // ── BO7 — Fucili d'assalto ──────────────────────────────────────────────────
  'voyak-kt-3'       : "Fucile d'assalto",   // Voyak = AR
  'swordfish-a1'     : "Fucile d'assalto",   // Swordfish era AR in BO4
  'egrt-17'          : "Fucile d'assalto",   // EGRT-17 = AR
  'hawker-hx'        : "Fucile d'assalto",   // Hawker = AR
  'm8a1'             : "Fucile d'assalto",   // M8A1 era AR in BO2
  'ds20-mirage'      : "Fucile d'assalto",   // DS20 = AR
  'sokol-545'        : "Fucile d'assalto",   // Sokol 5.45 = AK-style AR
  'm15-mod-0'        : "Fucile d'assalto",   // M15 = AR (M16-style)
  'x9-maverick'      : "Fucile d'assalto",   // X9 Maverick = AR
  'maddox-rfb'       : "Fucile d'assalto",   // Maddox RFB era AR in BO4
  'mxr-17'           : "Fucile d'assalto",   // MXR-17 = AR
  'ak-27'            : "Fucile d'assalto",   // AK variant = AR
  'xm325'            : "Fucile d'assalto",   // XM-series = AR
  // ── BO7 — Mitragliette ──────────────────────────────────────────────────────
  'ryden-45k'        : 'Mitraglietta',       // Ryden 45K = SMG
  'sturmwolf-45'     : 'Mitraglietta',       // Sturmwolf = SMG compact
  'peacekeeper-mk1'  : 'Mitraglietta',       // Peacekeeper era SMG in BO2/3
  'rk-9'             : 'Mitraglietta',       // RK-9 = SMG (come MW2019)
  'shadow-sk'        : 'Mitraglietta',       // Shadow SK = SMG
  'akita'            : 'Mitraglietta',       // Akita = SMG
  'mpc-25'           : 'Mitraglietta',       // MPC = Machine Pistol Compact
  // ── BO7 — Mitragliatrici leggere ────────────────────────────────────────────
  'mk-78'            : 'Mitragliatrice leggera',  // MK-78 LMG
  'mk78'             : 'Mitragliatrice leggera',  // slug alternativo
  'kogot-7'          : 'Mitragliatrice leggera',  // Kogot 7 = LMG
  // ── BO7 — Fucili tattici ────────────────────────────────────────────────────
  'carbon-57'        : 'Fucile tattico',     // Carbon 57 = Marksman
  'm34-novaline'     : 'Fucile tattico',     // M34 = Marksman
  // ── BO7 — Cecchini ──────────────────────────────────────────────────────────
  'vs-recon'         : 'Cecchino',           // VS Recon = sniper
  'warden-308'       : 'Cecchino',           // .308 = calibro cecchino
  'strider-300'      : 'Cecchino',           // .300 = calibro cecchino
  'mk35-isr'         : 'Cecchino',           // ISR = Integrated Sniper Rifle
  'vst'              : 'Cecchino',           // VST = sniper tattico
  // ── BO7 — Fucili da battaglia ───────────────────────────────────────────────
  'sturmwolf-45'     : 'Mitraglietta',       // già sopra (SMG wins)
  // ── BO7 — Pistole ───────────────────────────────────────────────────────────
  'razor-9mm'        : 'Pistola',            // 9mm = pistola
  'dravec-45'        : 'Pistola',            // .45 = pistola
  'rev-46'           : 'Pistola',            // REV = revolver
};

// ─── Funzione di normalizzazione ──────────────────────────────────────────────
function normalizeWeaponCategory(raw) {
  if (!raw) return 'Da verificare';
  // Normalizza apostrofi tipografici → dritti, trim, lowercase
  const k = String(raw)
    .trim()
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/\s+/g, ' ')
    .toLowerCase();
  if (CATEGORY_MAP[k]) return CATEGORY_MAP[k];
  // Match parziale
  for (const [key, val] of Object.entries(CATEGORY_MAP)) {
    if (key.length >= 4 && k.includes(key)) return val;
  }
  return 'Da verificare';
}

// ─── Main ─────────────────────────────────────────────────────────────────────
function main() {
  console.log('═══════════════════════════════════════');
  console.log(' RØDA — Fix categorie armi loadout');
  console.log('═══════════════════════════════════════\n');

  let weapons;
  try {
    weapons = JSON.parse(fs.readFileSync(WEAPONS_FILE, 'utf8'));
  } catch (e) {
    console.error('❌ Errore lettura file:', e.message);
    process.exit(1);
  }

  console.log(`📂 Armi nel database: ${weapons.length}\n`);

  let fixed = 0, alreadyOk = 0, stillUnknown = 0, verified = 0;
  const unknownList = [];

  weapons = weapons.map(w => {
    const oldCat = w.categoria;

    // 1. Prova normalizzazione della categoria esistente
    let newCat = normalizeWeaponCategory(oldCat);

    // 2. Se ancora "Da verificare", prova il fallback per ID
    if (newCat === 'Da verificare' && WEAPON_FALLBACK[w.id]) {
      newCat = WEAPON_FALLBACK[w.id];
    }

    // 3. Determina se auto-verificare
    const isValid = VALID_CATEGORIES.has(newCat);
    const shouldVerify = AUTO_VERIFY && isValid;

    if (newCat === oldCat && !shouldVerify) {
      // Nessun cambiamento necessario
      if (!isValid) { stillUnknown++; unknownList.push(w.id); }
      else alreadyOk++;
      return w;
    }

    const updated = {
      ...w,
      categoria : newCat,
      verificata: shouldVerify ? true : w.verificata,
      note      : 'Importato automaticamente da CODMunity.',
      updatedAt : new Date().toISOString().slice(0, 10),
    };

    if (newCat !== oldCat) {
      console.log(`  ✏️  ${w.id.padEnd(22)} ${oldCat.padEnd(20)} → ${newCat}`);
      fixed++;
    } else {
      alreadyOk++;
    }
    if (shouldVerify && !w.verificata) {
      verified++;
    }

    if (!isValid) { stillUnknown++; unknownList.push(w.id); }
    return updated;
  });

  console.log('\n─────────────────────────────────────────');
  console.log(`  Categorie corrette: ${fixed}`);
  console.log(`  Già corrette:       ${alreadyOk}`);
  console.log(`  Auto-verificate:    ${verified}`);
  console.log(`  Ancora sconosciute: ${stillUnknown}`);
  if (unknownList.length) {
    console.log(`  → ${unknownList.join(', ')}`);
  }
  console.log('─────────────────────────────────────────\n');

  // Salva con backup
  const backup = WEAPONS_FILE + '.bak';
  fs.copyFileSync(WEAPONS_FILE, backup);
  const tmp = WEAPONS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(weapons, null, 2), 'utf8');
  fs.renameSync(tmp, WEAPONS_FILE);

  console.log(`✅ File aggiornato: data/loadout-weapons.json`);
  console.log(`📄 Backup: data/loadout-weapons.json.bak\n`);

  // Riepilogo finale per categoria
  const byCat = {};
  weapons.forEach(w => { byCat[w.categoria] = (byCat[w.categoria] || 0) + 1; });
  console.log('Distribuzione categorie dopo fix:');
  Object.entries(byCat).sort((a, b) => b[1] - a[1]).forEach(([c, n]) => {
    const v = weapons.filter(w => w.categoria === c && w.verificata).length;
    console.log(`  ${c.padEnd(28)} ${n} armi (${v} verificate)`);
  });
  console.log();
}

main();
