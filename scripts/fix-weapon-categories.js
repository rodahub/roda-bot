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
  'voyak-kt-3'       : "Fucile d'assalto",
  'egrt-17'          : "Fucile d'assalto",
  'm15-mod-0'        : "Fucile d'assalto",
  'x9-maverick'      : "Fucile d'assalto",
  'maddox-rfb'       : "Fucile d'assalto",
  'mxr-17'           : "Fucile d'assalto",
  'ak-27'            : "Fucile d'assalto",
  'sokol-545'        : "Fucile d'assalto",
  'peacekeeper-mk1'  : "Fucile d'assalto",
  'kogot-7'          : "Fucile d'assalto",
  'mk35-isr'         : "Fucile d'assalto",
  // ── BO7 — Mitragliette ──────────────────────────────────────────────────────
  'ryden-45k'        : 'Mitraglietta',
  'sturmwolf-45'     : 'Mitraglietta',
  'rk-9'             : 'Mitraglietta',
  'vst'              : 'Mitraglietta',
  'carbon-57'        : 'Mitraglietta',
  'razor-9mm'        : 'Mitraglietta',
  'rev-46'           : 'Mitraglietta',
  'mpc-25'           : 'Mitraglietta',
  'dravec-45'        : 'Mitraglietta',
  // ── BO7 — Mitragliatrici leggere ────────────────────────────────────────────
  'mk-78'            : 'Mitragliatrice leggera',
  'mk78'             : 'Mitragliatrice leggera',
  'xm325'            : 'Mitragliatrice leggera',
  // ── BO7 — Fucili tattici ────────────────────────────────────────────────────
  'm8a1'             : 'Fucile tattico',
  'swordfish-a1'     : 'Fucile tattico',
  'warden-308'       : 'Fucile tattico',
  'ds20-mirage'      : 'Fucile tattico',
  // ── BO7 — Cecchini ──────────────────────────────────────────────────────────
  'vs-recon'         : 'Cecchino',
  'strider-300'      : 'Cecchino',
  'shadow-sk'        : 'Cecchino',
  'hawker-hx'        : 'Cecchino',
  'm34-novaline'     : 'Cecchino',
  // ── BO7 — Shotgun ───────────────────────────────────────────────────────────
  'akita'            : 'Shotgun',
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
