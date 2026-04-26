const { ChannelType, EmbedBuilder } = require('discord.js');
const { client, waitReady } = require('./client');
const state = require('./state');
const {
  refreshStateFromDisk,
  ensureDataStructures,
  saveState,
  logAudit,
  getTournamentMessages,
  getSortedTeamEntries,
  getSavedRoomsCategoryId,
  TOURNAMENT_CATEGORY_NAME
} = require('./lifecycle');
const { sanitizeText, buildTeamVoiceChannelName, buildResultButtonCustomId, getDiscordChannelTypeLabel } = require('./helpers');
const { GUILD_ID } = require('./config');

const GENERAL_CHANNEL_NAME = '💬・generale';
const RULES_CHANNEL_NAME = '📜・regolamento';
const REGISTRATION_CHANNEL_NAME = '📝・iscrizioni';

async function sendMessageToChannel(channelId, message) {
  await waitReady();
  const cleanChannelId = sanitizeText(channelId);
  const cleanMessage = sanitizeText(message);
  if (!cleanChannelId) throw new Error('ID canale non valido');
  if (!cleanMessage) throw new Error('Messaggio vuoto');
  const channel = await client.channels.fetch(cleanChannelId);
  if (!channel || typeof channel.send !== 'function') throw new Error('Canale non valido o non scrivibile');
  const sent = await channel.send({ content: cleanMessage });
  return { ok: true, messageId: sent.id, channelId: cleanChannelId };
}

async function sendGeneralAnnouncement(channelId, message) {
  return sendMessageToChannel(channelId, message);
}

async function listDiscordChannels() {
  await waitReady();
  const guild = await client.guilds.fetch(GUILD_ID);
  await guild.channels.fetch();
  const allChannels = [...guild.channels.cache.values()].sort((a, b) => {
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
    .filter(ch => ch.type === ChannelType.GuildCategory)
    .map(cat => ({
      id: cat.id,
      name: cat.name,
      type: 'category',
      rawPosition: Number(cat.rawPosition ?? cat.position ?? 0),
      channels: allChannels.filter(ch => ch.parentId === cat.id).map(ch => ({
        id: ch.id, name: ch.name, type: getDiscordChannelTypeLabel(ch.type),
        rawType: ch.type, parentId: ch.parentId || null,
        rawPosition: Number(ch.rawPosition ?? ch.position ?? 0),
        sendable: typeof ch.send === 'function'
      }))
    }));
  const withoutCategory = allChannels
    .filter(ch => ch.type !== ChannelType.GuildCategory && !ch.parentId)
    .map(ch => ({
      id: ch.id, name: ch.name, type: getDiscordChannelTypeLabel(ch.type),
      rawType: ch.type, parentId: null,
      rawPosition: Number(ch.rawPosition ?? ch.position ?? 0),
      sendable: typeof ch.send === 'function'
    }));
  return { ok: true, guild: { id: guild.id, name: guild.name }, categories, withoutCategory };
}

async function findOrCreateTournamentCategory(guild, preferredCategoryId = '') {
  await guild.channels.fetch();
  const cleanId = sanitizeText(preferredCategoryId);
  if (cleanId) {
    const existing = await guild.channels.fetch(cleanId).catch(() => null);
    if (existing && existing.type === ChannelType.GuildCategory) return { category: existing, created: false };
  }
  const byName = guild.channels.cache.find(ch => ch.type === ChannelType.GuildCategory && ch.name === TOURNAMENT_CATEGORY_NAME);
  if (byName) return { category: byName, created: false };
  const category = await guild.channels.create({ name: TOURNAMENT_CATEGORY_NAME, type: ChannelType.GuildCategory, reason: 'Creazione struttura RØDA CUP' });
  return { category, created: true };
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
      state.data.botSettings.roomsCategoryId = category.id;
      saveState();
      return { guild, category, categoryId: category.id, created: false };
    }
  }
  const byName = guild.channels.cache.find(ch => ch.type === ChannelType.GuildCategory && ch.name === TOURNAMENT_CATEGORY_NAME);
  if (byName) {
    state.data.botSettings.roomsCategoryId = byName.id;
    saveState();
    return { guild, category: byName, categoryId: byName.id, created: false };
  }
  const category = await guild.channels.create({ name: TOURNAMENT_CATEGORY_NAME, type: ChannelType.GuildCategory, reason: 'Creazione categoria RØDA CUP per stanze team' });
  state.data.botSettings.roomsCategoryId = category.id;
  saveState();
  return { guild, category, categoryId: category.id, created: true };
}

async function findOrCreateTextChannelInCategory(guild, category, channelName, topic = '') {
  await guild.channels.fetch();
  const existing = guild.channels.cache.find(ch => ch.type === ChannelType.GuildText && ch.parentId === category.id && ch.name === channelName);
  if (existing) {
    if (topic && existing.topic !== topic) await existing.setTopic(topic).catch(() => {});
    return { channel: existing, created: false };
  }
  const channel = await guild.channels.create({ name: channelName, type: ChannelType.GuildText, parent: category.id, topic, reason: `Creazione canale ${channelName} RØDA CUP` });
  return { channel, created: true };
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
    const existing = recentMessages.find(m => m.author?.id === client.user?.id && m.embeds?.[0]?.title === '📜 REGOLAMENTO UFFICIALE RØDA CUP');
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
    const existing = recentMessages.find(m => m.author?.id === client.user?.id && m.content.includes('BENVENUTI ALLA RØDA CUP'));
    if (existing) {
      await existing.edit({ content: announcement }).catch(() => {});
      return { updated: true };
    }
  }
  await generalChannel.send({ content: announcement }).catch(() => {});
  return { created: true };
}

async function safeSendToTeamVoiceChannel(channel, payload) {
  if (!channel) throw new Error('Canale non valido');
  if (typeof channel.send !== 'function') throw new Error(`Il canale ${channel.name} non supporta messaggi testuali`);
  const logErr = (attempt, err) => console.error(`[safeSend] ${channel.name} tentativo ${attempt} fallito:`, { code: err?.code, status: err?.status, msg: err?.message });
  try { return await channel.send({ content: '​', ...payload }); } catch (err1) { logErr(1, err1); }
  try {
    const embedData = (payload.embeds || []).map(e => { const d = e.toJSON ? e.toJSON() : { ...e }; delete d.thumbnail; return new EmbedBuilder(d); });
    return await channel.send({ content: '​', embeds: embedData, components: payload.components || [] });
  } catch (err2) { logErr(2, err2); }
  try {
    const embedTitle = payload.embeds?.[0]?.data?.title || payload.embeds?.[0]?.title || '';
    const embedDesc = payload.embeds?.[0]?.data?.description || payload.embeds?.[0]?.description || '';
    const textContent = [embedTitle, embedDesc].filter(Boolean).join('\n').substring(0, 1800) || 'Pannello risultati team';
    return await channel.send({ content: textContent, components: payload.components || [] });
  } catch (err3) { logErr(3, err3); }
  try { return await channel.send({ content: '📋 Pannello risultati — usa il comando del bot per inviare il risultato.' }); } catch (err4) {
    logErr(4, err4);
    throw new Error(`Impossibile inviare in ${channel.name}: ${err4?.message || 'errore sconosciuto'} [code:${err4?.code}]`);
  }
}

async function getVoiceTeamChannels(categoryIdToUse) {
  await waitReady();
  const guild = await client.guilds.fetch(GUILD_ID);
  await guild.channels.fetch();
  const cleanCategoryId = sanitizeText(categoryIdToUse) || getSavedRoomsCategoryId();
  if (!cleanCategoryId) return { guild, channels: new Map(), categoryId: '' };
  const normPrefix = '🏆・#'.normalize('NFKC');
  const channels = guild.channels.cache.filter(ch => {
    if (ch.parentId !== cleanCategoryId) return false;
    if (ch.type !== ChannelType.GuildVoice) return false;
    const normName = String(ch.name || '').normalize('NFKC');
    return normName.startsWith(normPrefix) || normName.startsWith('#') || normName.includes('・#') || normName.includes('・# ');
  });
  const allVoiceInCategory = guild.channels.cache.filter(ch => ch.parentId === cleanCategoryId && ch.type === ChannelType.GuildVoice).map(ch => ({ id: ch.id, name: ch.name }));
  return { guild, channels, categoryId: cleanCategoryId, allVoiceInCategory };
}

async function findPanelMessageByButtonCustomId(channel, customId) {
  try {
    if (!channel || typeof channel.messages?.fetch !== 'function') return null;
    const messages = await channel.messages.fetch({ limit: 30 });
    for (const message of messages.values()) {
      if (message.author?.id !== client.user?.id) continue;
      for (const row of (message.components || [])) {
        for (const component of (row.components || [])) {
          if (component.customId === customId) return message;
        }
      }
    }
  } catch (err) {
    console.error(`Errore ricerca pannello in ${channel?.name || 'canale sconosciuto'}:`, err.message);
  }
  return null;
}

async function createTeamRooms(customCategoryId) {
  await waitReady();
  refreshStateFromDisk();
  const sortedTeams = getSortedTeamEntries();
  if (!sortedTeams.length) throw new Error('Nessun team registrato');
  const resolved = await resolveTournamentCategory(customCategoryId);
  const guild = resolved.guild;
  const categoryIdToUse = resolved.categoryId;
  await guild.channels.fetch();
  const existingNames = new Set(guild.channels.cache.filter(ch => ch.parentId === categoryIdToUse && ch.type === ChannelType.GuildVoice).map(ch => ch.name));
  let created = 0, skipped = 0, failed = 0;
  const details = [];
  for (const [teamName, teamData] of sortedTeams) {
    const slot = Number(teamData?.slot || 0);
    const channelName = buildTeamVoiceChannelName(slot, teamName);
    if (existingNames.has(channelName)) {
      skipped++;
      details.push({ team: teamName, slot, channelName, status: 'skipped' });
      continue;
    }
    try {
      const channel = await guild.channels.create({ name: channelName, type: ChannelType.GuildVoice, parent: categoryIdToUse, reason: `Creazione stanza vocale team RØDA CUP: ${teamName}` });
      existingNames.add(channelName);
      created++;
      details.push({ team: teamName, slot, channelId: channel.id, channelName, status: 'created' });
    } catch (err) {
      failed++;
      details.push({ team: teamName, slot, channelName, status: 'failed', error: err.message || 'Errore creazione stanza' });
      console.error(`Errore creazione stanza team ${teamName}:`, err);
    }
  }
  state.data.botSettings.roomsCategoryId = categoryIdToUse;
  saveState();
  logAudit('dashboard', 'web', 'stanze_team_create', { categoryId: categoryIdToUse, categoryCreated: Boolean(resolved.created), created, skipped, failed });
  return { ok: true, categoryId: categoryIdToUse, categoryCreated: Boolean(resolved.created), created, skipped, failed, details };
}

async function deleteTeamRooms(customCategoryId) {
  await waitReady();
  const guild = await client.guilds.fetch(GUILD_ID);
  const categoryIdToUse = sanitizeText(customCategoryId) || getSavedRoomsCategoryId();
  await guild.channels.fetch();
  const channels = guild.channels.cache.filter(ch => ch.parentId === categoryIdToUse && ch.type === ChannelType.GuildVoice && ch.name.startsWith('🏆・#'));
  let deleted = 0;
  for (const ch of channels.values()) {
    try { await ch.delete('Eliminazione stanze vocali team RØDA CUP'); deleted++; } catch (err) { console.error(`Errore eliminazione stanza ${ch.name}:`, err); }
  }
  state.data.botSettings.roomsCategoryId = categoryIdToUse;
  saveState();
  logAudit('dashboard', 'web', 'stanze_team_eliminate', { categoryId: categoryIdToUse, deleted });
  return { ok: true, deleted };
}

async function sendLobbyCodeToTeamRooms(lobbyCode, customCategoryId, customMessage = '') {
  await waitReady();
  const cleanCode = sanitizeText(lobbyCode);
  if (!cleanCode) throw new Error('Codice lobby non valido');
  const guild = await client.guilds.fetch(GUILD_ID);
  const categoryIdToUse = sanitizeText(customCategoryId) || getSavedRoomsCategoryId();
  if (!categoryIdToUse) throw new Error('Categoria non valida');
  const categoryChannel = await guild.channels.fetch(categoryIdToUse).catch(() => null);
  if (!categoryChannel) throw new Error('Categoria non trovata');
  if (categoryChannel.type !== ChannelType.GuildCategory) throw new Error('Il canale selezionato non è una categoria');
  await guild.channels.fetch();
  const channels = guild.channels.cache.filter(ch => ch.parentId === categoryIdToUse && ch.type === ChannelType.GuildVoice && ch.name.startsWith('🏆・#')).sort((a, b) => a.rawPosition - b.rawPosition);
  if (!channels.size) throw new Error('Nessuna stanza team trovata nella categoria selezionata');
  const content = sanitizeText(customMessage) || `🎮 **CODICE LOBBY**\n\nCodice: **${cleanCode}**\n\nIl codice viene inviato nelle stanze ufficiali dei team.\nBuon game 🔥`;
  let sent = 0, failed = 0;
  const failedChannels = [];
  for (const ch of channels.values()) {
    try { await ch.send({ content }); sent++; } catch (err) { failed++; failedChannels.push(ch.name); console.error(`Errore invio codice lobby in ${ch.name}:`, err); }
  }
  logAudit('dashboard', 'web', 'codice_lobby_inviato_alle_stanze_team', { categoryId: categoryIdToUse, lobbyCode: cleanCode, sent, failed, failedChannels });
  return { ok: true, sent, failed, total: channels.size, failedChannels };
}

async function diagnosePanels(customCategoryId) {
  await waitReady();
  refreshStateFromDisk();
  const categoryIdToUse = sanitizeText(customCategoryId) || getSavedRoomsCategoryId();
  const sortedTeams = getSortedTeamEntries();
  if (!categoryIdToUse) {
    return { error: 'Categoria non configurata — imposta una categoria nelle impostazioni Discord.', categoryId: '', sortedTeams: sortedTeams.map(([n, t]) => ({ name: n, slot: t?.slot })), allVoiceInCategory: [], filteredChannels: [] };
  }
  const guild = await client.guilds.fetch(GUILD_ID);
  await guild.channels.fetch();
  const allVoiceInCategory = guild.channels.cache.filter(ch => ch.parentId === categoryIdToUse && ch.type === ChannelType.GuildVoice).map(ch => ({ id: ch.id, name: ch.name, nameHex: Buffer.from(ch.name).toString('hex') }));
  const normPrefix = '🏆・#'.normalize('NFKC');
  const filteredChannels = allVoiceInCategory.filter(ch => { const n = String(ch.name || '').normalize('NFKC'); return n.startsWith(normPrefix) || n.includes('・#') || n.includes('#'); });
  const teamMatchInfo = sortedTeams.map(([teamName, teamData]) => {
    const slot = Number(teamData?.slot || 0);
    const slotPrefix = `🏆・#${slot}`.normalize('NFKC');
    const match = allVoiceInCategory.find(ch => { const n = String(ch.name || '').normalize('NFKC'); return n.startsWith(slotPrefix + ' ') || n.startsWith(slotPrefix + '　') || n === slotPrefix || n.includes(`#${slot} `) || n.includes(`#${slot}　`); });
    return { team: teamName, slot, matchedChannel: match ? match.name : null, matchedChannelId: match ? match.id : null, status: slot === 0 ? 'slot_zero' : match ? 'ok' : 'no_match' };
  });
  return { categoryId: categoryIdToUse, totalVoiceInCategory: allVoiceInCategory.length, allVoiceInCategory, filteredChannels, teamMatchInfo, totalTeams: sortedTeams.length };
}

module.exports = {
  sendMessageToChannel,
  sendGeneralAnnouncement,
  listDiscordChannels,
  findOrCreateTournamentCategory,
  resolveTournamentCategory,
  findOrCreateTextChannelInCategory,
  ensureRulesMessage,
  ensureGeneralMessage,
  safeSendToTeamVoiceChannel,
  getVoiceTeamChannels,
  findPanelMessageByButtonCustomId,
  createTeamRooms,
  deleteTeamRooms,
  sendLobbyCodeToTeamRooms,
  diagnosePanels,
  GENERAL_CHANNEL_NAME,
  RULES_CHANNEL_NAME,
  REGISTRATION_CHANNEL_NAME
};
