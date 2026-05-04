'use strict';

/**
 * Keeps Discord registration panels in sync with tournament lifecycle changes.
 * Fixes the button staying on "Registrazioni chiuse" after opening registrations,
 * and refreshes the registration/team list panels after closing/finishing/archiving.
 */

const Module = require('module');

const LIFECYCLE_FUNCTIONS = new Set([
  'openRegistrations',
  'closeRegistrations',
  'startTournament',
  'finishTournament',
  'archiveAndCreateFreshTournament'
]);

function isStorageModuleRequest(request) {
  return typeof request === 'string' && (
    request === './storage' ||
    request === '../storage' ||
    request.endsWith('/storage') ||
    request.endsWith('storage.js')
  );
}

function scheduleDiscordRegistrationPanelRefresh(reason) {
  clearTimeout(global.__rodaRegistrationPanelRefreshTimer);
  global.__rodaRegistrationPanelRefreshTimer = setTimeout(async () => {
    try {
      const bot = require('./index');
      console.log(`[iscrizioni] refresh forzato pannelli Discord: ${reason}`);

      if (typeof bot.refreshStateFromDisk === 'function') {
        try { bot.refreshStateFromDisk(); } catch {}
      }

      if (typeof bot.updateSavedRegisterPanelIfExists === 'function') {
        await bot.updateSavedRegisterPanelIfExists();
      }

      if (typeof bot.updateRegistrationStatusMessage === 'function') {
        await bot.updateRegistrationStatusMessage({ force: true });
      }

      if (typeof bot.refreshTeamResultPanels === 'function') {
        await bot.refreshTeamResultPanels().catch(() => null);
      }

      console.log(`[iscrizioni] refresh forzato completato: ${reason}`);
    } catch (error) {
      console.error('[iscrizioni] refresh forzato pannelli fallito:', error && error.stack ? error.stack : error);
    }
  }, 1200);
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
      scheduleDiscordRegistrationPanelRefresh(functionName);
      return result;
    };
  }

  if (typeof storageModule.saveData === 'function') {
    const originalSaveData = storageModule.saveData;
    storageModule.saveData = function patchedSaveData(data, ...args) {
      const beforeState = (() => {
        try {
          const current = typeof storageModule.loadData === 'function' ? storageModule.loadData() : null;
          return current?.tournamentLifecycle?.state || '';
        } catch { return ''; }
      })();

      const nextState = data?.tournamentLifecycle?.state || '';
      const result = originalSaveData.call(this, data, ...args);

      if (beforeState && nextState && beforeState !== nextState) {
        invalidateRegistrationPanelCache(result);
        try { originalSaveData.call(this, result, ...args); } catch {}
        scheduleDiscordRegistrationPanelRefresh(`saveData:${beforeState}->${nextState}`);
      }

      return result;
    };
  }

  Object.defineProperty(storageModule, '__rodaRegistrationPanelSyncPatched', { value: true, enumerable: false });
  console.log('✅ Sync pannello iscrizioni Discord su cambio stato attivo.');
  return storageModule;
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

  console.log('✅ Hook sync pannelli iscrizioni installato.');
}

install();

module.exports = { install, scheduleDiscordRegistrationPanelRefresh };
