const { client, waitReady } = require('./bot/client');
const state = require('./bot/state');
const { TOKEN } = require('./bot/config');
const { loadData, loadTeams, initializeFiles } = require('./storage');

const {
  refreshStateFromDisk,
  setDataState,
  setTeamsState,
  saveState,
  saveEverything,
  getTournamentSettings,
  getTournamentMessages,
  getBotConfig,
  saveBotPanelSettings,
  resetAllState,
  setCurrentMatch,
  nextMatch
} = require('./bot/lifecycle');

const {
  updateLeaderboard,
  updateLeaderboardGraphics,
  updateRegistrationStatusMessage,
  handleRegistrationStateChange,
  spawnRegisterPanel,
  spawnResultsPanel,
  refreshSavedPanels,
  updateSavedResultsPanelIfExists,
  updateSavedRegisterPanelIfExists,
  ensureTournamentDiscordStructure,
  refreshTeamResultPanels,
  setCurrentMatchAndRefresh,
  nextMatchAndRefresh
} = require('./bot/panels');

const {
  approvePending,
  rejectPending,
  submitWebResult
} = require('./bot/submissions');

const {
  sendMessageToChannel,
  sendGeneralAnnouncement,
  createTeamRooms,
  deleteTeamRooms,
  sendLobbyCodeToTeamRooms,
  listDiscordChannels,
  diagnosePanels
} = require('./bot/channels');

const {
  sendAutomaticReminder,
  startAutomaticReminderScheduler,
  automaticReminderTick
} = require('./bot/reminders');

const { calcPoints } = require('./bot/helpers');

const { registerEvents } = require('./bot/events');

// Inizializza stato in memoria al boot
state.data = loadData();
state.teams = loadTeams();

// Registra tutti gli event handler Discord
registerEvents();

client.login(TOKEN);

module.exports = {
  client,
  waitReady,
  getData: () => state.data,
  getTeams: () => state.teams,
  setDataState,
  setTeamsState,
  saveState,
  saveEverything,
  updateLeaderboard,
  updateLeaderboardGraphics,
  updateRegistrationStatusMessage,
  handleRegistrationStateChange,
  approvePending,
  rejectPending,
  spawnRegisterPanel,
  spawnResultsPanel,
  refreshSavedPanels,
  updateSavedResultsPanelIfExists,
  updateSavedRegisterPanelIfExists,
  ensureTournamentDiscordStructure,
  createTeamRooms,
  deleteTeamRooms,
  sendLobbyCodeToTeamRooms,
  sendMessageToChannel,
  sendGeneralAnnouncement,
  sendAutomaticReminder,
  startAutomaticReminderScheduler,
  automaticReminderTick,
  nextMatch,
  nextMatchAndRefresh,
  setCurrentMatch,
  setCurrentMatchAndRefresh,
  submitWebResult,
  getBotConfig,
  resetAllState,
  saveBotPanelSettings,
  refreshTeamResultPanels,
  diagnosePanels,
  getTournamentSettings,
  getTournamentMessages,
  calcPoints,
  listDiscordChannels
};
