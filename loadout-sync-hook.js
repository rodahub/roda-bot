'use strict';

/**
 * RØDA Loadout CODMunity sync hook.
 *
 * Railway non espone una shell nel piano/servizio attuale, quindi questo hook
 * registra endpoint HTTP per avviare lo script `npm run sync:loadout-db`
 * direttamente dal browser o dal pannello admin.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, 'data');
const STATUS_FILE = path.join(DATA_DIR, 'loadout-manual-sync-status.json');

let runningProcess = null;
let currentStatus = readStatus() || {
  running: false,
  startedAt: null,
  finishedAt: null,
  exitCode: null,
  ok: false,
  lastLines: [],
  error: ''
};

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readStatus() {
  try {
    if (!fs.existsSync(STATUS_FILE)) return null;
    return JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
  } catch (_) {
    return null;
  }
}

function saveStatus() {
  try {
    ensureDataDir();
    fs.writeFileSync(STATUS_FILE, JSON.stringify(currentStatus, null, 2), 'utf8');
  } catch (error) {
    console.error('[loadout-sync] Impossibile salvare status:', error.message);
  }
}

function pushLine(line) {
  const text = String(line || '').trim();
  if (!text) return;
  currentStatus.lastLines = currentStatus.lastLines || [];
  currentStatus.lastLines.push(text);
  currentStatus.lastLines = currentStatus.lastLines.slice(-80);
  saveStatus();
}

function checkSecret(req, res) {
  const secret = process.env.LOADOUT_SYNC_SECRET;
  if (!secret) return true;

  const provided = String(req.query.secret || req.headers['x-loadout-sync-secret'] || '');
  if (provided === secret) return true;

  res.status(401).json({
    ok: false,
    message: 'Secret sync mancante o non valido.'
  });
  return false;
}

function startSync() {
  if (runningProcess) {
    return { started: false, alreadyRunning: true, status: currentStatus };
  }

  currentStatus = {
    running: true,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    exitCode: null,
    ok: false,
    lastLines: ['Avvio sync CODMunity...'],
    error: ''
  };
  saveStatus();

  runningProcess = spawn('npm', ['run', 'sync:loadout-db'], {
    cwd: ROOT_DIR,
    env: process.env,
    shell: false
  });

  runningProcess.stdout.on('data', chunk => {
    String(chunk).split(/\r?\n/).forEach(pushLine);
  });

  runningProcess.stderr.on('data', chunk => {
    String(chunk).split(/\r?\n/).forEach(line => pushLine('[ERR] ' + line));
  });

  runningProcess.on('error', error => {
    currentStatus.running = false;
    currentStatus.finishedAt = new Date().toISOString();
    currentStatus.exitCode = -1;
    currentStatus.ok = false;
    currentStatus.error = error.message;
    pushLine('[ERRORE PROCESSO] ' + error.message);
    saveStatus();
    runningProcess = null;
  });

  runningProcess.on('close', code => {
    currentStatus.running = false;
    currentStatus.finishedAt = new Date().toISOString();
    currentStatus.exitCode = code;
    currentStatus.ok = code === 0;
    pushLine(code === 0 ? 'Sync CODMunity completato.' : `Sync CODMunity terminato con codice ${code}.`);
    saveStatus();
    runningProcess = null;
  });

  return { started: true, alreadyRunning: false, status: currentStatus };
}

function registerSyncRoutes(app) {
  if (!app || typeof app.get !== 'function') return;
  if (app.__rodaLoadoutSyncHookRegistered) return;

  Object.defineProperty(app, '__rodaLoadoutSyncHookRegistered', {
    value: true,
    enumerable: false
  });

  app.get('/api/admin/loadout/run-sync', (req, res) => {
    if (!checkSecret(req, res)) return;
    const result = startSync();
    res.json({
      ok: true,
      message: result.alreadyRunning ? 'Sync già in corso.' : 'Sync CODMunity avviato.',
      ...result
    });
  });

  app.post('/api/admin/loadout/run-sync', (req, res) => {
    if (!checkSecret(req, res)) return;
    const result = startSync();
    res.json({
      ok: true,
      message: result.alreadyRunning ? 'Sync già in corso.' : 'Sync CODMunity avviato.',
      ...result
    });
  });

  app.get('/api/admin/loadout/sync-status', (req, res) => {
    if (!checkSecret(req, res)) return;
    res.json({ ok: true, status: currentStatus });
  });

  console.log('✅ Endpoint sync CODMunity Loadout registrati.');
}

function installExpressHook() {
  try {
    const express = require('express');
    const proto = express && express.application;
    if (!proto || proto.__rodaLoadoutSyncHookPatched) return;

    const originalListen = proto.listen;
    if (typeof originalListen !== 'function') return;

    Object.defineProperty(proto, '__rodaLoadoutSyncHookPatched', {
      value: true,
      enumerable: false
    });

    proto.listen = function patchedSyncListen(...args) {
      try {
        registerSyncRoutes(this);
      } catch (error) {
        console.error('[loadout-sync] Registrazione endpoint fallita:', error.message);
      }
      return originalListen.apply(this, args);
    };
  } catch (error) {
    console.error('[loadout-sync] Hook Express non installato:', error.message);
  }
}

installExpressHook();

module.exports = {
  registerSyncRoutes,
  startSync,
  readStatus
};
