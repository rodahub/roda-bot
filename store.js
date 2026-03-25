const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'data.json');
const TEAMS_FILE = path.join(__dirname, 'teams.json');
const BACKUP_DIR = path.join(__dirname, 'backups');

const DEFAULT_DATA = {
  currentMatch: 1,
  pending: {},
  tempSubmit: {},
  scores: {},
  fragger: {},
  leaderboardMessageId: null,
  resultHistory: []
};

const DEFAULT_TEAMS = {};

function ensureBaseFiles() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  if (!fs.existsSync(DATA_FILE)) {
    writeFileAtomic(DATA_FILE, DEFAULT_DATA);
  }

  if (!fs.existsSync(TEAMS_FILE)) {
    writeFileAtomic(TEAMS_FILE, DEFAULT_TEAMS);
  }
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeData(data) {
  const safe = isPlainObject(data) ? data : {};
  safe.currentMatch = Number.isInteger(Number(safe.currentMatch)) && Number(safe.currentMatch) > 0 ? Number(safe.currentMatch) : 1;
  safe.pending = isPlainObject(safe.pending) ? safe.pending : {};
  safe.tempSubmit = isPlainObject(safe.tempSubmit) ? safe.tempSubmit : {};
  safe.scores = isPlainObject(safe.scores) ? safe.scores : {};
  safe.fragger = isPlainObject(safe.fragger) ? safe.fragger : {};
  safe.leaderboardMessageId = safe.leaderboardMessageId || null;
  safe.resultHistory = Array.isArray(safe.resultHistory) ? safe.resultHistory : [];
  return safe;
}

function normalizeTeams(teams) {
  const safe = isPlainObject(teams) ? teams : {};
  const normalized = {};

  for (const [teamName, value] of Object.entries(safe)) {
    if (!teamName || !isPlainObject(value)) continue;
    const players = Array.isArray(value.players) ? value.players : [];
    normalized[teamName] = {
      players: [
        String(players[0] || '').trim(),
        String(players[1] || '').trim(),
        String(players[2] || '').trim()
      ]
    };
  }

  return normalized;
}

function parseJsonFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function getBackupPath(filePath) {
  const fileName = path.basename(filePath);
  return path.join(BACKUP_DIR, `${fileName}.bak`);
}

function writeFileAtomic(filePath, data) {
  const tempPath = `${filePath}.tmp`;
  const backupPath = getBackupPath(filePath);
  const json = JSON.stringify(data, null, 2);

  fs.writeFileSync(tempPath, json, 'utf8');

  if (fs.existsSync(filePath)) {
    fs.copyFileSync(filePath, backupPath);
  } else {
    fs.writeFileSync(backupPath, json, 'utf8');
  }

  fs.renameSync(tempPath, filePath);
}

function loadWithRecovery(filePath, normalizer, fallback) {
  try {
    return normalizer(parseJsonFile(filePath));
  } catch (error) {
    try {
      const backupPath = getBackupPath(filePath);
      if (fs.existsSync(backupPath)) {
        const recovered = normalizer(parseJsonFile(backupPath));
        writeFileAtomic(filePath, recovered);
        return recovered;
      }
    } catch (backupError) {}

    writeFileAtomic(filePath, fallback);
    return normalizer(fallback);
  }
}

function loadData() {
  ensureBaseFiles();
  return loadWithRecovery(DATA_FILE, normalizeData, DEFAULT_DATA);
}

function saveData(data) {
  ensureBaseFiles();
  writeFileAtomic(DATA_FILE, normalizeData(data));
}

function loadTeams() {
  ensureBaseFiles();
  return loadWithRecovery(TEAMS_FILE, normalizeTeams, DEFAULT_TEAMS);
}

function saveTeams(teams) {
  ensureBaseFiles();
  writeFileAtomic(TEAMS_FILE, normalizeTeams(teams));
}

function saveAll(data, teams) {
  saveData(data);
  saveTeams(teams);
}

function resetData() {
  const fresh = normalizeData(DEFAULT_DATA);
  saveData(fresh);
  return fresh;
}

ensureBaseFiles();

module.exports = {
  loadData,
  saveData,
  loadTeams,
  saveTeams,
  saveAll,
  resetData,
  normalizeData,
  normalizeTeams
};
