const state = require('./state');
const { sanitizeText, sanitizePositiveInteger, buildSubmissionKey, normalizeSubmissionTeamName, FIXED_TOURNAMENT_NAME, MAX_TEAMS, PLAYERS_PER_TEAM } = require('./helpers');
const { GUILD_ID, STAFF_CHANNEL, CLASSIFICA_CHANNEL, STORICO_CHANNEL, TOURNAMENT_FULL_CHANNEL, REGISTRATION_STATUS_CHANNEL } = require('./config');
const {
  loadData,
  loadTeams,
  saveData,
  saveAll,
  appendAuditLog,
  getDefaultData,
  getDefaultTournamentMessages
} = require('../storage');

const TOURNAMENT_CATEGORY_NAME = '🏆・RØDA CUP';

function refreshStateFromDisk() {
  state.data = loadData();
  state.teams = loadTeams();
  ensureDataStructures();
}

function ensureDataStructures() {
  if (!state.data || typeof state.data !== 'object') {
    state.data = getDefaultData();
  }

  const defaults = getDefaultData();

  if (!state.data.projectSettings || typeof state.data.projectSettings !== 'object') {
    state.data.projectSettings = defaults.projectSettings;
  }
  state.data.projectSettings.tournamentName = FIXED_TOURNAMENT_NAME;

  if (!state.data.tournamentSettings || typeof state.data.tournamentSettings !== 'object') {
    state.data.tournamentSettings = defaults.tournamentSettings;
  }
  state.data.tournamentSettings.tournamentName = FIXED_TOURNAMENT_NAME;
  state.data.tournamentSettings.playersPerTeam = PLAYERS_PER_TEAM;
  state.data.tournamentSettings.maxTeams = MAX_TEAMS;
  state.data.tournamentSettings.lockedRules = true;
  state.data.tournamentSettings.lockedPoints = true;

  if (!Number.isInteger(Number(state.data.tournamentSettings.totalMatches)) || Number(state.data.tournamentSettings.totalMatches) <= 0) {
    state.data.tournamentSettings.totalMatches = 3;
  }

  if (!Object.prototype.hasOwnProperty.call(state.data.tournamentSettings, 'autoNextMatch')) {
    state.data.tournamentSettings.autoNextMatch = true;
  }

  if (!state.data.tournamentLifecycle || typeof state.data.tournamentLifecycle !== 'object') {
    state.data.tournamentLifecycle = defaults.tournamentLifecycle || { state: 'bozza', updatedAt: null, updatedBy: '' };
  }

  if (!state.data.botSettings || typeof state.data.botSettings !== 'object') {
    state.data.botSettings = defaults.botSettings;
  }

  const botDefaults = ['registerPanelMessageId', 'registerPanelChannelId', 'resultsPanelMessageId', 'resultsPanelChannelId', 'roomsCategoryId', 'generalChannelId', 'rulesChannelId', 'lobbyChannelId', 'leaderboardChannelId'];
  for (const key of botDefaults) {
    if (!Object.prototype.hasOwnProperty.call(state.data.botSettings, key)) {
      state.data.botSettings[key] = key.endsWith('Id') && !key.endsWith('MessageId') ? '' : null;
    }
  }

  if (!state.data.tournamentMessages || typeof state.data.tournamentMessages !== 'object') {
    state.data.tournamentMessages = defaults.tournamentMessages;
  }
  state.data.tournamentMessages.regulationText = defaults.tournamentMessages.regulationText;

  if (!state.data.pending || typeof state.data.pending !== 'object') state.data.pending = {};
  if (!state.data.tempSubmit || typeof state.data.tempSubmit !== 'object') state.data.tempSubmit = {};
  if (!state.data.resultSubmissions || typeof state.data.resultSubmissions !== 'object') state.data.resultSubmissions = {};
  if (!state.data.scores || typeof state.data.scores !== 'object') state.data.scores = {};
  if (!state.data.fragger || typeof state.data.fragger !== 'object') state.data.fragger = {};

  for (const key of ['leaderboardMessageId', 'leaderboardGraphicMessageId', 'topFraggerGraphicMessageId', 'registrationStatusMessageId', 'registrationGraphicMessageId']) {
    if (!Object.prototype.hasOwnProperty.call(state.data, key)) state.data[key] = null;
  }

  if (!Object.prototype.hasOwnProperty.call(state.data, 'registrationClosedAnnounced')) state.data.registrationClosedAnnounced = false;
  if (!Object.prototype.hasOwnProperty.call(state.data, 'lastRegistrationGraphicSignature')) state.data.lastRegistrationGraphicSignature = null;

  state.data.registrationMaxTeams = MAX_TEAMS;
}

function saveState() {
  ensureDataStructures();
  try {
    const diskData = loadData();
    if (Array.isArray(diskData.reports) && diskData.reports.length > 0) {
      if (!Array.isArray(state.data.reports) || state.data.reports.length < diskData.reports.length) {
        state.data.reports = diskData.reports;
      }
    }
  } catch {}
  state.data = saveData(state.data);
}

function saveEverything() {
  ensureDataStructures();
  const saved = saveAll(state.data, state.teams);
  state.data = saved.data;
  state.teams = saved.teams;
}

function setDataState(newData) {
  state.data = newData;
  ensureDataStructures();
}

function setTeamsState(newTeams) {
  state.teams = newTeams || {};
}

function logAudit(actor, source, action, details = {}) {
  try {
    appendAuditLog({
      actor: sanitizeText(actor) || 'system',
      source: sanitizeText(source) || 'system',
      action: sanitizeText(action) || 'unknown',
      details: details && typeof details === 'object' ? details : {}
    });
  } catch (err) {
    console.error('Errore audit log:', err);
  }
}

function getProjectSettings() {
  const safe = state.data?.projectSettings || {};
  return {
    brandName: sanitizeText(safe.brandName) || 'RØDA',
    tournamentName: FIXED_TOURNAMENT_NAME,
    supportContact: sanitizeText(safe.supportContact),
    premiumMode: Boolean(safe.premiumMode),
    setupCompleted: Boolean(safe.setupCompleted)
  };
}

function getTournamentSettings() {
  const safe = state.data?.tournamentSettings || {};
  return {
    tournamentName: FIXED_TOURNAMENT_NAME,
    totalMatches: sanitizePositiveInteger(safe.totalMatches, 3, 50),
    playersPerTeam: PLAYERS_PER_TEAM,
    maxTeams: MAX_TEAMS,
    lockedRules: true,
    lockedPoints: true,
    autoNextMatch: safe.autoNextMatch !== false,
    createdAt: safe.createdAt || null,
    createdBy: sanitizeText(safe.createdBy),
    lastConfiguredAt: safe.lastConfiguredAt || null,
    lastConfiguredBy: sanitizeText(safe.lastConfiguredBy)
  };
}

function getTournamentMessages() {
  const defaults = getDefaultTournamentMessages ? getDefaultTournamentMessages() : {};
  const safe = state.data?.tournamentMessages || {};
  return {
    generalAnnouncement: sanitizeText(safe.generalAnnouncement) || defaults.generalAnnouncement || '',
    lobbyInfoMessage: sanitizeText(safe.lobbyInfoMessage) || defaults.lobbyInfoMessage || '',
    regulationText: defaults.regulationText || safe.regulationText || '',
    openRegistrationsAnnouncement: sanitizeText(safe.openRegistrationsAnnouncement) || defaults.openRegistrationsAnnouncement || '',
    closeRegistrationsAnnouncement: sanitizeText(safe.closeRegistrationsAnnouncement) || defaults.closeRegistrationsAnnouncement || '',
    tournamentStartAnnouncement: sanitizeText(safe.tournamentStartAnnouncement) || defaults.tournamentStartAnnouncement || '',
    nextMatchAnnouncement: sanitizeText(safe.nextMatchAnnouncement) || defaults.nextMatchAnnouncement || '',
    forcedNextMatchAnnouncement: sanitizeText(safe.forcedNextMatchAnnouncement) || defaults.forcedNextMatchAnnouncement || '',
    tournamentFinishedAnnouncement: sanitizeText(safe.tournamentFinishedAnnouncement) || defaults.tournamentFinishedAnnouncement || '',
    generalReminder: sanitizeText(safe.generalReminder) || defaults.generalReminder || ''
  };
}

function getBotSettings() {
  const safe = state.data?.botSettings || {};
  return {
    registerPanelMessageId: safe.registerPanelMessageId || null,
    registerPanelChannelId: sanitizeText(safe.registerPanelChannelId),
    resultsPanelMessageId: safe.resultsPanelMessageId || null,
    resultsPanelChannelId: sanitizeText(safe.resultsPanelChannelId),
    roomsCategoryId: sanitizeText(safe.roomsCategoryId),
    generalChannelId: sanitizeText(safe.generalChannelId),
    rulesChannelId: sanitizeText(safe.rulesChannelId),
    lobbyChannelId: sanitizeText(safe.lobbyChannelId),
    leaderboardChannelId: sanitizeText(safe.leaderboardChannelId)
  };
}

function normalizeTournamentState(value) {
  const s = sanitizeText(value).toLowerCase();
  if (['bozza', 'draft', 'created', 'idle', 'setup'].includes(s)) return 'bozza';
  if (['iscrizioni_aperte', 'registrazioni_aperte', 'registrations_open', 'registration_open', 'open_registrations'].includes(s)) return 'iscrizioni_aperte';
  if (['iscrizioni_chiuse', 'registrazioni_chiuse', 'registrations_closed', 'registration_closed', 'close_registrations', 'closed_registrations'].includes(s)) return 'iscrizioni_chiuse';
  if (['torneo_in_corso', 'running', 'started', 'in_progress', 'tournament_running'].includes(s)) return 'torneo_in_corso';
  if (['torneo_finito', 'finished', 'ended', 'completed', 'tournament_finished'].includes(s)) return 'torneo_finito';
  return s || 'bozza';
}

function areRegistrationsOpen() {
  ensureDataStructures();
  return normalizeTournamentState(state.data?.tournamentLifecycle?.state) === 'iscrizioni_aperte';
}

function getRegistrationLimit() {
  return MAX_TEAMS;
}

function getTournamentTotalMatches() {
  return sanitizePositiveInteger(state.data?.tournamentSettings?.totalMatches, 3, 50);
}

function getSavedRoomsCategoryId() {
  return getBotSettings().roomsCategoryId || '';
}

function getSortedTeamEntries() {
  return Object.entries(state.teams || {}).sort((a, b) => {
    const slotA = Number(a[1]?.slot || 999999);
    const slotB = Number(b[1]?.slot || 999999);
    if (slotA !== slotB) return slotA - slotB;
    return a[0].localeCompare(b[0], 'it');
  });
}

function getDisplayTeams() {
  return getSortedTeamEntries().map(([teamName, teamData], index) => {
    const numericSlot = Number(teamData?.slot);
    const slot = Number.isInteger(numericSlot) && numericSlot > 0 ? numericSlot : index + 1;
    return { teamName, slot, players: Array.isArray(teamData?.players) ? teamData.players : [] };
  });
}

function getSortedScores() {
  return Object.entries(state.data.scores || {})
    .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))
    .map(([teamName, points], index) => ({ rank: index + 1, teamName, points: Number(points || 0) }));
}

function getSortedFraggers() {
  return Object.entries(state.data.fragger || {})
    .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))
    .map(([playerName, kills], index) => ({ rank: index + 1, playerName, kills: Number(kills || 0) }));
}

function getNextAvailableSlot(limit = getRegistrationLimit()) {
  const used = new Set(
    Object.values(state.teams || {})
      .map(team => Number(team?.slot))
      .filter(slot => Number.isInteger(slot) && slot >= 1)
  );
  for (let i = 1; i <= limit; i++) {
    if (!used.has(i)) return i;
  }
  return null;
}

function isTournamentFull() {
  return Object.keys(state.teams || {}).length >= getRegistrationLimit();
}

function getTeamBySlot(slot) {
  const numericSlot = Number(slot);
  if (!Number.isInteger(numericSlot) || numericSlot <= 0) return null;
  for (const [teamName, teamData] of Object.entries(state.teams || {})) {
    if (Number(teamData?.slot) === numericSlot) return { teamName, teamData };
  }
  return null;
}

function getPendingForTeamMatch(teamName, matchNumber) {
  const targetTeam = normalizeSubmissionTeamName(teamName);
  const targetMatch = Number(matchNumber || 1);
  for (const [id, entry] of Object.entries(state.data.pending || {})) {
    if (normalizeSubmissionTeamName(entry?.team) === targetTeam && Number(entry?.matchNumber || 1) === targetMatch) {
      return { id, ...entry };
    }
  }
  return null;
}

function getSubmissionRecord(teamName, matchNumber) {
  const key = buildSubmissionKey(teamName, matchNumber);
  const saved = state.data.resultSubmissions?.[key];
  if (saved) {
    return {
      team: saved.team || teamName,
      matchNumber: Number(saved.matchNumber || matchNumber || 1),
      status: saved.status || 'non_inviato',
      pendingId: saved.pendingId || null,
      updatedAt: saved.updatedAt || '',
      updatedBy: saved.updatedBy || '',
      source: saved.source || ''
    };
  }
  const pending = getPendingForTeamMatch(teamName, matchNumber);
  if (pending) {
    return {
      team: pending.team || teamName,
      matchNumber: Number(pending.matchNumber || matchNumber || 1),
      status: 'in_attesa',
      pendingId: pending.id,
      updatedAt: '',
      updatedBy: pending.submittedBy || '',
      source: pending.source || ''
    };
  }
  return { team: teamName, matchNumber: Number(matchNumber || 1), status: 'non_inviato', pendingId: null, updatedAt: '', updatedBy: '', source: '' };
}

function markSubmission(teamName, matchNumber, status, extra = {}) {
  ensureDataStructures();
  const key = buildSubmissionKey(teamName, matchNumber);
  state.data.resultSubmissions[key] = {
    team: sanitizeText(teamName),
    matchNumber: Number(matchNumber || 1),
    status: sanitizeText(status) || 'non_inviato',
    pendingId: extra.pendingId || null,
    updatedAt: new Date().toISOString(),
    updatedBy: sanitizeText(extra.updatedBy || ''),
    source: sanitizeText(extra.source || '')
  };
}

function canSubmitResult(teamName, matchNumber) {
  const record = getSubmissionRecord(teamName, matchNumber);
  if (record.status === 'in_attesa') {
    return { allowed: false, message: `❌ Il team **${teamName}** ha già inviato il risultato del Match ${matchNumber}. Deve aspettare la decisione dello staff.` };
  }
  if (record.status === 'approvato' || record.status === 'inserito_manualmente') {
    return { allowed: false, message: `❌ Il risultato del Match ${matchNumber} per il team **${teamName}** è già stato registrato. Non puoi inviarlo due volte.` };
  }
  return { allowed: true, message: '' };
}

function setCurrentMatch(match) {
  const targetMatch = sanitizePositiveInteger(match, 1, getTournamentTotalMatches());
  if (targetMatch > getTournamentTotalMatches()) {
    throw new Error(`Il torneo ha solo ${getTournamentTotalMatches()} match configurati.`);
  }
  state.data.currentMatch = targetMatch;
  saveState();
}

function nextMatch() {
  const current = Number(state.data.currentMatch || 1);
  const total = getTournamentTotalMatches();
  if (current >= total) {
    throw new Error(`Sei già all'ultimo match configurato (${total}).`);
  }
  state.data.currentMatch = current + 1;
  saveState();
  return state.data.currentMatch;
}

function resetAllState() {
  state.data = getDefaultData();
  ensureDataStructures();
  state.data = saveData(state.data, { allowReset: true });
}

function saveBotPanelSettings(settings = {}) {
  ensureDataStructures();
  const fields = ['registerPanelChannelId', 'resultsPanelChannelId', 'roomsCategoryId', 'generalChannelId', 'rulesChannelId', 'lobbyChannelId', 'leaderboardChannelId'];
  for (const key of fields) {
    if (Object.prototype.hasOwnProperty.call(settings, key)) {
      state.data.botSettings[key] = sanitizeText(settings[key]);
    }
  }
  saveState();
  logAudit('dashboard', 'web', 'impostazioni_bot_salvate', { ...state.data.botSettings });
  return getBotSettings();
}

function getBotConfig() {
  const botSettings = getBotSettings();
  const project = getProjectSettings();
  const tournament = getTournamentSettings();
  return {
    guildId: GUILD_ID,
    staffChannel: STAFF_CHANNEL,
    classificaChannel: CLASSIFICA_CHANNEL,
    categoryId: getSavedRoomsCategoryId(),
    storicoChannel: STORICO_CHANNEL,
    tournamentFullChannel: TOURNAMENT_FULL_CHANNEL,
    registrationStatusChannel: REGISTRATION_STATUS_CHANNEL,
    ...botSettings,
    brandName: project.brandName,
    tournamentName: FIXED_TOURNAMENT_NAME,
    premiumMode: project.premiumMode,
    totalMatches: tournament.totalMatches,
    playersPerTeam: PLAYERS_PER_TEAM,
    maxTeams: MAX_TEAMS,
    registrationsOpen: areRegistrationsOpen()
  };
}

module.exports = {
  refreshStateFromDisk,
  ensureDataStructures,
  saveState,
  saveEverything,
  setDataState,
  setTeamsState,
  logAudit,
  getProjectSettings,
  getTournamentSettings,
  getTournamentMessages,
  getBotSettings,
  normalizeTournamentState,
  areRegistrationsOpen,
  getRegistrationLimit,
  getTournamentTotalMatches,
  getSavedRoomsCategoryId,
  getSortedTeamEntries,
  getDisplayTeams,
  getSortedScores,
  getSortedFraggers,
  getNextAvailableSlot,
  isTournamentFull,
  getTeamBySlot,
  getPendingForTeamMatch,
  getSubmissionRecord,
  markSubmission,
  canSubmitResult,
  setCurrentMatch,
  nextMatch,
  resetAllState,
  saveBotPanelSettings,
  getBotConfig,
  TOURNAMENT_CATEGORY_NAME,
  PLAYERS_PER_TEAM
};
