const fs = require('fs');
const path = require('path');

const ROOT = __dirname;

const STORAGE_DIR =
  process.env.STORAGE_DIR ||
  process.env.RAILWAY_VOLUME_MOUNT_PATH ||
  path.join(ROOT, 'storage-data');

const DATA_FILE = path.join(STORAGE_DIR, 'data.json');
const TEAMS_FILE = path.join(STORAGE_DIR, 'teams.json');
const BACKUP_DIR = path.join(STORAGE_DIR, 'backups');
const DATA_BACKUP_FILE = path.join(BACKUP_DIR, 'data.latest.json');
const TEAMS_BACKUP_FILE = path.join(BACKUP_DIR, 'teams.latest.json');

const AUDIT_LOG_FILE = path.join(STORAGE_DIR, 'audit-log.json');
const AUDIT_BACKUP_FILE = path.join(BACKUP_DIR, 'audit-log.latest.json');

const ARCHIVES_DIR = path.join(STORAGE_DIR, 'archives');
const UPLOADS_DIR = path.join(STORAGE_DIR, 'uploads');

const FIXED_TOURNAMENT_NAME = 'RØDA CUP';
const MAX_TEAMS = 16;
const PLAYERS_PER_TEAM = 3;

const TOURNAMENT_STATES = {
  DRAFT: 'bozza',
  REGISTRATIONS_OPEN: 'iscrizioni_aperte',
  REGISTRATIONS_CLOSED: 'iscrizioni_chiuse',
  RUNNING: 'torneo_in_corso',
  FINISHED: 'torneo_finito'
};

const MATCH_STATES = {
  NOT_STARTED: 'non_iniziato',
  RUNNING: 'in_corso',
  COMPLETED: 'completato',
  FORCED: 'forzato'
};

const TEAM_MATCH_STATES = {
  NOT_SUBMITTED: 'non_inviato',
  PENDING: 'in_attesa',
  APPROVED: 'approvato',
  REJECTED: 'rifiutato',
  MANUAL: 'inserito_manualmente',
  ABSENT: 'assente'
};

console.log('RAILWAY_VOLUME_MOUNT_PATH:', process.env.RAILWAY_VOLUME_MOUNT_PATH || '(non presente)');
console.log('STORAGE_DIR attuale:', STORAGE_DIR);
console.log('DATA_FILE attuale:', DATA_FILE);
console.log('TEAMS_FILE attuale:', TEAMS_FILE);
console.log('UPLOADS_DIR attuale:', UPLOADS_DIR);

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeText(value) {
  return String(value || '').trim();
}

function sanitizePositiveInteger(value, fallback = 1, max = 9999) {
  const num = Number(value);

  if (!Number.isInteger(num) || num <= 0) {
    return fallback;
  }

  return Math.min(num, max);
}

function getNowIso() {
  return new Date().toISOString();
}

function getDefaultProjectSettings() {
  return {
    brandName: 'RØDA',
    tournamentName: FIXED_TOURNAMENT_NAME,
    supportContact: '',
    premiumMode: false,
    setupCompleted: false
  };
}

function getDefaultTournamentSettings() {
  return {
    tournamentName: FIXED_TOURNAMENT_NAME,
    totalMatches: 3,
    playersPerTeam: PLAYERS_PER_TEAM,
    maxTeams: MAX_TEAMS,
    autoNextMatch: true,
    lockedRules: true,
    lockedPoints: true,
    createdAt: null,
    createdBy: '',
    lastConfiguredAt: null,
    lastConfiguredBy: ''
  };
}

function getDefaultTournamentLifecycle() {
  return {
    state: TOURNAMENT_STATES.DRAFT,
    registrationsOpen: false,
    tournamentStarted: false,
    tournamentFinished: false,
    createdAt: null,
    createdBy: '',
    registrationsOpenedAt: null,
    registrationsOpenedBy: '',
    registrationsClosedAt: null,
    registrationsClosedBy: '',
    startedAt: null,
    startedBy: '',
    finishedAt: null,
    finishedBy: '',
    lastStateChangeAt: null,
    lastStateChangeBy: ''
  };
}

function getDefaultTournamentMessages() {
  return {
    openRegistrationsAnnouncement:
      '@everyone\n\n' +
      '**🏆 ISCRIZIONI RØDA CUP APERTE**\n\n' +
      'Le iscrizioni al torneo sono aperte.\n' +
      'Iscrivetevi nel canale dedicato e controllate la lista team per verificare che il vostro team sia stato registrato correttamente.\n\n' +
      '**Leggete il regolamento ufficiale prima dell’inizio del torneo.**\n\n' +
      'Slot massimi: **16 team**\n' +
      'Formato: **Terzetti**',

    closeRegistrationsAnnouncement:
      '@everyone\n\n' +
      '**🔒 ISCRIZIONI RØDA CUP CHIUSE**\n\n' +
      'I team registrati sono confermati.\n' +
      'Lo staff sta preparando l’inizio del torneo.',

    tournamentStartAnnouncement:
      '@everyone\n\n' +
      '**🏆 RØDA CUP INIZIATA**\n\n' +
      'Si parte dal **Match 1**.\n\n' +
      'Ogni team deve restare nella propria vocale ufficiale.\n' +
      'Il codice lobby verrà mandato nelle stanze team.\n' +
      'A fine match inviate il risultato dal pannello nella vostra stanza.',

    nextMatchAnnouncement:
      '**✅ MATCH {match} COMPLETATO**\n\n' +
      'Tutti i risultati sono stati registrati.\n' +
      'Si passa al **Match {nextMatch}**.',

    forcedNextMatchAnnouncement:
      '**⏭️ MATCH {match} CHIUSO DALLO STAFF**\n\n' +
      'Lo staff ha chiuso manualmente il match.\n' +
      'Si passa al **Match {nextMatch}**.',

    tournamentFinishedAnnouncement:
      '@everyone\n\n' +
      '**🏆 RØDA CUP TERMINATA**\n\n' +
      'Il torneo è concluso.\n' +
      'La classifica finale verrà pubblicata dallo staff.',

    lobbyInfoMessage:
      '**🎮 CODICE LOBBY**\n\n' +
      'Codice: **{code}**\n\n' +
      'Entrate appena possibile e restate nella vostra vocale ufficiale.',

    generalReminder:
      '@everyone\n\n' +
      '**📌 PROMEMORIA RØDA CUP**\n\n' +
      'Leggete il regolamento ufficiale.\n' +
      'Durante il torneo dovete restare nelle vocali ufficiali.\n' +
      'I risultati vanno inviati dal pannello nella stanza del vostro team.',

    regulationText:
      '🏆 RØDA CUP\n\n' +
      '👥 FORMATO TORNEO\n\n' +
      'Il torneo si svolge in modalità TERZETTI (TRIO).\n\n' +
      'Ogni squadra deve essere composta da 3 giocatori titolari.\n' +
      'Non sono ammessi quartetti o cambi non autorizzati dallo staff.\n\n' +

      '🎮 OBBLIGO UTILIZZO DISCORD\n\n' +
      'Per tutta la durata dell’evento è obbligatorio:\n\n' +
      '• Utilizzare le stanze vocali Discord ufficiali\n' +
      '• Aprire una stanza temporanea Trio nella sezione RØDA HUB\n' +
      '• Restare presenti in vocale per tutto il torneo\n\n' +
      '⚠️ La mancata presenza in stanza comporta penalità o annullamento del match.\n\n' +

      '🚫 RESTRIZIONI EQUIPAGGIAMENTO\n\n' +
      'È severamente vietato l’utilizzo di:\n\n' +
      '❌ Mine\n' +
      '❌ Claymore\n' +
      '❌ Psicogranate\n' +
      '❌ Granate Stordenti\n' +
      '❌ Lacrimogeni\n' +
      '❌ Scarica Elettrica\n' +
      '❌ Skin Terminator\n\n' +

      '⚖️ SISTEMA DISCIPLINARE\n\n' +
      '• 1ª infrazione → Richiamo ufficiale\n' +
      '• 2ª infrazione → Sottrazione punti\n' +
      '• 3ª infrazione → Squalifica dal torneo\n\n' +
      'Lo staff può applicare sanzioni immediate in caso di violazioni gravi.\n\n' +

      '🔫 ARMI CONSENTITE\n\n' +
      '✅ Solo ARMI META approvate dallo staff\n' +
      '🎯 È ammesso 1 SOLO CECCHINO per team\n\n' +
      '⚠️ Violazioni:\n\n' +
      '• Utilizzo di 2 cecchini → Penalità immediata\n' +
      '• Uso di armi non consentite → Kill annullate o sottrazione punti\n\n' +

      '🏆 SISTEMA DI PUNTEGGIO\n\n' +
      '🔹 Kill di squadra\n\n' +
      '👉 Si sommano tutte le kill del team\n\n' +
      '📊 Formula ufficiale:\n\n' +
      '(Kill totali di squadra) + Bonus Posizionamento\n\n' +
      '🔹 Bonus Posizionamento\n\n' +
      '🥇 1° Posto → 10 punti\n' +
      '🥈 2° Posto → 6 punti\n' +
      '🥉 3° Posto → 5 punti\n' +
      '4° Posto → 4 punti\n' +
      '5° Posto → 3 punti\n' +
      '6° Posto → 2 punti\n' +
      '7° Posto → 1 punto\n' +
      '8° Posto → 1 punto\n\n' +

      '📸 VALIDAZIONE RISULTATI OBBLIGATORIA\n\n' +
      'Ogni team deve inviare il risultato dal pannello nella propria stanza ufficiale.\n\n' +
      'Lo screenshot deve mostrare chiaramente:\n\n' +
      '• Classifica finale\n' +
      '• Numero totale kill di squadra\n' +
      '• Posizionamento\n\n' +
      'Nel messaggio è obbligatorio indicare:\n\n' +
      '• Nome Team\n' +
      '• Posizione ottenuta\n' +
      '• Kill totali di squadra\n\n' +
      'Se una di queste informazioni manca, il risultato non verrà convalidato.\n\n' +

      '✅ ESEMPIO CORRETTO INVIO RISULTATO\n\n' +
      'Team: RØDA Black\n' +
      'Posizione: 2° Posto\n' +
      'Kill Totali Squadra: 18\n\n' +

      '⚖️ FAIR PLAY\n\n' +
      '• Vietato glitch, exploit o vantaggi illeciti\n' +
      '• Vietato comportamento tossico o antisportivo\n' +
      '• Rispetto obbligatorio verso staff e avversari\n' +
      '• Le decisioni dello staff sono definitive'
  };
}

const REMINDER_TYPES = ['iscrizioni', 'regolamento', 'risultati'];

const REMINDER_INTERVAL_OPTIONS = [1, 2, 3, 4, 6, 8, 12, 24, 48];

function getDefaultAutomaticReminders() {
  return {
    masterEnabled: true,
    reminders: {
      iscrizioni: {
        enabled: true,
        intervalHours: 12,
        message:
          '🎮 **RØDA CUP — ISCRIZIONI APERTE**\n\n' +
          'Iscrivi il tuo team in {canale_iscrizioni} cliccando su **✋ Iscriviti**.\n' +
          '📊 Slot disponibili: **{team_iscritti}**\n\n' +
          'Leggi il regolamento ufficiale in {canale_regolamento} prima di registrarti.',
        lastSentAt: null
      },
      regolamento: {
        enabled: true,
        intervalHours: 24,
        message:
          '📜 **PROMEMORIA REGOLAMENTO RØDA CUP**\n\n' +
          'Prima di giocare, leggi il regolamento ufficiale in {canale_regolamento}.\n\n' +
          'Le decisioni dello staff sono definitive.',
        lastSentAt: null
      },
      risultati: {
        enabled: true,
        intervalHours: 2,
        message:
          '📸 **PROMEMORIA INVIO RISULTATI**\n\n' +
          'Per inviare il risultato del match: vai in {canale_risultati} e premi **📤 Invia risultato**.\n' +
          'Allega lo screenshot della partita seguendo le istruzioni del bot.\n\n' +
          'Match in corso: **{match_corrente}/{match_totali}**',
        lastSentAt: null
      }
    }
  };
}

function getDefaultBotSettings() {
  return {
    registerPanelMessageId: null,
    registerPanelChannelId: '',
    registrationStatusMessageId: null,

    resultsPanelMessageId: null,
    resultsPanelChannelId: '',

    roomsCategoryId: '',
    generalChannelId: '',
    rulesChannelId: '',
    lobbyChannelId: '',
    leaderboardChannelId: '',

    leaderboardMessageId: null,
    leaderboardGraphicMessageId: null,
    topFraggerGraphicMessageId: null
  };
}

function getDefaultData() {
  return {
    currentMatch: 1,

    tournamentLifecycle: getDefaultTournamentLifecycle(),
    tournamentSettings: getDefaultTournamentSettings(),
    tournamentMessages: getDefaultTournamentMessages(),
    automaticReminders: getDefaultAutomaticReminders(),

    matches: {},

    pending: {},
    tempSubmit: {},
    resultSubmissions: {},

    scores: {},
    fragger: {},

    leaderboardMessageId: null,
    leaderboardGraphicMessageId: null,
    topFraggerGraphicMessageId: null,

    registrationStatusMessageId: null,
    registrationClosedAnnounced: false,
    registrationMaxTeams: MAX_TEAMS,
    registrationStatusTitle: '📋 Slot Team Registrati',
    registrationStatusText: 'Lista team attualmente registrati nel torneo.',

    projectSettings: getDefaultProjectSettings(),
    botSettings: getDefaultBotSettings()
  };
}

function getDefaultTeams() {
  return {};
}

function getDefaultAuditLog() {
  return [];
}

function getDefaultTeamMatchState(teamName, matchNumber) {
  return {
    team: sanitizeText(teamName),
    matchNumber: sanitizePositiveInteger(matchNumber, 1, 50),
    status: TEAM_MATCH_STATES.NOT_SUBMITTED,
    kills: [0, 0, 0],
    totalKills: 0,
    placement: 0,
    points: 0,
    source: '',
    pendingId: null,
    image: '',
    submittedBy: '',
    approvedBy: '',
    rejectedBy: '',
    manualBy: '',
    absentBy: '',
    updatedAt: '',
    createdAt: getNowIso()
  };
}

function getDefaultMatch(matchNumber) {
  return {
    matchNumber: sanitizePositiveInteger(matchNumber, 1, 50),
    status: MATCH_STATES.NOT_STARTED,
    startedAt: null,
    completedAt: null,
    forcedAt: null,
    closedBy: '',
    autoAdvanced: false,
    teams: {}
  };
}

function isFinalTeamMatchStatus(status) {
  return [
    TEAM_MATCH_STATES.APPROVED,
    TEAM_MATCH_STATES.MANUAL,
    TEAM_MATCH_STATES.ABSENT
  ].includes(status);
}

function normalizeProjectSettings(value) {
  const base = getDefaultProjectSettings();
  const safe = isObject(value) ? value : {};

  base.brandName = sanitizeText(safe.brandName || base.brandName) || base.brandName;
  base.tournamentName = FIXED_TOURNAMENT_NAME;
  base.supportContact = sanitizeText(safe.supportContact || '');
  base.premiumMode = Boolean(safe.premiumMode);
  base.setupCompleted = Boolean(safe.setupCompleted);

  return base;
}

function normalizeTournamentSettings(value) {
  const base = getDefaultTournamentSettings();
  const safe = isObject(value) ? value : {};

  base.tournamentName = FIXED_TOURNAMENT_NAME;
  base.totalMatches = sanitizePositiveInteger(safe.totalMatches, base.totalMatches, 50);
  base.playersPerTeam = PLAYERS_PER_TEAM;
  base.maxTeams = MAX_TEAMS;
  base.autoNextMatch = safe.autoNextMatch === false ? false : true;
  base.lockedRules = true;
  base.lockedPoints = true;
  base.createdAt = safe.createdAt || null;
  base.createdBy = sanitizeText(safe.createdBy || '');
  base.lastConfiguredAt = safe.lastConfiguredAt || null;
  base.lastConfiguredBy = sanitizeText(safe.lastConfiguredBy || '');

  return base;
}

function normalizeTournamentLifecycle(value) {
  const base = getDefaultTournamentLifecycle();
  const safe = isObject(value) ? value : {};

  const allowedStates = Object.values(TOURNAMENT_STATES);
  const state = sanitizeText(safe.state || base.state);

  base.state = allowedStates.includes(state) ? state : TOURNAMENT_STATES.DRAFT;

  base.registrationsOpen =
    typeof safe.registrationsOpen === 'boolean'
      ? safe.registrationsOpen
      : base.state === TOURNAMENT_STATES.REGISTRATIONS_OPEN;

  base.tournamentStarted =
    typeof safe.tournamentStarted === 'boolean'
      ? safe.tournamentStarted
      : base.state === TOURNAMENT_STATES.RUNNING || base.state === TOURNAMENT_STATES.FINISHED;

  base.tournamentFinished =
    typeof safe.tournamentFinished === 'boolean'
      ? safe.tournamentFinished
      : base.state === TOURNAMENT_STATES.FINISHED;

  base.createdAt = safe.createdAt || null;
  base.createdBy = sanitizeText(safe.createdBy || '');

  base.registrationsOpenedAt = safe.registrationsOpenedAt || null;
  base.registrationsOpenedBy = sanitizeText(safe.registrationsOpenedBy || '');

  base.registrationsClosedAt = safe.registrationsClosedAt || null;
  base.registrationsClosedBy = sanitizeText(safe.registrationsClosedBy || '');

  base.startedAt = safe.startedAt || null;
  base.startedBy = sanitizeText(safe.startedBy || '');

  base.finishedAt = safe.finishedAt || null;
  base.finishedBy = sanitizeText(safe.finishedBy || '');

  base.lastStateChangeAt = safe.lastStateChangeAt || null;
  base.lastStateChangeBy = sanitizeText(safe.lastStateChangeBy || '');

  if (base.state === TOURNAMENT_STATES.DRAFT) {
    base.registrationsOpen = false;
    base.tournamentStarted = false;
    base.tournamentFinished = false;
  }

  if (base.state === TOURNAMENT_STATES.REGISTRATIONS_OPEN) {
    base.registrationsOpen = true;
    base.tournamentStarted = false;
    base.tournamentFinished = false;
  }

  if (base.state === TOURNAMENT_STATES.REGISTRATIONS_CLOSED) {
    base.registrationsOpen = false;
    base.tournamentStarted = false;
    base.tournamentFinished = false;
  }

  if (base.state === TOURNAMENT_STATES.RUNNING) {
    base.registrationsOpen = false;
    base.tournamentStarted = true;
    base.tournamentFinished = false;
  }

  if (base.state === TOURNAMENT_STATES.FINISHED) {
    base.registrationsOpen = false;
    base.tournamentStarted = true;
    base.tournamentFinished = true;
  }

  return base;
}

function normalizeTournamentMessages(value) {
  const base = getDefaultTournamentMessages();
  const safe = isObject(value) ? value : {};

  base.openRegistrationsAnnouncement =
    sanitizeText(safe.openRegistrationsAnnouncement || safe.generalAnnouncement || base.openRegistrationsAnnouncement) ||
    base.openRegistrationsAnnouncement;

  base.closeRegistrationsAnnouncement =
    sanitizeText(safe.closeRegistrationsAnnouncement || base.closeRegistrationsAnnouncement) ||
    base.closeRegistrationsAnnouncement;

  base.tournamentStartAnnouncement =
    sanitizeText(safe.tournamentStartAnnouncement || base.tournamentStartAnnouncement) ||
    base.tournamentStartAnnouncement;

  base.nextMatchAnnouncement =
    sanitizeText(safe.nextMatchAnnouncement || base.nextMatchAnnouncement) ||
    base.nextMatchAnnouncement;

  base.forcedNextMatchAnnouncement =
    sanitizeText(safe.forcedNextMatchAnnouncement || base.forcedNextMatchAnnouncement) ||
    base.forcedNextMatchAnnouncement;

  base.tournamentFinishedAnnouncement =
    sanitizeText(safe.tournamentFinishedAnnouncement || base.tournamentFinishedAnnouncement) ||
    base.tournamentFinishedAnnouncement;

  base.lobbyInfoMessage =
    sanitizeText(safe.lobbyInfoMessage || base.lobbyInfoMessage) ||
    base.lobbyInfoMessage;

  base.generalReminder =
    sanitizeText(safe.generalReminder || base.generalReminder) ||
    base.generalReminder;

  base.regulationText = getDefaultTournamentMessages().regulationText;

  return base;
}

function normalizeAutomaticReminders(value) {
  const base = getDefaultAutomaticReminders();
  const safe = isObject(value) ? value : {};

  if (typeof safe.masterEnabled === 'boolean') {
    base.masterEnabled = safe.masterEnabled;
  }

  const incoming = isObject(safe.reminders) ? safe.reminders : {};

  for (const type of REMINDER_TYPES) {
    const def = base.reminders[type];
    const cur = isObject(incoming[type]) ? incoming[type] : {};

    if (typeof cur.enabled === 'boolean') def.enabled = cur.enabled;

    const interval = Number(cur.intervalHours);
    if (Number.isFinite(interval) && REMINDER_INTERVAL_OPTIONS.includes(interval)) {
      def.intervalHours = interval;
    }

    const msg = sanitizeText(cur.message);
    if (msg) def.message = msg;

    if (typeof cur.lastSentAt === 'string' && cur.lastSentAt.length > 0) {
      def.lastSentAt = cur.lastSentAt;
    } else {
      def.lastSentAt = null;
    }
  }

  return base;
}

function normalizeBotSettings(value) {
  const base = getDefaultBotSettings();
  const safe = isObject(value) ? value : {};

  base.registerPanelMessageId = safe.registerPanelMessageId || null;
  base.registerPanelChannelId = sanitizeText(safe.registerPanelChannelId || '');

  base.registrationStatusMessageId = safe.registrationStatusMessageId || safe.registerPanelMessageId || null;

  base.resultsPanelMessageId = safe.resultsPanelMessageId || null;
  base.resultsPanelChannelId = sanitizeText(safe.resultsPanelChannelId || '');

  base.roomsCategoryId = sanitizeText(safe.roomsCategoryId || safe.categoryId || '');
  base.generalChannelId = sanitizeText(safe.generalChannelId || '');
  base.rulesChannelId = sanitizeText(safe.rulesChannelId || '');
  base.lobbyChannelId = sanitizeText(safe.lobbyChannelId || '');
  base.leaderboardChannelId = sanitizeText(safe.leaderboardChannelId || '');

  base.leaderboardMessageId = safe.leaderboardMessageId || null;
  base.leaderboardGraphicMessageId = safe.leaderboardGraphicMessageId || null;
  base.topFraggerGraphicMessageId = safe.topFraggerGraphicMessageId || null;

  return base;
}

function normalizePending(pendingValue) {
  const safePending = isObject(pendingValue) ? pendingValue : {};
  const out = {};

  for (const [id, entry] of Object.entries(safePending)) {
    if (!isObject(entry)) continue;

    const kills = Array.isArray(entry.kills) ? entry.kills : [];
    const team = sanitizeText(entry.team);

    if (!team) continue;

    out[String(id)] = {
      team,
      kills: [
        Number(kills[0] || 0),
        Number(kills[1] || 0),
        Number(kills[2] || 0)
      ],
      total: Number(entry.total || 0),
      pos: Number(entry.pos || 0),
      image: sanitizeText(entry.image || ''),
      source: sanitizeText(entry.source || ''),
      submittedBy: sanitizeText(entry.submittedBy || ''),
      staffMessageId: entry.staffMessageId || null,
      matchNumber: sanitizePositiveInteger(entry.matchNumber, 1, 50),
      teamResultChannelId: sanitizeText(entry.teamResultChannelId || ''),
      slot: Number(entry.slot || 0) || null
    };
  }

  return out;
}

function normalizeTempSubmit(tempValue) {
  const safeTemp = isObject(tempValue) ? tempValue : {};
  const out = {};

  for (const [userId, entry] of Object.entries(safeTemp)) {
    if (!isObject(entry)) continue;

    const kills = Array.isArray(entry.kills) ? entry.kills : [];
    const team = sanitizeText(entry.team);

    if (!team) continue;

    out[String(userId)] = {
      team,
      slot: Number(entry.slot || 0),
      kills: [
        Number(kills[0] || 0),
        Number(kills[1] || 0),
        Number(kills[2] || 0)
      ],
      total: Number(entry.total || 0),
      pos: Number(entry.pos || 0),
      matchNumber: sanitizePositiveInteger(entry.matchNumber, 1, 50),
      teamResultChannelId: sanitizeText(entry.teamResultChannelId || '')
    };
  }

  return out;
}

function normalizeResultSubmissions(value) {
  const safe = isObject(value) ? value : {};
  const out = {};

  for (const [key, entry] of Object.entries(safe)) {
    if (!isObject(entry)) continue;

    const team = sanitizeText(entry.team);
    const matchNumber = sanitizePositiveInteger(entry.matchNumber, 1, 50);

    if (!team) continue;

    const cleanKey = sanitizeText(key) || buildSubmissionKey(team, matchNumber);

    let status = sanitizeText(entry.status || TEAM_MATCH_STATES.NOT_SUBMITTED);

    const allowedStatuses = Object.values(TEAM_MATCH_STATES);

    if (!allowedStatuses.includes(status)) {
      status = TEAM_MATCH_STATES.NOT_SUBMITTED;
    }

    out[cleanKey] = {
      team,
      matchNumber,
      status,
      pendingId: entry.pendingId || null,
      updatedAt: sanitizeText(entry.updatedAt || ''),
      updatedBy: sanitizeText(entry.updatedBy || ''),
      source: sanitizeText(entry.source || '')
    };
  }

  return out;
}

function normalizeScores(value) {
  const safe = isObject(value) ? value : {};
  const out = {};

  for (const [key, points] of Object.entries(safe)) {
    const cleanKey = sanitizeText(key);
    if (!cleanKey) continue;

    out[cleanKey] = Number(points || 0);
  }

  return out;
}

function normalizeFragger(value) {
  const safe = isObject(value) ? value : {};
  const out = {};

  for (const [key, kills] of Object.entries(safe)) {
    const cleanKey = sanitizeText(key);
    if (!cleanKey) continue;

    out[cleanKey] = Number(kills || 0);
  }

  return out;
}

function normalizeTeamMatchState(value, teamName, matchNumber) {
  const base = getDefaultTeamMatchState(teamName, matchNumber);
  const safe = isObject(value) ? value : {};

  const allowedStatuses = Object.values(TEAM_MATCH_STATES);
  const status = sanitizeText(safe.status || base.status);

  base.status = allowedStatuses.includes(status) ? status : TEAM_MATCH_STATES.NOT_SUBMITTED;

  const kills = Array.isArray(safe.kills) ? safe.kills : base.kills;

  base.kills = [
    Number(kills[0] || 0),
    Number(kills[1] || 0),
    Number(kills[2] || 0)
  ];

  base.totalKills = Number(safe.totalKills || safe.total || base.kills.reduce((sum, k) => sum + Number(k || 0), 0));
  base.placement = Number(safe.placement || safe.pos || 0);
  base.points = Number(safe.points || 0);

  base.source = sanitizeText(safe.source || '');
  base.pendingId = safe.pendingId || null;
  base.image = sanitizeText(safe.image || '');

  base.submittedBy = sanitizeText(safe.submittedBy || '');
  base.approvedBy = sanitizeText(safe.approvedBy || '');
  base.rejectedBy = sanitizeText(safe.rejectedBy || '');
  base.manualBy = sanitizeText(safe.manualBy || '');
  base.absentBy = sanitizeText(safe.absentBy || '');

  base.updatedAt = sanitizeText(safe.updatedAt || '');
  base.createdAt = sanitizeText(safe.createdAt || getNowIso());

  return base;
}

function normalizeMatch(value, matchNumber) {
  const base = getDefaultMatch(matchNumber);
  const safe = isObject(value) ? value : {};

  const allowedStatuses = Object.values(MATCH_STATES);
  const status = sanitizeText(safe.status || base.status);

  base.status = allowedStatuses.includes(status) ? status : MATCH_STATES.NOT_STARTED;

  base.startedAt = safe.startedAt || null;
  base.completedAt = safe.completedAt || null;
  base.forcedAt = safe.forcedAt || null;
  base.closedBy = sanitizeText(safe.closedBy || '');
  base.autoAdvanced = Boolean(safe.autoAdvanced);

  const teams = isObject(safe.teams) ? safe.teams : {};
  base.teams = {};

  for (const [teamName, teamState] of Object.entries(teams)) {
    const cleanTeam = sanitizeText(teamName);
    if (!cleanTeam) continue;

    base.teams[cleanTeam] = normalizeTeamMatchState(teamState, cleanTeam, base.matchNumber);
  }

  return base;
}

function normalizeMatches(value) {
  const safe = isObject(value) ? value : {};
  const out = {};

  for (const [matchNumberRaw, matchData] of Object.entries(safe)) {
    const matchNumber = sanitizePositiveInteger(matchNumberRaw, 1, 50);
    out[String(matchNumber)] = normalizeMatch(matchData, matchNumber);
  }

  return out;
}

function buildSubmissionKey(teamName, matchNumber) {
  return `${sanitizeText(teamName).toLowerCase()}::match_${sanitizePositiveInteger(matchNumber, 1, 50)}`;
}

function normalizeData(data) {
  const base = getDefaultData();
  const safe = isObject(data) ? data : {};

  base.currentMatch = sanitizePositiveInteger(safe.currentMatch, 1, 50);

  base.projectSettings = normalizeProjectSettings(safe.projectSettings);
  base.tournamentSettings = normalizeTournamentSettings(safe.tournamentSettings);
  base.tournamentLifecycle = normalizeTournamentLifecycle(safe.tournamentLifecycle || safe.lifecycle);
  base.tournamentMessages = normalizeTournamentMessages(safe.tournamentMessages);
  base.automaticReminders = normalizeAutomaticReminders(safe.automaticReminders);

  base.matches = normalizeMatches(safe.matches);

  base.pending = normalizePending(safe.pending);
  base.tempSubmit = normalizeTempSubmit(safe.tempSubmit);
  base.resultSubmissions = normalizeResultSubmissions(safe.resultSubmissions);

  base.scores = normalizeScores(safe.scores);
  base.fragger = normalizeFragger(safe.fragger);

  base.leaderboardMessageId = safe.leaderboardMessageId || null;
  base.leaderboardGraphicMessageId = safe.leaderboardGraphicMessageId || null;
  base.topFraggerGraphicMessageId = safe.topFraggerGraphicMessageId || null;

  base.registrationStatusMessageId = safe.registrationStatusMessageId || null;
  base.registrationClosedAnnounced = Boolean(safe.registrationClosedAnnounced);

  base.registrationMaxTeams = MAX_TEAMS;
  base.registrationStatusTitle =
    sanitizeText(safe.registrationStatusTitle || base.registrationStatusTitle) ||
    base.registrationStatusTitle;

  base.registrationStatusText = sanitizeText(safe.registrationStatusText || '');

  base.botSettings = normalizeBotSettings(
    safe.botSettings || {
      registerPanelMessageId: safe.registerPanelMessageId,
      registerPanelChannelId: safe.registerPanelChannelId,
      resultsPanelMessageId: safe.resultsPanelMessageId,
      resultsPanelChannelId: safe.resultsPanelChannelId,
      roomsCategoryId: safe.roomsCategoryId || safe.categoryId,
      generalChannelId: safe.generalChannelId,
      rulesChannelId: safe.rulesChannelId,
      lobbyChannelId: safe.lobbyChannelId,
      leaderboardMessageId: safe.leaderboardMessageId,
      leaderboardGraphicMessageId: safe.leaderboardGraphicMessageId,
      topFraggerGraphicMessageId: safe.topFraggerGraphicMessageId
    }
  );

  base.projectSettings.tournamentName = FIXED_TOURNAMENT_NAME;
  base.tournamentSettings.tournamentName = FIXED_TOURNAMENT_NAME;
  base.tournamentSettings.playersPerTeam = PLAYERS_PER_TEAM;
  base.tournamentSettings.maxTeams = MAX_TEAMS;
  base.tournamentSettings.lockedRules = true;
  base.tournamentSettings.lockedPoints = true;

  if (base.currentMatch > base.tournamentSettings.totalMatches) {
    base.currentMatch = base.tournamentSettings.totalMatches;
  }

  if (!base.matches[String(base.currentMatch)]) {
    base.matches[String(base.currentMatch)] = getDefaultMatch(base.currentMatch);
  }

  return base;
}

function normalizeTeams(teams) {
  const safe = isObject(teams) ? teams : {};
  const temp = {};
  const usedSlots = new Set();
  const needsSlot = [];

  for (const [teamNameRaw, teamData] of Object.entries(safe)) {
    const teamName = sanitizeText(teamNameRaw);
    if (!teamName || !isObject(teamData)) continue;

    const players = Array.isArray(teamData.players) ? teamData.players : [];
    const slotValue = Number(teamData.slot);
    let slot = null;

    if (
      Number.isInteger(slotValue) &&
      slotValue >= 1 &&
      slotValue <= MAX_TEAMS &&
      !usedSlots.has(slotValue)
    ) {
      slot = slotValue;
      usedSlots.add(slotValue);
    }

    temp[teamName] = {
      slot,
      players: [
        sanitizeText(players[0] || ''),
        sanitizeText(players[1] || ''),
        sanitizeText(players[2] || '')
      ]
    };

    if (!slot) {
      needsSlot.push(teamName);
    }
  }

  const sortedNeeding = needsSlot.sort((a, b) => a.localeCompare(b, 'it'));

  for (const teamName of sortedNeeding) {
    let assigned = null;

    for (let i = 1; i <= MAX_TEAMS; i++) {
      if (!usedSlots.has(i)) {
        assigned = i;
        usedSlots.add(i);
        break;
      }
    }

    if (!assigned) {
      delete temp[teamName];
      continue;
    }

    temp[teamName].slot = assigned;
  }

  const sorted = Object.entries(temp)
    .sort((a, b) => {
      const slotA = Number(a[1]?.slot || 999999);
      const slotB = Number(b[1]?.slot || 999999);

      if (slotA !== slotB) {
        return slotA - slotB;
      }

      return a[0].localeCompare(b[0], 'it');
    })
    .slice(0, MAX_TEAMS);

  const out = {};

  for (const [teamName, teamData] of sorted) {
    out[teamName] = {
      slot: teamData.slot,
      players: [
        sanitizeText(teamData.players[0] || ''),
        sanitizeText(teamData.players[1] || ''),
        sanitizeText(teamData.players[2] || '')
      ]
    };
  }

  return out;
}

function normalizeAuditLog(value) {
  if (!Array.isArray(value)) {
    return getDefaultAuditLog();
  }

  return value
    .filter(entry => isObject(entry))
    .map(entry => ({
      id: sanitizeText(entry.id || '') || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: sanitizeText(entry.timestamp || getNowIso()),
      actor: sanitizeText(entry.actor || 'system') || 'system',
      source: sanitizeText(entry.source || 'system') || 'system',
      action: sanitizeText(entry.action || 'unknown') || 'unknown',
      details: isObject(entry.details) ? entry.details : {}
    }))
    .slice(-1000);
}

function readJsonSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;

    const raw = fs.readFileSync(filePath, 'utf8');

    if (!raw || !raw.trim()) return null;

    return JSON.parse(raw);
  } catch (error) {
    console.error(`Errore lettura JSON ${filePath}:`, error.message);
    return null;
  }
}

function atomicWriteJson(filePath, data) {
  ensureDir(path.dirname(filePath));

  const tmpPath = `${filePath}.tmp`;

  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmpPath, filePath);
}

function writeBackup(filePath, backupPath, data) {
  atomicWriteJson(filePath, data);
  atomicWriteJson(backupPath, data);
}

function initializeFiles() {
  ensureDir(STORAGE_DIR);
  ensureDir(BACKUP_DIR);
  ensureDir(ARCHIVES_DIR);
  ensureDir(UPLOADS_DIR);

  const dataMain = readJsonSafe(DATA_FILE);
  const dataBackup = readJsonSafe(DATA_BACKUP_FILE);
  const teamsMain = readJsonSafe(TEAMS_FILE);
  const teamsBackup = readJsonSafe(TEAMS_BACKUP_FILE);
  const auditMain = readJsonSafe(AUDIT_LOG_FILE);
  const auditBackup = readJsonSafe(AUDIT_BACKUP_FILE);

  const safeData = normalizeData(dataMain || dataBackup || getDefaultData());
  const safeTeams = normalizeTeams(teamsMain || teamsBackup || getDefaultTeams());
  const safeAudit = normalizeAuditLog(auditMain || auditBackup || getDefaultAuditLog());

  writeBackup(DATA_FILE, DATA_BACKUP_FILE, safeData);
  writeBackup(TEAMS_FILE, TEAMS_BACKUP_FILE, safeTeams);
  writeBackup(AUDIT_LOG_FILE, AUDIT_BACKUP_FILE, safeAudit);

  console.log('Storage inizializzato correttamente');
}

function loadData() {
  const main = readJsonSafe(DATA_FILE);

  if (main) {
    const safe = normalizeData(main);
    writeBackup(DATA_FILE, DATA_BACKUP_FILE, safe);
    lastSavedDataFingerprint = computeDataFingerprint(safe);
    return safe;
  }

  const backup = readJsonSafe(DATA_BACKUP_FILE);

  if (backup) {
    const safe = normalizeData(backup);
    writeBackup(DATA_FILE, DATA_BACKUP_FILE, safe);
    lastSavedDataFingerprint = computeDataFingerprint(safe);
    console.warn('[loadData] data.json mancante o corrotto: ripristinato dal backup data.latest.json');
    return safe;
  }

  const safe = getDefaultData();
  writeBackup(DATA_FILE, DATA_BACKUP_FILE, safe);
  lastSavedDataFingerprint = computeDataFingerprint(safe);
  return safe;
}

function loadTeams() {
  const main = readJsonSafe(TEAMS_FILE);

  if (main) {
    const safe = normalizeTeams(main);
    writeBackup(TEAMS_FILE, TEAMS_BACKUP_FILE, safe);
    return safe;
  }

  const backup = readJsonSafe(TEAMS_BACKUP_FILE);

  if (backup) {
    const safe = normalizeTeams(backup);
    writeBackup(TEAMS_FILE, TEAMS_BACKUP_FILE, safe);
    return safe;
  }

  const safe = getDefaultTeams();
  writeBackup(TEAMS_FILE, TEAMS_BACKUP_FILE, safe);
  return safe;
}

function loadAuditLog() {
  const main = readJsonSafe(AUDIT_LOG_FILE);

  if (main) {
    const safe = normalizeAuditLog(main);
    writeBackup(AUDIT_LOG_FILE, AUDIT_BACKUP_FILE, safe);
    return safe;
  }

  const backup = readJsonSafe(AUDIT_BACKUP_FILE);

  if (backup) {
    const safe = normalizeAuditLog(backup);
    writeBackup(AUDIT_LOG_FILE, AUDIT_BACKUP_FILE, safe);
    return safe;
  }

  const safe = getDefaultAuditLog();
  writeBackup(AUDIT_LOG_FILE, AUDIT_BACKUP_FILE, safe);
  return safe;
}

let lastSavedDataFingerprint = null;

function computeDataFingerprint(safe) {
  try {
    return {
      state: safe.tournamentLifecycle?.state || TOURNAMENT_STATES.DRAFT,
      currentMatch: Number(safe.currentMatch || 0),
      matchesCount: Object.keys(safe.matches || {}).length,
      scoresCount: Object.keys(safe.scores || {}).length,
      fraggerCount: Object.keys(safe.fragger || {}).length
    };
  } catch {
    return { state: TOURNAMENT_STATES.DRAFT, currentMatch: 0, matchesCount: 0, scoresCount: 0, fraggerCount: 0 };
  }
}

function isCatastrophicWipe(prevFp, newFp) {
  if (!prevFp) return false;
  const wasActive =
    prevFp.state === TOURNAMENT_STATES.RUNNING ||
    prevFp.state === TOURNAMENT_STATES.REGISTRATIONS_OPEN ||
    prevFp.state === TOURNAMENT_STATES.REGISTRATIONS_CLOSED ||
    prevFp.state === TOURNAMENT_STATES.FINISHED;
  const becameDraft = newFp.state === TOURNAMENT_STATES.DRAFT;
  const lostMatches = prevFp.matchesCount > 0 && newFp.matchesCount === 0;
  const lostScores = prevFp.scoresCount > 0 && newFp.scoresCount === 0;
  if (wasActive && becameDraft && (lostMatches || lostScores)) return true;
  if (prevFp.scoresCount >= 3 && newFp.scoresCount === 0) return true;
  return false;
}

function saveData(data, options = {}) {
  const safe = normalizeData(data);
  const newFp = computeDataFingerprint(safe);

  if (!options.allowReset && isCatastrophicWipe(lastSavedDataFingerprint, newFp)) {
    console.error('[saveData] BLOCCATO: tentato salvataggio che svuoterebbe i dati', {
      previous: lastSavedDataFingerprint,
      attempted: newFp
    });
    throw new Error('Salvataggio bloccato: i dati risulterebbero svuotati. Se vuoi davvero resettare il torneo usa il pulsante reset dedicato.');
  }

  writeBackup(DATA_FILE, DATA_BACKUP_FILE, safe);
  lastSavedDataFingerprint = newFp;
  return safe;
}

function resetSavedDataFingerprint(safe) {
  lastSavedDataFingerprint = computeDataFingerprint(safe || getDefaultData());
}

function saveTeams(teams) {
  const safe = normalizeTeams(teams);
  writeBackup(TEAMS_FILE, TEAMS_BACKUP_FILE, safe);
  return safe;
}

function saveAuditLog(logs) {
  const safe = normalizeAuditLog(logs);
  writeBackup(AUDIT_LOG_FILE, AUDIT_BACKUP_FILE, safe);
  return safe;
}

function saveAll(data, teams) {
  const safeData = saveData(data);
  const safeTeams = saveTeams(teams);

  return {
    data: safeData,
    teams: safeTeams
  };
}

function appendAuditLog(entry) {
  const logs = loadAuditLog();

  const newEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: getNowIso(),
    actor: sanitizeText(entry?.actor || 'system') || 'system',
    source: sanitizeText(entry?.source || 'system') || 'system',
    action: sanitizeText(entry?.action || 'unknown') || 'unknown',
    details: isObject(entry?.details) ? entry.details : {}
  };

  logs.push(newEntry);

  const trimmed = logs.slice(-1000);

  saveAuditLog(trimmed);

  return newEntry;
}

function createTournamentArchive(data, teams, meta = {}) {
  ensureDir(ARCHIVES_DIR);

  const safeData = normalizeData(data);
  const safeTeams = normalizeTeams(teams);

  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const archiveId = `archive-${stamp}-${Math.random().toString(36).slice(2, 7)}`;

  const payload = {
    archiveId,
    createdAt: now.toISOString(),
    meta: {
      label: sanitizeText(meta.label || '') || `Snapshot ${now.toLocaleString('it-IT')}`,
      actor: sanitizeText(meta.actor || 'system') || 'system',
      note: sanitizeText(meta.note || ''),
      source: sanitizeText(meta.source || 'system') || 'system'
    },
    summary: {
      tournamentName: FIXED_TOURNAMENT_NAME,
      tournamentState: safeData.tournamentLifecycle?.state || TOURNAMENT_STATES.DRAFT,
      currentMatch: Number(safeData.currentMatch || 1),
      totalMatches: Number(safeData.tournamentSettings?.totalMatches || 3),
      teamCount: Object.keys(safeTeams || {}).length,
      pendingCount: Object.keys(safeData.pending || {}).length,
      scoreCount: Object.keys(safeData.scores || {}).length,
      fraggerCount: Object.keys(safeData.fragger || {}).length
    },
    data: safeData,
    teams: safeTeams
  };

  const archivePath = path.join(ARCHIVES_DIR, `${archiveId}.json`);

  atomicWriteJson(archivePath, payload);

  return payload;
}

function listTournamentArchives() {
  ensureDir(ARCHIVES_DIR);

  const files = fs.readdirSync(ARCHIVES_DIR)
    .filter(file => file.endsWith('.json'))
    .sort((a, b) => b.localeCompare(a, 'it'));

  const archives = [];

  for (const file of files.slice(0, 100)) {
    const payload = readJsonSafe(path.join(ARCHIVES_DIR, file));

    if (!payload || !isObject(payload)) continue;

    const safeData = normalizeData(payload.data || {});
    const safeTeams = normalizeTeams(payload.teams || {});

    archives.push({
      archiveId: sanitizeText(payload.archiveId || file.replace(/\.json$/i, '')),
      createdAt: sanitizeText(payload.createdAt || ''),
      label: sanitizeText(payload.meta?.label || ''),
      actor: sanitizeText(payload.meta?.actor || ''),
      note: sanitizeText(payload.meta?.note || ''),
      source: sanitizeText(payload.meta?.source || ''),
      tournamentName: FIXED_TOURNAMENT_NAME,
      tournamentState: safeData.tournamentLifecycle?.state || TOURNAMENT_STATES.DRAFT,
      teamCount: Object.keys(safeTeams || {}).length,
      pendingCount: Object.keys(safeData.pending || {}).length,
      scoreCount: Object.keys(safeData.scores || {}).length,
      fraggerCount: Object.keys(safeData.fragger || {}).length,
      currentMatch: Number(safeData.currentMatch || 1),
      totalMatches: Number(safeData.tournamentSettings?.totalMatches || 3)
    });
  }

  return archives;
}

function getTournamentArchive(archiveId) {
  const safeId = sanitizeText(archiveId);

  if (!safeId) return null;

  const archivePath = path.join(ARCHIVES_DIR, `${safeId}.json`);
  const payload = readJsonSafe(archivePath);

  if (!payload || !isObject(payload)) return null;

  return {
    archiveId: sanitizeText(payload.archiveId || safeId),
    createdAt: sanitizeText(payload.createdAt || ''),
    meta: {
      label: sanitizeText(payload.meta?.label || ''),
      actor: sanitizeText(payload.meta?.actor || ''),
      note: sanitizeText(payload.meta?.note || ''),
      source: sanitizeText(payload.meta?.source || '')
    },
    summary: isObject(payload.summary) ? payload.summary : {},
    data: normalizeData(payload.data),
    teams: normalizeTeams(payload.teams)
  };
}

function createFreshTournamentData(actor = 'system', options = {}) {
  const now = getNowIso();

  const totalMatches = sanitizePositiveInteger(options.totalMatches, 3, 50);

  const data = getDefaultData();

  data.currentMatch = 1;

  data.tournamentSettings = {
    ...getDefaultTournamentSettings(),
    totalMatches,
    autoNextMatch: options.autoNextMatch === false ? false : true,
    createdAt: now,
    createdBy: sanitizeText(actor),
    lastConfiguredAt: now,
    lastConfiguredBy: sanitizeText(actor)
  };

  data.tournamentLifecycle = {
    ...getDefaultTournamentLifecycle(),
    state: TOURNAMENT_STATES.DRAFT,
    createdAt: now,
    createdBy: sanitizeText(actor),
    lastStateChangeAt: now,
    lastStateChangeBy: sanitizeText(actor)
  };

  data.matches = {};

  for (let i = 1; i <= totalMatches; i++) {
    data.matches[String(i)] = getDefaultMatch(i);
  }

  data.pending = {};
  data.tempSubmit = {};
  data.resultSubmissions = {};
  data.scores = {};
  data.fragger = {};

  data.registrationClosedAnnounced = false;
  data.registrationMaxTeams = MAX_TEAMS;

  return normalizeData(data);
}

function archiveAndCreateFreshTournament(meta = {}) {
  const currentData = loadData();
  const currentTeams = loadTeams();

  const archive = createTournamentArchive(currentData, currentTeams, {
    label: sanitizeText(meta.label || '') || `Archivio automatico prima nuovo torneo ${new Date().toLocaleString('it-IT')}`,
    note: sanitizeText(meta.note || 'Archivio automatico creato prima di iniziare un nuovo torneo.'),
    actor: sanitizeText(meta.actor || 'system'),
    source: sanitizeText(meta.source || 'web')
  });

  const freshData = createFreshTournamentData(meta.actor || 'system', {
    totalMatches: meta.totalMatches || currentData.tournamentSettings?.totalMatches || 3,
    autoNextMatch: meta.autoNextMatch !== false
  });

  const freshTeams = {};

  saveData(freshData, { allowReset: true });
  saveTeams(freshTeams);

  appendAuditLog({
    actor: sanitizeText(meta.actor || 'system'),
    source: sanitizeText(meta.source || 'web'),
    action: 'archivia_e_crea_nuovo_torneo',
    details: {
      archiveId: archive.archiveId,
      totalMatches: freshData.tournamentSettings.totalMatches,
      autoNextMatch: freshData.tournamentSettings.autoNextMatch
    }
  });

  return {
    archive,
    data: freshData,
    teams: freshTeams
  };
}

function ensureMatchForTeams(data, teams, matchNumber) {
  const safeData = normalizeData(data);
  const safeTeams = normalizeTeams(teams);
  const targetMatch = sanitizePositiveInteger(matchNumber, Number(safeData.currentMatch || 1), 50);

  if (!safeData.matches[String(targetMatch)]) {
    safeData.matches[String(targetMatch)] = getDefaultMatch(targetMatch);
  }

  const match = normalizeMatch(safeData.matches[String(targetMatch)], targetMatch);

  for (const teamName of Object.keys(safeTeams)) {
    if (!match.teams[teamName]) {
      match.teams[teamName] = getDefaultTeamMatchState(teamName, targetMatch);
    }
  }

  for (const teamName of Object.keys(match.teams)) {
    if (!safeTeams[teamName]) {
      delete match.teams[teamName];
    }
  }

  safeData.matches[String(targetMatch)] = match;

  return safeData;
}

function resetReminderCooldownsForState(data, newState) {
  const reminders = data?.automaticReminders?.reminders;
  if (!reminders) return data;

  if (newState === TOURNAMENT_STATES.REGISTRATIONS_OPEN) {
    if (reminders.iscrizioni) reminders.iscrizioni.lastSentAt = null;
    if (reminders.regolamento) reminders.regolamento.lastSentAt = null;
  } else if (newState === TOURNAMENT_STATES.REGISTRATIONS_CLOSED) {
    if (reminders.regolamento) reminders.regolamento.lastSentAt = null;
  } else if (newState === TOURNAMENT_STATES.RUNNING) {
    if (reminders.risultati) reminders.risultati.lastSentAt = null;
    if (reminders.regolamento) reminders.regolamento.lastSentAt = null;
  }

  return data;
}

function setReminderMasterEnabled(data, enabled) {
  const safeData = normalizeData(data);
  safeData.automaticReminders.masterEnabled = Boolean(enabled);
  return saveData(safeData);
}

function updateAutomaticReminders(data, partial) {
  const safeData = normalizeData(data);
  const cur = safeData.automaticReminders;
  const incoming = isObject(partial) ? partial : {};

  if (typeof incoming.masterEnabled === 'boolean') {
    cur.masterEnabled = incoming.masterEnabled;
  }

  const incReminders = isObject(incoming.reminders) ? incoming.reminders : {};

  for (const type of REMINDER_TYPES) {
    const target = cur.reminders[type];
    const src = isObject(incReminders[type]) ? incReminders[type] : {};

    if (typeof src.enabled === 'boolean') target.enabled = src.enabled;

    const interval = Number(src.intervalHours);
    if (Number.isFinite(interval) && REMINDER_INTERVAL_OPTIONS.includes(interval)) {
      target.intervalHours = interval;
    }

    const msg = sanitizeText(src.message);
    if (msg) target.message = msg;
  }

  return saveData(safeData);
}

function markReminderSent(data, type, ts = getNowIso()) {
  const safeData = normalizeData(data);
  const target = safeData.automaticReminders?.reminders?.[type];
  if (target) {
    target.lastSentAt = ts;
  }
  return saveData(safeData);
}

function resetReminderToDefault(data, type) {
  const safeData = normalizeData(data);
  const defaults = getDefaultAutomaticReminders().reminders[type];
  const target = safeData.automaticReminders?.reminders?.[type];
  if (target && defaults) {
    target.enabled = defaults.enabled;
    target.intervalHours = defaults.intervalHours;
    target.message = defaults.message;
  }
  return saveData(safeData);
}

function openRegistrations(data, actor = 'system') {
  const safeData = normalizeData(data);
  const currentState = safeData.tournamentLifecycle?.state;

  if (currentState === TOURNAMENT_STATES.REGISTRATIONS_OPEN) {
    throw new Error('Le iscrizioni sono già aperte.');
  }

  if (currentState === TOURNAMENT_STATES.RUNNING) {
    throw new Error('Il torneo è in corso: non puoi riaprire le iscrizioni. Termina prima il torneo.');
  }

  const now = getNowIso();

  safeData.tournamentLifecycle = {
    ...normalizeTournamentLifecycle(safeData.tournamentLifecycle),
    state: TOURNAMENT_STATES.REGISTRATIONS_OPEN,
    registrationsOpen: true,
    tournamentStarted: false,
    tournamentFinished: false,
    registrationsOpenedAt: now,
    registrationsOpenedBy: sanitizeText(actor),
    lastStateChangeAt: now,
    lastStateChangeBy: sanitizeText(actor)
  };

  safeData.registrationClosedAnnounced = false;

  resetReminderCooldownsForState(safeData, TOURNAMENT_STATES.REGISTRATIONS_OPEN);

  return saveData(safeData);
}

function closeRegistrations(data, actor = 'system') {
  const safeData = normalizeData(data);
  const currentState = safeData.tournamentLifecycle?.state;

  if (currentState !== TOURNAMENT_STATES.REGISTRATIONS_OPEN) {
    throw new Error('Le iscrizioni non sono aperte: non c\'è nulla da chiudere.');
  }

  const now = getNowIso();

  safeData.tournamentLifecycle = {
    ...normalizeTournamentLifecycle(safeData.tournamentLifecycle),
    state: TOURNAMENT_STATES.REGISTRATIONS_CLOSED,
    registrationsOpen: false,
    tournamentStarted: false,
    tournamentFinished: false,
    registrationsClosedAt: now,
    registrationsClosedBy: sanitizeText(actor),
    lastStateChangeAt: now,
    lastStateChangeBy: sanitizeText(actor)
  };

  safeData.registrationClosedAnnounced = true;

  resetReminderCooldownsForState(safeData, TOURNAMENT_STATES.REGISTRATIONS_CLOSED);

  return saveData(safeData);
}

function startTournament(data, teams, actor = 'system') {
  let safeData = normalizeData(data);
  const safeTeams = normalizeTeams(teams);
  const currentState = safeData.tournamentLifecycle?.state;

  if (currentState === TOURNAMENT_STATES.RUNNING) {
    throw new Error('Il torneo è già in corso.');
  }

  if (currentState === TOURNAMENT_STATES.FINISHED) {
    throw new Error('Il torneo è già finito. Crea un nuovo torneo per ricominciare.');
  }

  if (currentState === TOURNAMENT_STATES.REGISTRATIONS_OPEN) {
    throw new Error('Chiudi prima le iscrizioni: poi potrai avviare il torneo.');
  }

  if (Object.keys(safeTeams || {}).length < 2) {
    throw new Error('Servono almeno 2 team registrati per avviare il torneo.');
  }

  const now = getNowIso();

  safeData.currentMatch = 1;

  safeData.tournamentLifecycle = {
    ...normalizeTournamentLifecycle(safeData.tournamentLifecycle),
    state: TOURNAMENT_STATES.RUNNING,
    registrationsOpen: false,
    tournamentStarted: true,
    tournamentFinished: false,
    startedAt: now,
    startedBy: sanitizeText(actor),
    lastStateChangeAt: now,
    lastStateChangeBy: sanitizeText(actor)
  };

  safeData = ensureMatchForTeams(safeData, safeTeams, 1);
  safeData.matches['1'].status = MATCH_STATES.RUNNING;
  safeData.matches['1'].startedAt = safeData.matches['1'].startedAt || now;

  resetReminderCooldownsForState(safeData, TOURNAMENT_STATES.RUNNING);

  return saveData(safeData);
}

function finishTournament(data, actor = 'system') {
  const safeData = normalizeData(data);
  const currentState = safeData.tournamentLifecycle?.state;

  if (currentState !== TOURNAMENT_STATES.RUNNING) {
    throw new Error('Il torneo non è in corso: non c\'è nulla da terminare.');
  }

  const now = getNowIso();

  safeData.tournamentLifecycle = {
    ...normalizeTournamentLifecycle(safeData.tournamentLifecycle),
    state: TOURNAMENT_STATES.FINISHED,
    registrationsOpen: false,
    tournamentStarted: true,
    tournamentFinished: true,
    finishedAt: now,
    finishedBy: sanitizeText(actor),
    lastStateChangeAt: now,
    lastStateChangeBy: sanitizeText(actor)
  };

  return saveData(safeData);
}

function getMatchCompletion(data, teams, matchNumber) {
  const safeData = ensureMatchForTeams(data, teams, matchNumber);
  const safeTeams = normalizeTeams(teams);
  const targetMatch = sanitizePositiveInteger(matchNumber, Number(safeData.currentMatch || 1), 50);
  const match = safeData.matches[String(targetMatch)] || getDefaultMatch(targetMatch);

  const rows = Object.keys(safeTeams).map(teamName => {
    const state = match.teams[teamName] || getDefaultTeamMatchState(teamName, targetMatch);

    return {
      team: teamName,
      slot: safeTeams[teamName]?.slot || null,
      players: safeTeams[teamName]?.players || [],
      matchNumber: targetMatch,
      status: state.status,
      final: isFinalTeamMatchStatus(state.status),
      data: state
    };
  });

  const total = rows.length;
  const finalCount = rows.filter(row => row.final).length;
  const pendingCount = rows.filter(row => row.status === TEAM_MATCH_STATES.PENDING).length;
  const missingCount = rows.filter(row => row.status === TEAM_MATCH_STATES.NOT_SUBMITTED || row.status === TEAM_MATCH_STATES.REJECTED).length;

  return {
    matchNumber: targetMatch,
    total,
    finalCount,
    pendingCount,
    missingCount,
    complete: total > 0 && finalCount === total,
    rows
  };
}

function markTeamMatchState(data, teams, matchNumber, teamName, patch = {}) {
  let safeData = ensureMatchForTeams(data, teams, matchNumber);
  const safeTeams = normalizeTeams(teams);
  const targetMatch = sanitizePositiveInteger(matchNumber, Number(safeData.currentMatch || 1), 50);
  const cleanTeam = sanitizeText(teamName);

  if (!cleanTeam || !safeTeams[cleanTeam]) {
    throw new Error('Team non trovato');
  }

  const match = safeData.matches[String(targetMatch)] || getDefaultMatch(targetMatch);
  const current = match.teams[cleanTeam] || getDefaultTeamMatchState(cleanTeam, targetMatch);

  const next = normalizeTeamMatchState({
    ...current,
    ...patch,
    team: cleanTeam,
    matchNumber: targetMatch,
    updatedAt: getNowIso()
  }, cleanTeam, targetMatch);

  match.teams[cleanTeam] = next;
  safeData.matches[String(targetMatch)] = match;

  const key = buildSubmissionKey(cleanTeam, targetMatch);
  safeData.resultSubmissions[key] = {
    team: cleanTeam,
    matchNumber: targetMatch,
    status: next.status,
    pendingId: next.pendingId || null,
    updatedAt: next.updatedAt,
    updatedBy: patch.updatedBy || patch.approvedBy || patch.manualBy || patch.absentBy || patch.rejectedBy || '',
    source: next.source || ''
  };

  return saveData(safeData);
}

function forceCompleteCurrentMatch(data, teams, actor = 'system') {
  let safeData = ensureMatchForTeams(data, teams, data.currentMatch);
  const safeTeams = normalizeTeams(teams);
  const targetMatch = Number(safeData.currentMatch || 1);
  const now = getNowIso();

  const match = safeData.matches[String(targetMatch)] || getDefaultMatch(targetMatch);

  for (const teamName of Object.keys(safeTeams)) {
    const current = match.teams[teamName] || getDefaultTeamMatchState(teamName, targetMatch);

    if (!isFinalTeamMatchStatus(current.status)) {
      match.teams[teamName] = normalizeTeamMatchState({
        ...current,
        status: TEAM_MATCH_STATES.ABSENT,
        absentBy: sanitizeText(actor),
        updatedAt: now
      }, teamName, targetMatch);

      const key = buildSubmissionKey(teamName, targetMatch);
      safeData.resultSubmissions[key] = {
        team: teamName,
        matchNumber: targetMatch,
        status: TEAM_MATCH_STATES.ABSENT,
        pendingId: null,
        updatedAt: now,
        updatedBy: sanitizeText(actor),
        source: 'staff'
      };
    }
  }

  match.status = MATCH_STATES.FORCED;
  match.forcedAt = now;
  match.completedAt = now;
  match.closedBy = sanitizeText(actor);
  match.autoAdvanced = false;

  safeData.matches[String(targetMatch)] = match;

  return saveData(safeData);
}

function advanceToNextMatch(data, teams, actor = 'system', options = {}) {
  let safeData = normalizeData(data);
  const safeTeams = normalizeTeams(teams);
  const now = getNowIso();

  const currentMatch = Number(safeData.currentMatch || 1);
  const totalMatches = Number(safeData.tournamentSettings?.totalMatches || 3);

  if (currentMatch >= totalMatches) {
    safeData = finishTournament(safeData, actor);
    return {
      data: safeData,
      advanced: false,
      finished: true,
      currentMatch,
      nextMatch: currentMatch
    };
  }

  safeData = ensureMatchForTeams(safeData, safeTeams, currentMatch);

  if (safeData.matches[String(currentMatch)]) {
    safeData.matches[String(currentMatch)].status = options.forced ? MATCH_STATES.FORCED : MATCH_STATES.COMPLETED;
    safeData.matches[String(currentMatch)].completedAt = safeData.matches[String(currentMatch)].completedAt || now;
    safeData.matches[String(currentMatch)].closedBy = sanitizeText(actor);
    safeData.matches[String(currentMatch)].autoAdvanced = Boolean(options.autoAdvanced);
  }

  const nextMatch = currentMatch + 1;

  safeData.currentMatch = nextMatch;
  safeData = ensureMatchForTeams(safeData, safeTeams, nextMatch);

  safeData.matches[String(nextMatch)].status = MATCH_STATES.RUNNING;
  safeData.matches[String(nextMatch)].startedAt = safeData.matches[String(nextMatch)].startedAt || now;

  safeData = saveData(safeData);

  return {
    data: safeData,
    advanced: true,
    finished: false,
    currentMatch,
    nextMatch
  };
}

module.exports = {
  STORAGE_DIR,
  BACKUP_DIR,
  ARCHIVES_DIR,
  DATA_FILE,
  TEAMS_FILE,
  AUDIT_LOG_FILE,
  UPLOADS_DIR,

  FIXED_TOURNAMENT_NAME,
  MAX_TEAMS,
  PLAYERS_PER_TEAM,

  TOURNAMENT_STATES,
  MATCH_STATES,
  TEAM_MATCH_STATES,

  initializeFiles,

  loadData,
  loadTeams,
  loadAuditLog,

  saveData,
  saveTeams,
  saveAuditLog,
  saveAll,

  appendAuditLog,

  createTournamentArchive,
  listTournamentArchives,
  getTournamentArchive,

  archiveAndCreateFreshTournament,
  createFreshTournamentData,

  openRegistrations,
  closeRegistrations,
  startTournament,
  finishTournament,

  ensureMatchForTeams,
  getMatchCompletion,
  markTeamMatchState,
  forceCompleteCurrentMatch,
  advanceToNextMatch,

  isFinalTeamMatchStatus,
  buildSubmissionKey,

  getDefaultData,
  getDefaultTeams,
  getDefaultAuditLog,
  getDefaultProjectSettings,
  getDefaultTournamentSettings,
  getDefaultTournamentLifecycle,
  getDefaultTournamentMessages,
  getDefaultAutomaticReminders,
  REMINDER_TYPES,
  REMINDER_INTERVAL_OPTIONS,
  setReminderMasterEnabled,
  updateAutomaticReminders,
  markReminderSent,
  resetReminderToDefault,
  getDefaultBotSettings,
  getDefaultMatch,
  getDefaultTeamMatchState,

  normalizeData,
  normalizeTeams,
  normalizeProjectSettings,
  normalizeTournamentSettings,
  normalizeTournamentLifecycle,
  normalizeTournamentMessages,
  normalizeBotSettings,
  normalizeMatches,
  normalizeMatch,
  normalizeTeamMatchState
};
