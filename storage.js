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

function getDefaultProjectSettings() {
  return {
    brandName: 'RØDA',
    tournamentName: 'RØDA CUP',
    supportContact: '',
    premiumMode: false,
    setupCompleted: false
  };
}

function getDefaultTournamentSettings() {
  return {
    tournamentName: 'RØDA CUP',
    totalMatches: 3,
    playersPerTeam: 3,
    maxTeams: 16,
    lockedRules: true,
    lockedPoints: true,
    createdAt: null,
    createdBy: '',
    lastConfiguredAt: null,
    lastConfiguredBy: ''
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

function getDefaultTournamentMessages() {
  return {
    generalAnnouncement: `@everyone

**🏆 BENVENUTI ALLA RØDA CUP**

Il torneo è stato creato correttamente.

**Cose importanti da sapere:**
• Leggete il regolamento nel canale dedicato
• Usate le vocali ufficiali del torneo
• Ogni team avrà il proprio pannello risultati nella propria stanza
• Il codice lobby verrà inviato nelle stanze dei team
• I risultati devono essere inviati solo una volta per ogni match

Buon torneo a tutti 🔥`,
    lobbyInfoMessage: `**🎮 CODICE LOBBY**

Il codice lobby verrà inviato dallo staff nelle stanze dei team.

Restate pronti e controllate la vostra stanza ufficiale.`,
    regulationText: `🏆 RØDA CUP

👥 FORMATO TORNEO

Il torneo si svolge in modalità TERZETTI (TRIO).

Ogni squadra deve essere composta da 3 giocatori titolari.
Non sono ammessi quartetti o cambi non autorizzati dallo staff.

🎮 OBBLIGO UTILIZZO DISCORD

Per tutta la durata dell’evento è obbligatorio:

• Utilizzare le stanze vocali Discord ufficiali
• Aprire una stanza temporanea Trio nella sezione RØDA HUB
• Restare presenti in vocale per tutto il torneo

⚠️ La mancata presenza in stanza comporta penalità o annullamento del match.

🚫 RESTRIZIONI EQUIPAGGIAMENTO

È severamente vietato l’utilizzo di:

❌ Mine
❌ Claymore
❌ Psicogranate
❌ Granate Stordenti
❌ Lacrimogeni
❌ Scarica Elettrica
❌ Skin Terminator

⚖️ SISTEMA DISCIPLINARE

• 1ª infrazione → Richiamo ufficiale
• 2ª infrazione → Sottrazione punti
• 3ª infrazione → Squalifica dal torneo

Lo staff può applicare sanzioni immediate in caso di violazioni gravi.

🔫 ARMI CONSENTITE

✅ Solo ARMI META approvate dallo staff
🎯 È ammesso 1 SOLO CECCHINO per team

⚠️ Violazioni:

• Utilizzo di 2 cecchini → Penalità immediata
• Uso di armi non consentite → Kill annullate o sottrazione punti

🏆 SISTEMA DI PUNTEGGIO

🔹 Kill di squadra

👉 Si sommano tutte le kill del team

📊 Formula ufficiale:

Kill totali di squadra + Bonus Posizionamento

🔹 Bonus Posizionamento

🥇 1° Posto → 10 punti
🥈 2° Posto → 6 punti
🥉 3° Posto → 5 punti
4° Posto → 4 punti
5° Posto → 3 punti
6° Posto → 2 punti
7° Posto → 1 punto
8° Posto → 1 punto

📸 VALIDAZIONE RISULTATI

Ogni team deve inviare il risultato tramite il pannello ufficiale nella propria stanza.

Lo screenshot deve mostrare chiaramente:

• Classifica finale
• Numero totale kill di squadra
• Posizionamento

Se una di queste informazioni manca, il risultato non verrà convalidato.

✅ ESEMPIO CORRETTO INVIO RISULTATO

Team: RØDA Black
Posizione: 2° Posto
Kill Totali Squadra: 18

⚖️ FAIR PLAY

• Vietato glitch, exploit o vantaggi illeciti
• Vietato comportamento tossico o antisportivo
• Rispetto obbligatorio verso staff e avversari
• Le decisioni dello staff sono definitive`
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
    registrationMaxTeams: 16,
    registrationStatusTitle: '📋 Slot Team Registrati',
    registrationStatusText: 'Lista team attualmente registrati nel torneo.',
    projectSettings: getDefaultProjectSettings(),
    tournamentSettings: getDefaultTournamentSettings(),
    botSettings: getDefaultBotSettings(),
    tournamentMessages: getDefaultTournamentMessages()
  };
}

function getDefaultTeams() {
  return {};
}

function getDefaultAuditLog() {
  return [];
}

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeString(value, fallback = '') {
  return String(value || fallback).trim();
}

function sanitizePositiveInteger(value, fallback = 1, max = 9999) {
  const num = Number(value);
  if (!Number.isInteger(num) || num <= 0) return fallback;
  return Math.min(num, max);
}

function normalizeProjectSettings(value) {
  const base = getDefaultProjectSettings();
  const safe = isObject(value) ? value : {};

  base.brandName = sanitizeString(safe.brandName, base.brandName) || base.brandName;
  base.tournamentName = 'RØDA CUP';
  base.supportContact = sanitizeString(safe.supportContact);
  base.premiumMode = Boolean(safe.premiumMode);
  base.setupCompleted = Boolean(safe.setupCompleted);

  return base;
}

function normalizeTournamentSettings(value) {
  const base = getDefaultTournamentSettings();
  const safe = isObject(value) ? value : {};

  base.tournamentName = 'RØDA CUP';
  base.totalMatches = sanitizePositiveInteger(safe.totalMatches, base.totalMatches, 50);
  base.playersPerTeam = 3;
  base.maxTeams = 16;
  base.lockedRules = true;
  base.lockedPoints = true;
  base.createdAt = safe.createdAt || null;
  base.createdBy = sanitizeString(safe.createdBy);
  base.lastConfiguredAt = safe.lastConfiguredAt || null;
  base.lastConfiguredBy = sanitizeString(safe.lastConfiguredBy);

  return base;
}

function normalizeBotSettings(value) {
  const base = getDefaultBotSettings();
  const safe = isObject(value) ? value : {};

  base.registerPanelMessageId = safe.registerPanelMessageId || null;
  base.registerPanelChannelId = sanitizeString(safe.registerPanelChannelId);
  base.resultsPanelMessageId = safe.resultsPanelMessageId || null;
  base.resultsPanelChannelId = sanitizeString(safe.resultsPanelChannelId);
  base.roomsCategoryId = sanitizeString(safe.roomsCategoryId);
  base.generalChannelId = sanitizeString(safe.generalChannelId);
  base.rulesChannelId = sanitizeString(safe.rulesChannelId);
  base.lobbyChannelId = sanitizeString(safe.lobbyChannelId);

  return base;
}

function normalizeTournamentMessages(value) {
  const base = getDefaultTournamentMessages();
  const safe = isObject(value) ? value : {};

  base.generalAnnouncement = sanitizeString(safe.generalAnnouncement, base.generalAnnouncement) || base.generalAnnouncement;
  base.lobbyInfoMessage = sanitizeString(safe.lobbyInfoMessage, base.lobbyInfoMessage) || base.lobbyInfoMessage;
  base.regulationText = base.regulationText;

  return base;
}

function normalizePending(pendingValue) {
  const safePending = isObject(pendingValue) ? pendingValue : {};
  const out = {};

  for (const [id, entry] of Object.entries(safePending)) {
    if (!isObject(entry)) continue;

    const kills = Array.isArray(entry.kills) ? entry.kills : [];

    out[String(id)] = {
      team: sanitizeString(entry.team),
      slot: Number(entry.slot || 0),
      kills: [
        Number(kills[0] || 0),
        Number(kills[1] || 0),
        Number(kills[2] || 0)
      ],
      total: Number(entry.total || 0),
      pos: Number(entry.pos || 0),
      image: sanitizeString(entry.image),
      source: sanitizeString(entry.source),
      submittedBy: sanitizeString(entry.submittedBy),
      staffMessageId: entry.staffMessageId || null,
      matchNumber: Number(entry.matchNumber || 1),
      teamResultChannelId: sanitizeString(entry.teamResultChannelId)
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

    out[String(userId)] = {
      team: sanitizeString(entry.team),
      slot: Number(entry.slot || 0),
      kills: [
        Number(kills[0] || 0),
        Number(kills[1] || 0),
        Number(kills[2] || 0)
      ],
      total: Number(entry.total || 0),
      pos: Number(entry.pos || 0),
      matchNumber: Number(entry.matchNumber || 1),
      teamResultChannelId: sanitizeString(entry.teamResultChannelId)
    };
  }

  return out;
}

function normalizeScores(value) {
  const safe = isObject(value) ? value : {};
  const out = {};

  for (const [key, points] of Object.entries(safe)) {
    const cleanKey = sanitizeString(key);
    if (!cleanKey) continue;
    out[cleanKey] = Number(points || 0);
  }

  return out;
}

function normalizeFragger(value) {
  const safe = isObject(value) ? value : {};
  const out = {};

  for (const [key, kills] of Object.entries(safe)) {
    const cleanKey = sanitizeString(key);
    if (!cleanKey) continue;
    out[cleanKey] = Number(kills || 0);
  }

  return out;
}

function normalizeResultSubmissions(value) {
  const safe = isObject(value) ? value : {};
  const out = {};

  for (const [key, entry] of Object.entries(safe)) {
    if (!isObject(entry)) continue;

    const cleanKey = sanitizeString(key);
    const team = sanitizeString(entry.team);

    if (!cleanKey || !team) continue;

    out[cleanKey] = {
      team,
      matchNumber: sanitizePositiveInteger(entry.matchNumber, 1, 9999),
      status: sanitizeString(entry.status, 'non_inviato') || 'non_inviato',
      pendingId: entry.pendingId || null,
      updatedAt: sanitizeString(entry.updatedAt),
      updatedBy: sanitizeString(entry.updatedBy),
      source: sanitizeString(entry.source)
    };
  }

  return out;
}

function normalizeData(data) {
  const base = getDefaultData();
  const safe = isObject(data) ? data : {};

  base.currentMatch = sanitizePositiveInteger(safe.currentMatch, 1, 9999);
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

  const maxTeams = sanitizePositiveInteger(safe.registrationMaxTeams, 16, 16);
  base.registrationMaxTeams = Math.min(maxTeams, 16);

  base.registrationStatusTitle =
    sanitizeString(safe.registrationStatusTitle, base.registrationStatusTitle) ||
    base.registrationStatusTitle;

  base.registrationStatusText = sanitizeString(safe.registrationStatusText);

  base.projectSettings = normalizeProjectSettings(safe.projectSettings);

  base.tournamentSettings = normalizeTournamentSettings(
    safe.tournamentSettings || {
      tournamentName: safe.projectSettings?.tournamentName,
      totalMatches: safe.totalMatches,
      playersPerTeam: safe.playersPerTeam,
      maxTeams: safe.registrationMaxTeams
    }
  );

  base.botSettings = normalizeBotSettings(
    safe.botSettings || {
      registerPanelMessageId: safe.registerPanelMessageId,
      registerPanelChannelId: safe.registerPanelChannelId,
      resultsPanelMessageId: safe.resultsPanelMessageId,
      resultsPanelChannelId: safe.resultsPanelChannelId,
      roomsCategoryId: safe.roomsCategoryId
    }
  );

  base.tournamentMessages = normalizeTournamentMessages(safe.tournamentMessages);

  return base;
}

function normalizeTeams(teams) {
  const safe = isObject(teams) ? teams : {};
  const temp = {};
  const usedSlots = new Set();
  const needsSlot = [];

  for (const [teamName, teamData] of Object.entries(safe)) {
    const cleanTeamName = sanitizeString(teamName);
    if (!cleanTeamName || !isObject(teamData)) continue;

    const players = Array.isArray(teamData.players) ? teamData.players : [];
    const slotValue = Number(teamData.slot);
    let slot = null;

    if (
      Number.isInteger(slotValue) &&
      slotValue >= 1 &&
      slotValue <= 16 &&
      !usedSlots.has(slotValue)
    ) {
      slot = slotValue;
      usedSlots.add(slotValue);
    }

    temp[cleanTeamName] = {
      slot,
      players: [
        sanitizeString(players[0]),
        sanitizeString(players[1]),
        sanitizeString(players[2])
      ]
    };

    if (!slot) needsSlot.push(cleanTeamName);
  }

  const sortedNeeding = needsSlot.sort((a, b) => a.localeCompare(b, 'it'));

  for (const teamName of sortedNeeding) {
    let assigned = null;

    for (let i = 1; i <= 16; i++) {
      if (!usedSlots.has(i)) {
        assigned = i;
        usedSlots.add(i);
        break;
      }
    }

    temp[teamName].slot = assigned;
  }

  return temp;
}

function normalizeAuditLog(value) {
  if (!Array.isArray(value)) return getDefaultAuditLog();

  return value
    .filter(entry => isObject(entry))
    .map(entry => ({
      id: sanitizeString(entry.id) || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: sanitizeString(entry.timestamp) || new Date().toISOString(),
      actor: sanitizeString(entry.actor, 'system') || 'system',
      source: sanitizeString(entry.source, 'system') || 'system',
      action: sanitizeString(entry.action, 'unknown') || 'unknown',
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
    actor: sanitizeString(entry?.actor, 'system') || 'system',
    source: sanitizeString(entry?.source, 'system') || 'system',
    action: sanitizeString(entry?.action, 'unknown') || 'unknown',
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
      label: sanitizeString(meta.label) || `Snapshot ${now.toLocaleString('it-IT')}`,
      actor: sanitizeString(meta.actor, 'system') || 'system',
      note: sanitizeString(meta.note),
      source: sanitizeString(meta.source, 'system') || 'system'
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

  const files = fs
    .readdirSync(ARCHIVES_DIR)
    .filter(file => file.endsWith('.json'))
    .sort((a, b) => b.localeCompare(a, 'it'));

  const archives = [];

  for (const file of files.slice(0, 100)) {
    const payload = readJsonSafe(path.join(ARCHIVES_DIR, file));
    if (!payload || !isObject(payload)) continue;

    archives.push({
      archiveId: sanitizeString(payload.archiveId) || file.replace(/\.json$/i, ''),
      createdAt: sanitizeString(payload.createdAt),
      label: sanitizeString(payload.meta?.label),
      actor: sanitizeString(payload.meta?.actor),
      note: sanitizeString(payload.meta?.note),
      source: sanitizeString(payload.meta?.source),
      teamCount: Object.keys(payload.teams || {}).length,
      pendingCount: Object.keys(payload.data?.pending || {}).length,
      currentMatch: Number(payload.data?.currentMatch || 1),
      totalMatches: Number(payload.data?.tournamentSettings?.totalMatches || 3),
      tournamentName: 'RØDA CUP'
    });
  }

  return archives;
}

function getTournamentArchive(archiveId) {
  const safeId = sanitizeString(archiveId);
  if (!safeId) return null;

  const archivePath = path.join(ARCHIVES_DIR, `${safeId}.json`);
  const payload = readJsonSafe(archivePath);

  if (!payload || !isObject(payload)) return null;

  return {
    archiveId: sanitizeString(payload.archiveId) || safeId,
    createdAt: sanitizeString(payload.createdAt),
    meta: {
      label: sanitizeString(payload.meta?.label),
      actor: sanitizeString(payload.meta?.actor),
      note: sanitizeString(payload.meta?.note),
      source: sanitizeString(payload.meta?.source)
    },
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
  getDefaultProjectSettings,
  getDefaultTournamentSettings,
  getDefaultBotSettings,
  getDefaultTournamentMessages
};
