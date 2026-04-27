const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
const { client, waitReady } = require('./client');
const state = require('./state');
const {
  refreshStateFromDisk,
  ensureDataStructures,
  saveState,
  logAudit,
  getProjectSettings,
  getBotSettings,
  areRegistrationsOpen,
  getRegistrationLimit,
  getSortedTeamEntries,
  getDisplayTeams,
  getSortedScores,
  getSortedFraggers,
  isTournamentFull,
  getSavedRoomsCategoryId,
  setCurrentMatch,
  nextMatch
} = require('./lifecycle');
const { sanitizeText, buildResultButtonCustomId, getLogoUrl, chunkArray, FIXED_TOURNAMENT_NAME, PLAYERS_PER_TEAM } = require('./helpers');
const { CLASSIFICA_CHANNEL, TOURNAMENT_FULL_CHANNEL, REGISTRATION_STATUS_CHANNEL } = require('./config');
const {
  findOrCreateTournamentCategory,
  findOrCreateTextChannelInCategory,
  ensureRulesMessage,
  ensureGeneralMessage,
  getVoiceTeamChannels,
  findPanelMessageByButtonCustomId,
  safeSendToTeamVoiceChannel,
  GENERAL_CHANNEL_NAME,
  RULES_CHANNEL_NAME,
  REGISTRATION_CHANNEL_NAME
} = require('./channels');
const {
  generateLeaderboardGraphicBuffer,
  generateTopFraggerGraphicBuffer,
  generateRegisteredTeamsGraphicBuffer
} = require('../renderer');

function createRegisterPanelPayload() {
  const project = getProjectSettings();
  const logoUrl = getLogoUrl();
  const registered = Object.keys(state.teams || {}).length;
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
      `${!registrationsOpen ? "Le iscrizioni non sono ancora aperte. Attendi l'annuncio dello staff." : isFull ? 'Le iscrizioni hanno raggiunto il limite massimo.' : 'Premi il pulsante qui sotto per registrare il tuo team.'}`
    )
    .setFooter({ text: 'Pannello registrazione torneo' });
  if (logoUrl) { try { embed.setThumbnail(logoUrl); } catch {} }
  const btn = new ButtonBuilder()
    .setCustomId('register_btn')
    .setLabel(disabled ? 'Registrazioni chiuse' : 'Registra team')
    .setStyle(disabled ? ButtonStyle.Secondary : ButtonStyle.Primary)
    .setDisabled(disabled);
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(btn)] };
}

function createTeamResultPanelPayload(teamName, teamData) {
  const project = getProjectSettings();
  const logoUrl = getLogoUrl();
  const slot = Number(teamData?.slot || 0);
  const players = Array.isArray(teamData?.players) ? teamData.players : [];
  const matchNumber = Number(state.data.currentMatch || 1);
  const { getSubmissionRecord } = require('./lifecycle');
  const record = getSubmissionRecord(teamName, matchNumber);
  const alreadySent = record.status === 'in_attesa' || record.status === 'approvato' || record.status === 'inserito_manualmente';
  const statusText = alreadySent
    ? (record.status === 'in_attesa' ? 'Risultato già inviato e in attesa dello staff.' : 'Risultato già registrato per questo match.')
    : "Compila le kill dei 3 giocatori e la posizione finale. Dopo l'invio, allega lo screenshot della partita nella chat di questa stanza.";
  const embed = new EmbedBuilder()
    .setColor(0x7b2cff)
    .setTitle(`📸 Risultato Match ${matchNumber}`)
    .setDescription(
      `**Team:** ${teamName}\n**Slot:** #${slot || '-'}\n**Torneo:** ${project.tournamentName}\n\n${statusText}\n\n` +
      `**Giocatori:**\n• ${sanitizeText(players[0]) || 'Giocatore 1'}\n• ${sanitizeText(players[1]) || 'Giocatore 2'}\n• ${sanitizeText(players[2]) || 'Giocatore 3'}`
    )
    .setFooter({ text: `Pannello locale team • Match ${matchNumber}` });
  if (logoUrl) { try { embed.setThumbnail(logoUrl); } catch {} }
  const submitBtn = new ButtonBuilder()
    .setCustomId(buildResultButtonCustomId(slot))
    .setLabel(alreadySent ? `Risultato Match ${matchNumber} già inviato` : `Invia risultato Match ${matchNumber}`)
    .setStyle(alreadySent ? ButtonStyle.Secondary : ButtonStyle.Primary)
    .setDisabled(alreadySent);
  const reportBtn = new ButtonBuilder().setCustomId(`report_slot_${slot}`).setLabel('⚠️ Segnala problema').setStyle(ButtonStyle.Danger);
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(submitBtn, reportBtn)] };
}

function buildRegistrationTextPages() {
  refreshStateFromDisk();
  const project = getProjectSettings();
  const displayTeams = getDisplayTeams();
  const title = sanitizeText(state.data.registrationStatusTitle) || '🏆 TEAM REGISTRATI';
  const intro = sanitizeText(state.data.registrationStatusText) || 'Lista team attualmente registrati nel torneo.';
  const limit = getRegistrationLimit();
  const freeSpots = Math.max(limit - displayTeams.length, 0);
  const registrationsOpen = areRegistrationsOpen();
  const isFull = displayTeams.length >= limit;
  const header = `# ${title}\n**Torneo:** ${project.tournamentName}\n${intro}\n\n**Team registrati:** ${displayTeams.length}/${limit}\n**Posti disponibili:** ${freeSpots}\n**Stato:** ${registrationsOpen && !isFull ? 'Iscrizioni aperte' : 'Iscrizioni chiuse'}\n`;
  if (!displayTeams.length) return [`${header}\n**Nessun team registrato al momento.**`];
  const pages = [];
  const pageTeams = chunkArray(displayTeams, 10);
  pageTeams.forEach((teamsChunk, pageIndex) => {
    const lines = teamsChunk.map(team => {
      const p1 = sanitizeText(team.players?.[0]) || 'Giocatore 1';
      const p2 = sanitizeText(team.players?.[1]) || 'Giocatore 2';
      const p3 = sanitizeText(team.players?.[2]) || 'Giocatore 3';
      return `🏆 **#${team.slot} • ${team.teamName}**\n👤 ${p1} • ${p2} • ${p3}`;
    });
    const pageHeader = pageTeams.length > 1 ? `${header}\n**Pagina ${pageIndex + 1}/${pageTeams.length}**\n` : header;
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
    if (logoUrl) { try { embed.setThumbnail(logoUrl); } catch {} }
    return embed;
  });
}

async function refreshTeamResultPanels(customCategoryId) {
  await waitReady();
  refreshStateFromDisk();
  const categoryIdToUse = sanitizeText(customCategoryId) || getSavedRoomsCategoryId();
  if (!categoryIdToUse) return { ok: false, skipped: true, reason: 'Categoria non configurata' };
  const { channels, allVoiceInCategory = [] } = await getVoiceTeamChannels(categoryIdToUse);
  const sortedTeams = getSortedTeamEntries();
  if (!sortedTeams.length) return { ok: true, updated: 0, created: 0, missingRooms: 0, failed: 0, details: [], allVoiceInCategory, reason: 'Nessun team registrato' };
  if (!channels.size) {
    return { ok: true, updated: 0, created: 0, missingRooms: sortedTeams.length, failed: 0, foundChannelNames: [], allVoiceInCategory, details: sortedTeams.map(([teamName, teamData]) => ({ team: teamName, slot: Number(teamData?.slot || 0), status: 'missing_room', reason: `Nessuna stanza vocale corrispondente trovata nella categoria (totale canali vocali: ${allVoiceInCategory.length})` })) };
  }
  const foundChannelNames = [...channels.values()].map(ch => ch.name);
  let updated = 0, created = 0, missingRooms = 0, failed = 0;
  const details = [];
  const channelList = [...channels.values()];
  for (const [teamName, teamData] of sortedTeams) {
    const slot = Number(teamData?.slot || 0);
    const normalize = str => String(str || '').normalize('NFKC').trim();
    const slotPrefix = normalize(`🏆・#${slot}`);
    const channel = channelList.find(ch => {
      const normalized = normalize(ch.name);
      return normalized.startsWith(slotPrefix + ' ') || normalized.startsWith(slotPrefix + '　') || normalized === slotPrefix || normalized.includes(`#${slot} `) || normalized.includes(`#${slot}　`);
    });
    if (!channel) { missingRooms++; details.push({ team: teamName, slot, status: 'missing_room' }); continue; }
    try {
      const customId = buildResultButtonCustomId(slot);
      const payload = createTeamResultPanelPayload(teamName, teamData);
      const existing = await findPanelMessageByButtonCustomId(channel, customId);
      if (existing) {
        try { await existing.delete(); } catch {}
        await safeSendToTeamVoiceChannel(channel, payload);
        updated++;
        details.push({ team: teamName, slot, channelId: channel.id, channelName: channel.name, status: 'updated' });
      } else {
        await safeSendToTeamVoiceChannel(channel, payload);
        created++;
        details.push({ team: teamName, slot, channelId: channel.id, channelName: channel.name, status: 'created' });
      }
    } catch (err) {
      failed++;
      details.push({ team: teamName, slot, channelId: channel.id, channelName: channel.name, status: 'failed', error: err.message || 'Errore invio pannello' });
      console.error(`Errore pannello risultato ${teamName}:`, err);
    }
  }
  logAudit('bot', 'discord', 'pannelli_risultati_team_aggiornati', { categoryId: categoryIdToUse, updated, created, missingRooms, failed, currentMatch: Number(state.data.currentMatch || 1) });
  return { ok: true, categoryId: categoryIdToUse, updated, created, missingRooms, failed, foundChannelNames, allVoiceInCategory, details };
}

async function spawnRegisterPanel(channelId) {
  await waitReady();
  refreshStateFromDisk();
  const botSettings = getBotSettings();
  const targetChannelId = sanitizeText(channelId) || botSettings.registerPanelChannelId;
  if (!targetChannelId) throw new Error('ID canale pannello registrazione non valido');
  const channel = await client.channels.fetch(targetChannelId);
  const payload = createRegisterPanelPayload();
  let created = false, updated = false;
  if (botSettings.registerPanelMessageId && botSettings.registerPanelChannelId === targetChannelId) {
    try { const msg = await channel.messages.fetch(botSettings.registerPanelMessageId); await msg.edit(payload); updated = true; } catch {}
  }
  if (!updated) {
    const msg = await channel.send(payload);
    state.data.botSettings.registerPanelMessageId = msg.id;
    created = true;
  }
  state.data.botSettings.registerPanelChannelId = targetChannelId;
  saveState();
  logAudit('dashboard', 'web', 'pannello_registrazione_inviato', { channelId: targetChannelId, created, updated, registrationsOpen: areRegistrationsOpen() });
  return { ok: true, created, updated, registrationsOpen: areRegistrationsOpen() };
}

async function spawnResultsPanel(channelId) {
  await waitReady();
  refreshStateFromDisk();
  const botSettings = getBotSettings();
  const targetChannelId = sanitizeText(channelId) || botSettings.resultsPanelChannelId;
  if (targetChannelId) { state.data.botSettings.resultsPanelChannelId = targetChannelId; saveState(); }
  const teamPanels = await refreshTeamResultPanels();
  logAudit('dashboard', 'web', 'pannelli_risultati_team_generati', { savedChannelId: targetChannelId || null, teamPanelsCreated: Number(teamPanels?.created || 0), teamPanelsUpdated: Number(teamPanels?.updated || 0), missingRooms: Number(teamPanels?.missingRooms || 0), failed: Number(teamPanels?.failed || 0), currentMatch: Number(state.data.currentMatch || 1) });
  return { ok: true, created: false, updated: false, teamPanels };
}

function queueRegistrationStatusUpdate(options = {}) {
  state.registrationStatusUpdateQueue = state.registrationStatusUpdateQueue
    .then(async () => {
      await waitReady();
      ensureDataStructures();
      const botSettings = getBotSettings();
      const targetChannelId = sanitizeText(REGISTRATION_STATUS_CHANNEL) || sanitizeText(botSettings.registerPanelChannelId);
      if (!targetChannelId) return { skipped: true, reason: 'no_channel' };
      const channel = await client.channels.fetch(targetChannelId).catch(() => null);
      if (!channel) return { skipped: true, reason: 'channel_not_found' };
      // Se il canale è cambiato dall'ultima volta, azzeriamo i riferimenti ai messaggi
      // per evitare di cercarli nel canale sbagliato e creare duplicati.
      if (state.data.registrationStatusChannelId && state.data.registrationStatusChannelId !== targetChannelId) {
        state.data.registrationStatusMessageId = null;
        state.data.registrationGraphicMessageId = null;
        state.data.lastRegistrationGraphicSignature = null;
      }
      state.data.registrationStatusChannelId = targetChannelId;
      const displayTeams = getDisplayTeams();
      const signature = `${displayTeams.length}:${areRegistrationsOpen()}`;
      let existingMsg = null;
      if (state.data.registrationStatusMessageId) {
        try { existingMsg = await channel.messages.fetch(state.data.registrationStatusMessageId); } catch {}
      }
      if (!existingMsg && state.data.registrationGraphicMessageId) {
        try { existingMsg = await channel.messages.fetch(state.data.registrationGraphicMessageId); } catch {}
      }
      if (existingMsg && state.data.lastRegistrationGraphicSignature === signature && !options.force) {
        return { ok: true, updated: false, created: false, skipped: true, reason: 'no_change' };
      }
      let graphicBuffer = null, graphicError = null;
      try { graphicBuffer = await generateRegisteredTeamsGraphicBuffer(displayTeams); } catch (err) { graphicError = err; console.error('Errore grafica team registrati:', err); }
      if (graphicBuffer && graphicBuffer.length) {
        const stamp = Date.now();
        const attachment = new AttachmentBuilder(graphicBuffer, { name: `team-registrati-${stamp}.png` });
        if (existingMsg) {
          try {
            await existingMsg.edit({ content: '', embeds: [], components: [], files: [attachment] });
            state.data.registrationGraphicMessageId = existingMsg.id;
            state.data.registrationStatusMessageId = existingMsg.id;
            if (signature) state.data.lastRegistrationGraphicSignature = signature;
            saveState();
            return { ok: true, updated: true, created: false, graphic: true, messageId: existingMsg.id };
          } catch (err) { console.error('Errore update grafica team registrati:', err); }
        }
        const msg = await channel.send({ content: '', files: [attachment] });
        state.data.registrationGraphicMessageId = msg.id;
        state.data.registrationStatusMessageId = msg.id;
        if (signature) state.data.lastRegistrationGraphicSignature = signature;
        saveState();
        return { ok: true, updated: false, created: true, graphic: true, messageId: msg.id };
      }
      const embeds = buildRegistrationEmbeds();
      if (existingMsg) {
        try {
          await existingMsg.edit({ content: '', embeds, components: [], attachments: [] });
          state.data.registrationStatusMessageId = existingMsg.id;
          if (signature) state.data.lastRegistrationGraphicSignature = signature;
          saveState();
          return { ok: true, updated: true, created: false, graphic: false, fallback: true, error: graphicError?.message || null, messageId: existingMsg.id };
        } catch (err) { console.error('Errore update messaggio slot team:', err); }
      }
      const msg = await channel.send({ content: '', embeds });
      state.data.registrationStatusMessageId = msg.id;
      if (signature) state.data.lastRegistrationGraphicSignature = signature;
      saveState();
      return { ok: true, updated: false, created: true, graphic: false, fallback: true, error: graphicError?.message || null, messageId: msg.id };
    })
    .catch(err => { console.error('Errore queue pannello slot team:', err); return { ok: false, error: true, message: err.message || 'Errore aggiornamento team registrati' }; });
  return state.registrationStatusUpdateQueue;
}

async function updateRegistrationStatusMessage(options = {}) {
  return queueRegistrationStatusUpdate(options);
}

async function maybeAnnounceTournamentFull() {
  if (!isTournamentFull()) {
    if (state.data.registrationClosedAnnounced) { state.data.registrationClosedAnnounced = false; saveState(); }
    return;
  }
  if (state.data.registrationClosedAnnounced) return;
  const project = getProjectSettings();
  try {
    const channel = await client.channels.fetch(TOURNAMENT_FULL_CHANNEL);
    const embed = new EmbedBuilder().setColor(0x7b2cff).setTitle('🚫 REGISTRAZIONI CHIUSE').setDescription(`**${project.tournamentName}** ha raggiunto il limite massimo di **${getRegistrationLimit()} team registrati**.\n\nGrazie a tutti per l'interesse. Le iscrizioni sono ora chiuse. 🔥`);
    await channel.send({ embeds: [embed] });
    state.data.registrationClosedAnnounced = true;
    saveState();
    logAudit('bot', 'discord', 'registrazioni_chiuse_annunciate', { tournamentName: project.tournamentName, maxTeams: getRegistrationLimit() });
  } catch (err) { console.error('Errore annuncio torneo pieno:', err); }
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
  const results = { registerPanel: null, resultsPanel: null };
  if (settings.registerPanelChannelId) {
    try { results.registerPanel = await spawnRegisterPanel(settings.registerPanelChannelId); } catch (err) { console.error('Errore refresh pannello registrazione:', err); }
  }
  try { results.resultsPanel = await spawnResultsPanel(settings.resultsPanelChannelId); } catch (err) { console.error('Errore refresh pannelli risultati team:', err); }
  return results;
}

async function sendOrUpdateGraphicMessage({ channel, messageId, fileName, buffer, content, allowCreate = true }) {
  const attachment = new AttachmentBuilder(buffer, { name: fileName });
  if (messageId) {
    try {
      const msg = await channel.messages.fetch(messageId);
      await msg.edit({ content, embeds: [], components: [], files: [attachment] });
      return { updated: true, created: false, skipped: false, messageId: msg.id };
    } catch (err) { console.error(`Errore update messaggio grafico ${fileName}:`, err); }
  }
  if (!allowCreate) return { updated: false, created: false, skipped: true, messageId: messageId || null, reason: 'Messaggio grafico non trovato e creazione disattivata' };
  const sent = await channel.send({ content, files: [attachment] });
  return { updated: false, created: true, skipped: false, messageId: sent.id };
}

async function deleteOldTextLeaderboardMessage(channel) {
  let deleted = false, cleared = false;
  const removedIds = [];
  if (state.data.leaderboardMessageId) {
    const oldId = state.data.leaderboardMessageId;
    try { const msg = await channel.messages.fetch(oldId); await msg.delete().catch(() => {}); deleted = true; removedIds.push(oldId); } catch { cleared = true; }
    state.data.leaderboardMessageId = null;
    saveState();
  }
  return { deleted, cleared, removedIds };
}

async function updateLeaderboardGraphicsImmediate(options = {}) {
  const allowCreate = options.allowCreate !== false;
  const targetChannelId = sanitizeText(state.data?.botSettings?.leaderboardChannelId) || CLASSIFICA_CHANNEL;
  if (!targetChannelId) { console.warn('[classifica] Canale classifica non configurato.'); return { skipped: true, reason: 'no_channel' }; }
  const channel = await client.channels.fetch(targetChannelId);
  const matchNumber = Number(state.data.currentMatch || 1);
  const stamp = Date.now();
  await deleteOldTextLeaderboardMessage(channel).catch(err => console.error('Errore eliminazione vecchia classifica testuale:', err));
  const leaderboardRows = getSortedScores();
  const topFraggerRows = getSortedFraggers();
  const leaderboardBuffer = await generateLeaderboardGraphicBuffer(leaderboardRows);
  const topFraggerBuffer = await generateTopFraggerGraphicBuffer(topFraggerRows);
  const leaderboardGraphicResult = await sendOrUpdateGraphicMessage({ channel, messageId: state.data.leaderboardGraphicMessageId, fileName: `classifica-live-output-match-${matchNumber}-${stamp}.png`, buffer: leaderboardBuffer, content: `🏆 **CLASSIFICA LIVE** • Match ${matchNumber}`, allowCreate });
  if (leaderboardGraphicResult.messageId) state.data.leaderboardGraphicMessageId = leaderboardGraphicResult.messageId;
  const topFraggerGraphicResult = await sendOrUpdateGraphicMessage({ channel, messageId: state.data.topFraggerGraphicMessageId, fileName: `top-fragger-output-match-${matchNumber}-${stamp}.png`, buffer: topFraggerBuffer, content: `🔥 **TOP FRAGGER** • Match ${matchNumber}`, allowCreate });
  if (topFraggerGraphicResult.messageId) state.data.topFraggerGraphicMessageId = topFraggerGraphicResult.messageId;
  state.data.leaderboardMessageId = null;
  saveState();
  return { ok: true, allowCreate, leaderboardGraphicResult, topFraggerGraphicResult, textLeaderboardDisabled: true };
}

async function updateLeaderboardGraphics(options = {}) {
  state.leaderboardUpdateQueue = state.leaderboardUpdateQueue
    .then(() => updateLeaderboardGraphicsImmediate(options))
    .catch(err => { console.error('Errore queue classifiche grafiche:', err); return { ok: false, error: true, message: err.message || 'Errore aggiornamento classifiche grafiche' }; });
  return state.leaderboardUpdateQueue;
}

async function updateLeaderboard(options = {}) {
  await waitReady();
  ensureDataStructures();
  const allowCreate = options.allowCreate !== false;
  const updateGraphics = options.updateGraphics !== false;
  let graphicsResult = null;
  if (updateGraphics) graphicsResult = await updateLeaderboardGraphics({ allowCreate });
  logAudit('bot', 'discord', 'classifiche_grafiche_aggiornate', { currentMatch: state.data.currentMatch, allowCreate, leaderboardGraphicMessageId: state.data.leaderboardGraphicMessageId || null, topFraggerGraphicMessageId: state.data.topFraggerGraphicMessageId || null, textLeaderboardDisabled: true });
  return { ok: true, allowCreate, updated: Boolean(graphicsResult?.leaderboardGraphicResult?.updated || graphicsResult?.topFraggerGraphicResult?.updated), created: Boolean(graphicsResult?.leaderboardGraphicResult?.created || graphicsResult?.topFraggerGraphicResult?.created), skipped: Boolean(graphicsResult?.leaderboardGraphicResult?.skipped && graphicsResult?.topFraggerGraphicResult?.skipped), textLeaderboardDisabled: true, graphicsResult };
}

async function ensureTournamentDiscordStructure(customCategoryId = '') {
  await waitReady();
  refreshStateFromDisk();
  const guild = await client.guilds.fetch(require('./config').GUILD_ID);
  const categoryResult = await findOrCreateTournamentCategory(guild, sanitizeText(customCategoryId) || getSavedRoomsCategoryId());
  const category = categoryResult.category;
  const generalResult = await findOrCreateTextChannelInCategory(guild, category, GENERAL_CHANNEL_NAME, 'Chat generale ufficiale della RØDA CUP');
  const rulesResult = await findOrCreateTextChannelInCategory(guild, category, RULES_CHANNEL_NAME, 'Regolamento ufficiale RØDA CUP');
  const registrationResult = await findOrCreateTextChannelInCategory(guild, category, REGISTRATION_CHANNEL_NAME, 'Canale iscrizioni ufficiale RØDA CUP');
  await ensureGeneralMessage(generalResult.channel).catch(err => console.error('Errore messaggio generale RØDA CUP:', err));
  await ensureRulesMessage(rulesResult.channel).catch(err => console.error('Errore messaggio regolamento RØDA CUP:', err));
  state.data.botSettings.roomsCategoryId = category.id;
  state.data.botSettings.generalChannelId = generalResult.channel.id;
  state.data.botSettings.rulesChannelId = rulesResult.channel.id;
  state.data.botSettings.registerPanelChannelId = registrationResult.channel.id;
  saveState();
  let registerPanel = null;
  try { registerPanel = await spawnRegisterPanel(registrationResult.channel.id); } catch (err) { registerPanel = { ok: false, error: true, message: err.message || 'Errore creazione pannello iscrizioni' }; console.error('Errore pannello iscrizioni RØDA CUP:', err); }
  logAudit('bot', 'discord', 'struttura_discord_torneo_preparata', { categoryId: category.id, categoryCreated: Boolean(categoryResult.created), generalChannelId: generalResult.channel.id, generalCreated: Boolean(generalResult.created), rulesChannelId: rulesResult.channel.id, rulesCreated: Boolean(rulesResult.created), registrationChannelId: registrationResult.channel.id, registrationCreated: Boolean(registrationResult.created) });
  return { ok: true, categoryId: category.id, categoryCreated: Boolean(categoryResult.created), generalChannelId: generalResult.channel.id, generalCreated: Boolean(generalResult.created), rulesChannelId: rulesResult.channel.id, rulesCreated: Boolean(rulesResult.created), registrationChannelId: registrationResult.channel.id, registrationCreated: Boolean(registrationResult.created), registerPanel };
}

async function setCurrentMatchAndRefresh(match) {
  setCurrentMatch(match);
  await refreshTeamResultPanels();
  await updateLeaderboard({ allowCreate: true });
  return state.data.currentMatch;
}

async function nextMatchAndRefresh() {
  nextMatch();
  await refreshTeamResultPanels();
  await updateLeaderboard({ allowCreate: true });
  return state.data.currentMatch;
}

module.exports = {
  createRegisterPanelPayload,
  createTeamResultPanelPayload,
  buildRegistrationTextPages,
  buildRegistrationEmbeds,
  refreshTeamResultPanels,
  spawnRegisterPanel,
  spawnResultsPanel,
  queueRegistrationStatusUpdate,
  updateRegistrationStatusMessage,
  maybeAnnounceTournamentFull,
  handleRegistrationStateChange,
  updateSavedRegisterPanelIfExists,
  updateSavedResultsPanelIfExists,
  refreshSavedPanels,
  sendOrUpdateGraphicMessage,
  deleteOldTextLeaderboardMessage,
  updateLeaderboardGraphicsImmediate,
  updateLeaderboardGraphics,
  updateLeaderboard,
  ensureTournamentDiscordStructure,
  setCurrentMatchAndRefresh,
  nextMatchAndRefresh
};
