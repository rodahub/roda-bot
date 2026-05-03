'use strict';

/**
 * RODA CUP startup guard.
 *
 * This file is loaded before legacy preload files. It blocks unsafe route
 * registration patterns, keeps Discord leaderboards synced with the same
 * persisted data used by the website dashboard, hardens the Discord
 * result-panel flow used during live tournaments, and guarantees that result
 * screenshots saved from Discord are served back to the website from /uploads.
 */

const fs = require('fs');
const path = require('path');
const Module = require('module');

const STORAGE_DIR =
  process.env.STORAGE_DIR ||
  process.env.RAILWAY_VOLUME_MOUNT_PATH ||
  path.join(__dirname, 'storage-data');

const UPLOADS_DIR = path.join(STORAGE_DIR, 'uploads');

const BLOCKED_LEGACY_ROUTES = new Set([
  '/api/dashboard/team-slot',
  '/api/dashboard/team-slots/recalibrate'
]);

const FIXED_POINTS = Object.freeze({
  kill: 1,
  placement: Object.freeze({
    1: 10,
    2: 6,
    3: 5,
    4: 4,
    5: 3,
    6: 2,
    7: 1,
    8: 1
  })
});

function shouldBlockLegacyRoute(pathValue) {
  if (process.env.ENABLE_LEGACY_TEAM_SLOT_ROUTES === 'true') {
    return false;
  }

  return typeof pathValue === 'string' && BLOCKED_LEGACY_ROUTES.has(pathValue);
}

function toStrictInteger(value, label, { min = 0, max = 999 } = {}) {
  const raw = String(value ?? '').trim();

  if (!/^\d+$/.test(raw)) {
    throw new Error(`${label} deve essere un numero intero valido.`);
  }

  const num = Number(raw);

  if (!Number.isSafeInteger(num) || num < min || num > max) {
    throw new Error(`${label} deve essere compreso tra ${min} e ${max}.`);
  }

  return num;
}

function normalizeKills(kills) {
  const list = Array.isArray(kills) ? kills : [];
  return [0, 1, 2].map(index => toStrictInteger(list[index] ?? 0, `Kill giocatore ${index + 1}`, { min: 0, max: 80 }));
}

function normalizePlacement(value) {
  return toStrictInteger(value, 'Posizione finale', { min: 1, max: 150 });
}

function calcFixedPoints(pos, kills) {
  const placement = Number(pos || 0);
  const totalKills = Number(kills || 0);
  const bonus = Number(FIXED_POINTS.placement[placement] || 0);
  return Math.max(0, totalKills) * FIXED_POINTS.kill + bonus;
}

function normalizeResultEntry(entry) {
  const safe = entry && typeof entry === 'object' ? { ...entry } : {};
  const kills = normalizeKills(safe.kills);
  const total = kills.reduce((sum, value) => sum + value, 0);
  const pos = normalizePlacement(safe.pos);

  return {
    ...safe,
    kills,
    total,
    pos,
    points: calcFixedPoints(pos, total)
  };
}

function getAttachmentFallbackUrl(attachment) {
  const urls = [
    attachment?.url,
    attachment?.proxyURL,
    attachment?.attachment,
    attachment?.href
  ];

  for (const url of urls) {
    const clean = String(url || '').trim();
    if (/^https?:\/\//i.test(clean)) return clean;
  }

  return '';
}

function normalizeUploadUrlForWebsite(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  if (raw.startsWith('/uploads/')) return raw;

  try {
    const parsed = new URL(raw);
    if (parsed.pathname.startsWith('/uploads/')) {
      return parsed.pathname;
    }
  } catch {}

  return raw;
}

function installUploadsStaticRoute(app, expressModule) {
  if (!app || app.__rodaUploadsStaticInstalled || !expressModule || typeof expressModule.static !== 'function') {
    return;
  }

  try {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });

    app.use('/uploads', expressModule.static(UPLOADS_DIR, {
      fallthrough: false,
      maxAge: '1h',
      setHeaders(res) {
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      }
    }));

    Object.defineProperty(app, '__rodaUploadsStaticInstalled', {
      value: true,
      enumerable: false
    });

    console.log(`[startup-guard] Upload risultati serviti da /uploads -> ${UPLOADS_DIR}`);
  } catch (error) {
    console.error('[startup-guard] Impossibile servire /uploads:', error.message);
  }
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

    installUploadsStaticRoute(app, originalExpress);

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

function isHelpersModuleRequest(request) {
  return typeof request === 'string' && (
    request === './bot/helpers' ||
    request === './helpers' ||
    request.endsWith('/bot/helpers') ||
    request.endsWith('bot/helpers.js')
  );
}

function installFixedPointsGuard(helpersModule) {
  if (!helpersModule || helpersModule.__rodaFixedPointsPatched) {
    return helpersModule;
  }

  helpersModule.loadPointsConfig = function loadFixedPointsConfig() {
    return {
      kill: FIXED_POINTS.kill,
      placement: { ...FIXED_POINTS.placement }
    };
  };

  helpersModule.calcPoints = function guardedCalcPoints(pos, kills) {
    const placement = Number(pos || 0);
    const totalKills = Number(kills || 0);

    if (!Number.isFinite(placement) || placement < 1) return Math.max(0, totalKills || 0);
    if (!Number.isFinite(totalKills) || totalKills < 0) return 0;

    return calcFixedPoints(placement, totalKills);
  };

  Object.defineProperty(helpersModule, '__rodaFixedPointsPatched', {
    value: true,
    enumerable: false
  });

  console.log('✅ Punteggio RODA CUP fisso attivo.');
  return helpersModule;
}

function isSubmissionsModuleRequest(request) {
  return typeof request === 'string' && (
    request === './bot/submissions' ||
    request === './submissions' ||
    request.endsWith('/bot/submissions') ||
    request.endsWith('bot/submissions.js')
  );
}

function installSubmissionGuard(submissionsModule) {
  if (!submissionsModule || submissionsModule.__rodaSubmissionGuardPatched) {
    return submissionsModule;
  }

  const lifecycle = require('./bot/lifecycle');
  const state = require('./bot/state');

  if (typeof submissionsModule.saveDiscordAttachmentLocally === 'function') {
    const originalSaveDiscordAttachmentLocally = submissionsModule.saveDiscordAttachmentLocally;

    submissionsModule.saveDiscordAttachmentLocally = async function noLostPhotoSave(attachment, ...args) {
      const fallbackUrl = getAttachmentFallbackUrl(attachment);

      try {
        const savedUrl = await originalSaveDiscordAttachmentLocally.call(this, attachment, ...args);
        const normalized = normalizeUploadUrlForWebsite(savedUrl);
        if (String(normalized || '').trim()) return normalized;
      } catch (error) {
        console.error('[startup-guard] Salvataggio locale foto fallito, uso URL Discord:', error.message);
      }

      if (fallbackUrl) return fallbackUrl;

      throw new Error('Nessuna immagine valida ricevuta. Invia lo screenshot come allegato Discord, non come link testuale.');
    };
  }

  if (typeof submissionsModule.createPendingSubmission === 'function') {
    const originalCreatePendingSubmission = submissionsModule.createPendingSubmission;

    submissionsModule.createPendingSubmission = async function guardedCreatePendingSubmission(entry, ...args) {
      const safeEntry = normalizeResultEntry(entry);
      safeEntry.image = normalizeUploadUrlForWebsite(safeEntry.image);
      return originalCreatePendingSubmission.call(this, safeEntry, ...args);
    };
  }

  if (typeof submissionsModule.submitWebResult === 'function') {
    const originalSubmitWebResult = submissionsModule.submitWebResult;

    submissionsModule.submitWebResult = async function guardedSubmitWebResult(payload, ...args) {
      const k1 = toStrictInteger(payload?.k1 ?? 0, 'Kill giocatore 1', { min: 0, max: 80 });
      const k2 = toStrictInteger(payload?.k2 ?? 0, 'Kill giocatore 2', { min: 0, max: 80 });
      const k3 = toStrictInteger(payload?.k3 ?? 0, 'Kill giocatore 3', { min: 0, max: 80 });
      const pos = normalizePlacement(payload?.pos);
      return originalSubmitWebResult.call(this, { ...payload, k1, k2, k3, pos }, ...args);
    };
  }

  for (const functionName of ['approvePending', 'rejectPending']) {
    if (typeof submissionsModule[functionName] !== 'function') continue;

    const original = submissionsModule[functionName];

    submissionsModule[functionName] = async function guardedStaffDecision(id, ...args) {
      try {
        if (typeof lifecycle.refreshStateFromDisk === 'function') {
          lifecycle.refreshStateFromDisk();
        }

        const entry = state.data?.pending?.[id];
        if (entry) {
          state.data.pending[id] = normalizeResultEntry(entry);
          state.data.pending[id].image = normalizeUploadUrlForWebsite(state.data.pending[id].image);
          if (typeof lifecycle.saveState === 'function') lifecycle.saveState();
        }
      } catch (error) {
        console.error(`[startup-guard] Errore normalizzazione ${functionName}:`, error.message);
        throw error;
      }

      return original.call(this, id, ...args);
    };
  }

  Object.defineProperty(submissionsModule, '__rodaSubmissionGuardPatched', {
    value: true,
    enumerable: false
  });

  console.log('✅ Guard risultati Discord attivo.');
  return submissionsModule;
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

function isDiscordModuleRequest(request) {
  return request === 'discord.js';
}

function installDiscordInteractionGuard(discordModule) {
  if (!discordModule || discordModule.__rodaInteractionGuardPatched) {
    return discordModule;
  }

  const Client = discordModule.Client;
  if (!Client || !Client.prototype || Client.prototype.__rodaInteractionGuardPatched) {
    return discordModule;
  }

  const originalEmit = Client.prototype.emit;

  Client.prototype.emit = function guardedDiscordEmit(eventName, ...args) {
    if (eventName === 'interactionCreate') {
      const interaction = args[0];

      try {
        if (
          interaction &&
          typeof interaction.isButton === 'function' &&
          interaction.isButton() &&
          /^(ok|no)_/.test(String(interaction.customId || ''))
        ) {
          const lifecycle = require('./bot/lifecycle');
          if (typeof lifecycle.refreshStateFromDisk === 'function') lifecycle.refreshStateFromDisk();

          const originalUpdate = interaction.update?.bind(interaction);
          const originalEditReply = interaction.editReply?.bind(interaction);

          if (!interaction.deferred && !interaction.replied && typeof interaction.deferUpdate === 'function') {
            interaction.deferUpdate().catch(error => {
              console.error('[startup-guard] defer bottone staff fallito:', error.message);
            });
          }

          if (typeof originalEditReply === 'function') {
            interaction.update = function safeUpdateAfterDefer(payload) {
              if (interaction.deferred || interaction.replied) {
                return originalEditReply(payload);
              }

              if (typeof originalUpdate === 'function') return originalUpdate(payload);
              return Promise.resolve(null);
            };
          }
        }
      } catch (error) {
        console.error('[startup-guard] Errore guard interazione staff:', error.message);
      }
    }

    return originalEmit.call(this, eventName, ...args);
  };

  Object.defineProperty(Client.prototype, '__rodaInteractionGuardPatched', {
    value: true,
    enumerable: false
  });

  Object.defineProperty(discordModule, '__rodaInteractionGuardPatched', {
    value: true,
    enumerable: false
  });

  console.log('✅ Guard bottoni staff Discord attivo.');
  return discordModule;
}

try {
  const expressPath = require.resolve('express');
  const originalLoad = Module._load;

  Module._load = function guardedLoad(request, parent, isMain) {
    const loaded = originalLoad.apply(this, arguments);

    if (request === 'express') {
      return installExpressRouteGuard(loaded);
    }

    if (isDiscordModuleRequest(request)) {
      return installDiscordInteractionGuard(loaded);
    }

    if (isHelpersModuleRequest(request)) {
      return installFixedPointsGuard(loaded);
    }

    if (isPanelsModuleRequest(request)) {
      return installLeaderboardSyncGuard(loaded);
    }

    if (isSubmissionsModuleRequest(request)) {
      return installSubmissionGuard(loaded);
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
