'use strict';

/**
 * RODA CUP startup guard.
 *
 * This file is loaded before legacy preload files. It blocks unsafe route
 * registration patterns and keeps Discord leaderboards synced with the same
 * persisted data used by the website dashboard.
 */

const Module = require('module');

const BLOCKED_LEGACY_ROUTES = new Set([
  '/api/dashboard/team-slot',
  '/api/dashboard/team-slots/recalibrate'
]);

function shouldBlockLegacyRoute(pathValue) {
  if (process.env.ENABLE_LEGACY_TEAM_SLOT_ROUTES === 'true') {
    return false;
  }

  return typeof pathValue === 'string' && BLOCKED_LEGACY_ROUTES.has(pathValue);
}

function installExpressRouteGuard(expressModule) {
  if (!expressModule || expressModule.__rodaStartupGuardPatched) {
    return expressModule;
  }

  const originalExpress = expressModule;

  function patchApp(app) {
    if (!app || app.__rodaRouteGuardInstalled) {
      return app;
    }

    Object.defineProperty(app, '__rodaRouteGuardInstalled', {
      value: true,
      enumerable: false
    });

    for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
      if (typeof app[method] !== 'function') continue;

      const original = app[method];

      app[method] = function guardedRoute(pathValue, ...handlers) {
        if (shouldBlockLegacyRoute(pathValue)) {
          console.warn(`[startup-guard] Rotta legacy non autenticata bloccata: ${method.toUpperCase()} ${pathValue}`);
          return this;
        }

        return original.call(this, pathValue, ...handlers);
      };
    }

    return app;
  }

  function guardedExpress(...args) {
    return patchApp(originalExpress(...args));
  }

  Object.setPrototypeOf(guardedExpress, originalExpress);
  Object.assign(guardedExpress, originalExpress);
  guardedExpress.application = originalExpress.application;
  guardedExpress.request = originalExpress.request;
  guardedExpress.response = originalExpress.response;
  guardedExpress.Router = originalExpress.Router;
  guardedExpress.__rodaStartupGuardPatched = true;

  return guardedExpress;
}

function isPanelsModuleRequest(request) {
  return typeof request === 'string' && (
    request === './bot/panels' ||
    request === './panels' ||
    request.endsWith('/bot/panels') ||
    request.endsWith('bot/panels.js')
  );
}

function installLeaderboardSyncGuard(panelsModule) {
  if (!panelsModule || panelsModule.__rodaLeaderboardSyncGuardPatched) {
    return panelsModule;
  }

  const lifecycle = require('./bot/lifecycle');

  function refreshBeforeDiscordLeaderboardUpdate() {
    try {
      if (typeof lifecycle.refreshStateFromDisk === 'function') {
        lifecycle.refreshStateFromDisk();
      }
    } catch (error) {
      console.error('[startup-guard] Errore refresh dati prima classifica Discord:', error.message);
    }
  }

  for (const functionName of ['updateLeaderboard', 'updateLeaderboardGraphics', 'updateLeaderboardGraphicsImmediate']) {
    if (typeof panelsModule[functionName] !== 'function') continue;

    const original = panelsModule[functionName];

    panelsModule[functionName] = async function syncedLeaderboardUpdate(...args) {
      refreshBeforeDiscordLeaderboardUpdate();
      return original.apply(this, args);
    };
  }

  Object.defineProperty(panelsModule, '__rodaLeaderboardSyncGuardPatched', {
    value: true,
    enumerable: false
  });

  console.log('✅ Sync classifiche sito ↔ Discord attivo.');
  return panelsModule;
}

function isStorageModuleRequest(request) {
  return typeof request === 'string' && (
    request === './storage' ||
    request === '../storage' ||
    request.endsWith('/storage') ||
    request.endsWith('storage.js')
  );
}

function installStorageWriteMarker(storageModule) {
  if (!storageModule || storageModule.__rodaStorageWriteMarkerPatched) {
    return storageModule;
  }

  const touch = () => {
    global.__rodaLastStorageWriteAt = Date.now();
  };

  for (const functionName of ['saveData', 'saveTeams', 'saveAll', 'appendAuditLog', 'createTournamentArchive']) {
    if (typeof storageModule[functionName] !== 'function') continue;

    const original = storageModule[functionName];

    storageModule[functionName] = function markedStorageWrite(...args) {
      const result = original.apply(this, args);
      touch();
      return result;
    };
  }

  Object.defineProperty(storageModule, '__rodaStorageWriteMarkerPatched', {
    value: true,
    enumerable: false
  });

  return storageModule;
}

try {
  const expressPath = require.resolve('express');
  const originalLoad = Module._load;

  Module._load = function guardedLoad(request, parent, isMain) {
    const loaded = originalLoad.apply(this, arguments);

    if (request === 'express') {
      return installExpressRouteGuard(loaded);
    }

    if (isPanelsModuleRequest(request)) {
      return installLeaderboardSyncGuard(loaded);
    }

    if (isStorageModuleRequest(request)) {
      return installStorageWriteMarker(loaded);
    }

    return loaded;
  };

  if (require.cache[expressPath]?.exports) {
    require.cache[expressPath].exports = installExpressRouteGuard(require.cache[expressPath].exports);
  }
} catch (error) {
  console.error('[startup-guard] Impossibile installare guard Express/sync:', error.message);
}
