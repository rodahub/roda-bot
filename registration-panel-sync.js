'use strict';

/**
 * Hard sync for Discord registration panel.
 * Searches the actual Discord registration channel and edits every stale RØDA
 * registration panel message it finds, instead of trusting only saved ids.
 */

const Module = require('module');

const LIFECYCLE_FUNCTIONS = new Set([
  'openRegistrations',
  'closeRegistrations',
  'startTournament',
  'finishTournament',
  'archiveAndCreateFreshTournament'
]);

let lastAppliedSignature = '';

function isStorageModuleRequest(request) {
  return typeof request === 'string' && (
    request === './storage' ||
    request === '../storage' ||
    request.endsWith('/storage') ||
    request.endsWith('storage.js')
  );
}

function safeText(value) { return String(value || '').trim(); }

function normalizeTournamentState(value) {
  const s = String(value || '').trim().toLowerCase();
  if (['iscrizioni_aperte', 'registrazioni_aperte', 'registrations_open', 'registration_open', 'open_registrations', 'open'].includes(s)) return 'iscrizioni_aperte';
  if (['iscrizioni_chiuse', 'registrazioni_chiuse', 'registrations_closed', 'registration_closed', 'close_registrations', 'closed_registrations', 'closed'].includes(s)) return 'iscrizioni_chiuse';
  if (['torneo_in_corso', 'running', 'started', 'in_progress', 'tournament_running'].includes(s)) return 'torneo_in_corso';
  if (['torneo_finito', 'finished', 'ended', 'completed', 'tournament_finished'].includes(s)) return 'torneo_finito';
  return s || 'bozza';
}

function readStateSnapshot() {
  const storage = require('./storage');
  const data = storage.loadData ? storage.loadData() : {};
  const teams = storage.loadTeams ? storage.loadTeams() : {};
  const maxTeams = Number(
    data?.tournamentLifecycle?.maxTeams ||
    data?.projectSettings?.maxTeams ||
    data?.registrationLimit ||
    storage.MAX_TEAMS ||
    16
  ) || 16;
  const state = normalizeTournamentState(data?.tournamentLifecycle?.state);
  const registered = Object.keys(teams || {}).length;
  const isOpen = state === 'iscrizioni_aperte' && registered < maxTeams;
  return { storage, data, teams, maxTeams, state, registered, isOpen };
}

function getCurrentSignature() {
  try {
    const { data, teams, maxTeams, state, registered, isOpen } = readStateSnapshot();
    const botSettings = data?.botSettings || {};
    const registerPanelMessageId = botSettings.registerPanelMessageId || '';
    const registerPanelChannelId = botSettings.registerPanelChannelId || '';
    const statusMessageId = data?.registrationStatusMessageId || data?.registrationGraphicMessageId || '';
    const teamSig = Object.entries(teams || {})
      .map(([name, team]) => `${Number(team && team.slot || 0)}:${name}`)
      .sort()
      .join('|');
    return `${state}|open:${isOpen}|${registered}/${maxTeams}|${teamSig}|${registerPanelChannelId}|${registerPanelMessageId}|${statusMessageId}`;
  } catch (error) {
    return `error:${Date.now()}:${error.message || error}`;
  }
}

function buildRegistrationPayload(snapshot) {
  const { data, registered, maxTeams, isOpen } = snapshot;
  const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
  const tournamentName = safeText(data?.projectSettings?.tournamentName) || 'RØDA CUP';
  const isFull = registered >= maxTeams;
  const disabled = !isOpen || isFull;
  const embed = new EmbedBuilder()
    .setColor(0x7b2cff)
    .setTitle(`🏆 ${tournamentName}`)
    .setDescription(
      `Benvenuto nel pannello iscrizioni ufficiale.\n\n` +
      `**Formato:** Team da 3 giocatori\n` +
      `**Iscrizioni:** ${isOpen && !isFull ? 'Aperte' : 'Chiuse'}\n` +
      `**Team registrati:** ${registered}/${maxTeams}\n\n` +
      `${!isOpen ? "Le iscrizioni non sono ancora aperte. Attendi l'annuncio dello staff." : isFull ? 'Le iscrizioni hanno raggiunto il limite massimo.' : 'Premi il pulsante qui sotto per registrare il tuo team.'}`
    )
    .setFooter({ text: 'Pannello registrazione torneo' });
  const button = new ButtonBuilder()
    .setCustomId('register_btn')
    .setLabel(disabled ? 'Registrazioni chiuse' : 'Registra team')
    .setStyle(disabled ? ButtonStyle.Secondary : ButtonStyle.Primary)
    .setDisabled(disabled);
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(button)] };
}

async function resolveRegistrationChannel(snapshot) {
  const { client, waitReady } = require('./bot/client');
  const { GUILD_ID, REGISTRATION_STATUS_CHANNEL } = require('./bot/config');
  await waitReady();
  const savedId = safeText(snapshot.data?.botSettings?.registerPanelChannelId);
  const candidates = [savedId, safeText(REGISTRATION_STATUS_CHANNEL)].filter(Boolean);
  for (const id of candidates) {
    const channel = await client.channels.fetch(id).catch(() => null);
    if (channel && typeof channel.send === 'function') return channel;
  }
  const guild = await client.guilds.fetch(GUILD_ID).catch(() => null);
  if (!guild) throw new Error('Guild Discord non trovata per pannello iscrizioni.');
  await guild.channels.fetch().catch(() => null);
  const byName = guild.channels.cache.find(ch =>
    typeof ch.send === 'function' &&
    String(ch.name || '').toLowerCase().includes('iscrizion')
  );
  if (byName) return byName;
  throw new Error('Canale iscrizioni non trovato. Imposta registerPanelChannelId o REGISTRATION_STATUS_CHANNEL.');
}

function isRegistrationPanelMessage(message) {
  const hasRegisterButton = (message.components || []).some(row =>
    (row.components || []).some(component => String(component.customId || '') === 'register_btn')
  );
  if (hasRegisterButton) return true;
  const embed = message.embeds && message.embeds[0];
  const text = `${embed?.title || ''}\n${embed?.description || ''}\n${embed?.footer?.text || ''}`.toLowerCase();
  return text.includes('røda cup') && text.includes('pannello iscrizioni');
}

function newestFirst(messages) {
  return messages.sort((a, b) => {
    try {
      const aa = BigInt(a.id);
      const bb = BigInt(b.id);
      return aa === bb ? 0 : aa > bb ? -1 : 1;
    } catch {
      return String(b.id).localeCompare(String(a.id));
    }
  });
}

async function directlyRepairDiscordPanel(reason) {
  const snapshot = readStateSnapshot();
  const payload = buildRegistrationPayload(snapshot);
  const channel = await resolveRegistrationChannel(snapshot);
  const { client } = require('./bot/client');
  const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  const panelMessages = [];
  if (messages) {
    for (const msg of messages.values()) {
      if (msg.author?.id !== client.user?.id) continue;
      if (isRegistrationPanelMessage(msg)) panelMessages.push(msg);
    }
  }

  let updated = 0;
  let created = false;
  if (panelMessages.length) {
    newestFirst(panelMessages);
    for (const msg of panelMessages) {
      try {
        await msg.edit(payload);
        updated++;
      } catch (error) {
        console.error('[iscrizioni] edit pannello vecchio fallito:', msg.id, error.message);
      }
    }
    snapshot.data.botSettings = snapshot.data.botSettings || {};
    snapshot.data.botSettings.registerPanelChannelId = channel.id;
    snapshot.data.botSettings.registerPanelMessageId = panelMessages[0].id;
    snapshot.data.__forceRegistrationPanelRefresh = false;
    if (snapshot.storage.saveData) snapshot.storage.saveData(snapshot.data);
  } else {
    const sent = await channel.send(payload);
    created = true;
    snapshot.data.botSettings = snapshot.data.botSettings || {};
    snapshot.data.botSettings.registerPanelChannelId = channel.id;
    snapshot.data.botSettings.registerPanelMessageId = sent.id;
    snapshot.data.__forceRegistrationPanelRefresh = false;
    if (snapshot.storage.saveData) snapshot.storage.saveData(snapshot.data);
  }

  console.log(`[iscrizioni] repair diretto completato (${reason}) stato=${snapshot.state} open=${snapshot.isOpen} team=${snapshot.registered}/${snapshot.maxTeams} updated=${updated} created=${created}`);
  return { ok: true, updated, created, state: snapshot.state, isOpen: snapshot.isOpen, registered: snapshot.registered, maxTeams: snapshot.maxTeams };
}

async function forceRefreshDiscordRegistrationPanels(reason, force = true) {
  let directResult = null;
  try {
    directResult = await directlyRepairDiscordPanel(reason);
  } catch (error) {
    console.error('[iscrizioni] repair diretto fallito:', error.message);
  }

  try {
    const bot = require('./index');
    if (typeof bot.updateRegistrationStatusMessage === 'function') {
      await bot.updateRegistrationStatusMessage({ force }).catch(err => console.error('[iscrizioni] update lista iscritti fallito:', err.message));
    }
  } catch (error) {
    console.error('[iscrizioni] refresh secondario fallito:', error.message);
  }

  return directResult || { ok: true };
}

function scheduleDiscordRegistrationPanelRefresh(reason, delay = 1200) {
  clearTimeout(global.__rodaRegistrationPanelRefreshTimer);
  global.__rodaRegistrationPanelRefreshTimer = setTimeout(async () => {
    const ok = await forceRefreshDiscordRegistrationPanels(reason, true);
    if (ok) lastAppliedSignature = getCurrentSignature();
  }, delay);
}

function invalidateRegistrationPanelCache(data) {
  if (!data || typeof data !== 'object') return data;
  data.lastRegistrationGraphicSignature = null;
  if (data.botSettings && typeof data.botSettings === 'object') data.botSettings.lastRegistrationGraphicSignature = null;
  data.__forceRegistrationPanelRefresh = true;
  return data;
}

function installStoragePatch(storageModule) {
  if (!storageModule || storageModule.__rodaRegistrationPanelSyncPatched) return storageModule;
  for (const functionName of LIFECYCLE_FUNCTIONS) {
    if (typeof storageModule[functionName] !== 'function') continue;
    const original = storageModule[functionName];
    storageModule[functionName] = function patchedTournamentLifecycleFunction(...args) {
      const result = original.apply(this, args);
      try {
        const data = typeof storageModule.loadData === 'function' ? storageModule.loadData() : null;
        if (data && typeof storageModule.saveData === 'function') storageModule.saveData(invalidateRegistrationPanelCache(data));
      } catch {}
      scheduleDiscordRegistrationPanelRefresh(functionName, 500);
      scheduleDiscordRegistrationPanelRefresh(`${functionName}:retry`, 3500);
      return result;
    };
  }
  if (typeof storageModule.saveData === 'function') {
    const originalSaveData = storageModule.saveData;
    storageModule.saveData = function patchedSaveData(data, ...args) {
      const beforeState = (() => { try { const current = typeof storageModule.loadData === 'function' ? storageModule.loadData() : null; return current?.tournamentLifecycle?.state || ''; } catch { return ''; } })();
      const nextState = data?.tournamentLifecycle?.state || '';
      const shouldRefresh = Boolean(data && data.__forceRegistrationPanelRefresh) || (beforeState && nextState && beforeState !== nextState);
      const result = originalSaveData.call(this, data, ...args);
      if (shouldRefresh) {
        scheduleDiscordRegistrationPanelRefresh(`saveData:${beforeState}->${nextState}`, 500);
        scheduleDiscordRegistrationPanelRefresh(`saveData:${beforeState}->${nextState}:retry`, 3500);
      }
      return result;
    };
  }
  Object.defineProperty(storageModule, '__rodaRegistrationPanelSyncPatched', { value: true, enumerable: false });
  console.log('✅ Sync pannello iscrizioni Discord su cambio stato attivo.');
  return storageModule;
}

function installReconcileLoop() {
  if (global.__rodaRegistrationPanelReconcileLoopInstalled) return;
  global.__rodaRegistrationPanelReconcileLoopInstalled = true;
  setTimeout(async () => {
    lastAppliedSignature = '';
    await forceRefreshDiscordRegistrationPanels('boot-force', true);
    lastAppliedSignature = getCurrentSignature();
  }, 12000);
  setInterval(async () => {
    const signature = getCurrentSignature();
    if (signature !== lastAppliedSignature) {
      const ok = await forceRefreshDiscordRegistrationPanels('reconcile-loop', true);
      if (ok) lastAppliedSignature = getCurrentSignature();
    }
  }, 15000);
  console.log('✅ Reconcile automatico pannello iscrizioni attivo.');
}

function install() {
  if (global.__rodaRegistrationPanelSyncInstalled) return;
  global.__rodaRegistrationPanelSyncInstalled = true;
  const originalLoad = Module._load;
  Module._load = function registrationPanelSyncLoad(request, parent, isMain) {
    const loaded = originalLoad.apply(this, arguments);
    if (isStorageModuleRequest(request)) return installStoragePatch(loaded);
    return loaded;
  };
  installReconcileLoop();
  console.log('✅ Hook sync pannelli iscrizioni installato.');
}

install();

module.exports = { install, scheduleDiscordRegistrationPanelRefresh, forceRefreshDiscordRegistrationPanels, directlyRepairDiscordPanel };
