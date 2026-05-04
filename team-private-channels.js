'use strict';

/**
 * Creates and maintains one private operational text room per registered team.
 * The room is visible only to the Discord user who registered the team and the bot.
 * Every private room is placed inside the official RØDA CUP category.
 */

const Module = require('module');
const {
  ChannelType,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');

function clean(value) { return String(value || '').trim(); }
function safeChannelPart(value) { return clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 42) || 'team'; }
function teamDisplayChannelName(teamName) { return `💬・${safeChannelPart(teamName).toUpperCase()}`.slice(0, 95); }
function isClientModuleRequest(request) { return typeof request === 'string' && (request === './bot/client' || request === './client' || request.endsWith('/bot/client') || request.endsWith('bot/client.js')); }
function isPanelsModuleRequest(request) { return typeof request === 'string' && (request === './bot/panels' || request === './panels' || request.endsWith('/bot/panels') || request.endsWith('bot/panels.js')); }
function getTeamEntries() { const state = require('./bot/state'); return Object.entries(state.teams || {}).sort((a, b) => Number(a[1]?.slot || 9999) - Number(b[1]?.slot || 9999)); }
function getRegistrantId(teamData) { return clean(teamData?.registeredById || teamData?.ownerDiscordId || teamData?.captainDiscordId || teamData?.createdByDiscordId || teamData?.discordUserId || teamData?.registrantId); }

function createWelcomePayload(teamName, teamData) {
  const { sanitizeText, getLogoUrl } = require('./bot/helpers');
  const { getProjectSettings } = require('./bot/lifecycle');
  const project = getProjectSettings();
  const logoUrl = getLogoUrl();
  const slot = Number(teamData?.slot || 0);
  const players = Array.isArray(teamData?.players) ? teamData.players : [];
  const embed = new EmbedBuilder()
    .setColor(0x7b2cff)
    .setTitle('🔒 Stanza operativa privata team')
    .setDescription(
      `Benvenuto nella stanza privata del team **${teamName}**.\n\n` +
      `Qui puoi scrivere comunicazioni e domande allo staff prima e durante il torneo.\n\n` +
      `**Torneo:** ${project.tournamentName}\n` +
      `**Slot:** #${slot || '-'}\n\n` +
      `**Cosa arriverà qui:**\n` +
      `• comunicazioni staff\n` +
      `• codice lobby\n` +
      `• pannello invio risultato\n` +
      `• conferme e problemi del team\n\n` +
      `**Giocatori:**\n• ${sanitizeText(players[0]) || 'Giocatore 1'}\n• ${sanitizeText(players[1]) || 'Giocatore 2'}\n• ${sanitizeText(players[2]) || 'Giocatore 3'}`
    )
    .setFooter({ text: 'RØDA CUP • canale operativo privato team' });
  if (logoUrl) { try { embed.setThumbnail(logoUrl); } catch {} }
  return { embeds: [embed] };
}

function createResultPanelPayload(teamName, teamData) {
  const state = require('./bot/state');
  const { sanitizeText, buildResultButtonCustomId, getLogoUrl } = require('./bot/helpers');
  const { getProjectSettings, getSubmissionRecord } = require('./bot/lifecycle');
  const project = getProjectSettings();
  const logoUrl = getLogoUrl();
  const slot = Number(teamData?.slot || 0);
  const players = Array.isArray(teamData?.players) ? teamData.players : [];
  const matchNumber = Number(state.data.currentMatch || 1);
  const record = getSubmissionRecord(teamName, matchNumber);
  const alreadySent = record.status === 'in_attesa' || record.status === 'approvato' || record.status === 'inserito_manualmente';
  const statusText = alreadySent ? (record.status === 'in_attesa' ? 'Risultato già inviato e in attesa dello staff.' : 'Risultato già registrato per questo match.') : 'Quando il match è finito, premi il pulsante, inserisci le kill e poi invia lo screenshot/foto qui in questa stanza operativa.';
  const embed = new EmbedBuilder()
    .setColor(0x7b2cff)
    .setTitle(`📸 Pannello risultato • Match ${matchNumber}`)
    .setDescription(`**Team:** ${teamName}\n**Slot:** #${slot || '-'}\n**Torneo:** ${project.tournamentName}\n\n${statusText}\n\n**Giocatori:**\n• ${sanitizeText(players[0]) || 'Giocatore 1'}\n• ${sanitizeText(players[1]) || 'Giocatore 2'}\n• ${sanitizeText(players[2]) || 'Giocatore 3'}`)
    .setFooter({ text: `Stanza operativa team • Match ${matchNumber}` });
  if (logoUrl) { try { embed.setThumbnail(logoUrl); } catch {} }
  const submitBtn = new ButtonBuilder().setCustomId(buildResultButtonCustomId(slot)).setLabel(alreadySent ? `Risultato Match ${matchNumber} già inviato` : `Invia risultato Match ${matchNumber}`).setStyle(alreadySent ? ButtonStyle.Secondary : ButtonStyle.Primary).setDisabled(alreadySent);
  const reportBtn = new ButtonBuilder().setCustomId(`report_slot_${slot}`).setLabel('⚠️ Segnala problema').setStyle(ButtonStyle.Danger);
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(submitBtn, reportBtn)] };
}

async function findExistingPrivateChannel(guild, categoryId, teamName, slot, registrantId) {
  await guild.channels.fetch();
  const safeTeam = safeChannelPart(teamName);
  const newName = teamDisplayChannelName(teamName);
  const markers = [newName, `team-${Number(slot || 0)}-`, `risultati-${Number(slot || 0)}-`, `team-${safeTeam}`, `risultati-${safeTeam}`, safeTeam.toUpperCase()];
  const channels = [...guild.channels.cache.values()].filter(ch => ch && ch.type === ChannelType.GuildText && (!categoryId || ch.parentId === categoryId));
  return channels.find(ch => {
    const name = String(ch.name || '');
    const upper = name.toUpperCase();
    return markers.some(marker => name.includes(marker) || upper.includes(String(marker).toUpperCase())) || (registrantId && name.endsWith(registrantId.slice(-4)));
  }) || null;
}

async function getTournamentCategory(guild) {
  const state = require('./bot/state');
  const config = require('./bot/config');
  const lifecycle = require('./bot/lifecycle');
  const categoryName = lifecycle.TOURNAMENT_CATEGORY_NAME || '🏆・RØDA CUP';
  const categoryId = clean(state.data?.botSettings?.roomsCategoryId) || clean(config.CATEGORY_ID);
  await guild.channels.fetch();
  if (categoryId) {
    const category = await guild.channels.fetch(categoryId).catch(() => null);
    if (category && category.type === ChannelType.GuildCategory) {
      state.data.botSettings = state.data.botSettings || {};
      state.data.botSettings.roomsCategoryId = category.id;
      if (typeof lifecycle.saveState === 'function') lifecycle.saveState();
      return category;
    }
  }
  const byName = guild.channels.cache.find(ch => ch.type === ChannelType.GuildCategory && ch.name === categoryName);
  if (byName) {
    state.data.botSettings = state.data.botSettings || {};
    state.data.botSettings.roomsCategoryId = byName.id;
    if (typeof lifecycle.saveState === 'function') lifecycle.saveState();
    return byName;
  }
  const created = await guild.channels.create({ name: categoryName, type: ChannelType.GuildCategory, reason: 'Creazione categoria ufficiale RØDA CUP per stanze operative team' });
  state.data.botSettings = state.data.botSettings || {};
  state.data.botSettings.roomsCategoryId = created.id;
  if (typeof lifecycle.saveState === 'function') lifecycle.saveState();
  console.log(`[team-private] categoria RØDA CUP creata: ${created.name} (${created.id})`);
  return created;
}

async function ensurePrivateTeamChannel(client, teamName, teamData, options = {}) {
  const config = require('./bot/config');
  const lifecycle = require('./bot/lifecycle');
  const state = require('./bot/state');
  const guild = await client.guilds.fetch(config.GUILD_ID);
  const category = await getTournamentCategory(guild);
  const slot = Number(teamData?.slot || 0);
  const registrantId = clean(options.registrantId) || getRegistrantId(teamData);
  if (!registrantId) {
    console.warn(`[team-private] impossibile creare stanza operativa per ${teamName}: registrantId mancante`);
    return { ok: false, skipped: true, reason: 'missing_registrant_id' };
  }
  const existing = teamData?.privateTextChannelId ? await guild.channels.fetch(teamData.privateTextChannelId).catch(() => null) : await findExistingPrivateChannel(guild, category.id, teamName, slot, registrantId);
  const botMember = guild.members.me || await guild.members.fetchMe().catch(() => null);
  const member = await guild.members.fetch(registrantId).catch(() => null);
  if (!member) {
    console.warn(`[team-private] utente registrante non trovato per ${teamName}: ${registrantId}`);
    return { ok: false, skipped: true, reason: 'member_not_found' };
  }
  const channelName = teamDisplayChannelName(teamName);
  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: registrantId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.ReadMessageHistory] }
  ];
  if (botMember) overwrites.push({ id: botMember.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ManageChannels] });
  const channel = existing || await guild.channels.create({ name: channelName, type: ChannelType.GuildText, parent: category.id, permissionOverwrites: overwrites, reason: `Stanza operativa privata RØDA CUP per ${teamName}` });
  if (existing) {
    await channel.permissionOverwrites.set(overwrites).catch(err => console.warn(`[team-private] permessi non aggiornati per ${channel.name}: ${err.message}`));
    if (channel.name !== channelName) await channel.setName(channelName).catch(() => {});
    if (channel.parentId !== category.id) await channel.setParent(category.id, { lockPermissions: false }).catch(err => console.warn(`[team-private] impossibile spostare ${channel.name} in categoria RØDA CUP: ${err.message}`));
  }
  state.teams[teamName] = state.teams[teamName] || teamData || {};
  state.teams[teamName].registeredById = registrantId;
  state.teams[teamName].registeredByTag = clean(options.registrantTag) || clean(state.teams[teamName].registeredByTag);
  state.teams[teamName].privateTextChannelId = channel.id;
  lifecycle.saveEverything ? lifecycle.saveEverything() : lifecycle.saveState();
  await upsertPrivateWelcome(channel, teamName, state.teams[teamName]);
  await upsertPrivateResultPanel(channel, teamName, state.teams[teamName]);
  lifecycle.logAudit(clean(options.registrantTag) || 'bot', 'discord', 'stanza_operativa_team_assicurata', { team: teamName, slot, channelId: channel.id, categoryId: category.id, registrantId });
  return { ok: true, channel, category, created: !existing };
}

async function upsertPrivateWelcome(channel, teamName, teamData) {
  let existing = null;
  try {
    const messages = await channel.messages.fetch({ limit: 30 });
    existing = messages.find(m => m.author?.bot && m.embeds?.[0]?.title === '🔒 Stanza operativa privata team') || null;
  } catch {}
  const payload = createWelcomePayload(teamName, teamData);
  if (existing) { await existing.edit({ content: '', ...payload }); return { updated: true, messageId: existing.id }; }
  const sent = await channel.send({ content: '🔒 **Stanza operativa privata team**', ...payload });
  return { created: true, messageId: sent.id };
}

async function upsertPrivateResultPanel(channel, teamName, teamData) {
  const { buildResultButtonCustomId } = require('./bot/helpers');
  const slot = Number(teamData?.slot || 0);
  const customId = buildResultButtonCustomId(slot);
  let existing = null;
  try {
    const messages = await channel.messages.fetch({ limit: 30 });
    for (const message of messages.values()) {
      if (!message.author?.bot) continue;
      for (const row of message.components || []) for (const component of row.components || []) if (component.customId === customId) existing = message;
    }
  } catch {}
  const payload = createResultPanelPayload(teamName, teamData);
  if (existing) { await existing.edit({ content: '', ...payload }); return { updated: true, messageId: existing.id }; }
  const sent = await channel.send({ content: '📸 **Pannello risultato team**', ...payload });
  return { created: true, messageId: sent.id };
}

async function ensureAllPrivateTeamChannels(client) {
  for (const [teamName, teamData] of getTeamEntries()) {
    try { await ensurePrivateTeamChannel(client, teamName, teamData); }
    catch (error) { console.error(`[team-private] errore ensure ${teamName}:`, error.message); }
  }
}

function installClientHook() {
  if (global.__rodaTeamPrivateClientHookInstalled) return;
  global.__rodaTeamPrivateClientHookInstalled = true;
  const originalLoad = Module._load;
  Module._load = function teamPrivateClientLoad(request, parent, isMain) {
    const loaded = originalLoad.apply(this, arguments);
    if (isClientModuleRequest(request) && loaded?.client && !loaded.client.__rodaTeamPrivateReadyHooked) {
      Object.defineProperty(loaded.client, '__rodaTeamPrivateReadyHooked', { value: true, enumerable: false });
      loaded.client.once('ready', () => setTimeout(() => ensureAllPrivateTeamChannels(loaded.client).catch(err => console.error('[team-private] ensure all failed:', err.message)), 9000));
      console.log('✅ Hook stanze operative team installato.');
    }
    return loaded;
  };
}

function installPanelsHook() {
  if (global.__rodaTeamPrivatePanelsHookInstalled) return;
  global.__rodaTeamPrivatePanelsHookInstalled = true;
  const originalLoad = Module._load;
  Module._load = function teamPrivatePanelsLoad(request, parent, isMain) {
    const loaded = originalLoad.apply(this, arguments);
    if (isPanelsModuleRequest(request) && loaded && !loaded.__rodaTeamPrivatePanelsPatched) {
      const originalRefresh = loaded.refreshTeamResultPanels;
      if (typeof originalRefresh === 'function') {
        loaded.refreshTeamResultPanels = async function patchedRefreshTeamResultPanels(...args) {
          const result = await originalRefresh.apply(this, args).catch(err => ({ ok: false, error: err.message }));
          try { const { client } = require('./bot/client'); if (client?.isReady?.()) await ensureAllPrivateTeamChannels(client); }
          catch (error) { console.error('[team-private] refresh operativo fallito:', error.message); }
          return result;
        };
      }
      Object.defineProperty(loaded, '__rodaTeamPrivatePanelsPatched', { value: true, enumerable: false });
      console.log('✅ Refresh pannelli operativi team collegato.');
    }
    return loaded;
  };
}

function installRegistrationHook() {
  if (global.__rodaTeamPrivateRegistrationHookInstalled) return;
  global.__rodaTeamPrivateRegistrationHookInstalled = true;
  const discord = require('discord.js');
  const Client = discord.Client;
  if (!Client || !Client.prototype || Client.prototype.__rodaTeamPrivateRegistrationPatched) return;
  const originalEmit = Client.prototype.emit;
  Client.prototype.emit = function teamPrivateRegistrationEmit(eventName, ...args) {
    const interaction = args[0];
    const isRegisterModal = eventName === 'interactionCreate' && interaction?.isModalSubmit?.() && interaction.customId === 'register_modal';
    const result = originalEmit.call(this, eventName, ...args);
    if (isRegisterModal) {
      const client = this;
      setTimeout(async () => {
        try {
          const state = require('./bot/state');
          const teamName = clean(interaction.fields.getTextInputValue('team'));
          const teamData = state.teams?.[teamName];
          if (!teamData) return;
          await ensurePrivateTeamChannel(client, teamName, teamData, { registrantId: interaction.user.id, registrantTag: interaction.user.tag });
        } catch (error) { console.error('[team-private] creazione operativa post-registrazione fallita:', error.message); }
      }, 2500);
    }
    return result;
  };
  Object.defineProperty(Client.prototype, '__rodaTeamPrivateRegistrationPatched', { value: true, enumerable: false });
  console.log('✅ Creazione stanze operative alla registrazione attiva.');
}

function installTeamPrivateChannels() { installClientHook(); installPanelsHook(); installRegistrationHook(); }
installTeamPrivateChannels();

module.exports = { installTeamPrivateChannels, ensurePrivateTeamChannel, ensureAllPrivateTeamChannels };
