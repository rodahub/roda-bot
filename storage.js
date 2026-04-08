const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, 'data.json');
const TEAMS_FILE = path.join(ROOT, 'teams.json');
const BACKUP_DIR = path.join(ROOT, 'backups');
const DATA_BACKUP_FILE = path.join(BACKUP_DIR, 'data.latest.json');
const TEAMS_BACKUP_FILE = path.join(BACKUP_DIR, 'teams.latest.json');

const AUDIT_LOG_FILE = path.join(ROOT, 'audit-log.json');
const AUDIT_BACKUP_FILE = path.join(BACKUP_DIR, 'audit-log.latest.json');

const ARCHIVES_DIR = path.join(ROOT, 'archives');

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

function getDefaultBotSettings() {
  return {
    registerPanelMessageId: null,
    registerPanelChannelId: '',
    resultsPanelMessageId: null,
    resultsPanelChannelId: '',
    roomsCategoryId: ''
  };
}

function getDefaultData() {
  return {
    currentMatch: 1,
    pending: {},
    tempSubmit: {},
    scores: {},
    fragger: {},
    leaderboardMessageId: null,
    registrationStatusMessageId: null,
    registrationClosedAnnounced: false,
    registrationMaxTeams: 16,
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

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeProjectSettings(value) {
  const base = getDefaultProjectSettings();
  const safe = isObject(value) ? value : {};

  base.brandName = String(safe.brandName || base.brandName).trim() || base.brandName;
  base.tournamentName = String(safe.tournamentName || base.tournamentName).trim() || base.tournamentName;
  base.supportContact = String(safe.supportContact || '').trim();
  base.premiumMode = Boolean(safe.premiumMode);
  base.setupCompleted = Boolean(safe.setupCompleted);

  return base;
}

function normalizeBotSettings(value) {
  const base = getDefaultBotSettings();
  const safe = isObject(value) ? value : {};

  base.registerPanelMessageId = safe.registerPanelMessageId || null;
  base.registerPanelChannelId = String(safe.registerPanelChannelId || '').trim();
  base.resultsPanelMessageId = safe.resultsPanelMessageId || null;
  base.resultsPanelChannelId = String(safe.resultsPanelChannelId || '').trim();
  base.roomsCategoryId = String(safe.roomsCategoryId || '').trim();

  return base;
}

function normalizeData(data) {
  const base = getDefaultData();
  const safe = isObject(data) ? data : {};

  base.currentMatch = Number.isInteger(Number(safe.currentMatch)) && Number(safe.currentMatch) > 0
    ? Number(safe.currentMatch)
    : 1;

  base.pending = isObject(safe.pending) ? safe.pending : {};
  base.tempSubmit = isObject(safe.tempSubmit) ? safe.tempSubmit : {};
  base.scores = isObject(safe.scores) ? safe.scores : {};
  base.fragger = isObject(safe.fragger) ? safe.fragger : {};
  base.leaderboardMessageId = safe.leaderboardMessageId || null;
  base.registrationStatusMessageId = safe.registrationStatusMessageId || null;
  base.registrationClosedAnnounced = Boolean(safe.registrationClosedAnnounced);

  const maxTeams = Number(safe.registrationMaxTeams);
  base.registrationMaxTeams = Number.isInteger(maxTeams) && maxTeams > 0 ? maxTeams : 16;

  base.registrationStatusTitle = String(safe.registrationStatusTitle || base.registrationStatusTitle).trim() || base.registrationStatusTitle;
  base.registrationStatusText = String(safe.registrationStatusText || '').trim();

  base.projectSettings = normalizeProjectSettings(safe.projectSettings);
  base.botSettings = normalizeBotSettings(
    safe.botSettings || {
      registerPanelMessageId: safe.registerPanelMessageId,
      registerPanelChannelId: safe.registerPanelChannelId,
      resultsPanelMessageId: safe.resultsPanelMessageId,
      resultsPanelChannelId: safe.resultsPanelChannelId,
      roomsCategoryId: safe.roomsCategoryId
    }
  );

  return base;
}

function normalizeTeams(teams) {
  const safe = isObject(teams) ? teams : {};
  const temp = {};
  const usedSlots = new Set();
  const needsSlot = [];

  for (const [teamName, teamData] of Object.entries(safe)) {
    if (!teamName || !isObject(teamData)) continue;

    const players = Array.isArray(teamData.players) ? teamData.players : [];
    const slotValue = Number(teamData.slot);
    let slot = null;

    if (
      Number.isInteger(slotValue) &&
      slotValue >= 1 &&
      slotValue <= 9999 &&
      !usedSlots.has(slotValue)
    ) {
      slot = slotValue;
      usedSlots.add(slotValue);
    }

    temp[teamName] = {
      slot,
      players: [
        String(players[0] || '').trim(),
        String(players[1] || '').trim(),
        String(players[2] || '').trim()
      ]
    };

    if (!slot) needsSlot.push(teamName);
  }

  const sortedNeeding = needsSlot.sort((a, b) => a.localeCompare(b, 'it'));

  for (const teamName of sortedNeeding) {
    let assigned = null;
    for (let i = 1; i <= 9999; i++) {
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
      id: String(entry.id || '').trim() || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: String(entry.timestamp || new Date().toISOString()).trim(),
      actor: String(entry.actor || 'system').trim(),
      source: String(entry.source || 'system').trim(),
      action: String(entry.action || 'unknown').trim(),
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
  } catch {
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
  ensureDir(BACKUP_DIR);
  ensureDir(ARCHIVES_DIR);

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
}

function loadData() {
  const main = readJsonSafe(DATA_FILE);
  if (main) return normalizeData(main);

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
  if (main) return normalizeTeams(main);

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
  if (main) return normalizeAuditLog(main);

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
  return { data: safeData, teams: safeTeams };
}

function appendAuditLog(entry) {
  const logs = loadAuditLog();
  const newEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    actor: String(entry?.actor || 'system').trim() || 'system',
    source: String(entry?.source || 'system').trim() || 'system',
    action: String(entry?.action || 'unknown').trim() || 'unknown',
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
      label: String(meta.label || '').trim() || `Snapshot ${now.toLocaleString('it-IT')}`,
      actor: String(meta.actor || 'system').trim() || 'system',
      note: String(meta.note || '').trim(),
      source: String(meta.source || 'system').trim() || 'system'
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

    archives.push({
      archiveId: String(payload.archiveId || file.replace(/\.json$/i, '')).trim(),
      createdAt: String(payload.createdAt || '').trim(),
      label: String(payload.meta?.label || '').trim(),
      actor: String(payload.meta?.actor || '').trim(),
      note: String(payload.meta?.note || '').trim(),
      source: String(payload.meta?.source || '').trim(),
      teamCount: Object.keys(payload.teams || {}).length,
      pendingCount: Object.keys(payload.data?.pending || {}).length,
      currentMatch: Number(payload.data?.currentMatch || 1)
    });
  }

  return archives;
}

function getTournamentArchive(archiveId) {
  ensureDir(ARCHIVES_DIR);

  const safeId = String(archiveId || '').trim().replace(/[^a-zA-Z0-9._-]/g, '');
  if (!safeId) return null;

  const archivePath = path.join(ARCHIVES_DIR, `${safeId}.json`);
  const payload = readJsonSafe(archivePath);
  if (!payload || !isObject(payload)) return null;

  return {
    archiveId: String(payload.archiveId || safeId).trim(),
    createdAt: String(payload.createdAt || '').trim(),
    meta: {
      label: String(payload.meta?.label || '').trim(),
      actor: String(payload.meta?.actor || '').trim(),
      note: String(payload.meta?.note || '').trim(),
      source: String(payload.meta?.source || '').trim()
    },
    data: normalizeData(payload.data || getDefaultData()),
    teams: normalizeTeams(payload.teams || getDefaultTeams())
  };
}

module.exports = {
  BACKUP_DIR,
  ARCHIVES_DIR,
  DATA_FILE,
  TEAMS_FILE,
  AUDIT_LOG_FILE,
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
  getDefaultBotSettings
};
