'use strict';

/**
 * RODA CUP startup guard.
 *
 * Runtime hardening layer loaded before the app. It keeps old unsafe routes
 * blocked, serves uploaded result proofs, forces fixed RODA CUP scoring,
 * normalizes match/pending data used by the admin dashboard, stabilizes
 * Discord result interactions, loads the official leaderboard auto-spawn,
 * and reconciles corrupted scoreboards from real approved match results.
 */

try {
  require('./scoreboard-reconcile.js');
  console.log('✅ Scoreboard reconcile caricato da startup-guard.');
} catch (error) {
  console.error('[startup-guard] Impossibile caricare scoreboard-reconcile:', error.message);
}

try {
  require('./leaderboard-autospawn.js');
  console.log('✅ Leaderboard auto-spawn caricato da startup-guard.');
} catch (error) {
  console.error('[startup-guard] Impossibile caricare leaderboard-autospawn:', error.message);
}

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

function calcFixedPoints(pos, kills) {
  const placement = Number(pos || 0);
  const totalKills = Number(kills || 0);
  const safeKills = Number.isFinite(totalKills) ? Math.max(0, Math.floor(totalKills)) : 0;
  const safePlacement = Number.isFinite(placement) ? Math.floor(placement) : 0;
  const bonus = Number(FIXED_POINTS.placement[safePlacement] || 0);
  return safeKills * FIXED_POINTS.kill + bonus;
}

function toStrictInteger(value, label, { min = 0, max = 999 } = {}) {
  const raw = String(value ?? '').trim();
  if (!/^\d+$/.test(raw)) throw new Error(`${label} deve essere un numero intero valido.`);
  const num = Number(raw);
  if (!Number.isSafeInteger(num) || num < min || num > max) throw new Error(`${label} deve essere compreso tra ${min} e ${max}.`);
  return num;
}

function normalizeKills(kills) {
  const list = Array.isArray(kills) ? kills : [];
  return [0, 1, 2].map(index => toStrictInteger(list[index] ?? 0, `Kill giocatore ${index + 1}`, { min: 0, max: 80 }));
}

function normalizePlacement(value) {
  return toStrictInteger(value, 'Posizione finale', { min: 1, max: 150 });
}

function sanitizePositiveMatch(value, fallback = 1) {
  const num = Number(value);
  if (!Number.isInteger(num) || num <= 0) return fallback;
  return Math.min(num, 50);
}

function normalizeUploadUrlForWebsite(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.startsWith('/uploads/')) return raw;
  try {
    const parsed = new URL(raw);
    if (parsed.pathname.startsWith('/uploads/')) return parsed.pathname;
  } catch {}
  return raw;
}

function getAttachmentFallbackUrl(attachment) {
  for (const url of [attachment?.url, attachment?.proxyURL, attachment?.attachment, attachment?.href]) {
    const clean = String(url || '').trim();
    if (/^https?:\/\//i.test(clean)) return clean;
  }
  return '';
}

function normalizeResultEntry(entry, fallbackMatch = 1) {
  const safe = entry && typeof entry === 'object' ? { ...entry } : {};
  const kills = normalizeKills(safe.kills);
  const total = kills.reduce((sum, value) => sum + value, 0);
  const pos = normalizePlacement(safe.pos || safe.placement || 1);
  const matchNumber = sanitizePositiveMatch(safe.matchNumber, fallbackMatch);
  return {
    ...safe,
    kills,
    total,
    pos,
    placement: Number(safe.placement || pos),
    matchNumber,
    points: calcFixedPoints(pos, total),
    image: normalizeUploadUrlForWebsite(safe.image || '')
  };
}

function normalizeAdminDashboardData(data) {
  if (!data || typeof data !== 'object') return data;
  const currentMatch = sanitizePositiveMatch(data.currentMatch, 1);
  data.currentMatch = currentMatch;
  if (!data.pending || typeof data.pending !== 'object') data.pending = {};
  for (const [id, entry] of Object.entries(data.pending)) {
    try { data.pending[id] = normalizeResultEntry(entry, currentMatch); }
    catch (error) { console.error('[startup-guard] Pending non valido rimosso:', id, error.message); delete data.pending[id]; }
  }
  if (!data.matches || typeof data.matches !== 'object') data.matches = {};
  for (const [matchKey, match] of Object.entries(data.matches)) {
    if (!match || typeof match !== 'object') continue;
    const matchNumber = sanitizePositiveMatch(match.matchNumber || matchKey, currentMatch);
    match.matchNumber = matchNumber;
    if (!match.teams || typeof match.teams !== 'object') match.teams = {};
    for (const [teamName, teamState] of Object.entries(match.teams)) {
      if (!teamState || typeof teamState !== 'object') continue;
      const kills = Array.isArray(teamState.kills) ? [0, 1, 2].map(i => Number(teamState.kills[i] || 0)) : [0, 0, 0];
      const cleanKills = kills.map(value => Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0);
      const totalKills = cleanKills.reduce((sum, value) => sum + value, 0);
      const placement = Number(teamState.placement || 0);
      teamState.team = teamState.team || teamName;
      teamState.matchNumber = matchNumber;
      teamState.kills = cleanKills;
      teamState.totalKills = totalKills;
      teamState.placement = Number.isFinite(placement) && placement > 0 ? Math.floor(placement) : 0;
      teamState.image = normalizeUploadUrlForWebsite(teamState.image || '');
      if (teamState.status === 'approvato' || teamState.status === 'inserito_manualmente') teamState.points = calcFixedPoints(teamState.placement, totalKills);
      else if (teamState.status === 'assente') teamState.points = 0;
      else teamState.points = Number(teamState.points || 0);
    }
  }
  if (!data.resultSubmissions || typeof data.resultSubmissions !== 'object') data.resultSubmissions = {};
  for (const record of Object.values(data.resultSubmissions)) {
    if (!record || typeof record !== 'object') continue;
    record.matchNumber = sanitizePositiveMatch(record.matchNumber, currentMatch);
    if (record.pendingId && data.pending[record.pendingId]) record.matchNumber = data.pending[record.pendingId].matchNumber;
  }
  return data;
}

function shouldBlockLegacyRoute(pathValue) {
  if (process.env.ENABLE_LEGACY_TEAM_SLOT_ROUTES === 'true') return false;
  return typeof pathValue === 'string' && BLOCKED_LEGACY_ROUTES.has(pathValue);
}

function installUploadsStaticRoute(app, expressModule) {
  if (!app || app.__rodaUploadsStaticInstalled || !expressModule || typeof expressModule.static !== 'function') return;
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
    Object.defineProperty(app, '__rodaUploadsStaticInstalled', { value: true, enumerable: false });
    console.log(`[startup-guard] Upload risultati serviti da /uploads -> ${UPLOADS_DIR}`);
  } catch (error) {
    console.error('[startup-guard] Impossibile servire /uploads:', error.message);
  }
}

function installExpressRouteGuard(expressModule) {
  if (!expressModule || expressModule.__rodaStartupGuardPatched) return expressModule;
  const originalExpress = expressModule;
  function patchApp(app) {
    if (!app || app.__rodaRouteGuardInstalled) return app;
    installUploadsStaticRoute(app, originalExpress);
    Object.defineProperty(app, '__rodaRouteGuardInstalled', { value: true, enumerable: false });
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
  function guardedExpress(...args) { return patchApp(originalExpress(...args)); }
  Object.setPrototypeOf(guardedExpress, originalExpress);
  Object.assign(guardedExpress, originalExpress);
  guardedExpress.application = originalExpress.application;
  guardedExpress.request = originalExpress.request;
  guardedExpress.response = originalExpress.response;
  guardedExpress.Router = originalExpress.Router;
  guardedExpress.__rodaStartupGuardPatched = true;
  return guardedExpress;
}

function isPanelsModuleRequest(request) { return typeof request === 'string' && (request === './bot/panels' || request === './panels' || request.endsWith('/bot/panels') || request.endsWith('bot/panels.js')); }
function installLeaderboardSyncGuard(panelsModule) {
  if (!panelsModule || panelsModule.__rodaLeaderboardSyncGuardPatched) return panelsModule;
  const lifecycle = require('./bot/lifecycle');
  function refreshBeforeDiscordLeaderboardUpdate() {
    try { if (typeof lifecycle.refreshStateFromDisk === 'function') lifecycle.refreshStateFromDisk(); }
    catch (error) { console.error('[startup-guard] Errore refresh dati prima classifica Discord:', error.message); }
  }
  for (const functionName of ['updateLeaderboard', 'updateLeaderboardGraphics', 'updateLeaderboardGraphicsImmediate']) {
    if (typeof panelsModule[functionName] !== 'function') continue;
    const original = panelsModule[functionName];
    panelsModule[functionName] = async function syncedLeaderboardUpdate(...args) {
      refreshBeforeDiscordLeaderboardUpdate();
      return original.apply(this, args);
    };
  }
  Object.defineProperty(panelsModule, '__rodaLeaderboardSyncGuardPatched', { value: true, enumerable: false });
  console.log('✅ Sync classifiche sito ↔ Discord attivo.');
  return panelsModule;
}

function isHelpersModuleRequest(request) { return typeof request === 'string' && (request === './bot/helpers' || request === './helpers' || request.endsWith('/bot/helpers') || request.endsWith('bot/helpers.js')); }
function installFixedPointsGuard(helpersModule) {
  if (!helpersModule || helpersModule.__rodaFixedPointsPatched) return helpersModule;
  helpersModule.loadPointsConfig = () => ({ kill: FIXED_POINTS.kill, placement: { ...FIXED_POINTS.placement } });
  helpersModule.calcPoints = (pos, kills) => calcFixedPoints(pos, kills);
  Object.defineProperty(helpersModule, '__rodaFixedPointsPatched', { value: true, enumerable: false });
  console.log('✅ Punteggio RODA CUP fisso attivo.');
  return helpersModule;
}

function isSubmissionsModuleRequest(request) { return typeof request === 'string' && (request === './bot/submissions' || request === './submissions' || request.endsWith('/bot/submissions') || request.endsWith('bot/submissions.js')); }
function installSubmissionGuard(submissionsModule) {
  if (!submissionsModule || submissionsModule.__rodaSubmissionGuardPatched) return submissionsModule;
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
      } catch (error) { console.error('[startup-guard] Salvataggio locale foto fallito, uso URL Discord:', error.message); }
      if (fallbackUrl) return fallbackUrl;
      throw new Error('Nessuna immagine valida ricevuta. Invia lo screenshot come allegato Discord, non come link testuale.');
    };
  }
  if (typeof submissionsModule.createPendingSubmission === 'function') {
    const originalCreatePendingSubmission = submissionsModule.createPendingSubmission;
    submissionsModule.createPendingSubmission = async function guardedCreatePendingSubmission(entry, ...args) {
      return originalCreatePendingSubmission.call(this, normalizeResultEntry(entry, Number(entry?.matchNumber || state.data?.currentMatch || 1)), ...args);
    };
  }
  for (const functionName of ['approvePending', 'rejectPending']) {
    if (typeof submissionsModule[functionName] !== 'function') continue;
    const original = submissionsModule[functionName];
    submissionsModule[functionName] = async function guardedStaffDecision(id, ...args) {
      if (typeof lifecycle.refreshStateFromDisk === 'function') lifecycle.refreshStateFromDisk();
      const entry = state.data?.pending?.[id];
      if (entry) {
        state.data.pending[id] = normalizeResultEntry(entry, Number(entry.matchNumber || state.data.currentMatch || 1));
        if (typeof lifecycle.saveState === 'function') lifecycle.saveState();
      }
      return original.call(this, id, ...args);
    };
  }
  Object.defineProperty(submissionsModule, '__rodaSubmissionGuardPatched', { value: true, enumerable: false });
  console.log('✅ Guard risultati Discord attivo.');
  return submissionsModule;
}

function isStorageModuleRequest(request) { return typeof request === 'string' && (request === './storage' || request === '../storage' || request.endsWith('/storage') || request.endsWith('storage.js')); }
function installStorageGuard(storageModule) {
  if (!storageModule || storageModule.__rodaStorageGuardPatched) return storageModule;
  const touch = () => { global.__rodaLastStorageWriteAt = Date.now(); };
  if (typeof storageModule.loadData === 'function') {
    const originalLoadData = storageModule.loadData;
    storageModule.loadData = function guardedLoadData(...args) { return normalizeAdminDashboardData(originalLoadData.apply(this, args)); };
  }
  if (typeof storageModule.saveData === 'function') {
    const originalSaveData = storageModule.saveData;
    storageModule.saveData = function guardedSaveData(data, ...args) {
      const result = originalSaveData.call(this, normalizeAdminDashboardData(data), ...args);
      touch();
      return result;
    };
  }
  if (typeof storageModule.markTeamMatchState === 'function') {
    const originalMarkTeamMatchState = storageModule.markTeamMatchState;
    storageModule.markTeamMatchState = function guardedMarkTeamMatchState(data, teams, matchNumber, teamName, status, payload = {}, ...args) {
      const cleanMatch = sanitizePositiveMatch(matchNumber, data?.currentMatch || 1);
      const cleanPayload = payload && typeof payload === 'object' ? { ...payload } : {};
      const kills = Array.isArray(cleanPayload.kills) ? cleanPayload.kills.map(v => Number(v || 0)) : [];
      const totalKills = kills.length ? kills.reduce((sum, v) => sum + (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0), 0) : Number(cleanPayload.totalKills || 0);
      const placement = Number(cleanPayload.placement || cleanPayload.pos || 0);
      cleanPayload.matchNumber = cleanMatch;
      cleanPayload.totalKills = Number.isFinite(totalKills) && totalKills > 0 ? Math.floor(totalKills) : 0;
      cleanPayload.placement = Number.isFinite(placement) && placement > 0 ? Math.floor(placement) : 0;
      if (status === 'approvato' || status === 'inserito_manualmente') cleanPayload.points = calcFixedPoints(cleanPayload.placement, cleanPayload.totalKills);
      if (status === 'assente') cleanPayload.points = 0;
      const result = originalMarkTeamMatchState.call(this, data, teams, cleanMatch, teamName, status, cleanPayload, ...args);
      normalizeAdminDashboardData(data);
      return result;
    };
  }
  for (const functionName of ['saveTeams', 'saveAll', 'appendAuditLog', 'createTournamentArchive']) {
    if (typeof storageModule[functionName] !== 'function') continue;
    const original = storageModule[functionName];
    storageModule[functionName] = function markedStorageWrite(...args) { const result = original.apply(this, args); touch(); return result; };
  }
  Object.defineProperty(storageModule, '__rodaStorageGuardPatched', { value: true, enumerable: false });
  console.log('✅ Guard storage admin/match attivo.');
  return storageModule;
}

function isDiscordModuleRequest(request) { return request === 'discord.js'; }
function installDiscordInteractionGuard(discordModule) {
  if (!discordModule || discordModule.__rodaInteractionGuardPatched) return discordModule;
  const Client = discordModule.Client;
  if (!Client || !Client.prototype || Client.prototype.__rodaInteractionGuardPatched) return discordModule;
  const originalEmit = Client.prototype.emit;
  Client.prototype.emit = function guardedDiscordEmit(eventName, ...args) {
    if (eventName === 'interactionCreate') {
      const interaction = args[0];
      try {
        if (interaction && typeof interaction.isButton === 'function' && interaction.isButton() && /^(ok|no)_/.test(String(interaction.customId || ''))) {
          const lifecycle = require('./bot/lifecycle');
          if (typeof lifecycle.refreshStateFromDisk === 'function') lifecycle.refreshStateFromDisk();
          const originalUpdate = interaction.update?.bind(interaction);
          const originalEditReply = interaction.editReply?.bind(interaction);
          if (!interaction.deferred && !interaction.replied && typeof interaction.deferUpdate === 'function') interaction.deferUpdate().catch(error => console.error('[startup-guard] defer bottone staff fallito:', error.message));
          if (typeof originalEditReply === 'function') {
            interaction.update = function safeUpdateAfterDefer(payload) {
              if (interaction.deferred || interaction.replied) return originalEditReply(payload);
              if (typeof originalUpdate === 'function') return originalUpdate(payload);
              return Promise.resolve(null);
            };
          }
        }
      } catch (error) { console.error('[startup-guard] Errore guard interazione staff:', error.message); }
    }
    return originalEmit.call(this, eventName, ...args);
  };
  Object.defineProperty(Client.prototype, '__rodaInteractionGuardPatched', { value: true, enumerable: false });
  Object.defineProperty(discordModule, '__rodaInteractionGuardPatched', { value: true, enumerable: false });
  console.log('✅ Guard bottoni staff Discord attivo.');
  return discordModule;
}

try {
  const expressPath = require.resolve('express');
  const originalLoad = Module._load;
  Module._load = function guardedLoad(request, parent, isMain) {
    const loaded = originalLoad.apply(this, arguments);
    if (request === 'express') return installExpressRouteGuard(loaded);
    if (isDiscordModuleRequest(request)) return installDiscordInteractionGuard(loaded);
    if (isHelpersModuleRequest(request)) return installFixedPointsGuard(loaded);
    if (isPanelsModuleRequest(request)) return installLeaderboardSyncGuard(loaded);
    if (isSubmissionsModuleRequest(request)) return installSubmissionGuard(loaded);
    if (isStorageModuleRequest(request)) return installStorageGuard(loaded);
    return loaded;
  };
  if (require.cache[expressPath]?.exports) require.cache[expressPath].exports = installExpressRouteGuard(require.cache[expressPath].exports);
} catch (error) {
  console.error('[startup-guard] Impossibile installare guard Express/sync:', error.message);
}
