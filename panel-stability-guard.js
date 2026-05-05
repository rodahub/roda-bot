'use strict';

/**
 * Stabilizes Discord panels so they are edited instead of reposted.
 * The registration panel must live ONLY in the official iscrizioni channel,
 * never inside team/private channels.
 */

const Module = require('module');
const { AttachmentBuilder } = require('discord.js');

const WRONG_REGISTRATION_PANEL_CHANNEL_ID = '1482050564375318579';

function clean(value) { return String(value || '').trim(); }

function getOfficialRegistrationChannelId() {
  try {
    const config = require('./bot/config');
    return clean(
      process.env.REGISTER_PANEL_CHANNEL_ID ||
      process.env.REGISTRATION_PANEL_CHANNEL_ID ||
      process.env.ISCRIZIONI_CHANNEL_ID ||
      config.REGISTRATION_STATUS_CHANNEL ||
      '1478304760816996423'
    );
  } catch {
    return clean(
      process.env.REGISTER_PANEL_CHANNEL_ID ||
      process.env.REGISTRATION_PANEL_CHANNEL_ID ||
      process.env.ISCRIZIONI_CHANNEL_ID ||
      '1478304760816996423'
    );
  }
}

function isPanelsModuleRequest(request) {
  return typeof request === 'string' && (
    request === './bot/panels' ||
    request === './panels' ||
    request.endsWith('/bot/panels') ||
    request.endsWith('bot/panels.js')
  );
}

function isBotIndexRequest(request) {
  return typeof request === 'string' && (
    request === './index' ||
    request === '../index' ||
    request.endsWith('/index') ||
    request.endsWith('index.js')
  );
}

function isStorageModuleRequest(request) {
  return typeof request === 'string' && (
    request === './storage' ||
    request === '../storage' ||
    request.endsWith('/storage') ||
    request.endsWith('storage.js')
  );
}

function isForbiddenRegistrationChannel(channel) {
  if (!channel) return true;
  const id = clean(channel.id);
  const name = clean(channel.name).toLowerCase();
  const officialId = getOfficialRegistrationChannelId();
  if (officialId && id === officialId) return false;
  if (id === WRONG_REGISTRATION_PANEL_CHANNEL_ID) return true;
  if (name.includes('team') || name.includes('privat') || name.includes('operativ') || name.includes('risultat')) return true;
  return !name.includes('iscrizion');
}

async function fetchMessagesDeep(channel, maxMessages = 800) {
  const collected = [];
  let before;
  while (collected.length < maxMessages) {
    const limit = Math.min(100, maxMessages - collected.length);
    const batch = await channel.messages.fetch(before ? { limit, before } : { limit }).catch(() => null);
    if (!batch || batch.size === 0) break;
    const values = [...batch.values()];
    collected.push(...values);
    before = values[values.length - 1]?.id;
    if (!before || batch.size < limit) break;
  }
  return collected;
}

function messageHasComponent(message, customId) {
  for (const row of message.components || []) {
    for (const component of row.components || []) {
      if (component.customId === customId) return true;
    }
  }
  return false;
}

function messageLooksLikeRegistrationPanel(message) {
  if (!message?.author?.bot) return false;
  if (messageHasComponent(message, 'register_btn')) return true;
  const content = clean(message.content).toLowerCase();
  const embedText = (message.embeds || []).map(embed => [embed.title, embed.description, embed.footer?.text].filter(Boolean).join(' ')).join(' ').toLowerCase();
  return (content + ' ' + embedText).includes('pannello iscrizioni') || ((content + ' ' + embedText).includes('røda cup') && (content + ' ' + embedText).includes('iscrizioni'));
}

async function deleteRegistrationPanelsFromChannel(channel, reason) {
  if (!channel || typeof channel.messages?.fetch !== 'function') return 0;
  let deleted = 0;
  const messages = await fetchMessagesDeep(channel, 800);
  for (const message of messages) {
    if (!messageLooksLikeRegistrationPanel(message)) continue;
    try {
      await message.delete();
      deleted++;
      console.log(`[panel-guard] pannello iscrizioni rimosso da canale sbagliato ${channel.name || channel.id}: ${message.id} (${reason})`);
    } catch (error) {
      console.warn(`[panel-guard] non posso rimuovere pannello iscrizioni sbagliato ${message.id}: ${error.message}`);
    }
  }
  return deleted;
}

async function cleanupWrongRegistrationPanels(client, targetChannelId) {
  const wrongIds = [WRONG_REGISTRATION_PANEL_CHANNEL_ID, process.env.WRONG_REGISTRATION_PANEL_CHANNEL_ID].map(clean).filter(Boolean);
  for (const id of [...new Set(wrongIds)]) {
    if (!id || id === targetChannelId) continue;
    const channel = await client.channels.fetch(id).catch(() => null);
    if (channel) await deleteRegistrationPanelsFromChannel(channel, 'cleanup-wrong-channel');
  }
}

async function findMessageByComponent(channel, customId) {
  try {
    const messages = await fetchMessagesDeep(channel, 800);
    for (const message of messages) {
      if (!message.author?.bot) continue;
      if (messageHasComponent(message, customId)) return message;
    }
  } catch (error) {
    console.error('[panel-guard] ricerca messaggio component fallita:', error.message);
  }
  return null;
}

function messageLooksLikeRegisteredTeams(message) {
  if (!message?.author?.bot) return false;
  const content = clean(message.content).toLowerCase();
  const embedText = (message.embeds || []).map(embed => [embed.title, embed.description, embed.footer?.text].filter(Boolean).join(' ')).join(' ').toLowerCase();
  const files = [...(message.attachments?.values?.() || [])].map(att => clean(att.name || att.url).toLowerCase()).join(' ');
  return content.includes('team registrati') || embedText.includes('team registrati') || embedText.includes('slot team') || files.includes('team-registrati');
}

async function findRegisteredTeamsMessage(channel) {
  try {
    const messages = await fetchMessagesDeep(channel, 800);
    for (const message of messages) if (messageLooksLikeRegisteredTeams(message)) return message;
  } catch (error) {
    console.error('[panel-guard] ricerca Team Registrati fallita:', error.message);
  }
  return null;
}

async function fetchSavedMessage(channel, id) {
  const cleanId = clean(id);
  if (!cleanId) return null;
  try { return await channel.messages.fetch(cleanId); }
  catch { return null; }
}

function getSignature(lifecycle) {
  const teams = lifecycle.getDisplayTeams ? lifecycle.getDisplayTeams() : [];
  return `${teams.length}:${lifecycle.areRegistrationsOpen ? lifecycle.areRegistrationsOpen() : false}:${teams.map(t => `${t.slot}-${t.teamName}`).join('|')}`;
}

function resolveRegisterPanelChannelId() {
  return getOfficialRegistrationChannelId();
}

async function stableSpawnRegisterPanel(panelsModule, channelId) {
  const { client, waitReady } = require('./bot/client');
  const state = require('./bot/state');
  const lifecycle = require('./bot/lifecycle');

  await waitReady();
  lifecycle.refreshStateFromDisk();

  const targetChannelId = resolveRegisterPanelChannelId();
  if (!targetChannelId) throw new Error('ID canale iscrizioni non configurato');

  const channel = await client.channels.fetch(targetChannelId);
  if (isForbiddenRegistrationChannel(channel)) throw new Error(`Canale iscrizioni non valido: ${channel?.name || targetChannelId}`);

  await cleanupWrongRegistrationPanels(client, targetChannelId).catch(() => {});

  const payload = panelsModule.createRegisterPanelPayload();
  let message = await fetchSavedMessage(channel, state.data?.botSettings?.registerPanelMessageId);
  if (!message) message = await findMessageByComponent(channel, 'register_btn');

  let created = false;
  let updated = false;
  if (message) {
    await message.edit(payload);
    updated = true;
  } else {
    message = await channel.send(payload);
    created = true;
  }

  state.data.botSettings = state.data.botSettings || {};
  state.data.botSettings.registerPanelChannelId = targetChannelId;
  state.data.botSettings.registerPanelMessageId = message.id;
  lifecycle.saveState();
  lifecycle.logAudit('dashboard', 'web', 'pannello_registrazione_stabile', { requestedChannelId: channelId || '', channelId: targetChannelId, messageId: message.id, created, updated, registrationsOpen: lifecycle.areRegistrationsOpen() });
  return { ok: true, created, updated, messageId: message.id, registrationsOpen: lifecycle.areRegistrationsOpen(), channelId: targetChannelId };
}

async function stableUpdateRegistrationStatusMessage(panelsModule, options = {}) {
  const { client, waitReady } = require('./bot/client');
  const state = require('./bot/state');
  const lifecycle = require('./bot/lifecycle');
  const renderer = require('./renderer');

  await waitReady();
  lifecycle.refreshStateFromDisk();
  lifecycle.ensureDataStructures();

  const targetChannelId = getOfficialRegistrationChannelId();
  if (!targetChannelId) return { skipped: true, reason: 'no_channel' };
  const channel = await client.channels.fetch(targetChannelId).catch(() => null);
  if (!channel) return { skipped: true, reason: 'channel_not_found', channelId: targetChannelId };
  if (isForbiddenRegistrationChannel(channel)) return { skipped: true, reason: 'forbidden_channel', channelId: targetChannelId, channelName: channel.name };

  await cleanupWrongRegistrationPanels(client, targetChannelId).catch(() => {});

  if (state.data.registrationStatusChannelId && state.data.registrationStatusChannelId !== targetChannelId) {
    state.data.registrationStatusMessageId = null;
    state.data.registrationGraphicMessageId = null;
    state.data.lastRegistrationGraphicSignature = null;
  }
  state.data.registrationStatusChannelId = targetChannelId;

  let message = await fetchSavedMessage(channel, state.data.registrationStatusMessageId);
  if (!message) message = await fetchSavedMessage(channel, state.data.registrationGraphicMessageId);
  if (!message) message = await findRegisteredTeamsMessage(channel);

  const signature = getSignature(lifecycle);
  if (message && state.data.lastRegistrationGraphicSignature === signature && !options.force) {
    state.data.registrationStatusMessageId = message.id;
    state.data.registrationGraphicMessageId = message.id;
    lifecycle.saveState();
    return { ok: true, updated: false, created: false, skipped: true, reason: 'no_change', messageId: message.id };
  }

  let buffer = null;
  let graphicError = null;
  try { buffer = await renderer.generateRegisteredTeamsGraphicBuffer(); }
  catch (error) { graphicError = error; console.error('[panel-guard] errore grafica Team Registrati:', error.message); }

  let created = false;
  let updated = false;
  if (buffer && buffer.length) {
    const attachment = new AttachmentBuilder(buffer, { name: `team-registrati.png` });
    const payload = { content: '', embeds: [], components: [], files: [attachment] };
    if (message) { await message.edit(payload); updated = true; }
    else { message = await channel.send(payload); created = true; }
  } else {
    const embeds = panelsModule.buildRegistrationEmbeds();
    const payload = { content: '', embeds, components: [] };
    if (message) { await message.edit(payload); updated = true; }
    else { message = await channel.send(payload); created = true; }
  }

  state.data.registrationStatusMessageId = message.id;
  state.data.registrationGraphicMessageId = message.id;
  state.data.lastRegistrationGraphicSignature = signature;
  lifecycle.saveState();
  return { ok: true, updated, created, graphic: Boolean(buffer && buffer.length), fallback: !(buffer && buffer.length), error: graphicError?.message || null, messageId: message.id, channelId: targetChannelId };
}

function patchPanelsModule(panelsModule) {
  if (!panelsModule || panelsModule.__rodaPanelStabilityGuardPatched) return panelsModule;

  panelsModule.spawnRegisterPanel = function guardedSpawnRegisterPanel(channelId) { return stableSpawnRegisterPanel(panelsModule, channelId); };
  panelsModule.updateRegistrationStatusMessage = function guardedUpdateRegistrationStatusMessage(options = {}) { return stableUpdateRegistrationStatusMessage(panelsModule, options); };
  panelsModule.updateSavedRegisterPanelIfExists = async function guardedUpdateSavedRegisterPanelIfExists() { return panelsModule.spawnRegisterPanel(getOfficialRegistrationChannelId()); };
  panelsModule.handleRegistrationStateChange = async function guardedHandleRegistrationStateChange() {
    const lifecycle = require('./bot/lifecycle');
    lifecycle.refreshStateFromDisk();
    await panelsModule.updateSavedRegisterPanelIfExists().catch(() => {});
    await panelsModule.updateRegistrationStatusMessage({ force: true }).catch(() => {});
    await panelsModule.updateSavedResultsPanelIfExists?.().catch(() => {});
    await panelsModule.maybeAnnounceTournamentFull?.().catch(() => {});
  };

  Object.defineProperty(panelsModule, '__rodaPanelStabilityGuardPatched', { value: true, enumerable: false });
  console.log(`✅ Guard stabilità pannelli Discord attivo. Canale iscrizioni ufficiale: ${getOfficialRegistrationChannelId()}`);
  return panelsModule;
}

function patchBotIndex(botModule) {
  if (!botModule || botModule.__rodaPanelStabilityIndexPatched) return botModule;
  try {
    const panels = require('./bot/panels');
    patchPanelsModule(panels);
    for (const key of ['spawnRegisterPanel', 'updateRegistrationStatusMessage', 'updateSavedRegisterPanelIfExists', 'handleRegistrationStateChange']) if (typeof panels[key] === 'function') botModule[key] = panels[key];
    Object.defineProperty(botModule, '__rodaPanelStabilityIndexPatched', { value: true, enumerable: false });
  } catch (error) {
    console.error('[panel-guard] patch index fallita:', error.message);
  }
  return botModule;
}

function scheduleFullPanelRefresh(reason) {
  clearTimeout(global.__rodaPanelStabilityRefreshTimer);
  global.__rodaPanelStabilityRefreshTimer = setTimeout(async () => {
    try {
      const panels = require('./bot/panels');
      patchPanelsModule(panels);
      console.log(`[panel-guard] refresh pannelli salvati: ${reason}`);
      await panels.updateSavedRegisterPanelIfExists?.().catch(() => {});
      await panels.updateRegistrationStatusMessage?.({ force: true }).catch(() => {});
    } catch (error) {
      console.error('[panel-guard] refresh pannelli salvati fallito:', error.message);
    }
  }, 1300);
}

function patchStorageModule(storageModule) {
  if (!storageModule || storageModule.__rodaPanelStabilityStoragePatched) return storageModule;
  for (const functionName of ['openRegistrations', 'closeRegistrations', 'startTournament', 'finishTournament', 'archiveAndCreateFreshTournament']) {
    if (typeof storageModule[functionName] !== 'function') continue;
    const original = storageModule[functionName];
    storageModule[functionName] = function guardedLifecycleCall(...args) {
      const result = original.apply(this, args);
      scheduleFullPanelRefresh(functionName);
      return result;
    };
  }
  Object.defineProperty(storageModule, '__rodaPanelStabilityStoragePatched', { value: true, enumerable: false });
  return storageModule;
}

function install() {
  if (global.__rodaPanelStabilityGuardInstalled) return;
  global.__rodaPanelStabilityGuardInstalled = true;
  const originalLoad = Module._load;
  Module._load = function panelStabilityGuardLoad(request, parent, isMain) {
    const loaded = originalLoad.apply(this, arguments);
    if (isPanelsModuleRequest(request)) return patchPanelsModule(loaded);
    if (isBotIndexRequest(request)) return patchBotIndex(loaded);
    if (isStorageModuleRequest(request)) return patchStorageModule(loaded);
    return loaded;
  };
  console.log('✅ Hook stabilità pannelli Discord installato.');
}

install();

module.exports = { install, patchPanelsModule, scheduleFullPanelRefresh };
