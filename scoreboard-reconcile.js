'use strict';

/**
 * Rebuilds global team leaderboard and top fragger from real approved/manual
 * match results. This fixes corrupted totals caused by old scoring bugs.
 */

const Module = require('module');

const FINAL_STATUSES = new Set(['approvato', 'inserito_manualmente']);
const FIXED_POINTS = Object.freeze({
  1: 10,
  2: 6,
  3: 5,
  4: 4,
  5: 3,
  6: 2,
  7: 1,
  8: 1
});

function clean(value) {
  return String(value || '').trim();
}

function safeInt(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? Math.max(0, Math.floor(num)) : fallback;
}

function calcPoints(placement, kills) {
  const safePlacement = safeInt(placement, 0);
  const safeKills = safeInt(kills, 0);
  return safeKills + Number(FIXED_POINTS[safePlacement] || 0);
}

function getTeamPlayers(teams, teamName) {
  const players = teams && teams[teamName] && Array.isArray(teams[teamName].players) ? teams[teamName].players : [];
  return [0, 1, 2].map(index => clean(players[index]) || `Giocatore ${index + 1}`);
}

function normalizeKills(teamState) {
  const rawKills = Array.isArray(teamState?.kills) ? teamState.kills : [];
  return [0, 1, 2].map(index => safeInt(rawKills[index], 0));
}

function rebuildScoreboardFromMatches(data, teams = {}) {
  if (!data || typeof data !== 'object' || !data.matches || typeof data.matches !== 'object') {
    return { changed: false, reason: 'no_matches' };
  }

  const scores = {};
  const fragger = {};
  let approvedRows = 0;
  let fraggerRows = 0;

  const matchEntries = Object.entries(data.matches)
    .sort((a, b) => Number(a[0]) - Number(b[0]));

  for (const [matchKey, match] of matchEntries) {
    if (!match || typeof match !== 'object' || !match.teams || typeof match.teams !== 'object') continue;
    const matchNumber = safeInt(match.matchNumber || matchKey, 1) || 1;

    for (const [rawTeamName, teamState] of Object.entries(match.teams)) {
      if (!teamState || typeof teamState !== 'object') continue;
      const status = clean(teamState.status);
      if (!FINAL_STATUSES.has(status)) continue;

      const teamName = clean(teamState.team || rawTeamName);
      if (!teamName) continue;

      const kills = normalizeKills(teamState);
      const killsSum = kills.reduce((sum, value) => sum + value, 0);
      const totalKills = killsSum > 0 ? killsSum : safeInt(teamState.totalKills || teamState.total || 0, 0);
      const placement = safeInt(teamState.placement || teamState.pos || 0, 0);
      const points = calcPoints(placement, totalKills);

      scores[teamName] = safeInt(scores[teamName], 0) + points;
      approvedRows += 1;

      teamState.team = teamName;
      teamState.matchNumber = matchNumber;
      teamState.kills = kills;
      teamState.totalKills = totalKills;
      teamState.placement = placement;
      teamState.points = points;

      const players = Array.isArray(teamState.playerNames) && teamState.playerNames.length >= 3
        ? [0, 1, 2].map(index => clean(teamState.playerNames[index]) || `Giocatore ${index + 1}`)
        : getTeamPlayers(teams, teamName);

      teamState.playerNames = players;

      kills.forEach((kill, index) => {
        const playerName = clean(players[index]) || `Giocatore ${index + 1}`;
        fragger[playerName] = safeInt(fragger[playerName], 0) + safeInt(kill, 0);
        fraggerRows += 1;
      });
    }
  }

  if (!approvedRows) {
    return { changed: false, reason: 'no_approved_results' };
  }

  const oldScores = JSON.stringify(data.scores || {});
  const oldFragger = JSON.stringify(data.fragger || {});
  const newScores = JSON.stringify(scores);
  const newFragger = JSON.stringify(fragger);

  data.scores = scores;
  data.fragger = fragger;
  data.lastScoreboardReconcileAt = new Date().toISOString();
  data.lastScoreboardReconcileRows = approvedRows;

  const changed = oldScores !== newScores || oldFragger !== newFragger;
  return { changed, approvedRows, fraggerRows, scoresCount: Object.keys(scores).length, fraggerCount: Object.keys(fragger).length };
}

function isStorageModuleRequest(request) {
  return typeof request === 'string' && (
    request === './storage' ||
    request === '../storage' ||
    request.endsWith('/storage') ||
    request.endsWith('storage.js')
  );
}

function installStorageReconcile(storageModule) {
  if (!storageModule || storageModule.__rodaScoreboardReconcilePatched) return storageModule;

  const getTeams = () => {
    try {
      return typeof storageModule.loadTeams === 'function' ? storageModule.loadTeams() : {};
    } catch {
      return {};
    }
  };

  if (typeof storageModule.loadData === 'function') {
    const originalLoadData = storageModule.loadData;
    storageModule.loadData = function reconciledLoadData(...args) {
      const data = originalLoadData.apply(this, args);
      const result = rebuildScoreboardFromMatches(data, getTeams());
      if (result.changed) {
        console.log(`[ricalcolo] classifica ricostruita da ${result.approvedRows} risultati approvati/manuali.`);
        if (typeof storageModule.saveData === 'function') {
          try { storageModule.saveData(data); } catch (error) { console.error('[ricalcolo] salvataggio dati ricalcolati fallito:', error.message); }
        }
      }
      return data;
    };
  }

  if (typeof storageModule.saveData === 'function') {
    const originalSaveData = storageModule.saveData;
    storageModule.saveData = function reconciledSaveData(data, ...args) {
      const result = rebuildScoreboardFromMatches(data, getTeams());
      if (result.changed) {
        console.log(`[ricalcolo] totals corretti prima del salvataggio: ${result.approvedRows} risultati, ${result.scoresCount} team, ${result.fraggerCount} player.`);
      }
      return originalSaveData.call(this, data, ...args);
    };
  }

  Object.defineProperty(storageModule, '__rodaScoreboardReconcilePatched', { value: true, enumerable: false });
  console.log('✅ Ricalcolo automatico classifica/fragger da match approvati attivo.');
  return storageModule;
}

function install() {
  if (global.__rodaScoreboardReconcileInstalled) return;
  global.__rodaScoreboardReconcileInstalled = true;

  const originalLoad = Module._load;
  Module._load = function scoreboardReconcileLoad(request, parent, isMain) {
    const loaded = originalLoad.apply(this, arguments);
    if (isStorageModuleRequest(request)) return installStorageReconcile(loaded);
    return loaded;
  };

  console.log('✅ Hook ricalcolo classifica/fragger installato.');
}

install();

module.exports = {
  rebuildScoreboardFromMatches,
  install
};
