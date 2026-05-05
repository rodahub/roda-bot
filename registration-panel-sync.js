'use strict';

/**
 * Keeps Discord registration panels in sync with tournament lifecycle changes.
 * Emergency-safe behavior: besides patching lifecycle calls, it also reconciles the
 * saved Discord panels on a timer so the registration button cannot remain stale.
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

function normalizeTournamentState(value) {
  const s = String(value || '').trim().toLowerCase();
  if (['iscrizioni_aperte', 'registrazioni_aperte', 'registrations_open', 'registration_open', 'open_registrations'].includes(s)) return 'iscrizioni_aperte';
  if (['iscrizioni_chiuse', 'registrazioni_chiuse', 'registrations_closed', 'registration_closed', 'close_registrations', 'closed_registrations'].includes(s)) return 'iscrizioni_chiuse';
  if (['torneo_in_corso', 'running', 'started', 'in_progress', 'tournament_running'].includes(s)) return 'torneo_in_corso';
  if (['torneo_finito', 'finished', 'ended', 'completed', 'tournament_finished'].includes(s)) return 'torneo_finito';
  return s || 'bozza';
}

function getCurrentSignature() {
  try {
    const storage = require('./storage');
    const data = storage.loadData ? storage.loadData() : {};
    const teams = storage.loadTeams ? storage.loadTeams() : {};
    const state = normalizeTournamentState(data && data.tournamentLifecycle && data.tournamentLifecycle.state);
    const registerPanelMessageId = data && data.botSettings ? data.botSettings.registerPanelMessageId || '' : '';
    const registerPanelChannelId = data && data.botSettings ? data.botSettings.registerPanelChannelId || '' : '';
    const statusMessageId = data ? data.registrationStatusMessageId || data.registrationGraphicMessageId || '' : '';
    const teamSig = Object.entries(teams || {})
      .map(([name, team]) => `${Number(team && team.slot || 0)}:${name}`)
      .sort()
      .join('|');
    return `${state}|${Object.keys(teams || {}).length}|${teamSig}|${registerPanelChannelId}|${registerPanelMessageId}|${statusMessageId}`;
  } catch (error) {
    return `error:${Date.now()}:${error.message || error}`;
  }
}

async function forceRefreshDiscordRegistrationPanels(reason, force = true) {
  try {
    const bot = require('./index');
    console.log(`[iscrizioni] refresh pannelli Discord: ${reason}`);

    if (typeof bot.refreshStateFromDisk === 'function') {
      try { bot.refreshStateFromDisk(); } catch {}
    }

    if (typeof bot.updateSavedRegisterPanelIfExists === 'function') {
      await bot.updateSavedRegisterPanelIfExists().catch(err => console.error('[iscrizioni] update pannello iscrizioni fallito:', err.message));
    }

    if (typeof bot.updateRegistrationStatusMessage === 'function') {
      await bot.updateRegistrationStatusMessage({ force }).catch(err => console.error('[iscrizioni] update lista iscritti fallito:', err.message));
    }

    console.log(`[iscrizioni] refresh pannelli Discord completato: ${reason}`);
    return true;
  } catch (error) {
    console.error('[iscrizioni] refresh pannelli Discord fallito:', error && error.stack ? error.stack : error);
    return false;
  }
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
  if (data.botSettings && typeof data.botSettings === 'object') {
    data.botSettings.lastRegistrationGraphicSignature = null;
  }
  return data;
}

function installStoragePatch(storageModule) {
  if (!storageModule || storageModule.__rodaRegistrationPanelSyncPatched) return storageModule;

  for (const functionName of LIFECYCLE_FUNCTIONS) {
    if (typeof storageModule[functionName] !== 'function') continue;
    const original = storageModule[functionName];

    storageModule[functionName] = function patchedTournamentLifecycleFunction(...args) {
      const result = original.apply(this, args);
      scheduleDiscordRegistrationPanelRefresh(functionName, 600);
      scheduleDiscordRegistrationPanelRefresh(`${functionName}:retry`, 3500);
      return result;
    };
  }

  if (typeof storageModule.saveData === 'function') {
    const originalSaveData = storageModule.saveData;
    storageModule.saveData = function patchedSaveData(data, ...args) {
      const beforeState = (() => {
        try {
          const current = typeof storageModule.loadData === 'function' ? storageModule.loadData() : null;
          return current && current.tournamentLifecycle ? current.tournamentLifecycle.state || '' : '';
        } catch { return ''; }
      })();

      const nextState = data && data.tournamentLifecycle ? data.tournamentLifecycle.state || '' : '';
      const result = originalSaveData.call(this, data, ...args);

      if ((beforeState && nextState && beforeState !== nextState) || (result && result.__forceRegistrationPanelRefresh)) {
        invalidateRegistrationPanelCache(result);
        try { originalSaveData.call(this, result, ...args); } catch {}
        scheduleDiscordRegistrationPanelRefresh(`saveData:${beforeState}->${nextState}`, 600);
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
  }, 15000);

  setInterval(async () => {
    const signature = getCurrentSignature();
    if (signature !== lastAppliedSignature) {
      const ok = await forceRefreshDiscordRegistrationPanels('reconcile-loop', true);
      if (ok) lastAppliedSignature = getCurrentSignature();
    }
  }, 20000);

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

module.exports = { install, scheduleDiscordRegistrationPanelRefresh, forceRefreshDiscordRegistrationPanels };
