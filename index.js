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
  UPLOADS_DIR
} = require('./storage');

const {
  generateLeaderboardGraphicBuffer,
  generateTopFraggerGraphicBuffer
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
const GUILD_ID = process.env.GUILD_ID || '1442509991109066765';
const STAFF_CHANNEL = process.env.STAFF_CHANNEL || '1483201939712774145';
const CLASSIFICA_CHANNEL = process.env.CLASSIFICA_CHANNEL || '1478304828592623777';
const CATEGORY_ID = process.env.CATEGORY_ID || '1478303649586348165';
const STORICO_CHANNEL = process.env.STORICO_CHANNEL || '1483594392819204126';
const TOURNAMENT_FULL_CHANNEL = process.env.TOURNAMENT_FULL_CHANNEL || STAFF_CHANNEL;
const REGISTRATION_STATUS_CHANNEL = process.env.REGISTRATION_STATUS_CHANNEL || '1482050564375318579';

const FIXED_TOURNAMENT_NAME = 'RØDA CUP';
const MAX_TEAMS = 16;
const PLAYERS_PER_TEAM = 3;

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

let teams = loadTeams();
let data = loadData();

let readyResolver;
const readyPromise = new Promise(resolve => {
  readyResolver = resolve;
});

let registrationStatusUpdateQueue = Promise.resolve();

function sanitizeText(value) {
  return String(value || '').trim();
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
    regulationText: defaults.regulationText || safe.regulationText || ''
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

  if (!data.botSettings || typeof data.botSettings !== 'object') {
    data.botSettings = defaults.botSettings;
  }

  if (!data.tournamentMessages || typeof data.tournamentMessages !== 'object') {
    data.tournamentMessages = defaults.tournamentMessages;
  }

  data.tournamentMessages.regulationText = defaults.tournamentMessages.regulationText;

  if (!data.pending || typeof data.pending !== 'object') {
    data.pending = {};
  }

  if (!data.tempSubmit || typeof data.tempSubmit !== 'object') {
    data.tempSubmit = {};
  }

  if (!data.resultSubmissions || typeof data.resultSubmissions !== 'object') {
    data.resultSubmissions = {};
  }

  if (!data.scores || typeof data.scores !== 'object') {
    data.scores = {};
  }

  if (!data.fragger || typeof data.fragger !== 'object') {
    data.fragger = {};
  }

  if (!Object.prototype.hasOwnProperty.call(data, 'leaderboardGraphicMessageId')) {
    data.leaderboardGraphicMessageId = null;
  }

  if (!Object.prototype.hasOwnProperty.call(data, 'topFraggerGraphicMessageId')) {
    data.topFraggerGraphicMessageId = null;
  }

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

function sanitizePositiveInteger(value, fallback = 1, max = 9999) {
  const num = Number(value);
  if (!Number.isInteger(num) || num <= 0) return fallback;
  return Math.min(num, max);
}

function getRegistrationLimit() {
  return MAX_TEAMS;
}

function getTournamentTotalMatches() {
  return sanitizePositiveInteger(data?.tournamentSettings?.totalMatches, 3, 50);
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

function getSavedRoomsCategoryId() {
  return getBotSettings().roomsCategoryId || CATEGORY_ID;
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

function getLogoUrl() {
  const logoPath = path.join(__dirname, 'public', 'roda-logo.png');
  if (!fs.existsSync(logoPath)) return null;

  const baseUrl = getPublicBaseUrl();
  if (!baseUrl) return null;

  return `${baseUrl}/roda-logo.png`;
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

  const embed = new EmbedBuilder()
    .setColor(0x7b2cff)
    .setTitle(`🏆 ${project.tournamentName}`)
    .setDescription(
      `Benvenuto nel pannello iscrizioni ufficiale.\n\n` +
      `**Formato:** Team da 3 giocatori\n` +
      `**Iscrizioni:** ${isFull ? 'Chiuse' : 'Aperte'}\n` +
      `**Team registrati:** ${registered}/${maxTeams}\n\n` +
      `${isFull
        ? 'Le iscrizioni hanno raggiunto il limite massimo.'
        : 'Premi il pulsante qui sotto per registrare il tuo team.'}`
    )
    .setFooter({ text: 'Pannello registrazione torneo' });

  if (logoUrl) {
    embed.setThumbnail(logoUrl);
  }

  const btn = new ButtonBuilder()
    .setCustomId('register_btn')
    .setLabel(isFull ? 'Registrazioni chiuse' : 'Registra team')
    .setStyle(isFull ? ButtonStyle.Secondary : ButtonStyle.Primary)
    .setDisabled(isFull);

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

  const alreadySent = record.status === 'in_attesa' || record.status === 'approvato' || record.status === 'inserito_manualmente';

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
    embed.setThumbnail(logoUrl);
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(buildResultButtonCustomId(slot))
      .setLabel(alreadySent ? `Risultato Match ${matchNumber} già inviato` : `Invia risultato Match ${matchNumber}`)
      .setStyle(alreadySent ? ButtonStyle.Secondary : ButtonStyle.Primary)
      .setDisabled(alreadySent)
  );

  return {
    embeds: [embed],
    components: [row]
  };
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

function buildRegistrationTextPages() {
  refreshStateFromDisk();

  const project = getProjectSettings();
  const displayTeams = getDisplayTeams();
  const title = sanitizeText(data.registrationStatusTitle) || '🏆 TEAM REGISTRATI';
  const intro = sanitizeText(data.registrationStatusText) || 'Lista team attualmente registrati nel torneo.';
  const limit = getRegistrationLimit();
  const freeSpots = Math.max(limit - displayTeams.length, 0);
  const isFull = displayTeams.length >= limit;

  const pages = [];
  const pageTeams = chunkArray(displayTeams, 10);

  const header =
    `# ${title}\n` +
    `**Torneo:** ${project.tournamentName}\n` +
    `${intro}\n\n` +
    `**Team registrati:** ${displayTeams.length}/${limit}\n` +
    `**Posti disponibili:** ${freeSpots}\n` +
    `**Stato:** ${isFull ? 'Iscrizioni chiuse' : 'Iscrizioni aperte'}\n`;

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
      embed.setThumbnail(logoUrl);
    }

    return embed;
  });
}

function queueRegistrationStatusUpdate() {
  registrationStatusUpdateQueue = registrationStatusUpdateQueue
    .then(async () => {
      await waitReady();
      refreshStateFromDisk();

      const channel = await client.channels.fetch(REGISTRATION_STATUS_CHANNEL);
      const embeds = buildRegistrationEmbeds();

      if (data.registrationStatusMessageId) {
        try {
          const msg = await channel.messages.fetch(data.registrationStatusMessageId);
          await msg.edit({
            content: '',
            embeds,
            components: [],
            attachments: []
          });
          return true;
        } catch (error) {
          console.error('Errore update messaggio slot team:', error);
        }
      }

      const msg = await channel.send({
        content: '',
        embeds
      });

      data.registrationStatusMessageId = msg.id;
      saveState();
      return true;
    })
    .catch(error => {
      console.error('Errore queue pannello slot team:', error);
    });

  return registrationStatusUpdateQueue;
}

async function updateRegistrationStatusMessage() {
  return queueRegistrationStatusUpdate();
}

async function findPanelMessageByButtonCustomId(channel, customId) {
  try {
    const messages = await channel.messages.fetch({ limit: 50 });

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
    console.error(`Errore ricerca pannello in ${channel?.name || 'canale sconosciuto'}:`, error);
  }

  return null;
}

async function getVoiceTeamChannels(categoryIdToUse) {
  const guild = await client.guilds.fetch(GUILD_ID);
  await guild.channels.fetch();

  const channels = guild.channels.cache.filter(c =>
    c.parentId === categoryIdToUse &&
    c.type === ChannelType.GuildVoice &&
    c.name.startsWith('🏆・#')
  );

  return { guild, channels };
}

async function refreshTeamResultPanels(customCategoryId) {
  await waitReady();
  refreshStateFromDisk();

  const categoryIdToUse = sanitizeText(customCategoryId) || getSavedRoomsCategoryId();
  if (!categoryIdToUse) {
    return { ok: false, skipped: true, reason: 'Categoria non valida' };
  }

  const { channels } = await getVoiceTeamChannels(categoryIdToUse);

  if (!channels.size) {
    return { ok: true, updated: 0, created: 0, missingRooms: Object.keys(teams || {}).length };
  }

  let updated = 0;
  let created = 0;
  let missingRooms = 0;

  const channelList = [...channels.values()];

  for (const [teamName, teamData] of getSortedTeamEntries()) {
    const slot = Number(teamData?.slot || 0);
    const channel = channelList.find(ch => ch.name.startsWith(`🏆・#${slot} `));

    if (!channel) {
      missingRooms++;
      continue;
    }

    const customId = buildResultButtonCustomId(slot);
    const payload = createTeamResultPanelPayload(teamName, teamData);
    const existing = await findPanelMessageByButtonCustomId(channel, customId);

    if (existing) {
      try {
        await existing.edit(payload);
        updated++;
      } catch (error) {
        console.error(`Errore update pannello team ${teamName}:`, error);
      }
    } else {
      try {
        await channel.send(payload);
        created++;
      } catch (error) {
        console.error(`Errore invio pannello team ${teamName}:`, error);
      }
    }
  }

  logAudit('bot', 'discord', 'pannelli_risultati_team_aggiornati', {
    categoryId: categoryIdToUse,
    updated,
    created,
    missingRooms,
    currentMatch: Number(data.currentMatch || 1)
  });

  return {
    ok: true,
    updated,
    created,
    missingRooms
  };
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

async function updateSavedResultsPanelIfExists() {
  const settings = getBotSettings();
  return spawnResultsPanel(settings.resultsPanelChannelId);
}

async function updateSavedRegisterPanelIfExists() {
  const settings = getBotSettings();
  if (!settings.registerPanelChannelId) return { skipped: true };

  return spawnRegisterPanel(settings.registerPanelChannelId);
}

async function handleRegistrationStateChange() {
  refreshStateFromDisk();
  await updateRegistrationStatusMessage();
  await updateSavedRegisterPanelIfExists().catch(() => {});
  await updateSavedResultsPanelIfExists().catch(() => {});
  await maybeAnnounceTournamentFull();
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

async function waitReady() {
  await readyPromise;
  return client;
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

  if (entry.image) {
    embed.setImage(entry.image);
  }

  return embed;
}

function createStaffActionRow(id) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ok_${id}`).setLabel('APPROVA').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`no_${id}`).setLabel('RIFIUTA').setStyle(ButtonStyle.Danger)
  );
}

async function updateLeaderboardGraphics() {
  await waitReady();
  ensureDataStructures();

  const channel = await client.channels.fetch(CLASSIFICA_CHANNEL);
  const matchNumber = Number(data.currentMatch || 1);
  const stamp = Date.now();

  const leaderboardRows = getSortedScores();
  const topFraggerRows = getSortedFraggers();

  const leaderboardBuffer = await generateLeaderboardGraphicBuffer(leaderboardRows);
  const topFraggerBuffer = await generateTopFraggerGraphicBuffer(topFraggerRows);

  const leaderboardGraphicResult = await sendOrUpdateGraphicMessage({
    channel,
    messageId: data.leaderboardGraphicMessageId,
    fileName: `classifica-live-output-match-${matchNumber}-${stamp}.png`,
    buffer: leaderboardBuffer,
    content: `🏆 **CLASSIFICA LIVE** • Match ${matchNumber}`
  });

  data.leaderboardGraphicMessageId = leaderboardGraphicResult.messageId;

  const topFraggerGraphicResult = await sendOrUpdateGraphicMessage({
    channel,
    messageId: data.topFraggerGraphicMessageId,
    fileName: `top-fragger-output-match-${matchNumber}-${stamp}.png`,
    buffer: topFraggerBuffer,
    content: `🔥 **TOP FRAGGER** • Match ${matchNumber}`
  });

  data.topFraggerGraphicMessageId = topFraggerGraphicResult.messageId;
  saveState();

  return {
    ok: true,
    leaderboardGraphicResult,
    topFraggerGraphicResult
  };
}

async function sendOrUpdateGraphicMessage({
  channel,
  messageId,
  fileName,
  buffer,
  content
}) {
  const attachment = new AttachmentBuilder(buffer, { name: fileName });

  if (messageId) {
    try {
      const msg = await channel.messages.fetch(messageId);
      await msg.edit({
        content,
        files: [attachment]
      });
      return { updated: true, messageId: msg.id };
    } catch (error) {
      console.error(`Errore update messaggio grafico ${fileName}:`, error);
    }
  }

  const sent = await channel.send({
    content,
    files: [attachment]
  });

  return { created: true, messageId: sent.id };
}

async function updateLeaderboard() {
  await waitReady();
  ensureDataStructures();

  const channel = await client.channels.fetch(CLASSIFICA_CHANNEL);
  const project = getProjectSettings();

  const sorted = Object.entries(data.scores || {}).sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0));
  const desc = sorted.map((t, i) => `#${i + 1} ${t[0]} - ${t[1]} pt`).join('\n') || 'Nessun dato';

  const frag = Object.entries(data.fragger || {})
    .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))
    .slice(0, 5)
    .map(f => `${f[0]} (${f[1]})`)
    .join('\n') || 'Nessuno';

  const embed = new EmbedBuilder()
    .setColor(0x7b2cff)
    .setTitle(`🏆 ${project.tournamentName} • CLASSIFICA MATCH ${data.currentMatch}`)
    .setDescription(desc)
    .addFields({ name: '🔥 Top Fragger', value: frag });

  let created = false;
  let updated = false;

  if (data.leaderboardMessageId) {
    try {
      const msg = await channel.messages.fetch(data.leaderboardMessageId);
      await msg.edit({ embeds: [embed] });
      updated = true;
    } catch {}
  }

  if (!updated) {
    const msg = await channel.send({ embeds: [embed] });
    data.leaderboardMessageId = msg.id;
    created = true;
    saveState();
  }

  let graphicsResult = null;
  try {
    graphicsResult = await updateLeaderboardGraphics();
  } catch (error) {
    console.error('Errore aggiornamento grafiche classifica:', error);
  }

  logAudit('bot', 'discord', updated ? 'classifica_aggiornata' : 'classifica_creata', {
    currentMatch: data.currentMatch,
    updated,
    created,
    leaderboardGraphicMessageId: data.leaderboardGraphicMessageId || null,
    topFraggerGraphicMessageId: data.topFraggerGraphicMessageId || null
  });

  return {
    ok: true,
    updated,
    created,
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
  await updateLeaderboard();
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
  ensureDataStructures();

  const botSettings = getBotSettings();
  const targetChannelId = sanitizeText(channelId) || botSettings.registerPanelChannelId;
  if (!targetChannelId) {
    throw new Error('Channel ID pannello registrazione non valido');
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
    updated
  });

  return { ok: true, created, updated };
}

async function spawnResultsPanel(channelId) {
  await waitReady();
  ensureDataStructures();

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
    currentMatch: Number(data.currentMatch || 1)
  });

  return {
    ok: true,
    created: false,
    updated: false,
    teamPanels
  };
}

async function createTeamRooms(customCategoryId) {
  await waitReady();
  refreshStateFromDisk();

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

  const sortedTeams = getSortedTeamEntries();
  if (!sortedTeams.length) {
    throw new Error('Nessun team registrato');
  }

  await guild.channels.fetch();

  const existingNames = new Set(
    guild.channels.cache
      .filter(c => c.parentId === categoryIdToUse && c.type === ChannelType.GuildVoice)
      .map(c => c.name)
  );

  let created = 0;
  let skipped = 0;

  for (const [teamName, teamData] of sortedTeams) {
    const channelName = buildTeamVoiceChannelName(teamData.slot, teamName);

    if (existingNames.has(channelName)) {
      skipped++;
      continue;
    }

    await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildVoice,
      parent: categoryIdToUse
    });

    existingNames.add(channelName);
    created++;
  }

  data.botSettings.roomsCategoryId = categoryIdToUse;
  saveState();

  let teamPanels = null;
  try {
    teamPanels = await refreshTeamResultPanels(categoryIdToUse);
  } catch (error) {
    console.error('Errore creazione pannelli team dopo stanze:', error);
  }

  logAudit('dashboard', 'web', 'stanze_team_create', {
    categoryId: categoryIdToUse,
    created,
    skipped,
    teamPanelsCreated: Number(teamPanels?.created || 0),
    teamPanelsUpdated: Number(teamPanels?.updated || 0)
  });

  return { ok: true, created, skipped, teamPanels };
}

async function deleteTeamRooms(customCategoryId) {
  await waitReady();

  const guild = await client.guilds.fetch(GUILD_ID);
  const categoryIdToUse = sanitizeText(customCategoryId) || getSavedRoomsCategoryId();

  await guild.channels.fetch();

  const channels = guild.channels.cache.filter(c =>
    c.parentId === categoryIdToUse &&
    c.type === ChannelType.GuildVoice &&
    c.name.startsWith('🏆・#')
  );

  let deleted = 0;

  for (const ch of channels.values()) {
    try {
      await ch.delete();
      deleted++;
    } catch {}
  }

  data.botSettings.roomsCategoryId = categoryIdToUse;
  saveState();

  logAudit('dashboard', 'web', 'stanze_team_eliminate', {
    categoryId: categoryIdToUse,
    deleted
  });

  return { ok: true, deleted };
}

function buildLobbyCodeMessage(lobbyCode) {
  const cleanCode = sanitizeText(lobbyCode);
  return `🎮 **CODICE LOBBY**

Codice: **${cleanCode}**

Il codice viene inviato nelle stanze ufficiali dei team.
Buon game 🔥`;
}

async function sendLobbyCodeToTeamRooms(lobbyCode, customCategoryId) {
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
    .filter(c =>
      c.parentId === categoryIdToUse &&
      c.type === ChannelType.GuildVoice &&
      c.name.startsWith('🏆・#')
    )
    .sort((a, b) => a.rawPosition - b.rawPosition);

  if (!channels.size) {
    throw new Error('Nessuna stanza team trovata nella categoria selezionata');
  }

  const content = buildLobbyCodeMessage(cleanCode);

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

  for (const target of tryUrls) {
    try {
      const response = await fetch(target);
      if (!response.ok) continue;

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
    } catch {}
  }

  return attachment.url;
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
  await updateLeaderboard();
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
  await updateLeaderboard();
  return data.currentMatch;
}

function resetAllState() {
  data = getDefaultData();
  saveState();
}

function saveBotPanelSettings(settings = {}) {
  ensureDataStructures();

  data.botSettings.registerPanelChannelId = sanitizeText(
    settings.registerPanelChannelId || data.botSettings.registerPanelChannelId
  );

  data.botSettings.resultsPanelChannelId = sanitizeText(
    settings.resultsPanelChannelId || data.botSettings.resultsPanelChannelId
  );

  data.botSettings.roomsCategoryId = sanitizeText(
    settings.roomsCategoryId || data.botSettings.roomsCategoryId
  );

  if (Object.prototype.hasOwnProperty.call(settings, 'generalChannelId')) {
    data.botSettings.generalChannelId = sanitizeText(settings.generalChannelId);
  }

  if (Object.prototype.hasOwnProperty.call(settings, 'rulesChannelId')) {
    data.botSettings.rulesChannelId = sanitizeText(settings.rulesChannelId);
  }

  if (Object.prototype.hasOwnProperty.call(settings, 'lobbyChannelId')) {
    data.botSettings.lobbyChannelId = sanitizeText(settings.lobbyChannelId);
  }

  saveState();

  logAudit('dashboard', 'web', 'impostazioni_bot_salvate', {
    registerPanelChannelId: data.botSettings.registerPanelChannelId,
    resultsPanelChannelId: data.botSettings.resultsPanelChannelId,
    roomsCategoryId: data.botSettings.roomsCategoryId,
    generalChannelId: data.botSettings.generalChannelId || '',
    rulesChannelId: data.botSettings.rulesChannelId || '',
    lobbyChannelId: data.botSettings.lobbyChannelId || ''
  });

  return {
    registerPanelChannelId: data.botSettings.registerPanelChannelId,
    resultsPanelChannelId: data.botSettings.resultsPanelChannelId,
    roomsCategoryId: data.botSettings.roomsCategoryId,
    generalChannelId: data.botSettings.generalChannelId || '',
    rulesChannelId: data.botSettings.rulesChannelId || '',
    lobbyChannelId: data.botSettings.lobbyChannelId || ''
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
    brandName: project.brandName,
    tournamentName: FIXED_TOURNAMENT_NAME,
    premiumMode: project.premiumMode,
    totalMatches: tournament.totalMatches,
    playersPerTeam: PLAYERS_PER_TEAM,
    maxTeams: MAX_TEAMS
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
  await updateLeaderboard().catch(error => {
    console.error('Errore aggiornamento classifica al ready:', error);
  });
});

client.on('interactionCreate', async interaction => {
  try {
    if (interaction.isButton() && interaction.customId === 'register_btn') {
      const project = getProjectSettings();

      if (isTournamentFull()) {
        await maybeAnnounceTournamentFull();
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
              .setLabel(`Kill ${players[i] || `Giocatore ${i + 1}`}`)
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

      if (!team || !p1 || !p2 || !p3) {
        return interaction.editReply({ content: '❌ Compila tutti i campi.' });
      }

      if (teams[team]) {
        return interaction.editReply({ content: '❌ Esiste già un team con questo nome.' });
      }

      if (isTournamentFull()) {
        await maybeAnnounceTournamentFull();
        return interaction.editReply({
          content: `🚫 Le registrazioni sono chiuse. **${project.tournamentName}** ha già raggiunto ${getRegistrationLimit()} team.`
        });
      }

      const slot = getNextAvailableSlot();
      if (!slot) {
        await maybeAnnounceTournamentFull();
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
        return interaction.reply({ content: '❌ Team non trovato.', ephemeral: true });
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

    if (interaction.isButton()) {
      const [action, id] = interaction.customId.split('_');
      if (!id) return;

      if (action === 'ok') {
        const entry = data.pending[id];
        if (!entry) {
          return interaction.reply({ content: '❌ Risultato non trovato.', ephemeral: true });
        }

        await approvePending(id, interaction.user.tag, 'discord');
        const embed = createResultEmbed(entry, '✅ APPROVATO');
        return interaction.update({ embeds: [embed], components: [] });
      }

      if (action === 'no') {
        const entry = data.pending[id];
        if (!entry) {
          return interaction.reply({ content: '❌ Risultato non trovato.', ephemeral: true });
        }

        await rejectPending(id, interaction.user.tag, 'discord');
        const embed = createResultEmbed(entry, '❌ RIFIUTATO');
        return interaction.update({ embeds: [embed], components: [] });
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
    const image = await saveDiscordAttachmentLocally(attachment);

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
    console.error(error);
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
  createTeamRooms,
  deleteTeamRooms,
  sendLobbyCodeToTeamRooms,
  nextMatch,
  nextMatchAndRefresh,
  setCurrentMatch,
  setCurrentMatchAndRefresh,
  submitWebResult,
  getBotConfig,
  resetAllState,
  saveBotPanelSettings,
  refreshTeamResultPanels,
  getTournamentSettings,
  getTournamentMessages,
  calcPoints
};
