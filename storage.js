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
  if (!Number.isInteger(num) || num <= 0) return fallback;
  return Math.min(num, max);
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
    lockedRules: true,
    lockedPoints: true,
    createdAt: null,
    createdBy: '',
    lastConfiguredAt: null,
    lastConfiguredBy: ''
  };
}

function getDefaultTournamentMessages() {
  return {
    generalAnnouncement:
      '@everyone\n\n' +
      '**🏆 BENVENUTI ALLA RØDA CUP**\n\n' +
      '**Leggete il regolamento ufficiale prima dell’inizio del torneo.**\n\n' +
      'Ogni team userà la propria stanza vocale ufficiale.\n' +
      'Dentro la stanza del team troverete il pannello per inviare i risultati.\n' +
      'Il codice lobby verrà mandato nelle stanze ufficiali dei team.\n\n' +
      '**Buona fortuna a tutti. 🔥**',
    lobbyInfoMessage:
      '**🎮 CODICE LOBBY**\n\n' +
      'Il codice lobby verrà inviato nelle stanze ufficiali dei team.\n' +
      'Controllate sempre la vostra stanza durante il torneo.',
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

function getDefaultBotSettings() {
  return {
    registerPanelMessageId: null,
    registerPanelChannelId: '',
    resultsPanelMessageId: null,
    resultsPanelChannelId: '',
    roomsCategoryId: '',
    generalChannelId: '',
    rulesChannelId: '',
    lobbyChannelId: ''
  };
}

function getDefaultData() {
  return {
    currentMatch: 1,
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
    tournamentSettings: getDefaultTournamentSettings(),
    tournamentMessages: getDefaultTournamentMessages(),
    botSettings: getDefaultBotSettings()
  };
}

function getDefaultTeams() {
  return {};
}

function getDefaultAuditLog() {
  return [];
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
  base.lockedRules = true;
  base.lockedPoints = true;
  base.createdAt = safe.createdAt || null;
  base.createdBy = sanitizeText(safe.createdBy || '');
  base.lastConfiguredAt = safe.lastConfiguredAt || null;
  base.lastConfiguredBy = sanitizeText(safe.lastConfiguredBy || '');

  return base;
}

function normalizeTournamentMessages(value) {
  const base = getDefaultTournamentMessages();
  const safe = isObject(value) ? value : {};

  base.generalAnnouncement = sanitizeText(safe.generalAnnouncement || base.generalAnnouncement) || base.generalAnnouncement;
  base.lobbyInfoMessage = sanitizeText(safe.lobbyInfoMessage || base.lobbyInfoMessage) || base.lobbyInfoMessage;
  base.regulationText = getDefaultTournamentMessages().regulationText;

  return base;
}

function normalizeBotSettings(value) {
  const base = getDefaultBotSettings();
  const safe = isObject(value) ? value : {};

  base.registerPanelMessageId = safe.registerPanelMessageId || null;
  base.registerPanelChannelId = sanitizeText(safe.registerPanelChannelId || '');
  base.resultsPanelMessageId = safe.resultsPanelMessageId || null;
  base.resultsPanelChannelId = sanitizeText(safe.resultsPanelChannelId || '');
  base.roomsCategoryId = sanitizeText(safe.roomsCategoryId || safe.categoryId || '');
  base.generalChannelId = sanitizeText(safe.generalChannelId || '');
  base.rulesChannelId = sanitizeText(safe.rulesChannelId || '');
  base.lobbyChannelId = sanitizeText(safe.lobbyChannelId || '');

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

    const cleanKey = sanitizeText(key) || `${team.toLowerCase()}::match_${matchNumber}`;

    let status = sanitizeText(entry.status || 'non_inviato');

    const allowedStatuses = [
      'non_inviato',
      'in_attesa',
      'approvato',
      'rifiutato',
      'assente',
      'inserito_manualmente'
    ];

    if (!allowedStatuses.includes(status)) {
      status = 'non_inviato';
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

function normalizeData(data) {
  const base = getDefaultData();
  const safe = isObject(data) ? data : {};

  base.currentMatch = sanitizePositiveInteger(safe.currentMatch, 1, 50);

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
  base.registrationStatusTitle = sanitizeText(safe.registrationStatusTitle || base.registrationStatusTitle) || base.registrationStatusTitle;
  base.registrationStatusText = sanitizeText(safe.registrationStatusText || '');

  base.projectSettings = normalizeProjectSettings(safe.projectSettings);
  base.tournamentSettings = normalizeTournamentSettings(safe.tournamentSettings);
  base.tournamentMessages = normalizeTournamentMessages(safe.tournamentMessages);

  base.botSettings = normalizeBotSettings(
    safe.botSettings || {
      registerPanelMessageId: safe.registerPanelMessageId,
      registerPanelChannelId: safe.registerPanelChannelId,
      resultsPanelMessageId: safe.resultsPanelMessageId,
      resultsPanelChannelId: safe.resultsPanelChannelId,
      roomsCategoryId: safe.roomsCategoryId || safe.categoryId,
      generalChannelId: safe.generalChannelId,
      rulesChannelId: safe.rulesChannelId,
      lobbyChannelId: safe.lobbyChannelId
    }
  );

  if (base.currentMatch > base.tournamentSettings.totalMatches) {
    base.currentMatch = base.tournamentSettings.totalMatches;
  }

  base.projectSettings.tournamentName = FIXED_TOURNAMENT_NAME;
  base.tournamentSettings.tournamentName = FIXED_TOURNAMENT_NAME;
  base.tournamentSettings.playersPerTeam = PLAYERS_PER_TEAM;
  base.tournamentSettings.maxTeams = MAX_TEAMS;
  base.tournamentSettings.lockedRules = true;
  base.tournamentSettings.lockedPoints = true;

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

    if (!slot) needsSlot.push(teamName);
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
      if (slotA !== slotB) return slotA - slotB;
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
  if (!Array.isArray(value)) return getDefaultAuditLog();

  return value
    .filter(entry => isObject(entry))
    .map(entry => ({
      id: sanitizeText(entry.id || '') || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: sanitizeText(entry.timestamp || new Date().toISOString()),
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
    return safe;
  }

  const backup = readJsonSafe(DATA_BACKUP_FILE);

  if (backup) {
    const safe = normalizeData(backup);
    writeBackup(DATA_FILE, DATA_BACKUP_FILE, safe);
    return safe;
  }

  const safe = getDefaultData();
  writeBackup(DATA_FILE, DATA_BACKUP_FILE, safe);
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

function saveData(data) {
  const safe = normalizeData(data);
  writeBackup(DATA_FILE, DATA_BACKUP_FILE, safe);
  return safe;
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
    timestamp: new Date().toISOString(),
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

module.exports = {
  STORAGE_DIR,
  BACKUP_DIR,
  ARCHIVES_DIR,
  DATA_FILE,
  TEAMS_FILE,
  AUDIT_LOG_FILE,
  UPLOADS_DIR,

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

  getDefaultData,
  getDefaultTeams,
  getDefaultAuditLog,
  getDefaultProjectSettings,
  getDefaultTournamentSettings,
  getDefaultTournamentMessages,
  getDefaultBotSettings,

  normalizeData,
  normalizeTeams,
  normalizeProjectSettings,
  normalizeTournamentSettings,
  normalizeTournamentMessages,
  normalizeBotSettings
};
