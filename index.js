const {
  Client,
  GatewayIntentBits,
  Partials,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
  AttachmentBuilder,
  ChannelType
} = require('discord.js');

const fs = require('fs');
const path = require('path');

const {
  loadData,
  loadTeams,
  saveData,
  saveAll,
  appendAuditLog,
  getDefaultData,
  markReminderSent,
  REMINDER_TYPES,
  UPLOADS_DIR,
  addReport,
  updateReportProofUrl
} = require('./storage');

const {
  generateLeaderboardGraphicBuffer,
  generateTopFraggerGraphicBuffer,
  generateRegisteredTeamsGraphicBuffer
} = require('./renderer');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates
  ],
  partials: [Partials.Channel]
});

const TOKEN = process.env.TOKEN;
const GUILD_ID = process.env.GUILD_ID || '';
const STAFF_CHANNEL = process.env.STAFF_CHANNEL || '';
const CLASSIFICA_CHANNEL = process.env.CLASSIFICA_CHANNEL || '';
const CATEGORY_ID = process.env.CATEGORY_ID || '';
const STORICO_CHANNEL = process.env.STORICO_CHANNEL || '';
const TOURNAMENT_FULL_CHANNEL = process.env.TOURNAMENT_FULL_CHANNEL || STAFF_CHANNEL;
const REGISTRATION_STATUS_CHANNEL = process.env.REGISTRATION_STATUS_CHANNEL || '';

const FIXED_TOURNAMENT_NAME = 'RØDA CUP';
const TOURNAMENT_CATEGORY_NAME = '🏆・RØDA CUP';
const GENERAL_CHANNEL_NAME = '💬・generale';
const RULES_CHANNEL_NAME = '📜・regolamento';
const REGISTRATION_CHANNEL_NAME = '📝・iscrizioni';
const MAX_TEAMS = 16;
const PLAYERS_PER_TEAM = 3;

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

let teams = loadTeams();
let data = loadData();

try {
  const lc = data?.tournamentLifecycle || {};
  const teamCount = Object.keys(teams || {}).length;
  console.log('[STARTUP] Stato torneo letto dal disco:', {
    state: lc.state || 'sconosciuto',
    registrationsOpen: lc.registrationsOpen,
    tournamentStarted: lc.tournamentStarted,
    tournamentFinished: lc.tournamentFinished,
    registrationsOpenedAt: lc.registrationsOpenedAt,
    registrationsOpenedBy: lc.registrationsOpenedBy,
    teamRegistrati: teamCount,
    matchCorrente: data?.currentMatch
  });
} catch (e) {
  console.error('[STARTUP] Errore log diagnostica stato torneo:', e?.message);
}

let readyResolver;
const readyPromise = new Promise(resolve => {
  readyResolver = resolve;
});

let registrationStatusUpdateQueue = Promise.resolve();
let leaderboardUpdateQueue = Promise.resolve();

const pendingReportProof = new Map();

function sanitizeText(value) {
  return String(value || '').trim();
}

function sanitizePositiveInteger(value, fallback = 1, max = 9999) {
  const num = Number(value);
  if (!Number.isInteger(num) || num <= 0) return fallback;
  return Math.min(num, max);
}

function normalizeBaseUrl(value) {
  const clean = String(value || '').trim();
  if (!clean) return '';
  return clean.endsWith('/') ? clean.slice(0, -1) : clean;
}

function getPublicBaseUrl() {
  const explicit = normalizeBaseUrl(process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL);
  if (explicit) return explicit;

  const railwayDomain = sanitizeText(process.env.RAILWAY_PUBLIC_DOMAIN);
  if (railwayDomain) return `https://${railwayDomain}`;

  return '';
}

function buildPublicUploadUrl(fileName) {
  const baseUrl = getPublicBaseUrl();
  if (!baseUrl) return `/uploads/${fileName}`;
  return `${baseUrl}/uploads/${fileName}`;
}

function refreshStateFromDisk() {
  data = loadData();
  teams = loadTeams();
  ensureDataStructures();
}

function ensureDataStructures() {
  if (!data || typeof data !== 'object') {
    data = getDefaultData();
  }

  const defaults = getDefaultData();

  if (!data.projectSettings || typeof data.projectSettings !== 'object') {
    data.projectSettings = defaults.projectSettings;
  }

  data.projectSettings.tournamentName = FIXED_TOURNAMENT_NAME;

  if (!data.tournamentSettings || typeof data.tournamentSettings !== 'object') {
    data.tournamentSettings = defaults.tournamentSettings;
  }

  data.tournamentSettings.tournamentName = FIXED_TOURNAMENT_NAME;
  data.tournamentSettings.playersPerTeam = PLAYERS_PER_TEAM;
  data.tournamentSettings.maxTeams = MAX_TEAMS;
  data.tournamentSettings.lockedRules = true;
  data.tournamentSettings.lockedPoints = true;

  if (!Number.isInteger(Number(data.tournamentSettings.totalMatches)) || Number(data.tournamentSettings.totalMatches) <= 0) {
    data.tournamentSettings.totalMatches = 3;
  }

  if (!Object.prototype.hasOwnProperty.call(data.tournamentSettings, 'autoNextMatch')) {
    data.tournamentSettings.autoNextMatch = true;
  }

  if (!data.tournamentLifecycle || typeof data.tournamentLifecycle !== 'object') {
    data.tournamentLifecycle = defaults.tournamentLifecycle || {
      state: 'bozza',
      updatedAt: null,
      updatedBy: ''
    };
  }

  if (!data.botSettings || typeof data.botSettings !== 'object') {
    data.botSettings = defaults.botSettings;
  }

  if (!Object.prototype.hasOwnProperty.call(data.botSettings, 'registerPanelMessageId')) {
    data.botSettings.registerPanelMessageId = null;
  }

  if (!Object.prototype.hasOwnProperty.call(data.botSettings, 'registerPanelChannelId')) {
    data.botSettings.registerPanelChannelId = '';
  }

  if (!Object.prototype.hasOwnProperty.call(data.botSettings, 'resultsPanelMessageId')) {
    data.botSettings.resultsPanelMessageId = null;
  }

  if (!Object.prototype.hasOwnProperty.call(data.botSettings, 'resultsPanelChannelId')) {
    data.botSettings.resultsPanelChannelId = '';
  }

  if (!Object.prototype.hasOwnProperty.call(data.botSettings, 'roomsCategoryId')) {
    data.botSettings.roomsCategoryId = '';
  }

  if (!Object.prototype.hasOwnProperty.call(data.botSettings, 'generalChannelId')) {
    data.botSettings.generalChannelId = '';
  }

  if (!Object.prototype.hasOwnProperty.call(data.botSettings, 'rulesChannelId')) {
    data.botSettings.rulesChannelId = '';
  }

  if (!Object.prototype.hasOwnProperty.call(data.botSettings, 'lobbyChannelId')) {
    data.botSettings.lobbyChannelId = '';
  }

  if (!Object.prototype.hasOwnProperty.call(data.botSettings, 'leaderboardChannelId')) {
    data.botSettings.leaderboardChannelId = '';
  }

  if (!data.tournamentMessages || typeof data.tournamentMessages !== 'object') {
    data.tournamentMessages = defaults.tournamentMessages;
  }

  data.tournamentMessages.regulationText = defaults.tournamentMessages.regulationText;

  if (!data.pending || typeof data.pending !== 'object') data.pending = {};
  if (!data.tempSubmit || typeof data.tempSubmit !== 'object') data.tempSubmit = {};
  if (!data.resultSubmissions || typeof data.resultSubmissions !== 'object') data.resultSubmissions = {};
  if (!data.scores || typeof data.scores !== 'object') data.scores = {};
  if (!data.fragger || typeof data.fragger !== 'object') data.fragger = {};

  if (!Object.prototype.hasOwnProperty.call(data, 'leaderboardMessageId')) data.leaderboardMessageId = null;
  if (!Object.prototype.hasOwnProperty.call(data, 'leaderboardGraphicMessageId')) data.leaderboardGraphicMessageId = null;
  if (!Object.prototype.hasOwnProperty.call(data, 'topFraggerGraphicMessageId')) data.topFraggerGraphicMessageId = null;
  if (!Object.prototype.hasOwnProperty.call(data, 'registrationStatusMessageId')) data.registrationStatusMessageId = null;
  if (!Object.prototype.hasOwnProperty.call(data, 'registrationGraphicMessageId')) data.registrationGraphicMessageId = null;
  if (!Object.prototype.hasOwnProperty.call(data, 'registrationClosedAnnounced')) data.registrationClosedAnnounced = false;
  if (!Object.prototype.hasOwnProperty.call(data, 'lastRegistrationGraphicSignature')) data.lastRegistrationGraphicSignature = null;

  data.registrationMaxTeams = MAX_TEAMS;
}

function saveState() {
  ensureDataStructures();
  data = saveData(data);
}

function saveEverything() {
  ensureDataStructures();
  const saved = saveAll(data, teams);
  data = saved.data;
  teams = saved.teams;
}

function setDataState(newData) {
  data = newData;
  ensureDataStructures();
}

function setTeamsState(newTeams) {
  teams = newTeams || {};
}

function getProjectSettings() {
  const safe = data?.projectSettings || {};

  return {
    brandName: sanitizeText(safe.brandName) || 'RØDA',
    tournamentName: FIXED_TOURNAMENT_NAME,
    supportContact: sanitizeText(safe.supportContact),
    premiumMode: Boolean(safe.premiumMode),
    setupCompleted: Boolean(safe.setupCompleted)
  };
}

function getTournamentSettings() {
  const safe = data?.tournamentSettings || {};

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
  const defaults = getDefaultData().tournamentMessages || {};
  const safe = data?.tournamentMessages || {};

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
  const safe = data?.botSettings || {};

  return {
    registerPanelMessageId: safe.registerPanelMessageId || null,
    registerPanelChannelId: sanitizeText(safe.registerPanelChannelId),
    resultsPanelMessageId: safe.resultsPanelMessageId || null,
    resultsPanelChannelId: sanitizeText(safe.resultsPanelChannelId),
    roomsCategoryId: sanitizeText(safe.roomsCategoryId),
    generalChannelId: sanitizeText(safe.generalChannelId),
    rulesChannelId: sanitizeText(safe.rulesChannelId),
    lobbyChannelId: sanitizeText(safe.lobbyChannelId)
  };
}

function logAudit(actor, source, action, details = {}) {
  try {
    appendAuditLog({
      actor: sanitizeText(actor) || 'system',
      source: sanitizeText(source) || 'system',
      action: sanitizeText(action) || 'unknown',
      details: details && typeof details === 'object' ? details : {}
    });
  } catch (error) {
    console.error('Errore audit log:', error);
  }
}

function normalizeTournamentState(value) {
  const state = sanitizeText(value).toLowerCase();

  if (['bozza', 'draft', 'created', 'idle', 'setup'].includes(state)) return 'bozza';

  if ([
    'iscrizioni_aperte',
    'registrazioni_aperte',
    'registrations_open',
    'registration_open',
    'open_registrations'
  ].includes(state)) {
    return 'iscrizioni_aperte';
  }

  if ([
    'iscrizioni_chiuse',
    'registrazioni_chiuse',
    'registrations_closed',
    'registration_closed',
    'close_registrations',
    'closed_registrations'
  ].includes(state)) {
    return 'iscrizioni_chiuse';
  }

  if ([
    'torneo_in_corso',
    'running',
    'started',
    'in_progress',
    'tournament_running'
  ].includes(state)) {
    return 'torneo_in_corso';
  }

  if ([
    'torneo_finito',
    'finished',
    'ended',
    'completed',
    'tournament_finished'
  ].includes(state)) {
    return 'torneo_finito';
  }

  return state || 'bozza';
}

function areRegistrationsOpen() {
  ensureDataStructures();

  const lifecycleState = normalizeTournamentState(data?.tournamentLifecycle?.state);
  return lifecycleState === 'iscrizioni_aperte';
}

function getRegistrationLimit() {
  return MAX_TEAMS;
}

function getTournamentTotalMatches() {
  return sanitizePositiveInteger(data?.tournamentSettings?.totalMatches, 3, 50);
}

function getSavedRoomsCategoryId() {
  return getBotSettings().roomsCategoryId || CATEGORY_ID;
}

function getSortedTeamEntries() {
  return Object.entries(teams || {}).sort((a, b) => {
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

    return {
      teamName,
      slot,
      players: Array.isArray(teamData?.players) ? teamData.players : []
    };
  });
}

function getSortedScores() {
  return Object.entries(data.scores || {})
    .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))
    .map(([teamName, points], index) => ({
      rank: index + 1,
      teamName,
      points: Number(points || 0)
    }));
}

function getSortedFraggers() {
  return Object.entries(data.fragger || {})
    .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))
    .map(([playerName, kills], index) => ({
      rank: index + 1,
      playerName,
      kills: Number(kills || 0)
    }));
}

function chunkArray(list, size) {
  const chunks = [];
  for (let i = 0; i < list.length; i += size) {
    chunks.push(list.slice(i, i + size));
  }
  return chunks;
}

function getNextAvailableSlot(limit = getRegistrationLimit()) {
  const used = new Set(
    Object.values(teams || {})
      .map(team => Number(team?.slot))
      .filter(slot => Number.isInteger(slot) && slot >= 1)
  );

  for (let i = 1; i <= limit; i++) {
    if (!used.has(i)) return i;
  }

  return null;
}

function isTournamentFull() {
  return Object.keys(teams || {}).length >= getRegistrationLimit();
}

function sanitizeChannelNamePart(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildTeamVoiceChannelName(slot, teamName) {
  const safeSlot = Number.isInteger(Number(slot)) && Number(slot) > 0 ? Number(slot) : '-';
  const cleanTeam = sanitizeChannelNamePart(teamName) || 'TEAM';
  return `🏆・#${safeSlot} ${cleanTeam}`;
}

function getLogoUrl() {
  const logoPath = path.join(__dirname, 'public', 'roda-logo.png');
  if (!fs.existsSync(logoPath)) return null;

  const baseUrl = getPublicBaseUrl();
  if (!baseUrl) return null;

  const url = `${baseUrl}/roda-logo.png`;

  // Discord embed thumbnails require a valid absolute URL (https://)
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return url;
  } catch {
    return null;
  }
}

function getTeamBySlot(slot) {
  const numericSlot = Number(slot);
  if (!Number.isInteger(numericSlot) || numericSlot <= 0) return null;

  for (const [teamName, teamData] of Object.entries(teams || {})) {
    if (Number(teamData?.slot) === numericSlot) {
      return { teamName, teamData };
    }
  }

  return null;
}

function normalizeSubmissionTeamName(teamName) {
  return sanitizeText(teamName).toLowerCase();
}

function buildSubmissionKey(teamName, matchNumber) {
  return `${normalizeSubmissionTeamName(teamName)}::match_${Number(matchNumber || 1)}`;
}

function getPendingForTeamMatch(teamName, matchNumber) {
  const targetTeam = normalizeSubmissionTeamName(teamName);
  const targetMatch = Number(matchNumber || 1);

  for (const [id, entry] of Object.entries(data.pending || {})) {
    if (
      normalizeSubmissionTeamName(entry?.team) === targetTeam &&
      Number(entry?.matchNumber || 1) === targetMatch
    ) {
      return {
        id,
        ...entry
      };
    }
  }

  return null;
}

function getSubmissionRecord(teamName, matchNumber) {
  const key = buildSubmissionKey(teamName, matchNumber);
  const saved = data.resultSubmissions?.[key];

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

  return {
    team: teamName,
    matchNumber: Number(matchNumber || 1),
    status: 'non_inviato',
    pendingId: null,
    updatedAt: '',
    updatedBy: '',
    source: ''
  };
}

function markSubmission(teamName, matchNumber, status, extra = {}) {
  ensureDataStructures();

  const key = buildSubmissionKey(teamName, matchNumber);

  data.resultSubmissions[key] = {
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
    return {
      allowed: false,
      message: `❌ Il team **${teamName}** ha già inviato il risultato del Match ${matchNumber}. Deve aspettare la decisione dello staff.`
    };
  }

  if (record.status === 'approvato' || record.status === 'inserito_manualmente') {
    return {
      allowed: false,
      message: `❌ Il risultato del Match ${matchNumber} per il team **${teamName}** è già stato registrato. Non puoi inviarlo due volte.`
    };
  }

  return {
    allowed: true,
    message: ''
  };
}

function buildResultButtonCustomId(slot) {
  return `result_submit_slot_${Number(slot)}`;
}

function createRegisterPanelPayload() {
  const project = getProjectSettings();
  const logoUrl = getLogoUrl();
  const registered = Object.keys(teams || {}).length;
  const maxTeams = getRegistrationLimit();
  const isFull = registered >= maxTeams;
  const registrationsOpen = areRegistrationsOpen();
  const disabled = isFull || !registrationsOpen;

  const embed = new EmbedBuilder()
    .setColor(0x7b2cff)
    .setTitle(`🏆 ${project.tournamentName}`)
    .setDescription(
      `Benvenuto nel pannello iscrizioni ufficiale.\n\n` +
      `**Formato:** Team da 3 giocatori\n` +
      `**Iscrizioni:** ${registrationsOpen && !isFull ? 'Aperte' : 'Chiuse'}\n` +
      `**Team registrati:** ${registered}/${maxTeams}\n\n` +
      `${!registrationsOpen
        ? 'Le iscrizioni non sono ancora aperte. Attendi l’annuncio dello staff.'
        : isFull
          ? 'Le iscrizioni hanno raggiunto il limite massimo.'
          : 'Premi il pulsante qui sotto per registrare il tuo team.'}`
    )
    .setFooter({ text: 'Pannello registrazione torneo' });

  if (logoUrl) {
    try { embed.setThumbnail(logoUrl); } catch { /* invalid URL — skip */ }
  }

  const btn = new ButtonBuilder()
    .setCustomId('register_btn')
    .setLabel(disabled ? 'Registrazioni chiuse' : 'Registra team')
    .setStyle(disabled ? ButtonStyle.Secondary : ButtonStyle.Primary)
    .setDisabled(disabled);

  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(btn)]
  };
}

function createTeamResultPanelPayload(teamName, teamData) {
  const project = getProjectSettings();
  const logoUrl = getLogoUrl();
  const slot = Number(teamData?.slot || 0);
  const players = Array.isArray(teamData?.players) ? teamData.players : [];
  const matchNumber = Number(data.currentMatch || 1);
  const record = getSubmissionRecord(teamName, matchNumber);

  const alreadySent =
    record.status === 'in_attesa' ||
    record.status === 'approvato' ||
    record.status === 'inserito_manualmente';

  const statusText = alreadySent
    ? record.status === 'in_attesa'
      ? 'Risultato già inviato e in attesa dello staff.'
      : 'Risultato già registrato per questo match.'
    : 'Compila le kill dei 3 giocatori e la posizione finale. Dopo l’invio, allega lo screenshot della partita nella chat di questa stanza.';

  const embed = new EmbedBuilder()
    .setColor(0x7b2cff)
    .setTitle(`📸 Risultato Match ${matchNumber}`)
    .setDescription(
      `**Team:** ${teamName}\n` +
      `**Slot:** #${slot || '-'}\n` +
      `**Torneo:** ${project.tournamentName}\n\n` +
      `${statusText}\n\n` +
      `**Giocatori:**\n` +
      `• ${sanitizeText(players[0]) || 'Giocatore 1'}\n` +
      `• ${sanitizeText(players[1]) || 'Giocatore 2'}\n` +
      `• ${sanitizeText(players[2]) || 'Giocatore 3'}`
    )
    .setFooter({ text: `Pannello locale team • Match ${matchNumber}` });

  if (logoUrl) {
    try {
      embed.setThumbnail(logoUrl);
    } catch {
      // thumbnail URL invalid for discord.js — skip silently
    }
  }

  const submitBtn = new ButtonBuilder()
    .setCustomId(buildResultButtonCustomId(slot))
    .setLabel(alreadySent ? `Risultato Match ${matchNumber} già inviato` : `Invia risultato Match ${matchNumber}`)
    .setStyle(alreadySent ? ButtonStyle.Secondary : ButtonStyle.Primary)
    .setDisabled(alreadySent);

  const reportBtn = new ButtonBuilder()
    .setCustomId(`report_slot_${slot}`)
    .setLabel('⚠️ Segnala problema')
    .setStyle(ButtonStyle.Danger);

  const row = new ActionRowBuilder().addComponents(submitBtn, reportBtn);

  return {
    embeds: [embed],
    components: [row]
  };
}

async function waitReady() {
  await readyPromise;
  return client;
}

async function sendMessageToChannel(channelId, message) {
  await waitReady();

  const cleanChannelId = sanitizeText(channelId);
  const cleanMessage = sanitizeText(message);

  if (!cleanChannelId) {
    throw new Error('ID canale non valido');
  }

  if (!cleanMessage) {
    throw new Error('Messaggio vuoto');
  }

  const channel = await client.channels.fetch(cleanChannelId);

  if (!channel || typeof channel.send !== 'function') {
    throw new Error('Canale non valido o non scrivibile');
  }

  const sent = await channel.send({ content: cleanMessage });

  return {
    ok: true,
    messageId: sent.id,
    channelId: cleanChannelId
  };
}

async function sendGeneralAnnouncement(channelId, message) {
  return sendMessageToChannel(channelId, message);
}

const REMINDER_STATE_RULES = {
  iscrizioni: ['iscrizioni_aperte'],
  regolamento: ['iscrizioni_aperte', 'iscrizioni_chiuse', 'torneo_in_corso'],
  risultati: ['torneo_in_corso']
};

function resolveReminderPlaceholders(text, ctx = {}) {
  if (!text) return '';

  const channelTag = (id) => (id ? `<#${id}>` : '`(canale non configurato)`');

  const teamCount = Number(ctx.teamCount || 0);
  const maxTeams = Number(ctx.maxTeams || 16);

  const replacements = {
    '{canale_iscrizioni}': channelTag(ctx.registerPanelChannelId),
    '{canale_regolamento}': channelTag(ctx.rulesChannelId),
    '{canale_risultati}': channelTag(ctx.resultsPanelChannelId),
    '{canale_generale}': channelTag(ctx.generalChannelId),
    '{team_iscritti}': `${teamCount}/${maxTeams}`,
    '{slot_liberi}': String(Math.max(0, maxTeams - teamCount)),
    '{match_corrente}': String(ctx.currentMatch || 1),
    '{match_totali}': String(ctx.totalMatches || 3)
  };

  let out = String(text);
  for (const [key, val] of Object.entries(replacements)) {
    out = out.split(key).join(val);
  }
  return out;
}

function buildReminderContext(currentData, currentTeams) {
  const bot = currentData?.botSettings || {};
  return {
    registerPanelChannelId: bot.registerPanelChannelId || '',
    rulesChannelId: bot.rulesChannelId || '',
    resultsPanelChannelId: bot.resultsPanelChannelId || '',
    generalChannelId: bot.generalChannelId || '',
    teamCount: Object.keys(currentTeams || {}).length,
    maxTeams: Number(currentData?.registrationMaxTeams || 16),
    currentMatch: Number(currentData?.currentMatch || 1),
    totalMatches: Number(currentData?.tournamentSettings?.totalMatches || 3)
  };
}

async function sendAutomaticReminder(type, options = {}) {
  if (!REMINDER_TYPES.includes(type)) {
    throw new Error(`Tipo promemoria non valido: ${type}`);
  }

  refreshStateFromDisk();

  const reminder = data.automaticReminders?.reminders?.[type];
  if (!reminder) {
    throw new Error(`Promemoria "${type}" non trovato in configurazione.`);
  }

  const generalChannelId = data.botSettings?.generalChannelId || '';
  if (!generalChannelId) {
    throw new Error('Canale generale Discord non configurato. Vai in Discord → seleziona "# Canale generale".');
  }

  const ctx = buildReminderContext(data, teams);
  let finalMessage = resolveReminderPlaceholders(reminder.message, ctx);

  if (!/@everyone\b/i.test(finalMessage)) {
    finalMessage = `@everyone\n\n${finalMessage}`;
  }

  if (!finalMessage.trim()) {
    throw new Error(`Il testo del promemoria "${type}" è vuoto.`);
  }

  await waitReady();
  const channel = await client.channels.fetch(generalChannelId);
  if (!channel || typeof channel.send !== 'function') {
    throw new Error('Canale generale Discord non valido o non scrivibile');
  }

  const sent = await channel.send({
    content: finalMessage,
    allowedMentions: { parse: ['everyone'] }
  });

  if (!options.skipMark) {
    data = markReminderSent(data, type);
  }

  return { ok: true, type, channelId: generalChannelId, messageId: sent.id };
}

function isReminderDueNow(reminder, currentState) {
  if (!reminder.enabled) return false;

  const allowedStates = REMINDER_STATE_RULES[reminder._type] || [];
  if (!allowedStates.includes(currentState)) return false;

  if (!reminder.lastSentAt) return true;

  const last = Date.parse(reminder.lastSentAt);
  if (!Number.isFinite(last)) return true;

  const intervalMs = Math.max(1, Number(reminder.intervalHours || 12)) * 60 * 60 * 1000;
  return (Date.now() - last) >= intervalMs;
}

let reminderTickInProgress = false;
let reminderTickHandle = null;

async function automaticReminderTick() {
  if (reminderTickInProgress) return;
  reminderTickInProgress = true;

  try {
    refreshStateFromDisk();

    const config = data.automaticReminders;
    if (!config || !config.masterEnabled) return;

    const currentState = data.tournamentLifecycle?.state || 'bozza';
    const generalChannelId = data.botSettings?.generalChannelId || '';
    if (!generalChannelId) return;

    for (const type of REMINDER_TYPES) {
      const reminder = config.reminders[type];
      if (!reminder) continue;

      reminder._type = type;
      if (!isReminderDueNow(reminder, currentState)) continue;

      try {
        await sendAutomaticReminder(type);
        console.log(`[reminders] inviato promemoria "${type}" su Discord`);
      } catch (err) {
        console.error(`[reminders] errore invio "${type}":`, err.message || err);
      }
    }
  } catch (err) {
    console.error('[reminders] tick error:', err);
  } finally {
    reminderTickInProgress = false;
  }
}

function startAutomaticReminderScheduler() {
  if (reminderTickHandle) return;

  setTimeout(() => {
    automaticReminderTick().catch(err => console.error('[reminders] first tick error:', err));
  }, 30 * 1000);

  reminderTickHandle = setInterval(() => {
    automaticReminderTick().catch(err => console.error('[reminders] tick error:', err));
  }, 60 * 1000);

  console.log('[reminders] scheduler avviato (tick ogni 60s)');
}

function getDiscordChannelTypeLabel(type) {
  if (type === ChannelType.GuildCategory) return 'category';
  if (type === ChannelType.GuildText) return 'text';
  if (type === ChannelType.GuildVoice) return 'voice';
  if (type === ChannelType.GuildAnnouncement) return 'announcement';
  if (type === ChannelType.GuildStageVoice) return 'stage';
  if (type === ChannelType.GuildForum) return 'forum';
  return 'other';
}

async function listDiscordChannels() {
  await waitReady();

  const guild = await client.guilds.fetch(GUILD_ID);
  await guild.channels.fetch();

  const allChannels = [...guild.channels.cache.values()]
    .sort((a, b) => {
      const parentA = a.parentId || '';
      const parentB = b.parentId || '';

      if (a.type === ChannelType.GuildCategory && b.type !== ChannelType.GuildCategory) return -1;
      if (a.type !== ChannelType.GuildCategory && b.type === ChannelType.GuildCategory) return 1;

      if (parentA !== parentB) return parentA.localeCompare(parentB);

      const posA = Number(a.rawPosition ?? a.position ?? 0);
      const posB = Number(b.rawPosition ?? b.position ?? 0);

      if (posA !== posB) return posA - posB;

      return String(a.name || '').localeCompare(String(b.name || ''), 'it');
    });

  const categories = allChannels
    .filter(channel => channel.type === ChannelType.GuildCategory)
    .map(category => ({
      id: category.id,
      name: category.name,
      type: 'category',
      rawPosition: Number(category.rawPosition ?? category.position ?? 0),
      channels: allChannels
        .filter(channel => channel.parentId === category.id)
        .map(channel => ({
          id: channel.id,
          name: channel.name,
          type: getDiscordChannelTypeLabel(channel.type),
          rawType: channel.type,
          parentId: channel.parentId || null,
          rawPosition: Number(channel.rawPosition ?? channel.position ?? 0),
          sendable: typeof channel.send === 'function'
        }))
    }));

  const withoutCategory = allChannels
    .filter(channel => channel.type !== ChannelType.GuildCategory && !channel.parentId)
    .map(channel => ({
      id: channel.id,
      name: channel.name,
      type: getDiscordChannelTypeLabel(channel.type),
      rawType: channel.type,
      parentId: null,
      rawPosition: Number(channel.rawPosition ?? channel.position ?? 0),
      sendable: typeof channel.send === 'function'
    }));

  return {
    ok: true,
    guild: {
      id: guild.id,
      name: guild.name
    },
    categories,
    withoutCategory
  };
}

async function findOrCreateTournamentCategory(guild, preferredCategoryId = '') {
  await guild.channels.fetch();

  const cleanPreferredId = sanitizeText(preferredCategoryId);

  if (cleanPreferredId) {
    const existingById = await guild.channels.fetch(cleanPreferredId).catch(() => null);
    if (existingById && existingById.type === ChannelType.GuildCategory) {
      return {
        category: existingById,
        created: false
      };
    }
  }

  const existingByName = guild.channels.cache.find(channel =>
    channel.type === ChannelType.GuildCategory &&
    channel.name === TOURNAMENT_CATEGORY_NAME
  );

  if (existingByName) {
    return {
      category: existingByName,
      created: false
    };
  }

  const category = await guild.channels.create({
    name: TOURNAMENT_CATEGORY_NAME,
    type: ChannelType.GuildCategory,
    reason: 'Creazione struttura RØDA CUP'
  });

  return {
    category,
    created: true
  };
}

async function resolveTournamentCategory(customCategoryId = '') {
  await waitReady();
  refreshStateFromDisk();

  const guild = await client.guilds.fetch(GUILD_ID);
  await guild.channels.fetch();

  const categoryIdToUse = sanitizeText(customCategoryId) || getSavedRoomsCategoryId();

  if (categoryIdToUse) {
    const category = await guild.channels.fetch(categoryIdToUse).catch(() => null);

    if (category && category.type === ChannelType.GuildCategory) {
      data.botSettings.roomsCategoryId = category.id;
      saveState();

      return {
        guild,
        category,
        categoryId: category.id,
        created: false
      };
    }
  }

  const existingByName = guild.channels.cache.find(channel =>
    channel.type === ChannelType.GuildCategory &&
    channel.name === TOURNAMENT_CATEGORY_NAME
  );

  if (existingByName) {
    data.botSettings.roomsCategoryId = existingByName.id;
    saveState();

    return {
      guild,
      category: existingByName,
      categoryId: existingByName.id,
      created: false
    };
  }

  const category = await guild.channels.create({
    name: TOURNAMENT_CATEGORY_NAME,
    type: ChannelType.GuildCategory,
    reason: 'Creazione categoria RØDA CUP per stanze team'
  });

  data.botSettings.roomsCategoryId = category.id;
  saveState();

  return {
    guild,
    category,
    categoryId: category.id,
    created: true
  };
}

async function findOrCreateTextChannelInCategory(guild, category, channelName, topic = '') {
  await guild.channels.fetch();

  const existing = guild.channels.cache.find(channel =>
    channel.type === ChannelType.GuildText &&
    channel.parentId === category.id &&
    channel.name === channelName
  );

  if (existing) {
    if (topic && existing.topic !== topic) {
      await existing.setTopic(topic).catch(() => {});
    }

    return {
      channel: existing,
      created: false
    };
  }

  const channel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: category.id,
    topic,
    reason: `Creazione canale ${channelName} RØDA CUP`
  });

  return {
    channel,
    created: true
  };
}

async function ensureRulesMessage(rulesChannel) {
  const messages = getTournamentMessages();
  const regulationText = messages.regulationText || '';
  if (!regulationText) return { skipped: true };

  const recentMessages = await rulesChannel.messages.fetch({ limit: 20 }).catch(() => null);

  const embed = new EmbedBuilder()
    .setColor(0x7b2cff)
    .setTitle('📜 REGOLAMENTO UFFICIALE RØDA CUP')
    .setDescription(regulationText.slice(0, 4000))
    .setFooter({ text: 'Regolamento bloccato • Decisioni staff definitive' });

  if (recentMessages) {
    const existing = recentMessages.find(message =>
      message.author?.id === client.user?.id &&
      message.embeds?.[0]?.title === '📜 REGOLAMENTO UFFICIALE RØDA CUP'
    );

    if (existing) {
      await existing.edit({ embeds: [embed], content: '' }).catch(() => {});
      return { updated: true };
    }
  }

  await rulesChannel.send({ embeds: [embed] }).catch(() => {});
  return { created: true };
}

async function ensureGeneralMessage(generalChannel) {
  const messages = getTournamentMessages();
  const announcement = messages.generalAnnouncement || '';
  if (!announcement) return { skipped: true };

  const recentMessages = await generalChannel.messages.fetch({ limit: 20 }).catch(() => null);

  if (recentMessages) {
    const existing = recentMessages.find(message =>
      message.author?.id === client.user?.id &&
      message.content.includes('BENVENUTI ALLA RØDA CUP')
    );

    if (existing) {
      await existing.edit({ content: announcement }).catch(() => {});
      return { updated: true };
    }
  }

  await generalChannel.send({ content: announcement }).catch(() => {});
  return { created: true };
}

async function ensureTournamentDiscordStructure(customCategoryId = '') {
  await waitReady();
  refreshStateFromDisk();

  const guild = await client.guilds.fetch(GUILD_ID);

  const categoryResult = await findOrCreateTournamentCategory(
    guild,
    sanitizeText(customCategoryId) || getSavedRoomsCategoryId()
  );

  const category = categoryResult.category;

  const generalResult = await findOrCreateTextChannelInCategory(
    guild,
    category,
    GENERAL_CHANNEL_NAME,
    'Chat generale ufficiale della RØDA CUP'
  );

  const rulesResult = await findOrCreateTextChannelInCategory(
    guild,
    category,
    RULES_CHANNEL_NAME,
    'Regolamento ufficiale RØDA CUP'
  );

  const registrationResult = await findOrCreateTextChannelInCategory(
    guild,
    category,
    REGISTRATION_CHANNEL_NAME,
    'Canale iscrizioni ufficiale RØDA CUP'
  );

  await ensureGeneralMessage(generalResult.channel).catch(error => {
    console.error('Errore messaggio generale RØDA CUP:', error);
  });

  await ensureRulesMessage(rulesResult.channel).catch(error => {
    console.error('Errore messaggio regolamento RØDA CUP:', error);
  });

  data.botSettings.roomsCategoryId = category.id;
  data.botSettings.generalChannelId = generalResult.channel.id;
  data.botSettings.rulesChannelId = rulesResult.channel.id;
  data.botSettings.registerPanelChannelId = registrationResult.channel.id;
  saveState();

  let registerPanel = null;

  try {
    registerPanel = await spawnRegisterPanel(registrationResult.channel.id);
  } catch (error) {
    registerPanel = {
      ok: false,
      error: true,
      message: error.message || 'Errore creazione pannello iscrizioni'
    };

    console.error('Errore pannello iscrizioni RØDA CUP:', error);
  }

  logAudit('bot', 'discord', 'struttura_discord_torneo_preparata', {
    categoryId: category.id,
    categoryCreated: Boolean(categoryResult.created),
    generalChannelId: generalResult.channel.id,
    generalCreated: Boolean(generalResult.created),
    rulesChannelId: rulesResult.channel.id,
    rulesCreated: Boolean(rulesResult.created),
    registrationChannelId: registrationResult.channel.id,
    registrationCreated: Boolean(registrationResult.created),
    registerPanelCreated: Boolean(registerPanel?.created),
    registerPanelUpdated: Boolean(registerPanel?.updated)
  });

  return {
    ok: true,
    categoryId: category.id,
    categoryCreated: Boolean(categoryResult.created),
    generalChannelId: generalResult.channel.id,
    generalCreated: Boolean(generalResult.created),
    rulesChannelId: rulesResult.channel.id,
    rulesCreated: Boolean(rulesResult.created),
    registrationChannelId: registrationResult.channel.id,
    registrationCreated: Boolean(registrationResult.created),
    registerPanel
  };
}

async function safeSendToTeamVoiceChannel(channel, payload) {
  if (!channel) {
    throw new Error('Canale non valido');
  }

  if (typeof channel.send !== 'function') {
    throw new Error(`Il canale ${channel.name} non supporta messaggi testuali`);
  }

  const logErr = (attempt, err) => console.error(
    `[safeSend] ${channel.name} tentativo ${attempt} fallito:`,
    { code: err?.code, status: err?.status, msg: err?.message, raw: JSON.stringify(err?.rawError || {}).substring(0, 300) }
  );

  // Attempt 1: full embed + button + invisible content
  try {
    return await channel.send({ content: '\u200B', ...payload });
  } catch (err1) {
    logErr(1, err1);
  }

  // Attempt 2: embed without thumbnail + button + content
  try {
    const embedData = (payload.embeds || []).map(e => {
      const d = e.toJSON ? e.toJSON() : { ...e };
      delete d.thumbnail;
      return new EmbedBuilder(d);
    });
    return await channel.send({ content: '\u200B', embeds: embedData, components: payload.components || [] });
  } catch (err2) {
    logErr(2, err2);
  }

  // Attempt 3: button only, no embed
  try {
    const embedTitle = payload.embeds?.[0]?.data?.title || payload.embeds?.[0]?.title || '';
    const embedDesc = payload.embeds?.[0]?.data?.description || payload.embeds?.[0]?.description || '';
    const textContent = [embedTitle, embedDesc].filter(Boolean).join('\n').substring(0, 1800) || 'Pannello risultati team';
    return await channel.send({ content: textContent, components: payload.components || [] });
  } catch (err3) {
    logErr(3, err3);
  }

  // Attempt 4: plain text only (confirms channel accepts any message)
  try {
    return await channel.send({ content: '📋 Pannello risultati — usa il comando del bot per inviare il risultato.' });
  } catch (err4) {
    logErr(4, err4);
    throw new Error(`Impossibile inviare in ${channel.name}: ${err4?.message || 'errore sconosciuto'} [code:${err4?.code}]`);
  }
}

async function safeEditTeamPanelMessage(message, payload) {
  if (!message || typeof message.edit !== 'function') {
    throw new Error('Messaggio pannello non valido');
  }

  return message.edit(payload);
}

async function getVoiceTeamChannels(categoryIdToUse) {
  await waitReady();

  const guild = await client.guilds.fetch(GUILD_ID);
  await guild.channels.fetch();

  const cleanCategoryId = sanitizeText(categoryIdToUse) || getSavedRoomsCategoryId();

  if (!cleanCategoryId) {
    return {
      guild,
      channels: new Map(),
      categoryId: ''
    };
  }

  const normPrefix = '🏆・#'.normalize('NFKC');
  const channels = guild.channels.cache.filter(channel => {
    if (channel.parentId !== cleanCategoryId) return false;
    if (channel.type !== ChannelType.GuildVoice) return false;
    const normName = String(channel.name || '').normalize('NFKC');
    return normName.startsWith(normPrefix) || normName.startsWith('#') || normName.includes('・#') || normName.includes('・# ');
  });

  const allVoiceInCategory = guild.channels.cache
    .filter(ch => ch.parentId === cleanCategoryId && ch.type === ChannelType.GuildVoice)
    .map(ch => ({ id: ch.id, name: ch.name }));

  return {
    guild,
    channels,
    categoryId: cleanCategoryId,
    allVoiceInCategory
  };
}

async function findPanelMessageByButtonCustomId(channel, customId) {
  try {
    if (!channel || typeof channel.messages?.fetch !== 'function') {
      return null;
    }

    const messages = await channel.messages.fetch({ limit: 30 });

    for (const message of messages.values()) {
      if (message.author?.id !== client.user?.id) continue;

      const rows = Array.isArray(message.components) ? message.components : [];

      for (const row of rows) {
        const components = Array.isArray(row.components) ? row.components : [];

        for (const component of components) {
          if (component.customId === customId) {
            return message;
          }
        }
      }
    }
  } catch (error) {
    console.error(`Errore ricerca pannello in ${channel?.name || 'canale sconosciuto'}:`, error.message);
  }

  return null;
}

async function refreshTeamResultPanels(customCategoryId) {
  await waitReady();
  refreshStateFromDisk();

  const categoryIdToUse = sanitizeText(customCategoryId) || getSavedRoomsCategoryId();

  if (!categoryIdToUse) {
    return {
      ok: false,
      skipped: true,
      reason: 'Categoria non configurata'
    };
  }

  const { channels, allVoiceInCategory = [] } = await getVoiceTeamChannels(categoryIdToUse);
  const sortedTeams = getSortedTeamEntries();

  if (!sortedTeams.length) {
    return {
      ok: true,
      updated: 0,
      created: 0,
      missingRooms: 0,
      failed: 0,
      details: [],
      allVoiceInCategory,
      reason: 'Nessun team registrato'
    };
  }

  if (!channels.size) {
    return {
      ok: true,
      updated: 0,
      created: 0,
      missingRooms: sortedTeams.length,
      failed: 0,
      foundChannelNames: [],
      allVoiceInCategory,
      details: sortedTeams.map(([teamName, teamData]) => ({
        team: teamName,
        slot: Number(teamData?.slot || 0),
        status: 'missing_room',
        reason: `Nessuna stanza vocale corrispondente trovata nella categoria (totale canali vocali nella categoria: ${allVoiceInCategory.length})`
      }))
    };
  }

  const foundChannelNames = [...channels.values()].map(ch => ch.name);

  let updated = 0;
  let created = 0;
  let missingRooms = 0;
  let failed = 0;

  const details = [];
  const channelList = [...channels.values()];

  for (const [teamName, teamData] of sortedTeams) {
    const slot = Number(teamData?.slot || 0);

    const normalizeChannelName = str => String(str || '').normalize('NFKC').trim();
    const slotPrefix = normalizeChannelName(`🏆・#${slot}`);

    const channel = channelList.find(ch => {
      const normalized = normalizeChannelName(ch.name);
      return (
        normalized.startsWith(slotPrefix + ' ') ||
        normalized.startsWith(slotPrefix + '\u3000') ||
        normalized === slotPrefix ||
        normalized.includes(`#${slot} `) ||
        normalized.includes(`#${slot}\u3000`)
      );
    });

    if (!channel) {
      missingRooms++;

      details.push({
        team: teamName,
        slot,
        status: 'missing_room'
      });

      continue;
    }

    try {
      const customId = buildResultButtonCustomId(slot);
      const payload = createTeamResultPanelPayload(teamName, teamData);

      const existing = await findPanelMessageByButtonCustomId(channel, customId);

      if (existing) {
        try { await existing.delete(); } catch { /* già eliminato o permission denied */ }
        await safeSendToTeamVoiceChannel(channel, payload);
        updated++;

        details.push({
          team: teamName,
          slot,
          channelId: channel.id,
          channelName: channel.name,
          status: 'updated'
        });
      } else {
        await safeSendToTeamVoiceChannel(channel, payload);
        created++;

        details.push({
          team: teamName,
          slot,
          channelId: channel.id,
          channelName: channel.name,
          status: 'created'
        });
      }
    } catch (error) {
      failed++;

      const rawDetails = error?.rawError ? JSON.stringify(error.rawError).substring(0, 500) : null;
      const errorDetail = [
        error.message || 'Errore invio pannello',
        error.code ? `[code ${error.code}]` : null,
        rawDetails ? `raw: ${rawDetails}` : null
      ].filter(Boolean).join(' | ');

      details.push({
        team: teamName,
        slot,
        channelId: channel.id,
        channelName: channel.name,
        status: 'failed',
        error: errorDetail
      });

      console.error(`Errore pannello risultato ${teamName} in ${channel.name}:`, {
        message: error.message,
        code: error.code,
        status: error.status,
        rawError: error.rawError
      });
    }
  }

  logAudit('bot', 'discord', 'pannelli_risultati_team_aggiornati', {
    categoryId: categoryIdToUse,
    updated,
    created,
    missingRooms,
    failed,
    currentMatch: Number(data.currentMatch || 1)
  });

  return {
    ok: true,
    categoryId: categoryIdToUse,
    updated,
    created,
    missingRooms,
    failed,
    foundChannelNames,
    allVoiceInCategory,
    details
  };
}

async function diagnosePanels(customCategoryId) {
  await waitReady();
  refreshStateFromDisk();

  const categoryIdToUse = sanitizeText(customCategoryId) || getSavedRoomsCategoryId();
  const sortedTeams = getSortedTeamEntries();

  if (!categoryIdToUse) {
    return {
      error: 'Categoria non configurata — imposta una categoria nelle impostazioni Discord.',
      categoryId: '',
      sortedTeams: sortedTeams.map(([n, t]) => ({ name: n, slot: t?.slot })),
      allVoiceInCategory: [],
      filteredChannels: []
    };
  }

  const guild = await client.guilds.fetch(GUILD_ID);
  await guild.channels.fetch();

  const allVoiceInCategory = guild.channels.cache
    .filter(ch => ch.parentId === categoryIdToUse && ch.type === ChannelType.GuildVoice)
    .map(ch => ({ id: ch.id, name: ch.name, nameHex: Buffer.from(ch.name).toString('hex') }));

  const normPrefix = '🏆・#'.normalize('NFKC');
  const filteredChannels = allVoiceInCategory.filter(ch => {
    const n = String(ch.name || '').normalize('NFKC');
    return n.startsWith(normPrefix) || n.includes('・#') || n.includes('#');
  });

  const teamMatchInfo = sortedTeams.map(([teamName, teamData]) => {
    const slot = Number(teamData?.slot || 0);
    const slotPrefix = `🏆・#${slot}`.normalize('NFKC');
    const match = allVoiceInCategory.find(ch => {
      const n = String(ch.name || '').normalize('NFKC');
      return n.startsWith(slotPrefix + ' ') || n.startsWith(slotPrefix + '\u3000') || n === slotPrefix || n.includes(`#${slot} `) || n.includes(`#${slot}\u3000`);
    });
    return {
      team: teamName,
      slot,
      matchedChannel: match ? match.name : null,
      matchedChannelId: match ? match.id : null,
      status: slot === 0 ? 'slot_zero' : match ? 'ok' : 'no_match'
    };
  });

  return {
    categoryId: categoryIdToUse,
    totalVoiceInCategory: allVoiceInCategory.length,
    allVoiceInCategory,
    filteredChannels,
    teamMatchInfo,
    totalTeams: sortedTeams.length
  };
}

async function createTeamRooms(customCategoryId) {
  await waitReady();
  refreshStateFromDisk();

  const sortedTeams = getSortedTeamEntries();

  if (!sortedTeams.length) {
    throw new Error('Nessun team registrato');
  }

  const resolved = await resolveTournamentCategory(customCategoryId);
  const guild = resolved.guild;
  const categoryIdToUse = resolved.categoryId;

  await guild.channels.fetch();

  const existingVoiceChannels = guild.channels.cache.filter(channel =>
    channel.parentId === categoryIdToUse &&
    channel.type === ChannelType.GuildVoice &&
    channel.name.startsWith('🏆・#')
  );

  const existingNames = new Set(existingVoiceChannels.map(channel => channel.name));

  let created = 0;
  let skipped = 0;
  let failed = 0;
  const details = [];

  for (const [teamName, teamData] of sortedTeams) {
    const slot = Number(teamData?.slot || 0);
    const channelName = buildTeamVoiceChannelName(slot, teamName);

    if (existingNames.has(channelName)) {
      skipped++;

      details.push({
        team: teamName,
        slot,
        channelName,
        status: 'skipped'
      });

      continue;
    }

    try {
      const channel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildVoice,
        parent: categoryIdToUse,
        reason: `Creazione stanza vocale team RØDA CUP: ${teamName}`
      });

      existingNames.add(channelName);
      created++;

      details.push({
        team: teamName,
        slot,
        channelId: channel.id,
        channelName,
        status: 'created'
      });
    } catch (error) {
      failed++;

      details.push({
        team: teamName,
        slot,
        channelName,
        status: 'failed',
        error: error.message || 'Errore creazione stanza'
      });

      console.error(`Errore creazione stanza team ${teamName}:`, error);
    }
  }

  data.botSettings.roomsCategoryId = categoryIdToUse;
  saveState();

  let teamPanels = null;

  try {
    teamPanels = await refreshTeamResultPanels(categoryIdToUse);
  } catch (error) {
    teamPanels = {
      ok: false,
      error: true,
      message: error.message || 'Errore aggiornamento pannelli risultato'
    };

    console.error('Errore creazione pannelli team dopo stanze:', error);
  }

  logAudit('dashboard', 'web', 'stanze_team_create', {
    categoryId: categoryIdToUse,
    categoryCreated: Boolean(resolved.created),
    created,
    skipped,
    failed,
    teamPanelsCreated: Number(teamPanels?.created || 0),
    teamPanelsUpdated: Number(teamPanels?.updated || 0),
    teamPanelsMissingRooms: Number(teamPanels?.missingRooms || 0),
    teamPanelsFailed: Number(teamPanels?.failed || 0)
  });

  return {
    ok: true,
    categoryId: categoryIdToUse,
    categoryCreated: Boolean(resolved.created),
    created,
    skipped,
    failed,
    details,
    teamPanels
  };
}

async function deleteTeamRooms(customCategoryId) {
  await waitReady();

  const guild = await client.guilds.fetch(GUILD_ID);
  const categoryIdToUse = sanitizeText(customCategoryId) || getSavedRoomsCategoryId();

  await guild.channels.fetch();

  const channels = guild.channels.cache.filter(channel =>
    channel.parentId === categoryIdToUse &&
    channel.type === ChannelType.GuildVoice &&
    channel.name.startsWith('🏆・#')
  );

  let deleted = 0;

  for (const channel of channels.values()) {
    try {
      await channel.delete('Eliminazione stanze vocali team RØDA CUP');
      deleted++;
    } catch (error) {
      console.error(`Errore eliminazione stanza ${channel.name}:`, error);
    }
  }

  data.botSettings.roomsCategoryId = categoryIdToUse;
  saveState();

  logAudit('dashboard', 'web', 'stanze_team_eliminate', {
    categoryId: categoryIdToUse,
    deleted
  });

  return {
    ok: true,
    deleted
  };
}

function buildRegistrationTextPages() {
  refreshStateFromDisk();

  const project = getProjectSettings();
  const displayTeams = getDisplayTeams();
  const title = sanitizeText(data.registrationStatusTitle) || '🏆 TEAM REGISTRATI';
  const intro = sanitizeText(data.registrationStatusText) || 'Lista team attualmente registrati nel torneo.';
  const limit = getRegistrationLimit();
  const freeSpots = Math.max(limit - displayTeams.length, 0);
  const registrationsOpen = areRegistrationsOpen();
  const isFull = displayTeams.length >= limit;

  const pages = [];
  const pageTeams = chunkArray(displayTeams, 10);

  const header =
    `# ${title}\n` +
    `**Torneo:** ${project.tournamentName}\n` +
    `${intro}\n\n` +
    `**Team registrati:** ${displayTeams.length}/${limit}\n` +
    `**Posti disponibili:** ${freeSpots}\n` +
    `**Stato:** ${registrationsOpen && !isFull ? 'Iscrizioni aperte' : 'Iscrizioni chiuse'}\n`;

  if (!pageTeams.length) {
    pages.push(`${header}\n**Nessun team registrato al momento.**`);
    return pages;
  }

  pageTeams.forEach((teamsChunk, pageIndex) => {
    const lines = teamsChunk.map(team => {
      const p1 = sanitizeText(team.players?.[0]) || 'Giocatore 1';
      const p2 = sanitizeText(team.players?.[1]) || 'Giocatore 2';
      const p3 = sanitizeText(team.players?.[2]) || 'Giocatore 3';

      return (
        `🏆 **#${team.slot} • ${team.teamName}**\n` +
        `👤 ${p1} • ${p2} • ${p3}`
      );
    });

    const pageHeader = pageTeams.length > 1
      ? `${header}\n**Pagina ${pageIndex + 1}/${pageTeams.length}**\n`
      : header;

    pages.push(`${pageHeader}\n${lines.join('\n\n')}`);
  });

  return pages;
}

function buildRegistrationEmbeds() {
  const project = getProjectSettings();
  const logoUrl = getLogoUrl();
  const pages = buildRegistrationTextPages();

  return pages.map((pageText, index) => {
    const embed = new EmbedBuilder()
      .setColor(0x7b2cff)
      .setTitle(index === 0 ? `🏆 ${project.tournamentName}` : `📑 Elenco team • Pagina ${index + 1}/${pages.length}`)
      .setDescription(pageText);

    if (logoUrl) {
      try { embed.setThumbnail(logoUrl); } catch { /* invalid URL — skip */ }
    }

    return embed;
  });
}

async function generateRegisteredTeamsGraphicSafe() {
  if (typeof generateRegisteredTeamsGraphicBuffer !== 'function') {
    throw new Error('Funzione generateRegisteredTeamsGraphicBuffer non disponibile nel renderer');
  }

  return generateRegisteredTeamsGraphicBuffer();
}

function computeRegistrationGraphicSignature() {
  try {
    const teamsObj = loadTeams() || {};
    const entries = Object.entries(teamsObj)
      .map(([name, team]) => {
        const slot = Number(team?.slot);
        const players = Array.isArray(team?.players) ? team.players.slice(0, 3) : [];
        return {
          slot: Number.isInteger(slot) && slot > 0 ? slot : 999999,
          name: String(name || '').toLowerCase(),
          players: [
            String(players[0] || '').toLowerCase(),
            String(players[1] || '').toLowerCase(),
            String(players[2] || '').toLowerCase()
          ]
        };
      })
      .sort((a, b) => {
        if (a.slot !== b.slot) return a.slot - b.slot;
        return a.name.localeCompare(b.name, 'it');
      })
      .slice(0, 16);

    const teamsKey = entries
      .map(e => `${e.slot}|${e.name}|${e.players.join(',')}`)
      .join(';');

    const statusKey = [
      areRegistrationsOpen() ? 'open' : 'closed',
      String(data.registrationStatusTitle || ''),
      String(data.registrationStatusText || '')
    ].join('||');

    return `v1:${entries.length}:${teamsKey}::${statusKey}`;
  } catch (error) {
    console.error('Errore calcolo signature grafica registrati:', error);
    return null;
  }
}

async function findExistingRegistrationMessage(channel) {
  const knownIds = [
    data.registrationGraphicMessageId,
    data.registrationStatusMessageId
  ].filter(Boolean);

  for (const id of knownIds) {
    try {
      const msg = await channel.messages.fetch(id);
      if (msg && msg.author?.id === client.user?.id) return msg;
    } catch (error) {
      // continua a cercare in cronologia
    }
  }

  try {
    const recent = await channel.messages.fetch({ limit: 50 });
    const botMessages = Array.from(recent.values())
      .filter(m => m.author?.id === client.user?.id)
      .sort((a, b) => b.createdTimestamp - a.createdTimestamp);

    if (botMessages.length === 0) return null;

    const keep = botMessages[0];
    const duplicates = botMessages.slice(1);
    for (const dup of duplicates) {
      await dup.delete().catch(error => {
        console.error('Errore eliminazione duplicato registrazioni:', error.message);
      });
    }
    if (duplicates.length) {
      console.log(`[registrazioni] eliminati ${duplicates.length} messaggi duplicati nel canale`);
    }

    return keep;
  } catch (error) {
    console.error('Errore scansione canale registrazioni:', error.message);
    return null;
  }
}

function queueRegistrationStatusUpdate(options = {}) {
  const force = options && options.force === true;

  registrationStatusUpdateQueue = registrationStatusUpdateQueue
    .then(async () => {
      await waitReady();
      refreshStateFromDisk();

      const signature = computeRegistrationGraphicSignature();
      const lastSignature = data.lastRegistrationGraphicSignature || null;
      const hasGraphicMessage = Boolean(data.registrationGraphicMessageId || data.registrationStatusMessageId);

      if (!force && signature && lastSignature === signature && hasGraphicMessage) {
        return {
          ok: true,
          updated: false,
          created: false,
          skipped: true,
          reason: 'no_changes',
          messageId: data.registrationGraphicMessageId || data.registrationStatusMessageId
        };
      }

      const channel = await client.channels.fetch(REGISTRATION_STATUS_CHANNEL);

      const existingMsg = await findExistingRegistrationMessage(channel);

      if (existingMsg) {
        const trackedId = data.registrationGraphicMessageId || data.registrationStatusMessageId || null;
        if (trackedId !== existingMsg.id) {
          data.registrationGraphicMessageId = existingMsg.id;
          data.registrationStatusMessageId = existingMsg.id;
          saveState();
        }
      }

      let graphicBuffer = null;
      let graphicError = null;

      try {
        graphicBuffer = await generateRegisteredTeamsGraphicSafe();
      } catch (error) {
        graphicError = error;
        console.error('Errore generazione grafica team registrati:', error);
      }

      if (graphicBuffer && graphicBuffer.length) {
        const stamp = Date.now();
        const attachment = new AttachmentBuilder(graphicBuffer, {
          name: `team-registrati-${stamp}.png`
        });

        if (existingMsg) {
          try {
            await existingMsg.edit({
              content: '',
              embeds: [],
              components: [],
              files: [attachment]
            });

            data.registrationGraphicMessageId = existingMsg.id;
            data.registrationStatusMessageId = existingMsg.id;
            if (signature) data.lastRegistrationGraphicSignature = signature;
            saveState();

            return {
              ok: true,
              updated: true,
              created: false,
              graphic: true,
              messageId: existingMsg.id
            };
          } catch (error) {
            console.error('Errore update grafica team registrati:', error);
          }
        }

        const msg = await channel.send({
          content: '',
          files: [attachment]
        });

        data.registrationGraphicMessageId = msg.id;
        data.registrationStatusMessageId = msg.id;
        if (signature) data.lastRegistrationGraphicSignature = signature;
        saveState();

        return {
          ok: true,
          updated: false,
          created: true,
          graphic: true,
          messageId: msg.id
        };
      }

      const embeds = buildRegistrationEmbeds();

      if (existingMsg) {
        try {
          await existingMsg.edit({
            content: '',
            embeds,
            components: [],
            attachments: []
          });

          data.registrationStatusMessageId = existingMsg.id;
          if (signature) data.lastRegistrationGraphicSignature = signature;
          saveState();

          return {
            ok: true,
            updated: true,
            created: false,
            graphic: false,
            fallback: true,
            error: graphicError?.message || null,
            messageId: existingMsg.id
          };
        } catch (error) {
          console.error('Errore update messaggio slot team:', error);
        }
      }

      const msg = await channel.send({
        content: '',
        embeds
      });

      data.registrationStatusMessageId = msg.id;
      if (signature) data.lastRegistrationGraphicSignature = signature;
      saveState();

      return {
        ok: true,
        updated: false,
        created: true,
        graphic: false,
        fallback: true,
        error: graphicError?.message || null,
        messageId: msg.id
      };
    })
    .catch(error => {
      console.error('Errore queue pannello slot team:', error);
      return {
        ok: false,
        error: true,
        message: error.message || 'Errore aggiornamento team registrati'
      };
    });

  return registrationStatusUpdateQueue;
}

async function updateRegistrationStatusMessage(options = {}) {
  return queueRegistrationStatusUpdate(options);
}

async function maybeAnnounceTournamentFull() {
  if (!isTournamentFull()) {
    if (data.registrationClosedAnnounced) {
      data.registrationClosedAnnounced = false;
      saveState();
    }
    return;
  }

  if (data.registrationClosedAnnounced) return;

  const project = getProjectSettings();

  try {
    const channel = await client.channels.fetch(TOURNAMENT_FULL_CHANNEL);
    const embed = new EmbedBuilder()
      .setColor(0x7b2cff)
      .setTitle('🚫 REGISTRAZIONI CHIUSE')
      .setDescription(
        `**${project.tournamentName}** ha raggiunto il limite massimo di **${getRegistrationLimit()} team registrati**.\n\n` +
        'Grazie a tutti per l’interesse. Le iscrizioni sono ora chiuse. 🔥'
      );

    await channel.send({ embeds: [embed] });
    data.registrationClosedAnnounced = true;
    saveState();

    logAudit('bot', 'discord', 'registrazioni_chiuse_annunciate', {
      tournamentName: project.tournamentName,
      maxTeams: getRegistrationLimit()
    });
  } catch (error) {
    console.error('Errore annuncio torneo pieno:', error);
  }
}

async function handleRegistrationStateChange() {
  refreshStateFromDisk();
  await updateRegistrationStatusMessage();
  await updateSavedRegisterPanelIfExists().catch(() => {});
  await updateSavedResultsPanelIfExists().catch(() => {});
  await maybeAnnounceTournamentFull();
}

async function updateSavedRegisterPanelIfExists() {
  const settings = getBotSettings();
  if (!settings.registerPanelChannelId) return { skipped: true };

  return spawnRegisterPanel(settings.registerPanelChannelId);
}

async function updateSavedResultsPanelIfExists() {
  const settings = getBotSettings();
  return spawnResultsPanel(settings.resultsPanelChannelId);
}

async function refreshSavedPanels() {
  const settings = getBotSettings();

  const results = {
    registerPanel: null,
    resultsPanel: null
  };

  if (settings.registerPanelChannelId) {
    try {
      results.registerPanel = await spawnRegisterPanel(settings.registerPanelChannelId);
    } catch (error) {
      console.error('Errore refresh pannello registrazione:', error);
    }
  }

  try {
    results.resultsPanel = await spawnResultsPanel(settings.resultsPanelChannelId);
  } catch (error) {
    console.error('Errore refresh pannelli risultati team:', error);
  }

  return results;
}

function loadPointsConfig() {
  const fallback = {
    kill: 1,
    placement: {
      1: 10,
      2: 6,
      3: 5,
      4: 4,
      5: 3,
      6: 2,
      7: 1,
      8: 1
    }
  };

  const possibleFiles = [
    path.join(__dirname, 'points.json'),
    path.join(__dirname, 'points.js')
  ];

  for (const filePath of possibleFiles) {
    try {
      if (!fs.existsSync(filePath)) continue;

      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw);

      return {
        kill: Number(parsed.kill || fallback.kill),
        placement: parsed.placement && typeof parsed.placement === 'object'
          ? parsed.placement
          : fallback.placement
      };
    } catch (error) {
      console.error(`Errore lettura punteggio ${filePath}:`, error.message);
    }
  }

  return fallback;
}

function calcPoints(pos, kills) {
  const config = loadPointsConfig();
  const killPoints = Number(config.kill || 1);
  const placementBonus = Number(config.placement?.[String(Number(pos))] || 0);

  return Number(kills || 0) * killPoints + placementBonus;
}

function createResultEmbed(entry, footerText) {
  const project = getProjectSettings();
  const players = teams[entry.team]?.players || ['Giocatore 1', 'Giocatore 2', 'Giocatore 3'];
  const points = calcPoints(Number(entry.pos || 0), Number(entry.total || 0));

  const embed = new EmbedBuilder()
    .setColor(0x7b2cff)
    .setTitle(`📸 NUOVO RISULTATO • ${project.tournamentName}`)
    .setDescription(
      `🏷️ **Team:** ${entry.team}
🎯 **Slot:** ${entry.slot || teams[entry.team]?.slot || '-'}
🎮 **Match:** ${Number(entry.matchNumber || data.currentMatch || 1)}

👤 **${players[0] || 'Giocatore 1'}:** ${Number(entry.kills?.[0] || 0)} kill
👤 **${players[1] || 'Giocatore 2'}:** ${Number(entry.kills?.[1] || 0)} kill
👤 **${players[2] || 'Giocatore 3'}:** ${Number(entry.kills?.[2] || 0)} kill

🔥 **Totale kill:** ${Number(entry.total || 0)}
🏆 **Posizione:** ${Number(entry.pos || 0)}
📊 **Punti calcolati:** ${points}
🧾 **Inviato da:** ${entry.submittedBy || 'Sconosciuto'}`
    )
    .setFooter({ text: footerText || '⏳ In attesa approvazione staff' });

  if (entry.image) embed.setImage(entry.image);

  return embed;
}

function createStaffActionRow(id) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ok_${id}`).setLabel('APPROVA').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`no_${id}`).setLabel('RIFIUTA').setStyle(ButtonStyle.Danger)
  );
}

async function sendOrUpdateGraphicMessage({
  channel,
  messageId,
  fileName,
  buffer,
  content,
  allowCreate = true
}) {
  const attachment = new AttachmentBuilder(buffer, { name: fileName });

  if (messageId) {
    try {
      const msg = await channel.messages.fetch(messageId);
      await msg.edit({
        content,
        embeds: [],
        components: [],
        files: [attachment]
      });
      return {
        updated: true,
        created: false,
        skipped: false,
        messageId: msg.id
      };
    } catch (error) {
      console.error(`Errore update messaggio grafico ${fileName}:`, error);
    }
  }

  if (!allowCreate) {
    return {
      updated: false,
      created: false,
      skipped: true,
      messageId: messageId || null,
      reason: 'Messaggio grafico non trovato e creazione disattivata'
    };
  }

  const sent = await channel.send({
    content,
    files: [attachment]
  });

  return {
    updated: false,
    created: true,
    skipped: false,
    messageId: sent.id
  };
}

async function deleteOldTextLeaderboardMessage(channel) {
  let deleted = false;
  let cleared = false;
  const removedIds = [];

  if (data.leaderboardMessageId) {
    const oldId = data.leaderboardMessageId;

    try {
      const msg = await channel.messages.fetch(oldId);
      await msg.delete().catch(() => {});
      deleted = true;
      removedIds.push(oldId);
    } catch (error) {
      cleared = true;
    }

    data.leaderboardMessageId = null;
    saveState();
  }

  try {
    const recentMessages = await channel.messages.fetch({ limit: 25 });

    for (const message of recentMessages.values()) {
      if (message.author?.id !== client.user?.id) continue;

      const hasFiles = message.attachments && message.attachments.size > 0;
      const hasLeaderboardGraphicId = message.id === data.leaderboardGraphicMessageId;
      const hasTopFraggerGraphicId = message.id === data.topFraggerGraphicMessageId;

      if (hasFiles || hasLeaderboardGraphicId || hasTopFraggerGraphicId) continue;

      const content = String(message.content || '').toLowerCase();
      const title = String(message.embeds?.[0]?.title || '').toLowerCase();
      const description = String(message.embeds?.[0]?.description || '').toLowerCase();

      const looksLikeOldTextLeaderboard =
        content.includes('classifica') ||
        title.includes('classifica') ||
        description.includes('classifica live') ||
        description.includes('top fragger');

      if (looksLikeOldTextLeaderboard) {
        await message.delete().catch(() => {});
        deleted = true;
        removedIds.push(message.id);
      }
    }
  } catch (error) {
    console.error('Errore ricerca vecchi pannelli testuali classifica:', error.message);
  }

  return {
    deleted,
    cleared,
    removedIds,
    textLeaderboardDisabled: true
  };
}

async function updateLeaderboardGraphicsImmediate(options = {}) {
  await waitReady();
  ensureDataStructures();

  const allowCreate = options.allowCreate !== false;
  const targetChannelId = sanitizeText(data?.botSettings?.leaderboardChannelId) || CLASSIFICA_CHANNEL;
  if (!targetChannelId) {
    console.warn('[classifica] Canale classifica non configurato. Imposta il canale nella sezione Discord del pannello admin.');
    return { skipped: true, reason: 'no_channel' };
  }
  const channel = await client.channels.fetch(targetChannelId);
  const matchNumber = Number(data.currentMatch || 1);
  const stamp = Date.now();

  await deleteOldTextLeaderboardMessage(channel).catch(error => {
    console.error('Errore eliminazione vecchia classifica testuale:', error);
  });

  const leaderboardRows = getSortedScores();
  const topFraggerRows = getSortedFraggers();

  const leaderboardBuffer = await generateLeaderboardGraphicBuffer(leaderboardRows);
  const topFraggerBuffer = await generateTopFraggerGraphicBuffer(topFraggerRows);

  const leaderboardGraphicResult = await sendOrUpdateGraphicMessage({
    channel,
    messageId: data.leaderboardGraphicMessageId,
    fileName: `classifica-live-output-match-${matchNumber}-${stamp}.png`,
    buffer: leaderboardBuffer,
    content: `🏆 **CLASSIFICA LIVE** • Match ${matchNumber}`,
    allowCreate
  });

  if (leaderboardGraphicResult.messageId) {
    data.leaderboardGraphicMessageId = leaderboardGraphicResult.messageId;
  }

  const topFraggerGraphicResult = await sendOrUpdateGraphicMessage({
    channel,
    messageId: data.topFraggerGraphicMessageId,
    fileName: `top-fragger-output-match-${matchNumber}-${stamp}.png`,
    buffer: topFraggerBuffer,
    content: `🔥 **TOP FRAGGER** • Match ${matchNumber}`,
    allowCreate
  });

  if (topFraggerGraphicResult.messageId) {
    data.topFraggerGraphicMessageId = topFraggerGraphicResult.messageId;
  }

  data.leaderboardMessageId = null;
  saveState();

  return {
    ok: true,
    allowCreate,
    leaderboardGraphicResult,
    topFraggerGraphicResult,
    textLeaderboardDisabled: true
  };
}

async function updateLeaderboardGraphics(options = {}) {
  leaderboardUpdateQueue = leaderboardUpdateQueue
    .then(() => updateLeaderboardGraphicsImmediate(options))
    .catch(error => {
      console.error('Errore queue classifiche grafiche:', error);

      return {
        ok: false,
        error: true,
        message: error.message || 'Errore aggiornamento classifiche grafiche'
      };
    });

  return leaderboardUpdateQueue;
}

async function updateLeaderboard(options = {}) {
  await waitReady();
  ensureDataStructures();

  const allowCreate = options.allowCreate !== false;
  const updateGraphics = options.updateGraphics !== false;

  let graphicsResult = null;

  if (updateGraphics) {
    graphicsResult = await updateLeaderboardGraphics({ allowCreate });
  }

  logAudit('bot', 'discord', 'classifiche_grafiche_aggiornate', {
    currentMatch: data.currentMatch,
    allowCreate,
    leaderboardGraphicMessageId: data.leaderboardGraphicMessageId || null,
    topFraggerGraphicMessageId: data.topFraggerGraphicMessageId || null,
    textLeaderboardDisabled: true
  });

  return {
    ok: true,
    allowCreate,
    updated: Boolean(graphicsResult?.leaderboardGraphicResult?.updated || graphicsResult?.topFraggerGraphicResult?.updated),
    created: Boolean(graphicsResult?.leaderboardGraphicResult?.created || graphicsResult?.topFraggerGraphicResult?.created),
    skipped: Boolean(graphicsResult?.leaderboardGraphicResult?.skipped && graphicsResult?.topFraggerGraphicResult?.skipped),
    textLeaderboardDisabled: true,
    graphicsResult
  };
}

async function sendResultToStorico(embed) {
  try {
    const storico = await client.channels.fetch(STORICO_CHANNEL);
    await storico.send({ embeds: [embed] });
  } catch (error) {
    console.error('Errore invio storico:', error);
  }
}

async function sendTeamResultStatus(entry, approved) {
  const channelId = sanitizeText(entry?.teamResultChannelId);
  if (!channelId) return;

  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel) return;

    const statusText = approved ? '✅ RISULTATO APPROVATO' : '❌ RISULTATO RIFIUTATO';
    const project = getProjectSettings();

    const embed = new EmbedBuilder()
      .setColor(approved ? 0x18c964 : 0xff4d6d)
      .setTitle(statusText)
      .setDescription(
        `**Team:** ${entry.team}\n` +
        `**Match:** ${Number(entry.matchNumber || data.currentMatch || 1)}\n` +
        `**Posizione:** ${Number(entry.pos || 0)}\n` +
        `**Uccisioni totali:** ${Number(entry.total || 0)}\n\n` +
        `${approved
          ? 'Lo staff ha approvato il risultato inviato.'
          : 'Lo staff ha rifiutato il risultato inviato. Se richiesto dallo staff, il team potrà reinviarlo.'}`
      )
      .setFooter({ text: project.tournamentName });

    await channel.send({ embeds: [embed] });
  } catch (error) {
    console.error('Errore invio esito risultato al team:', error);
  }
}

async function editStaffMessage(entry, approved) {
  if (!entry.staffMessageId) return null;

  try {
    const staff = await client.channels.fetch(STAFF_CHANNEL);
    const msg = await staff.messages.fetch(entry.staffMessageId);
    const footerText = approved ? '✅ APPROVATO' : '❌ RIFIUTATO';
    const embed = EmbedBuilder.from(msg.embeds[0]).setFooter({ text: footerText });
    await msg.edit({ embeds: [embed], components: [] });
    return embed;
  } catch (error) {
    console.error('Errore update messaggio staff:', error);
    return null;
  }
}

async function approvePending(id, actor = 'system', source = 'system') {
  ensureDataStructures();

  const entry = data.pending[id];
  if (!entry) return { already: true };

  const duplicateCheck = getSubmissionRecord(entry.team, Number(entry.matchNumber || 1));

  if (duplicateCheck.status === 'approvato' || duplicateCheck.status === 'inserito_manualmente') {
    delete data.pending[id];
    saveState();

    return {
      ok: false,
      message: 'Questo risultato risulta già registrato.'
    };
  }

  const players = teams[entry.team]?.players || ['Giocatore 1', 'Giocatore 2', 'Giocatore 3'];
  const pointsToAdd = calcPoints(Number(entry.pos || 0), Number(entry.total || 0));

  data.scores[entry.team] = Number(data.scores[entry.team] || 0) + pointsToAdd;

  (entry.kills || []).forEach((k, i) => {
    const playerName = players[i] || `Giocatore ${i + 1}`;
    data.fragger[playerName] = Number(data.fragger[playerName] || 0) + Number(k || 0);
  });

  markSubmission(entry.team, Number(entry.matchNumber || 1), 'approvato', {
    pendingId: null,
    updatedBy: actor,
    source
  });

  delete data.pending[id];
  saveState();

  let storicoEmbed = await editStaffMessage(entry, true);

  if (!storicoEmbed) {
    storicoEmbed = createResultEmbed(entry, '✅ APPROVATO');
  }

  await sendResultToStorico(storicoEmbed);
  await sendTeamResultStatus(entry, true);
  await updateLeaderboard({ allowCreate: true });
  await refreshTeamResultPanels().catch(() => {});

  logAudit(actor, source, 'risultato_approvato', {
    pendingId: id,
    team: entry.team,
    total: Number(entry.total || 0),
    pos: Number(entry.pos || 0),
    puntiAggiunti: pointsToAdd,
    matchNumber: Number(entry.matchNumber || 0)
  });

  return { ok: true };
}

async function rejectPending(id, actor = 'system', source = 'system') {
  ensureDataStructures();

  const entry = data.pending[id];
  if (!entry) return { already: true };

  markSubmission(entry.team, Number(entry.matchNumber || 1), 'rifiutato', {
    pendingId: null,
    updatedBy: actor,
    source
  });

  delete data.pending[id];
  saveState();

  await editStaffMessage(entry, false);
  await sendTeamResultStatus(entry, false);
  await refreshTeamResultPanels().catch(() => {});

  logAudit(actor, source, 'risultato_rifiutato', {
    pendingId: id,
    team: entry.team,
    total: Number(entry.total || 0),
    pos: Number(entry.pos || 0),
    matchNumber: Number(entry.matchNumber || 0)
  });

  return { ok: true };
}

async function createPendingSubmission(entry) {
  await waitReady();
  ensureDataStructures();

  const teamName = sanitizeText(entry.team);
  const matchNumber = Number(entry.matchNumber || data.currentMatch || 1);
  const check = canSubmitResult(teamName, matchNumber);

  if (!check.allowed) {
    throw new Error(check.message.replace(/\*\*/g, ''));
  }

  const id = String(Date.now());

  data.pending[id] = {
    ...entry,
    team: teamName,
    matchNumber,
    slot: entry.slot || teams[teamName]?.slot || null
  };

  markSubmission(teamName, matchNumber, 'in_attesa', {
    pendingId: id,
    updatedBy: entry.submittedBy || 'unknown',
    source: entry.source || 'system'
  });

  saveState();

  const staff = await client.channels.fetch(STAFF_CHANNEL);
  const embed = createResultEmbed(data.pending[id], '⏳ In attesa approvazione staff');
  const row = createStaffActionRow(id);
  const msg = await staff.send({ embeds: [embed], components: [row] });

  data.pending[id].staffMessageId = msg.id;

  markSubmission(teamName, matchNumber, 'in_attesa', {
    pendingId: id,
    updatedBy: entry.submittedBy || 'unknown',
    source: entry.source || 'system'
  });

  saveState();

  logAudit(entry.submittedBy || 'unknown', entry.source || 'system', 'risultato_in_attesa_creato', {
    pendingId: id,
    team: teamName,
    total: Number(entry.total || 0),
    pos: Number(entry.pos || 0),
    matchNumber
  });

  await refreshTeamResultPanels().catch(() => {});

  return { id };
}

async function submitWebResult(payload) {
  ensureDataStructures();

  const entry = {
    team: sanitizeText(payload.team),
    kills: [
      Number(payload.k1 || 0),
      Number(payload.k2 || 0),
      Number(payload.k3 || 0)
    ],
    total: Number(payload.k1 || 0) + Number(payload.k2 || 0) + Number(payload.k3 || 0),
    pos: Number(payload.pos || 0),
    image: payload.image || '',
    source: 'web',
    submittedBy: sanitizeText(payload.submittedBy || 'Dashboard'),
    matchNumber: Number(data.currentMatch || 1),
    slot: teams[sanitizeText(payload.team)]?.slot || null
  };

  if (!teams[entry.team]) {
    throw new Error('Team non trovato');
  }

  const check = canSubmitResult(entry.team, entry.matchNumber);
  if (!check.allowed) {
    throw new Error(check.message.replace(/\*\*/g, ''));
  }

  return createPendingSubmission(entry);
}

async function spawnRegisterPanel(channelId) {
  await waitReady();
  refreshStateFromDisk();

  const botSettings = getBotSettings();
  const targetChannelId = sanitizeText(channelId) || botSettings.registerPanelChannelId;

  if (!targetChannelId) {
    throw new Error('ID canale pannello registrazione non valido');
  }

  const channel = await client.channels.fetch(targetChannelId);
  const payload = createRegisterPanelPayload();

  let created = false;
  let updated = false;

  if (botSettings.registerPanelMessageId && botSettings.registerPanelChannelId === targetChannelId) {
    try {
      const msg = await channel.messages.fetch(botSettings.registerPanelMessageId);
      await msg.edit(payload);
      updated = true;
    } catch {}
  }

  if (!updated) {
    const msg = await channel.send(payload);
    data.botSettings.registerPanelMessageId = msg.id;
    created = true;
  }

  data.botSettings.registerPanelChannelId = targetChannelId;
  saveState();

  logAudit('dashboard', 'web', 'pannello_registrazione_inviato', {
    channelId: targetChannelId,
    created,
    updated,
    registrationsOpen: areRegistrationsOpen()
  });

  return {
    ok: true,
    created,
    updated,
    registrationsOpen: areRegistrationsOpen()
  };
}

async function spawnResultsPanel(channelId) {
  await waitReady();
  refreshStateFromDisk();

  const botSettings = getBotSettings();
  const targetChannelId = sanitizeText(channelId) || botSettings.resultsPanelChannelId;

  if (targetChannelId) {
    data.botSettings.resultsPanelChannelId = targetChannelId;
    saveState();
  }

  const teamPanels = await refreshTeamResultPanels();

  logAudit('dashboard', 'web', 'pannelli_risultati_team_generati', {
    savedChannelId: targetChannelId || null,
    teamPanelsCreated: Number(teamPanels?.created || 0),
    teamPanelsUpdated: Number(teamPanels?.updated || 0),
    missingRooms: Number(teamPanels?.missingRooms || 0),
    failed: Number(teamPanels?.failed || 0),
    currentMatch: Number(data.currentMatch || 1)
  });

  return {
    ok: true,
    created: false,
    updated: false,
    teamPanels
  };
}

function buildLobbyCodeMessage(lobbyCode) {
  const cleanCode = sanitizeText(lobbyCode);

  return `🎮 **CODICE LOBBY**

Codice: **${cleanCode}**

Il codice viene inviato nelle stanze ufficiali dei team.
Buon game 🔥`;
}

async function sendLobbyCodeToTeamRooms(lobbyCode, customCategoryId, customMessage = '') {
  await waitReady();

  const cleanCode = sanitizeText(lobbyCode);

  if (!cleanCode) {
    throw new Error('Codice lobby non valido');
  }

  const guild = await client.guilds.fetch(GUILD_ID);
  const categoryIdToUse = sanitizeText(customCategoryId) || getSavedRoomsCategoryId();

  if (!categoryIdToUse) {
    throw new Error('Categoria non valida');
  }

  const categoryChannel = await guild.channels.fetch(categoryIdToUse).catch(() => null);

  if (!categoryChannel) {
    throw new Error('Categoria non trovata');
  }

  if (categoryChannel.type !== ChannelType.GuildCategory) {
    throw new Error('Il canale selezionato non è una categoria');
  }

  await guild.channels.fetch();

  const channels = guild.channels.cache
    .filter(channel =>
      channel.parentId === categoryIdToUse &&
      channel.type === ChannelType.GuildVoice &&
      channel.name.startsWith('🏆・#')
    )
    .sort((a, b) => a.rawPosition - b.rawPosition);

  if (!channels.size) {
    throw new Error('Nessuna stanza team trovata nella categoria selezionata');
  }

  const content = sanitizeText(customMessage) || buildLobbyCodeMessage(cleanCode);

  let sent = 0;
  let failed = 0;
  const failedChannels = [];

  for (const channel of channels.values()) {
    try {
      await channel.send({ content });
      sent++;
    } catch (error) {
      failed++;
      failedChannels.push(channel.name);
      console.error(`Errore invio codice lobby in ${channel.name}:`, error);
    }
  }

  logAudit('dashboard', 'web', 'codice_lobby_inviato_alle_stanze_team', {
    categoryId: categoryIdToUse,
    lobbyCode: cleanCode,
    sent,
    failed,
    failedChannels
  });

  return {
    ok: true,
    sent,
    failed,
    total: channels.size,
    failedChannels
  };
}

async function saveDiscordAttachmentLocally(attachment) {
  const tryUrls = [attachment.url, attachment.proxyURL].filter(Boolean);
  const errors = [];

  for (const target of tryUrls) {
    try {
      const response = await fetch(target);
      if (!response.ok) {
        errors.push(`HTTP ${response.status} su ${target}`);
        continue;
      }

      const contentType = response.headers.get('content-type') || '';
      let ext = 'jpg';

      if (contentType.includes('png')) ext = 'png';
      else if (contentType.includes('webp')) ext = 'webp';
      else if (contentType.includes('gif')) ext = 'gif';
      else if (contentType.includes('jpeg') || contentType.includes('jpg')) ext = 'jpg';
      else if (attachment.name && attachment.name.includes('.')) {
        ext = attachment.name.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
      }

      const fileName = `discord-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
      const filePath = path.join(UPLOADS_DIR, fileName);
      const arrayBuffer = await response.arrayBuffer();

      fs.writeFileSync(filePath, Buffer.from(arrayBuffer));
      return buildPublicUploadUrl(fileName);
    } catch (err) {
      errors.push(err.message || String(err));
    }
  }

  console.error('[saveDiscordAttachmentLocally] impossibile scaricare lo screenshot da Discord:', errors);
  throw new Error('Non sono riuscito a salvare il tuo screenshot. Riprova fra qualche secondo o invia un altro file.');
}

function setCurrentMatch(match) {
  const targetMatch = sanitizePositiveInteger(match, 1, getTournamentTotalMatches());

  if (targetMatch > getTournamentTotalMatches()) {
    throw new Error(`Il torneo ha solo ${getTournamentTotalMatches()} match configurati.`);
  }

  data.currentMatch = targetMatch;
  saveState();
}

async function setCurrentMatchAndRefresh(match) {
  setCurrentMatch(match);
  await refreshTeamResultPanels();
  await updateLeaderboard({ allowCreate: true });
  return data.currentMatch;
}

function nextMatch() {
  const current = Number(data.currentMatch || 1);
  const total = getTournamentTotalMatches();

  if (current >= total) {
    throw new Error(`Sei già all’ultimo match configurato (${total}).`);
  }

  data.currentMatch = current + 1;
  saveState();
  return data.currentMatch;
}

async function nextMatchAndRefresh() {
  nextMatch();
  await refreshTeamResultPanels();
  await updateLeaderboard({ allowCreate: true });
  return data.currentMatch;
}

function resetAllState() {
  data = getDefaultData();
  ensureDataStructures();
  data = saveData(data, { allowReset: true });
}

function saveBotPanelSettings(settings = {}) {
  ensureDataStructures();

  if (Object.prototype.hasOwnProperty.call(settings, 'registerPanelChannelId')) {
    data.botSettings.registerPanelChannelId = sanitizeText(settings.registerPanelChannelId);
  }

  if (Object.prototype.hasOwnProperty.call(settings, 'resultsPanelChannelId')) {
    data.botSettings.resultsPanelChannelId = sanitizeText(settings.resultsPanelChannelId);
  }

  if (Object.prototype.hasOwnProperty.call(settings, 'roomsCategoryId')) {
    data.botSettings.roomsCategoryId = sanitizeText(settings.roomsCategoryId);
  }

  if (Object.prototype.hasOwnProperty.call(settings, 'generalChannelId')) {
    data.botSettings.generalChannelId = sanitizeText(settings.generalChannelId);
  }

  if (Object.prototype.hasOwnProperty.call(settings, 'rulesChannelId')) {
    data.botSettings.rulesChannelId = sanitizeText(settings.rulesChannelId);
  }

  if (Object.prototype.hasOwnProperty.call(settings, 'lobbyChannelId')) {
    data.botSettings.lobbyChannelId = sanitizeText(settings.lobbyChannelId);
  }

  if (Object.prototype.hasOwnProperty.call(settings, 'leaderboardChannelId')) {
    data.botSettings.leaderboardChannelId = sanitizeText(settings.leaderboardChannelId);
  }

  saveState();

  logAudit('dashboard', 'web', 'impostazioni_bot_salvate', {
    registerPanelChannelId: data.botSettings.registerPanelChannelId,
    resultsPanelChannelId: data.botSettings.resultsPanelChannelId,
    roomsCategoryId: data.botSettings.roomsCategoryId,
    generalChannelId: data.botSettings.generalChannelId || '',
    rulesChannelId: data.botSettings.rulesChannelId || '',
    lobbyChannelId: data.botSettings.lobbyChannelId || '',
    leaderboardChannelId: data.botSettings.leaderboardChannelId || ''
  });

  return {
    registerPanelChannelId: data.botSettings.registerPanelChannelId,
    resultsPanelChannelId: data.botSettings.resultsPanelChannelId,
    roomsCategoryId: data.botSettings.roomsCategoryId,
    generalChannelId: data.botSettings.generalChannelId || '',
    rulesChannelId: data.botSettings.rulesChannelId || '',
    lobbyChannelId: data.botSettings.lobbyChannelId || '',
    leaderboardChannelId: data.botSettings.leaderboardChannelId || ''
  };
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
    registerPanelChannelId: botSettings.registerPanelChannelId,
    resultsPanelChannelId: botSettings.resultsPanelChannelId,
    roomsCategoryId: botSettings.roomsCategoryId,
    generalChannelId: botSettings.generalChannelId,
    rulesChannelId: botSettings.rulesChannelId,
    lobbyChannelId: botSettings.lobbyChannelId,
    leaderboardChannelId: botSettings.leaderboardChannelId || '',
    brandName: project.brandName,
    tournamentName: FIXED_TOURNAMENT_NAME,
    premiumMode: project.premiumMode,
    totalMatches: tournament.totalMatches,
    playersPerTeam: PLAYERS_PER_TEAM,
    maxTeams: MAX_TEAMS,
    registrationsOpen: areRegistrationsOpen()
  };
}

client.once('ready', async () => {
  console.log('ONLINE');

  if (readyResolver) readyResolver(client);

  refreshStateFromDisk();

  logAudit('bot', 'discord', 'bot_online', {
    guildId: GUILD_ID
  });

  await handleRegistrationStateChange();

  await updateLeaderboard({ allowCreate: true }).catch(error => {
    console.error('Errore aggiornamento classifica al ready:', error);
  });

  startAutomaticReminderScheduler();
});

client.on('interactionCreate', async interaction => {
  try {
    if (interaction.isButton() && interaction.customId === 'register_btn') {
      refreshStateFromDisk();

      const project = getProjectSettings();

      if (!areRegistrationsOpen()) {
        await updateSavedRegisterPanelIfExists().catch(() => {});

        return interaction.reply({
          content: `🚫 Le iscrizioni non sono aperte. Attendi che lo staff apra ufficialmente le registrazioni per **${project.tournamentName}**.`,
          ephemeral: true
        });
      }

      if (isTournamentFull()) {
        await maybeAnnounceTournamentFull();
        await updateSavedRegisterPanelIfExists().catch(() => {});

        return interaction.reply({
          content: `🚫 Le registrazioni sono chiuse. **${project.tournamentName}** ha già raggiunto ${getRegistrationLimit()} team.`,
          ephemeral: true
        });
      }

      const modal = new ModalBuilder()
        .setCustomId('register_modal')
        .setTitle(`Registrazione Team • ${project.brandName}`);

      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('team').setLabel('Nome team').setStyle(TextInputStyle.Short).setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('p1').setLabel('Giocatore 1').setStyle(TextInputStyle.Short).setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('p2').setLabel('Giocatore 2').setStyle(TextInputStyle.Short).setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('p3').setLabel('Giocatore 3').setStyle(TextInputStyle.Short).setRequired(true)
        )
      );

      return interaction.showModal(modal);
    }

    if (interaction.isButton() && interaction.customId.startsWith('result_submit_slot_')) {
      refreshStateFromDisk();

      const slot = Number(interaction.customId.replace('result_submit_slot_', ''));
      const teamInfo = getTeamBySlot(slot);

      if (!teamInfo) {
        return interaction.reply({
          content: '❌ Team non trovato per questo pannello.',
          ephemeral: true
        });
      }

      const { teamName, teamData } = teamInfo;
      const matchNumber = Number(data.currentMatch || 1);
      const check = canSubmitResult(teamName, matchNumber);

      if (!check.allowed) {
        return interaction.reply({
          content: check.message,
          ephemeral: true
        });
      }

      const players = Array.isArray(teamData?.players) ? teamData.players : ['Giocatore 1', 'Giocatore 2', 'Giocatore 3'];
      const project = getProjectSettings();

      const modal = new ModalBuilder()
        .setCustomId(`modal_slot_${slot}`)
        .setTitle(`${project.tournamentName} • ${teamName}`.slice(0, 45));

      for (let i = 0; i < PLAYERS_PER_TEAM; i++) {
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId(`k${i}`)
              .setLabel(`Kill ${players[i] || `Giocatore ${i + 1}`}`.slice(0, 45))
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
          )
        );
      }

      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('pos')
            .setLabel('Posizione finale')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
        )
      );

      return interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId === 'register_modal') {
      await interaction.deferReply({ ephemeral: true });

      refreshStateFromDisk();

      const team = sanitizeText(interaction.fields.getTextInputValue('team'));
      const p1 = sanitizeText(interaction.fields.getTextInputValue('p1'));
      const p2 = sanitizeText(interaction.fields.getTextInputValue('p2'));
      const p3 = sanitizeText(interaction.fields.getTextInputValue('p3'));
      const project = getProjectSettings();

      if (!areRegistrationsOpen()) {
        await updateSavedRegisterPanelIfExists().catch(() => {});

        return interaction.editReply({
          content: `🚫 Le iscrizioni non sono aperte. Attendi che lo staff apra ufficialmente le registrazioni per **${project.tournamentName}**.`
        });
      }

      if (!team || !p1 || !p2 || !p3) {
        return interaction.editReply({ content: '❌ Compila tutti i campi.' });
      }

      if (teams[team]) {
        return interaction.editReply({ content: '❌ Esiste già un team con questo nome.' });
      }

      if (isTournamentFull()) {
        await maybeAnnounceTournamentFull();
        await updateSavedRegisterPanelIfExists().catch(() => {});

        return interaction.editReply({
          content: `🚫 Le registrazioni sono chiuse. **${project.tournamentName}** ha già raggiunto ${getRegistrationLimit()} team.`
        });
      }

      const slot = getNextAvailableSlot();

      if (!slot) {
        await maybeAnnounceTournamentFull();
        await updateSavedRegisterPanelIfExists().catch(() => {});

        return interaction.editReply({
          content: '🚫 Nessuno slot disponibile. Registrazioni chiuse.'
        });
      }

      teams[team] = {
        slot,
        players: [p1, p2, p3]
      };

      saveEverything();
      refreshStateFromDisk();
      await handleRegistrationStateChange();

      logAudit(interaction.user.tag, 'discord', 'team_registrato_discord', {
        team,
        slot,
        players: [p1, p2, p3]
      });

      return interaction.editReply({
        content: `✅ Team registrato con successo nello **slot #${slot}** di **${project.tournamentName}**.`
      });
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_slot_')) {
      refreshStateFromDisk();

      const slot = Number(interaction.customId.replace('modal_slot_', ''));
      const teamInfo = getTeamBySlot(slot);

      if (!teamInfo) {
        return interaction.reply({
          content: '❌ Team non trovato.',
          ephemeral: true
        });
      }

      const { teamName } = teamInfo;
      const matchNumber = Number(data.currentMatch || 1);
      const check = canSubmitResult(teamName, matchNumber);

      if (!check.allowed) {
        return interaction.reply({
          content: check.message,
          ephemeral: true
        });
      }

      const kills = [];
      let total = 0;

      for (let i = 0; i < PLAYERS_PER_TEAM; i++) {
        const raw = interaction.fields.getTextInputValue(`k${i}`);
        const k = parseInt(raw, 10);

        if (!Number.isFinite(k) || k < 0) {
          return interaction.reply({
            content: '❌ Le kill devono essere numeri validi.',
            ephemeral: true
          });
        }

        kills.push(k);
        total += k;
      }

      const posRaw = interaction.fields.getTextInputValue('pos');
      const pos = parseInt(posRaw, 10);

      if (!Number.isFinite(pos) || pos <= 0) {
        return interaction.reply({
          content: '❌ La posizione finale non è valida.',
          ephemeral: true
        });
      }

      data.tempSubmit[interaction.user.id] = {
        team: teamName,
        slot,
        kills,
        total,
        pos,
        matchNumber,
        teamResultChannelId: interaction.channelId || null
      };

      saveState();

      logAudit(interaction.user.tag, 'discord', 'modulo_risultato_compilato', {
        team: teamName,
        slot,
        total,
        pos,
        matchNumber,
        channelId: interaction.channelId || null
      });

      return interaction.reply({
        content: '📸 Ora invia qui sotto lo screenshot della partita. È obbligatorio per la verifica dello staff.',
        ephemeral: true
      });
    }

    if (interaction.isButton() && interaction.customId.startsWith('report_slot_')) {
      const slot = Number(interaction.customId.replace('report_slot_', ''));
      const matchNumber = Number(data.currentMatch || 1);

      const modal = new ModalBuilder()
        .setCustomId(`report_modal_${slot}`)
        .setTitle(`⚠️ Segnalazione • Match ${matchNumber}`.slice(0, 45));

      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('player_name')
            .setLabel('Giocatore da segnalare (opzionale)')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMaxLength(60)
            .setPlaceholder('Lascia vuoto per problema generale')
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('description')
            .setLabel('Cosa è successo?')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(900)
            .setPlaceholder('Descrivi il problema o l\'irregolarità nel dettaglio…')
        )
      );

      return interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('report_modal_')) {
      const slot = Number(interaction.customId.replace('report_modal_', ''));
      const teamInfo = getTeamBySlot(slot);
      const matchNumber = Number(data.currentMatch || 1);

      const playerName = (interaction.fields.getTextInputValue('player_name') || '').trim();
      const description = (interaction.fields.getTextInputValue('description') || '').trim();

      if (!description) {
        return interaction.reply({
          content: '❌ La descrizione non può essere vuota.',
          ephemeral: true
        });
      }

      const report = addReport({
        teamName: teamInfo?.teamName || `Slot #${slot}`,
        slot,
        matchNumber,
        reporterDiscordId: interaction.user.id,
        reporterDiscordTag: interaction.user.tag,
        playerName,
        description,
        proofUrl: '',
        timestamp: Date.now()
      });

      logAudit(interaction.user.tag, 'discord', 'segnalazione_inviata', {
        reportId: report.id,
        team: teamInfo?.teamName,
        slot,
        matchNumber,
        playerName
      });

      const proofBtn = new ButtonBuilder()
        .setCustomId(`reportproof_${report.id}`)
        .setLabel('📎 Allega foto/video come prova')
        .setStyle(ButtonStyle.Secondary);

      const proofRow = new ActionRowBuilder().addComponents(proofBtn);

      return interaction.reply({
        content:
          `✅ **Segnalazione ricevuta!** (ID: \`${report.id}\`)\n\n` +
          `Lo staff esaminerà quanto segnalato al più presto.\n\n` +
          `Vuoi allegare uno screenshot o video come prova? Clicca il bottone qui sotto.`,
        components: [proofRow],
        ephemeral: true
      });
    }

    if (interaction.isButton() && interaction.customId.startsWith('reportproof_')) {
      const reportId = interaction.customId.replace('reportproof_', '');

      pendingReportProof.set(interaction.user.id, {
        reportId,
        channelId: interaction.channelId,
        expiresAt: Date.now() + 5 * 60 * 1000
      });

      return interaction.update({
        content:
          `✅ **Segnalazione salvata!**\n\n` +
          `📎 **Ora invia il file qui nella chat di questa stanza** (trascina la foto o il video nel campo messaggi).\n` +
          `Il bot lo rileverà automaticamente e lo allegherà alla tua segnalazione.\n\n` +
          `⏰ Hai **5 minuti** per farlo.`,
        components: []
      });
    }

    if (interaction.isButton()) {
      const [action, id] = interaction.customId.split('_');
      if (!id) return;

      if (action === 'ok') {
        const entry = data.pending[id];

        if (!entry) {
          return interaction.reply({
            content: '❌ Risultato non trovato.',
            ephemeral: true
          });
        }

        await approvePending(id, interaction.user.tag, 'discord');
        const embed = createResultEmbed(entry, '✅ APPROVATO');

        return interaction.update({
          embeds: [embed],
          components: []
        });
      }

      if (action === 'no') {
        const entry = data.pending[id];

        if (!entry) {
          return interaction.reply({
            content: '❌ Risultato non trovato.',
            ephemeral: true
          });
        }

        await rejectPending(id, interaction.user.tag, 'discord');
        const embed = createResultEmbed(entry, '❌ RIFIUTATO');

        return interaction.update({
          embeds: [embed],
          components: []
        });
      }
    }
  } catch (error) {
    console.error(error);

    try {
      if (interaction.isRepliable()) {
        const message = error.message || 'Si è verificato un errore durante l’operazione.';

        if (interaction.deferred || interaction.replied) {
          await interaction.editReply({ content: `❌ ${message}` });
        } else {
          await interaction.reply({ content: `❌ ${message}`, ephemeral: true });
        }
      }
    } catch {}
  }
});

client.on('messageCreate', async message => {
  try {
    if (message.author.bot) return;
    if (!message.attachments.size) return;

    refreshStateFromDisk();

    const pendingProof = pendingReportProof.get(message.author.id);
    if (pendingProof) {
      pendingReportProof.delete(message.author.id);

      if (Date.now() > pendingProof.expiresAt) {
        await message.delete().catch(() => {});
        const expiredMsg = await message.channel.send({
          content: '⏰ Il tempo per allegare la prova è scaduto (5 min). La segnalazione è stata salvata senza allegato.'
        }).catch(() => null);
        if (expiredMsg) setTimeout(() => expiredMsg.delete().catch(() => {}), 3000);
        return;
      }

      const attachment = message.attachments.first();
      let proofUrl = attachment.proxyURL || attachment.url || '';

      try {
        const saved = await saveDiscordAttachmentLocally(attachment);
        proofUrl = saved;
      } catch {
        /* se il salvataggio locale fallisce usiamo l'URL originale */
      }

      updateReportProofUrl(pendingProof.reportId, proofUrl);

      // Elimina il messaggio dell'utente (con la foto) per tenere la chat pulita
      await message.delete().catch(() => {});

      // Messaggio temporaneo "Segnalazione inviata" visibile 3 secondi poi cancellato
      const confirmMsg = await message.channel.send({
        content: '✅ **Segnalazione inviata!** Lo staff la esaminerà al più presto.'
      }).catch(() => null);

      if (confirmMsg) {
        setTimeout(() => confirmMsg.delete().catch(() => {}), 3000);
      }

      return;
    }

    const temp = data.tempSubmit[message.author.id];
    if (!temp) return;

    const check = canSubmitResult(temp.team, Number(temp.matchNumber || data.currentMatch || 1));

    if (!check.allowed) {
      delete data.tempSubmit[message.author.id];
      saveState();

      await message.reply({
        content: check.message
      }).catch(() => {});

      return;
    }

    const attachment = message.attachments.first();
    let image;
    try {
      image = await saveDiscordAttachmentLocally(attachment);
    } catch (saveErr) {
      console.error('[messageCreate] errore salvataggio screenshot:', saveErr);
      await message.reply({
        content: `❌ ${saveErr.message || 'Non sono riuscito a salvare lo screenshot.'} Il tuo invio NON è stato registrato: prova ad inviare di nuovo lo screenshot.`
      }).catch(() => {});
      return;
    }

    delete data.tempSubmit[message.author.id];
    saveState();

    await createPendingSubmission({
      ...temp,
      image,
      source: 'discord',
      submittedBy: message.author.tag
    });

    await message.delete().catch(() => {});
  } catch (error) {
    console.error('[messageCreate] errore inatteso:', error);
    try {
      await message.reply({
        content: '❌ Errore inatteso nel registrare il tuo invio. Riprova fra qualche secondo.'
      });
    } catch {}
  }
});

client.login(TOKEN);

module.exports = {
  client,
  waitReady,
  getData: () => data,
  getTeams: () => teams,
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
