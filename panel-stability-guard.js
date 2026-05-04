'use strict';

/**
 * Stabilizes Discord panels so they are edited instead of reposted.
 * - Registration panel: finds the existing register_btn message if saved ID is stale.
 * - Registered teams graphic: finds the existing teams message if saved ID is stale.
 * - Lifecycle changes: force refreshes saved panels after open/close/new tournament actions.
 */

const Module = require('module');
const { AttachmentBuilder } = require('discord.js');

function clean(value) { return String(value || '').trim(); }

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

async function findMessageByComponent(channel, customId) {
  try {
    const messages = await channel.messages.fetch({ limit: 50 });
    for (const message of messages.values()) {
      if (!message.author?.bot) continue;
      for (const row of message.components || []) {
        for (const component of row.components || []) {
          if (component.customId === customId) return message;
        }
      }
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
  return (
    content.includes('team registrati') ||
    embedText.includes('team registrati') ||
    embedText.includes('slot team') ||
    files.includes('team-registrati')
  );
}

async function findRegisteredTeamsMessage(channel) {
  try {
    const messages = await channel.messages.fetch({ limit: 80 });
    for (const message of messages.values()) {
      if (messageLooksLikeRegisteredTeams(message)) return message;
    }
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

async function stableSpawnRegisterPanel(panelsModule, channelId) {
  const { client, waitReady } = require('./bot/client');
  const state = require('./bot/state');
  const lifecycle = require('./bot/lifecycle');

  await waitReady();
  lifecycle.refreshStateFromDisk();
  const settings = lifecycle.getBotSettings();
  const targetChannelId = clean(channelId) || settings.registerPanelChannelId;
  if (!targetChannelId) throw new Error('ID canale pannello registrazione non valido');

  const channel = await client.channels.fetch(targetChannelId);
  const payload = panelsModule.createRegisterPanelPayload();

  let message = null;
  if (settings.registerPanelChannelId === targetChannelId) {
    message = await fetchSavedMessage(channel, settings.registerPanelMessageId);
  }
  if (!message) message = await findMessageByComponent(channel, 'register_btn');

  let created = false;
  let updated = false;

  if (message) {
    await message.edit(payload);
    updated = true;
    state.data.botSettings.registerPanelMessageId = message.id;
  } else {
    message = await channel.send(payload);
    created = true;
    state.data.botSettings.registerPanelMessageId = message.id;
  }

  state.data.botSettings.registerPanelChannelId = targetChannelId;
  lifecycle.saveState();
  lifecycle.logAudit('dashboard', 'web', 'pannello_registrazione_stabile', { channelId: targetChannelId, messageId: message.id, created, updated, registrationsOpen: lifecycle.areRegistrationsOpen() });
  return { ok: true, created, updated, messageId: message.id, registrationsOpen: lifecycle.areRegistrationsOpen() };
}

async function stableUpdateRegistrationStatusMessage(panelsModule, options = {}) {
  const { client, waitReady } = require('./bot/client');
  const state = require('./bot/state');
  const lifecycle = require('./bot/lifecycle');
  const config = require('./bot/config');
  const renderer = require('./renderer');

  await waitReady();
  lifecycle.refreshStateFromDisk();
  lifecycle.ensureDataStructures();

  const settings = lifecycle.getBotSettings();
  const targetChannelId = clean(config.REGISTRATION_STATUS_CHANNEL) || clean(settings.registerPanelChannelId);
  if (!targetChannelId) return { skipped: true, reason: 'no_channel' };

  const channel = await client.channels.fetch(targetChannelId).catch(() => null);
  if (!channel) return { skipped: true, reason: 'channel_not_found', channelId: targetChannelId };

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
    if (message) {
      await message.edit(payload);
      updated = true;
    } else {
      message = await channel.send(payload);
      created = true;
    }
  } else {
    const embeds = panelsModule.buildRegistrationEmbeds();
    const payload = { content: '', embeds, components: [] };
    if (message) {
      await message.edit(payload);
      updated = true;
    } else {
      message = await channel.send(payload);
      created = true;
    }
  }

  state.data.registrationStatusMessageId = message.id;
  state.data.registrationGraphicMessageId = message.id;
  state.data.lastRegistrationGraphicSignature = signature;
  lifecycle.saveState();

  return { ok: true, updated, created, graphic: Boolean(buffer && buffer.length), fallback: !(buffer && buffer.length), error: graphicError?.message || null, messageId: message.id };
}

function patchPanelsModule(panelsModule) {
  if (!panelsModule || panelsModule.__rodaPanelStabilityGuardPatched) return panelsModule;

  panelsModule.spawnRegisterPanel = function guardedSpawnRegisterPanel(channelId) {
    return stableSpawnRegisterPanel(panelsModule, channelId);
  };

  panelsModule.updateRegistrationStatusMessage = function guardedUpdateRegistrationStatusMessage(options = {}) {
    return stableUpdateRegistrationStatusMessage(panelsModule, options);
  };

  panelsModule.updateSavedRegisterPanelIfExists = async function guardedUpdateSavedRegisterPanelIfExists() {
    const lifecycle = require('./bot/lifecycle');
    const settings = lifecycle.getBotSettings();
    if (!settings.registerPanelChannelId) return { skipped: true };
    return panelsModule.spawnRegisterPanel(settings.registerPanelChannelId);
  };

  panelsModule.handleRegistrationStateChange = async function guardedHandleRegistrationStateChange() {
    const lifecycle = require('./bot/lifecycle');
    lifecycle.refreshStateFromDisk();
    await panelsModule.updateSavedRegisterPanelIfExists().catch(() => {});
    await panelsModule.updateRegistrationStatusMessage({ force: true }).catch(() => {});
    await panelsModule.updateSavedResultsPanelIfExists?.().catch(() => {});
    await panelsModule.maybeAnnounceTournamentFull?.().catch(() => {});
  };

  Object.defineProperty(panelsModule, '__rodaPanelStabilityGuardPatched', { value: true, enumerable: false });
  console.log('✅ Guard stabilità pannelli Discord attivo.');
  return panelsModule;
}

function patchBotIndex(botModule) {
  if (!botModule || botModule.__rodaPanelStabilityIndexPatched) return botModule;
  try {
    const panels = require('./bot/panels');
    patchPanelsModule(panels);
    for (const key of ['spawnRegisterPanel', 'updateRegistrationStatusMessage', 'updateSavedRegisterPanelIfExists', 'handleRegistrationStateChange']) {
      if (typeof panels[key] === 'function') botModule[key] = panels[key];
    }
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
