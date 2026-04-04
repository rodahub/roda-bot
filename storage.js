const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, 'data.json');
const TEAMS_FILE = path.join(ROOT, 'teams.json');
const BACKUP_DIR = path.join(ROOT, 'backups');
const DATA_BACKUP_FILE = path.join(BACKUP_DIR, 'data.latest.json');
const TEAMS_BACKUP_FILE = path.join(BACKUP_DIR, 'teams.latest.json');

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
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
    registerPanelMessageId: null,
    registerPanelChannelId: '',
    resultsPanelMessageId: null,
    resultsPanelChannelId: '',
    roomsCategoryId: ''
  };
}

function getDefaultTeams() {
  return {};
}

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
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

  base.registerPanelMessageId = safe.registerPanelMessageId || null;
  base.registerPanelChannelId = String(safe.registerPanelChannelId || '').trim();
  base.resultsPanelMessageId = safe.resultsPanelMessageId || null;
  base.resultsPanelChannelId = String(safe.resultsPanelChannelId || '').trim();
  base.roomsCategoryId = String(safe.roomsCategoryId || '').trim();

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

  const dataMain = readJsonSafe(DATA_FILE);
  const dataBackup = readJsonSafe(DATA_BACKUP_FILE);
  const teamsMain = readJsonSafe(TEAMS_FILE);
  const teamsBackup = readJsonSafe(TEAMS_BACKUP_FILE);

  const safeData = normalizeData(dataMain || dataBackup || getDefaultData());
  const safeTeams = normalizeTeams(teamsMain || teamsBackup || getDefaultTeams());

  writeBackup(DATA_FILE, DATA_BACKUP_FILE, safeData);
  writeBackup(TEAMS_FILE, TEAMS_BACKUP_FILE, safeTeams);
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

function saveAll(data, teams) {
  const safeData = saveData(data);
  const safeTeams = saveTeams(teams);
  return { data: safeData, teams: safeTeams };
}

module.exports = {
  BACKUP_DIR,
  DATA_FILE,
  TEAMS_FILE,
  initializeFiles,
  loadData,
  loadTeams,
  saveData,
  saveTeams,
  saveAll,
  getDefaultData,
  getDefaultTeams
};
