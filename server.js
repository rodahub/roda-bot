const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

let helmet = null;
let rateLimit = null;

try {
  helmet = require('helmet');
} catch {
  helmet = null;
}

try {
  rateLimit = require('express-rate-limit');
} catch {
  rateLimit = null;
}

const {
  initializeFiles,

  loadData,
  loadTeams,
  loadAuditLog,

  saveData,
  saveTeams,

  appendAuditLog,

  createTournamentArchive,
  listTournamentArchives,
  getTournamentArchive,

  archiveAndCreateFreshTournament,

  openRegistrations,
  closeRegistrations,
  startTournament,
  finishTournament,

  ensureMatchForTeams,
  getMatchCompletion,
  markTeamMatchState,
  forceCompleteCurrentMatch,
  advanceToNextMatch,

  isFinalTeamMatchStatus,
  buildSubmissionKey,

  getDefaultData,
  getDefaultProjectSettings,
  getDefaultTournamentMessages,
  getDefaultAutomaticReminders,
  REMINDER_TYPES,
  REMINDER_INTERVAL_OPTIONS,
  setReminderMasterEnabled,
  updateAutomaticReminders,
  resetReminderToDefault,
  getDefaultBotSettings,

  FIXED_TOURNAMENT_NAME,
  MAX_TEAMS,
  PLAYERS_PER_TEAM,
  TOURNAMENT_STATES,
  MATCH_STATES,
  TEAM_MATCH_STATES,

  STORAGE_DIR,
  UPLOADS_DIR,

  getReports,
  markReportReviewed,
  deleteReport
} = require('./storage');

initializeFiles();

const bot = require('./index');

const app = express();

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');

const DASHBOARD_EMAIL = process.env.DASHBOARD_EMAIL || '';
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || '';
const DASHBOARD_COOKIE_SECRET =
  process.env.SESSION_SECRET ||
  process.env.DASHBOARD_COOKIE_SECRET ||
  crypto.randomBytes(64).toString('hex');

if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET && !process.env.DASHBOARD_COOKIE_SECRET) {
  console.warn('⚠️ ATTENZIONE: SESSION_SECRET non impostato. Le sessioni cambieranno a ogni riavvio.');
}

if (!helmet) {
  console.warn('⚠️ helmet non installato: uso protezioni manuali base.');
}

if (!rateLimit) {
  console.warn('⚠️ express-rate-limit non installato: rate limit disattivato.');
}

const COOKIE_NAME = 'staff_auth';
const COOKIE_DURATION_MS = 1000 * 60 * 60 * 12;

const ADMIN_USERS_FILE = path.join(STORAGE_DIR, 'admin-users.json');

const OWNER_USERNAME = 'RooS';
const OWNER_INITIAL_PASSWORD = process.env.ADMIN_PASSWORD || '';

if (!process.env.ADMIN_PASSWORD) {
  console.warn('⚠️ ATTENZIONE: ADMIN_PASSWORD non impostato. Imposta la variabile ambiente ADMIN_PASSWORD per creare l\'utente RooS con una password sicura.');
}

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

app.disable('x-powered-by');
app.set('trust proxy', 1);

if (helmet) {
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
  }));
}

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

function createLimiter(options) {
  if (!rateLimit) {
    return (req, res, next) => next();
  }

  return rateLimit(options);
}

const generalLimiter = createLimiter({
  windowMs: 60 * 1000,
  limit: 180,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    message: 'Troppe richieste. Riprova tra poco.'
  }
});

const loginLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    message: 'Troppi tentativi di login. Riprova tra 15 minuti.'
  }
});

const publicRegisterLimiter = createLimiter({
  windowMs: 10 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    message: 'Troppe registrazioni da questo indirizzo. Riprova tra poco.'
  }
});

app.use(generalLimiter);

app.use(express.json({ limit: '8mb' }));
app.use(express.urlencoded({ extended: true, limit: '8mb' }));

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeText(value) {
  return String(value || '').trim();
}

function sanitizeOptionalText(value, maxLength = 200) {
  return String(value || '').trim().slice(0, maxLength);
}

function sanitizePositiveInteger(value, fallback = 1, max = 9999) {
  const num = Number(value);

  if (!Number.isInteger(num) || num <= 0) {
    return fallback;
  }

  return Math.min(num, max);
}

function sanitizeBoolean(value) {
  return value === true || value === 'true' || value === 1 || value === '1' || value === 'on';
}

function isSafeSameOrigin(req) {
  const origin = req.headers.origin;
  const referer = req.headers.referer;
  const host = req.headers['x-forwarded-host'] || req.headers.host;

  if (!origin && !referer) return true;
  if (!host) return false;

  try {
    if (origin) {
      const originUrl = new URL(origin);
      return originUrl.host === host;
    }

    if (referer) {
      const refererUrl = new URL(referer);
      return refererUrl.host === host;
    }

    return true;
  } catch {
    return false;
  }
}

function csrfLiteProtection(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  if (!req.originalUrl.startsWith('/api/')) {
    return next();
  }

  if (req.originalUrl.startsWith('/api/public/')) {
    return next();
  }

  if (!isSafeSameOrigin(req)) {
    return res.status(403).json({
      ok: false,
      message: 'Richiesta bloccata per sicurezza.'
    });
  }

  return next();
}

function noStore(req, res, next) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  return next();
}

app.use(csrfLiteProtection);

app.use('/admin', noStore);
app.use('/api/dashboard', noStore);
app.use('/api/admin-users', noStore);

function normalizeBaseUrl(value) {
  const clean = String(value || '').trim();

  if (!clean) {
    return '';
  }

  return clean.endsWith('/') ? clean.slice(0, -1) : clean;
}

function getPublicBaseUrl(req) {
  const explicit = normalizeBaseUrl(process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL);

  if (explicit) {
    return explicit;
  }

  const railwayDomain = sanitizeText(process.env.RAILWAY_PUBLIC_DOMAIN);

  if (railwayDomain) {
    return `https://${railwayDomain}`;
  }

  if (req) {
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
    const host = req.headers['x-forwarded-host'] || req.get('host');

    if (host) {
      return `${protocol}://${host}`;
    }
  }

  return '';
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto
    .pbkdf2Sync(String(password || ''), salt, 120000, 64, 'sha512')
    .toString('hex');

  return {
    salt,
    hash
  };
}

function verifyPassword(password, passwordData) {
  if (!passwordData || !passwordData.salt || !passwordData.hash) {
    return false;
  }

  const attempt = hashPassword(password, passwordData.salt).hash;

  try {
    return crypto.timingSafeEqual(Buffer.from(attempt, 'hex'), Buffer.from(passwordData.hash, 'hex'));
  } catch {
    return false;
  }
}

function createAdminUser({ username, password, role = 'staff', createdBy = 'system', locked = false }) {
  const cleanUsername = sanitizeOptionalText(username, 40);
  const cleanRole = ['proprietario', 'admin', 'staff'].includes(role) ? role : 'staff';

  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    username: cleanUsername,
    role: cleanRole,
    active: true,
    locked: Boolean(locked),
    password: hashPassword(password),
    createdAt: new Date().toISOString(),
    createdBy: sanitizeText(createdBy || 'system'),
    updatedAt: new Date().toISOString(),
    updatedBy: sanitizeText(createdBy || 'system'),
    lastLoginAt: null
  };
}

function normalizeAdminUsers(value) {
  const list = Array.isArray(value) ? value : [];
  const out = [];
  const used = new Set();

  for (const entry of list) {
    if (!isObject(entry)) continue;

    const username = sanitizeOptionalText(entry.username, 40);
    if (!username) continue;

    const key = username.toLowerCase();
    if (used.has(key)) continue;
    used.add(key);

    const role = ['proprietario', 'admin', 'staff'].includes(entry.role) ? entry.role : 'staff';

    out.push({
      id: sanitizeText(entry.id) || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      username,
      role,
      active: entry.active !== false,
      locked: Boolean(entry.locked),
      password: isObject(entry.password) ? entry.password : { salt: '', hash: '' },
      createdAt: sanitizeText(entry.createdAt) || new Date().toISOString(),
      createdBy: sanitizeText(entry.createdBy) || 'system',
      updatedAt: sanitizeText(entry.updatedAt) || new Date().toISOString(),
      updatedBy: sanitizeText(entry.updatedBy) || 'system',
      lastLoginAt: entry.lastLoginAt || null
    });
  }

  const hasOwner = out.some(user => user.username.toLowerCase() === OWNER_USERNAME.toLowerCase());

  if (!hasOwner && OWNER_INITIAL_PASSWORD) {
    out.unshift(createAdminUser({
      username: OWNER_USERNAME,
      password: OWNER_INITIAL_PASSWORD,
      role: 'proprietario',
      createdBy: 'system',
      locked: true
    }));
  } else if (!hasOwner && !OWNER_INITIAL_PASSWORD) {
    console.warn('⚠️ ATTENZIONE: Utente RooS non trovato e ADMIN_PASSWORD non impostato. Imposta ADMIN_PASSWORD per creare l\'account proprietario.');
  }

  return out;
}

function readAdminUsersFile() {
  try {
    if (!fs.existsSync(ADMIN_USERS_FILE)) {
      return null;
    }

    const raw = fs.readFileSync(ADMIN_USERS_FILE, 'utf8');

    if (!raw.trim()) {
      return null;
    }

    return JSON.parse(raw);
  } catch (error) {
    console.error('Errore lettura admin-users.json:', error.message);
    return null;
  }
}

function writeAdminUsersFile(users) {
  ensureDir(path.dirname(ADMIN_USERS_FILE));

  const safe = normalizeAdminUsers(users);
  const tmp = `${ADMIN_USERS_FILE}.tmp`;

  fs.writeFileSync(tmp, JSON.stringify(safe, null, 2), 'utf8');
  fs.renameSync(tmp, ADMIN_USERS_FILE);

  return safe;
}

function loadAdminUsers() {
  const existing = readAdminUsersFile();
  const safe = normalizeAdminUsers(existing || []);

  writeAdminUsersFile(safe);

  return safe;
}

function saveAdminUsers(users) {
  return writeAdminUsersFile(users);
}

function publicAdminUser(user) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    active: Boolean(user.active),
    locked: Boolean(user.locked),
    createdAt: user.createdAt,
    createdBy: user.createdBy,
    updatedAt: user.updatedAt,
    updatedBy: user.updatedBy,
    lastLoginAt: user.lastLoginAt || null
  };
}

function getUserPermissions(role) {
  if (role === 'proprietario') {
    return {
      manageUsers: true,
      manageTournament: true,
      manageDiscord: true,
      manageResults: true,
      manageTeams: true,
      manageArchive: true,
      manageSystem: true
    };
  }

  if (role === 'admin') {
    return {
      manageUsers: false,
      manageTournament: true,
      manageDiscord: true,
      manageResults: true,
      manageTeams: true,
      manageArchive: true,
      manageSystem: false
    };
  }

  return {
    manageUsers: false,
    manageTournament: false,
    manageDiscord: false,
    manageResults: true,
    manageTeams: true,
    manageArchive: false,
    manageSystem: false
  };
}

function findAdminUserByUsername(username) {
  const users = loadAdminUsers();
  const clean = sanitizeText(username).toLowerCase();

  return users.find(user => user.username.toLowerCase() === clean) || null;
}

function updateAdminUserRecord(username, updater) {
  const users = loadAdminUsers();
  const index = users.findIndex(user => user.username.toLowerCase() === sanitizeText(username).toLowerCase());

  if (index === -1) {
    return null;
  }

  const updated = updater(users[index], users);

  if (!updated) {
    return null;
  }

  users[index] = updated;
  saveAdminUsers(users);

  return updated;
}

function parseCookies(cookieHeader) {
  const out = {};

  if (!cookieHeader) {
    return out;
  }

  const parts = cookieHeader.split(';');

  for (const part of parts) {
    const index = part.indexOf('=');

    if (index === -1) {
      continue;
    }

    const key = part.slice(0, index).trim();
    const value = decodeURIComponent(part.slice(index + 1).trim());

    out[key] = value;
  }

  return out;
}

function sign(value) {
  return crypto
    .createHmac('sha256', DASHBOARD_COOKIE_SECRET)
    .update(value)
    .digest('hex');
}

function toBase64Url(str) {
  return Buffer.from(str)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function fromBase64Url(str) {
  let value = str.replace(/-/g, '+').replace(/_/g, '/');

  while (value.length % 4) {
    value += '=';
  }

  return Buffer.from(value, 'base64').toString('utf8');
}

function createToken(user) {
  const payload = {
    username: user.username,
    email: user.username,
    role: user.role,
    exp: Date.now() + COOKIE_DURATION_MS
  };

  const encoded = toBase64Url(JSON.stringify(payload));
  const signature = sign(encoded);

  return `${encoded}.${signature}`;
}

function verifyToken(token) {
  try {
    if (!token || typeof token !== 'string') {
      return null;
    }

    const parts = token.split('.');

    if (parts.length !== 2) {
      return null;
    }

    const encoded = parts[0];
    const signature = parts[1];

    if (sign(encoded) !== signature) {
      return null;
    }

    const payload = JSON.parse(fromBase64Url(encoded));

    if (!payload.username || !payload.exp) {
      return null;
    }

    if (Date.now() > payload.exp) {
      return null;
    }

    const user = findAdminUserByUsername(payload.username);

    if (!user || user.active === false) {
      return null;
    }

    return {
      username: user.username,
      email: user.username,
      role: user.role,
      permissions: getUserPermissions(user.role),
      exp: payload.exp
    };
  } catch {
    return null;
  }
}

function buildCookie(token) {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(COOKIE_DURATION_MS / 1000)}`
  ];

  if (process.env.NODE_ENV === 'production') {
    parts.push('Secure');
  }

  return parts.join('; ');
}

function clearCookie() {
  const parts = [
    `${COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0'
  ];

  if (process.env.NODE_ENV === 'production') {
    parts.push('Secure');
  }

  return parts.join('; ');
}

function authRequired(req, res, next) {
  const cookies = parseCookies(req.headers.cookie || '');
  const token = cookies[COOKIE_NAME];
  const session = verifyToken(token);

  if (!session) {
    if (req.originalUrl.startsWith('/api/')) {
      return res.status(401).json({
        ok: false,
        message: 'Accesso non autorizzato'
      });
    }

    return res.redirect('/login');
  }

  req.staffUser = session.username;
  req.staffRole = session.role;
  req.staffPermissions = session.permissions;
  req.staffSession = session;

  return next();
}

function requireOwner(req, res, next) {
  if (req.staffRole !== 'proprietario') {
    return res.status(403).json({
      ok: false,
      message: 'Solo il proprietario può gestire gli account staff.'
    });
  }

  return next();
}

function requireAdmin(req, res, next) {
  if (!['proprietario', 'admin'].includes(req.staffRole)) {
    return res.status(403).json({
      ok: false,
      message: 'Permesso insufficiente.'
    });
  }

  return next();
}

function logAudit(actor, source, action, details = {}) {
  try {
    appendAuditLog({
      actor: sanitizeText(actor) || 'system',
      source: sanitizeText(source) || 'system',
      action: sanitizeText(action) || 'unknown',
      details: details && typeof details === 'object' ? details : {}
    });
  } catch (error) {
    console.error('Errore audit log server:', error);
  }
}

function syncBotState(data = null, teams = null) {
  try {
    const safeData = data || loadData();
    const safeTeams = teams || loadTeams();

    if (typeof bot.setDataState === 'function') {
      bot.setDataState(safeData);
    }

    if (typeof bot.setTeamsState === 'function') {
      bot.setTeamsState(safeTeams);
    }
  } catch (error) {
    console.error('Errore sync bot state:', error);
  }
}

async function safeBotCall(functionName, ...args) {
  try {
    if (typeof bot[functionName] !== 'function') {
      return {
        ok: false,
        skipped: true,
        message: `Funzione bot non ancora disponibile: ${functionName}`
      };
    }

    return await bot[functionName](...args);
  } catch (error) {
    console.error(`Errore bot.${functionName}:`, error);

    return {
      ok: false,
      error: true,
      message: error.message || `Errore funzione bot: ${functionName}`
    };
  }
}

function replaceMessagePlaceholders(message, values = {}) {
  let out = String(message || '');

  for (const [key, value] of Object.entries(values)) {
    out = out.replaceAll(`{${key}}`, String(value));
  }

  return out;
}

async function sendGeneralAnnouncementFromData(data, messageKey, values = {}) {
  const safeData = data || loadData();
  const settings = safeData.botSettings || {};
  const messages = safeData.tournamentMessages || getDefaultTournamentMessages();
  const generalChannelId = sanitizeText(settings.generalChannelId || '');

  const rawMessage = messages[messageKey] || '';
  const message = replaceMessagePlaceholders(rawMessage, values);

  if (!generalChannelId || !message) {
    return {
      ok: false,
      skipped: true,
      message: 'Canale generale o messaggio non configurato'
    };
  }

  if (typeof bot.sendGeneralAnnouncement === 'function') {
    return await safeBotCall('sendGeneralAnnouncement', generalChannelId, message);
  }

  if (typeof bot.sendMessageToChannel === 'function') {
    return await safeBotCall('sendMessageToChannel', generalChannelId, message);
  }

  return {
    ok: false,
    skipped: true,
    message: 'Funzione invio messaggio generale non ancora disponibile nel bot'
  };
}

function loadPointsConfig() {
  const defaultConfig = {
    kill: 1,
    placement: {
      1: 10,
      2: 6,
      3: 5,
      4: 4,
      5: 3,
      6: 2,
      7: 1,
      8: 1
    }
  };

  const possibleFiles = [
    path.join(__dirname, 'points.json'),
    path.join(__dirname, 'points.js')
  ];

  for (const pointsPath of possibleFiles) {
    try {
      if (!fs.existsSync(pointsPath)) continue;

      const raw = fs.readFileSync(pointsPath, 'utf8');
      const parsed = JSON.parse(raw);

      return {
        kill: Number(parsed.kill || 1),
        placement: parsed.placement && typeof parsed.placement === 'object'
          ? parsed.placement
          : defaultConfig.placement
      };
    } catch (error) {
      console.error(`Errore lettura ${pointsPath}:`, error.message);
    }
  }

  return defaultConfig;
}

function calcPoints(pos, kills) {
  const pointsConfig = loadPointsConfig();
  const killPoints = Number(pointsConfig.kill || 1);
  const placementBonus = Number(pointsConfig.placement?.[String(Number(pos))] || 0);

  return Number(kills || 0) * killPoints + placementBonus;
}

function getNextAvailableSlot(teams, maxTeams = MAX_TEAMS) {
  const used = new Set(
    Object.values(teams || {})
      .map(team => Number(team?.slot))
      .filter(slot => Number.isInteger(slot) && slot >= 1)
  );

  for (let i = 1; i <= maxTeams; i++) {
    if (!used.has(i)) {
      return i;
    }
  }

  return null;
}

function sortTeamsWithSlot(teams) {
  return Object.entries(teams || {}).sort((a, b) => {
    const slotA = Number(a[1]?.slot || 999999);
    const slotB = Number(b[1]?.slot || 999999);

    if (slotA !== slotB) return slotA - slotB;

    return a[0].localeCompare(b[0], 'it');
  });
}

function buildLeaderboard(scores) {
  return Object.entries(scores || {})
    .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))
    .map(([team, points], index) => ({
      posizione: index + 1,
      team,
      punti: Number(points || 0)
    }));
}

function buildFraggers(fragger) {
  return Object.entries(fragger || {})
    .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))
    .map(([name, kills], index) => ({
      posizione: index + 1,
      nome: name,
      uccisioni: Number(kills || 0)
    }));
}

function getItalianStatusLabel(status) {
  if (status === TEAM_MATCH_STATES.PENDING) return 'In attesa';
  if (status === TEAM_MATCH_STATES.APPROVED) return 'Approvato';
  if (status === TEAM_MATCH_STATES.REJECTED) return 'Rifiutato';
  if (status === TEAM_MATCH_STATES.ABSENT) return 'Assente';
  if (status === TEAM_MATCH_STATES.MANUAL) return 'Inserito manualmente';
  return 'Non inviato';
}

function normalizeSubmissionTeamName(teamName) {
  return sanitizeText(teamName).toLowerCase();
}

function getPendingForTeamMatch(data, teamName, matchNumber) {
  const safePending = data.pending || {};
  const targetTeam = normalizeSubmissionTeamName(teamName);
  const targetMatch = Number(matchNumber || 1);

  for (const [id, entry] of Object.entries(safePending)) {
    if (
      normalizeSubmissionTeamName(entry?.team) === targetTeam &&
      Number(entry?.matchNumber || 1) === targetMatch
    ) {
      return {
        id,
        ...entry
      };
    }
  }

  return null;
}

function buildMatchTeamRows(data, teams, matchNumber) {
  let safeData = ensureMatchForTeams(data, teams, matchNumber);
  const safeTeams = teams || {};
  const targetMatch = Number(matchNumber || 1);
  const match = safeData.matches?.[String(targetMatch)];

  return sortTeamsWithSlot(safeTeams).map(([teamName, teamData]) => {
    const state = match?.teams?.[teamName] || {};
    const pending = getPendingForTeamMatch(safeData, teamName, targetMatch);

    let status = state.status || TEAM_MATCH_STATES.NOT_SUBMITTED;

    if (pending && status !== TEAM_MATCH_STATES.APPROVED && status !== TEAM_MATCH_STATES.MANUAL && status !== TEAM_MATCH_STATES.ABSENT) {
      status = TEAM_MATCH_STATES.PENDING;
    }

    const result = pending
      ? {
          id: pending.id,
          team: pending.team,
          totaleUccisioni: Number(pending.total || 0),
          posizione: Number(pending.pos || 0),
          uccisioni: Array.isArray(pending.kills) ? pending.kills.map(v => Number(v || 0)) : [],
          immagine: pending.image || '',
          inviatoDa: pending.submittedBy || '',
          matchNumber: Number(pending.matchNumber || targetMatch)
        }
      : state.status && state.status !== TEAM_MATCH_STATES.NOT_SUBMITTED
        ? {
            id: state.pendingId || null,
            team: teamName,
            totaleUccisioni: Number(state.totalKills || 0),
            posizione: Number(state.placement || 0),
            uccisioni: Array.isArray(state.kills) ? state.kills.map(v => Number(v || 0)) : [],
            immagine: state.image || '',
            inviatoDa: state.submittedBy || state.manualBy || state.approvedBy || '',
            matchNumber: targetMatch
          }
        : null;

    return {
      team: teamName,
      slot: teamData?.slot || null,
      players: Array.isArray(teamData?.players) ? teamData.players : [],
      matchNumber: targetMatch,
      stato: status,
      statoTesto: getItalianStatusLabel(status),
      pendingId: pending?.id || state.pendingId || null,
      aggiornatoIl: state.updatedAt || '',
      aggiornatoDa: state.approvedBy || state.manualBy || state.absentBy || state.rejectedBy || '',
      origine: state.source || '',
      kills: Number(state.totalKills || pending?.total || 0),
      placement: Number(state.placement || pending?.pos || 0),
      points: Number(state.points || 0),
      risultato: result
    };
  });
}

function buildMatchOverview(data, teams, matchNumber) {
  const rows = buildMatchTeamRows(data, teams, matchNumber);

  const finalRows = rows.filter(row => isFinalTeamMatchStatus(row.stato));
  const pendingRows = rows.filter(row => row.stato === TEAM_MATCH_STATES.PENDING);
  const approvedRows = rows.filter(row => row.stato === TEAM_MATCH_STATES.APPROVED || row.stato === TEAM_MATCH_STATES.MANUAL);
  const rejectedRows = rows.filter(row => row.stato === TEAM_MATCH_STATES.REJECTED);
  const missingRows = rows.filter(row => row.stato === TEAM_MATCH_STATES.NOT_SUBMITTED || row.stato === TEAM_MATCH_STATES.REJECTED);
  const absentRows = rows.filter(row => row.stato === TEAM_MATCH_STATES.ABSENT);

  return {
    matchNumber: Number(matchNumber || 1),
    totaleTeam: rows.length,
    completato: rows.length > 0 && finalRows.length === rows.length,
    inviati: rows.filter(row => row.stato !== TEAM_MATCH_STATES.NOT_SUBMITTED).length,
    chiusi: finalRows.length,
    inAttesa: pendingRows.length,
    approvati: approvedRows.length,
    rifiutati: rejectedRows.length,
    nonInviati: missingRows.length,
    assenti: absentRows.length,
    righe: rows,
    teamMancanti: missingRows
  };
}

function buildAllMatchOverviews(data, teams) {
  const totalMatches = Math.max(Number(data.tournamentSettings?.totalMatches || 3), Number(data.currentMatch || 1), 1);
  const out = [];

  for (let i = 1; i <= totalMatches; i++) {
    out.push(buildMatchOverview(data, teams, i));
  }

  return out;
}

function buildPending(pending, teams) {
  return Object.entries(pending || {}).map(([id, p]) => ({
    id,
    team: p.team,
    slot: p.slot || teams[p.team]?.slot || null,
    totaleUccisioni: Number(p.total || 0),
    posizione: Number(p.pos || 0),
    uccisioni: Array.isArray(p.kills) ? p.kills.map(v => Number(v || 0)) : [],
    players: teams[p.team]?.players || [],
    immagine: p.image || '',
    inviatoDa: p.submittedBy || '',
    messaggioStaffId: p.staffMessageId || null,
    matchNumber: Number(p.matchNumber || 1),
    stato: TEAM_MATCH_STATES.PENDING,
    statoTesto: 'In attesa'
  }));
}

function buildSetupStatus(data) {
  const projectSettings = data.projectSettings || {};
  const botSettings = data.botSettings || {};

  return {
    completato: Boolean(projectSettings.setupCompleted),
    controlli: {
      nomeBrand: Boolean(projectSettings.brandName),
      nomeTorneo: projectSettings.tournamentName === FIXED_TOURNAMENT_NAME,
      canalePannelloRegistrazione: Boolean(botSettings.registerPanelChannelId),
      categoriaStanze: Boolean(botSettings.roomsCategoryId),
      canaleGenerale: Boolean(botSettings.generalChannelId),
      canaleRegolamento: Boolean(botSettings.rulesChannelId)
    }
  };
}

function saveBase64Image(imageData, req) {
  const match = String(imageData || '').match(/^data:(image\/png|image\/jpeg|image\/jpg|image\/webp);base64,(.+)$/);

  if (!match) {
    throw new Error('Formato immagine non valido');
  }

  const mime = match[1];
  const base64 = match[2];

  const sizeBytes = Buffer.byteLength(base64, 'base64');
  const maxBytes = 5 * 1024 * 1024;

  if (sizeBytes > maxBytes) {
    throw new Error('Immagine troppo grande. Massimo 5MB.');
  }

  const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
  const filePath = path.join(UPLOADS_DIR, fileName);

  const buffer = Buffer.from(base64, 'base64');

  if (!buffer.length) {
    throw new Error('Immagine vuota o non valida.');
  }

  fs.writeFileSync(filePath, buffer);

  const baseUrl = getPublicBaseUrl(req);

  if (!baseUrl) {
    return `/uploads/${fileName}`;
  }

  return `${baseUrl}/uploads/${fileName}`;
}

async function updateLeaderboardAllowCreate(allowCreate = true) {
  const result = await safeBotCall('updateLeaderboard', { allowCreate });

  return result;
}

async function refreshPanelsSoft() {
  await safeBotCall('refreshTeamResultPanels');
  await safeBotCall('updateRegistrationStatusMessage');
}

async function maybeAutoAdvanceMatch(actor = 'system') {
  let data = loadData();
  let teams = loadTeams();

  if (data.tournamentLifecycle?.state !== TOURNAMENT_STATES.RUNNING) {
    return {
      ok: true,
      advanced: false,
      reason: 'torneo_non_in_corso'
    };
  }

  if (data.tournamentSettings?.autoNextMatch === false) {
    return {
      ok: true,
      advanced: false,
      reason: 'auto_disattivo'
    };
  }

  const currentMatch = Number(data.currentMatch || 1);
  const totalMatches = Number(data.tournamentSettings?.totalMatches || 3);
  const completion = getMatchCompletion(data, teams, currentMatch);

  if (!completion.complete) {
    return {
      ok: true,
      advanced: false,
      reason: 'match_non_completo',
      completion
    };
  }

  const advance = advanceToNextMatch(data, teams, actor, {
    autoAdvanced: true,
    forced: false
  });

  data = advance.data;
  teams = loadTeams();

  syncBotState(data, teams);

  await updateLeaderboardAllowCreate(true);
  await refreshPanelsSoft();

  if (advance.finished) {
    await sendGeneralAnnouncementFromData(data, 'tournamentFinishedAnnouncement', {
      match: currentMatch
    });

    logAudit(actor, 'server', 'torneo_finito_auto', {
      currentMatch,
      totalMatches
    });

    return {
      ok: true,
      advanced: false,
      finished: true
    };
  }

  await sendGeneralAnnouncementFromData(data, 'nextMatchAnnouncement', {
    match: advance.currentMatch,
    nextMatch: advance.nextMatch
  });

  logAudit(actor, 'server', 'match_successivo_automatico', {
    from: advance.currentMatch,
    to: advance.nextMatch
  });

  return {
    ok: true,
    advanced: true,
    from: advance.currentMatch,
    to: advance.nextMatch
  };
}

async function applyManualResult({ req, team, k1, k2, k3, pos, matchNumber }) {
  let data = loadData();
  const teams = loadTeams();

  const teamName = sanitizeText(team);
  const targetMatch = sanitizePositiveInteger(matchNumber, Number(data.currentMatch || 1), 50);

  if (!teamName || !teams[teamName]) {
    throw new Error('Team non trovato');
  }

  if (targetMatch > Number(data.tournamentSettings?.totalMatches || 3)) {
    throw new Error(`Il torneo ha solo ${data.tournamentSettings?.totalMatches || 3} match configurati.`);
  }

  const kills = [
    Number(k1 || 0),
    Number(k2 || 0),
    Number(k3 || 0)
  ];

  if (!kills.every(value => Number.isFinite(value) && value >= 0)) {
    throw new Error('Uccisioni non valide');
  }

  const placement = Number(pos || 0);

  if (!Number.isFinite(placement) || placement <= 0) {
    throw new Error('Posizione non valida');
  }

  const totalKills = kills.reduce((sum, value) => sum + Number(value || 0), 0);
  const addedPoints = calcPoints(placement, totalKills);
  const players = Array.isArray(teams[teamName]?.players) ? teams[teamName].players : [];

  data.scores[teamName] = Number(data.scores[teamName] || 0) + addedPoints;

  kills.forEach((killValue, index) => {
    const playerName = sanitizeText(players[index]) || `Giocatore ${index + 1}`;
    data.fragger[playerName] = Number(data.fragger[playerName] || 0) + Number(killValue || 0);
  });

  data = saveData(data);

  data = markTeamMatchState(data, teams, targetMatch, teamName, {
    status: TEAM_MATCH_STATES.MANUAL,
    kills,
    totalKills,
    placement,
    points: addedPoints,
    source: 'web',
    manualBy: sanitizeText(req.staffUser || 'admin'),
    updatedBy: sanitizeText(req.staffUser || 'admin')
  });

  syncBotState(data, teams);

  await updateLeaderboardAllowCreate(true);
  await refreshPanelsSoft();

  logAudit(req.staffUser, 'web', 'risultato_inserito_manualmente', {
    team: teamName,
    matchNumber: targetMatch,
    kills,
    totalKills,
    pos: placement,
    addedPoints
  });

  const autoAdvance = await maybeAutoAdvanceMatch(req.staffUser);

  return {
    ok: true,
    team: teamName,
    matchNumber: targetMatch,
    kills,
    totalKills,
    pos: placement,
    addedPoints,
    totalScore: data.scores[teamName],
    autoAdvance
  };
}

function buildDashboardPayload(req = null) {
  let data = loadData();
  const teams = loadTeams();

  data = ensureMatchForTeams(data, teams, Number(data.currentMatch || 1));
  data = saveData(data);

  const auditLog = loadAuditLog();
  const archives = listTournamentArchives();

  syncBotState(data, teams);

  const currentMatch = Number(data.currentMatch || 1);
  const statoMatchCorrente = buildMatchOverview(data, teams, currentMatch);

  const session = req?.staffSession || null;
  const isOwner = session?.role === 'proprietario';

  return {
    ok: true,
    session,
    adminUsers: isOwner ? loadAdminUsers().map(publicAdminUser) : [],

    statoTorneo: data.tournamentLifecycle || {},
    impostazioniTorneo: data.tournamentSettings || {},
    messaggiTorneo: data.tournamentMessages || {},

    matchCorrente: currentMatch,

    classificaTeam: buildLeaderboard(data.scores),
    classificaFragger: buildFraggers(data.fragger),

    risultatiInAttesa: buildPending(data.pending, teams),

    teams,
    teamOrdinati: sortTeamsWithSlot(teams).map(([teamName, teamData]) => ({
      team: teamName,
      slot: teamData.slot || null,
      players: teamData.players || []
    })),

    statoMatchCorrente,
    teamMancantiMatchCorrente: statoMatchCorrente.teamMancanti,

    riepilogoMatch: buildAllMatchOverviews(data, teams).map(match => ({
      matchNumber: match.matchNumber,
      totaleTeam: match.totaleTeam,
      completato: match.completato,
      inviati: match.inviati,
      chiusi: match.chiusi,
      inAttesa: match.inAttesa,
      approvati: match.approvati,
      rifiutati: match.rifiutati,
      nonInviati: match.nonInviati,
      assenti: match.assenti
    })),

    botConfig: {
      ...(typeof bot.getBotConfig === 'function' ? bot.getBotConfig() : {}),
      ...(data.botSettings || {})
    },

    impostazioniRegistrazione: {
      titolo: data.registrationStatusTitle || '📋 Slot Team Registrati',
      testo: data.registrationStatusText || '',
      maxTeams: MAX_TEAMS
    },

    impostazioniProgetto: data.projectSettings || getDefaultProjectSettings(),

    statoSetup: buildSetupStatus(data),

    statistiche: {
      totaleTeam: Object.keys(teams).length,
      totalePending: Object.keys(data.pending || {}).length,
      totaleFragger: Object.keys(data.fragger || {}).length,
      teamMancantiMatchCorrente: statoMatchCorrente.teamMancanti.length,
      risultatiInAttesaMatchCorrente: statoMatchCorrente.inAttesa,
      totaleMatch: Number(data.tournamentSettings?.totalMatches || 3),
      statoTorneo: data.tournamentLifecycle?.state || TOURNAMENT_STATES.DRAFT,
      autoNextMatch: data.tournamentSettings?.autoNextMatch !== false
    },

    auditLog: auditLog.slice(-120).reverse(),
    archivi: archives,
    puntiUfficiali: loadPointsConfig()
  };
}

function buildPublicPayload(req) {
  const data = loadData();
  const teams = loadTeams();
  const projectSettings = data.projectSettings || getDefaultProjectSettings();
  const tournamentSettings = data.tournamentSettings || {};

  const teamOrdinati = sortTeamsWithSlot(teams).map(([teamName, teamData]) => ({
    team: teamName,
    slot: teamData.slot || null,
    players: teamData.players || []
  }));

  const lifecycle = data.tournamentLifecycle || {};
  const registrationsOpen = lifecycle.state === TOURNAMENT_STATES.REGISTRATIONS_OPEN;

  return {
    ok: true,
    torneo: {
      brandName: projectSettings.brandName || 'RØDA',
      tournamentName: FIXED_TOURNAMENT_NAME,
      supportContact: projectSettings.supportContact || '',
      premiumMode: Boolean(projectSettings.premiumMode),
      stato: lifecycle.state || TOURNAMENT_STATES.DRAFT,
      matchCorrente: Number(data.currentMatch || 1),
      totalMatches: Number(tournamentSettings.totalMatches || 3),
      playersPerTeam: PLAYERS_PER_TEAM,
      teamRegistrati: Object.keys(teams).length,
      maxTeams: MAX_TEAMS,
      postiDisponibili: Math.max(MAX_TEAMS - Object.keys(teams).length, 0),
      registrazioniAperte: registrationsOpen && Object.keys(teams).length < MAX_TEAMS
    },
    classificaTeam: buildLeaderboard(data.scores),
    classificaFragger: buildFraggers(data.fragger),
    teamRegistrati: teamOrdinati,
    messaggioRegistrazione: {
      titolo: data.registrationStatusTitle || '📋 Slot Team Registrati',
      testo: data.registrationStatusText || ''
    },
    baseUrl: getPublicBaseUrl(req)
  };
}

async function handleDiscordChannelsList(req, res) {
  try {
    const result = await safeBotCall('listDiscordChannels');

    logAudit(req.staffUser, 'web', 'lista_canali_discord_letta', {
      ok: Boolean(result?.ok)
    });

    return res.json({
      ok: true,
      ...result
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message || 'Errore lettura canali Discord'
    });
  }
}

async function handleBotSettingsSave(req, res) {
  try {
    let data = loadData();

    data.botSettings = {
      ...(data.botSettings || getDefaultBotSettings()),
      registerPanelChannelId: sanitizeText(req.body.registerPanelChannelId),
      resultsPanelChannelId: sanitizeText(req.body.resultsPanelChannelId),
      roomsCategoryId: sanitizeText(req.body.roomsCategoryId),
      generalChannelId: sanitizeText(req.body.generalChannelId),
      rulesChannelId: sanitizeText(req.body.rulesChannelId),
      lobbyChannelId: sanitizeText(req.body.lobbyChannelId),
      leaderboardChannelId: sanitizeText(req.body.leaderboardChannelId)
    };

    data = saveData(data);

    syncBotState(data);

    let botSettings = data.botSettings;

    if (typeof bot.saveBotPanelSettings === 'function') {
      botSettings = bot.saveBotPanelSettings(data.botSettings);
    }

    logAudit(req.staffUser, 'web', 'impostazioni_bot_salvate', botSettings);

    return res.json({
      ok: true,
      settings: botSettings
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message || 'Errore salvataggio impostazioni bot'
    });
  }
}

async function handlePrepareDiscordStructure(req, res) {
  try {
    const categoryId = sanitizeText(req.body.categoryId || req.body.roomsCategoryId);
    const result = await safeBotCall('ensureTournamentDiscordStructure', categoryId);

    logAudit(req.staffUser, 'web', 'struttura_discord_preparata', result);

    return res.json({
      ok: true,
      ...result
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message || 'Errore preparazione struttura Discord'
    });
  }
}

loadAdminUsers();

app.get('/', (req, res) => {
  return res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.get('/admin', authRequired, (req, res) => {
  return res.sendFile(path.join(PUBLIC_DIR, 'admin.html'));
});

app.get('/login', (req, res) => {
  const cookies = parseCookies(req.headers.cookie || '');
  const token = cookies[COOKIE_NAME];
  const session = verifyToken(token);

  if (session) {
    return res.redirect('/admin');
  }

  return res.sendFile(path.join(PUBLIC_DIR, 'login.html'));
});

app.use('/uploads', express.static(UPLOADS_DIR, {
  index: false,
  dotfiles: 'deny',
  maxAge: '1h'
}));

app.use(express.static(PUBLIC_DIR, {
  index: false,
  dotfiles: 'deny',
  maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0
}));

app.get('/api/public/dashboard', (req, res) => {
  return res.json(buildPublicPayload(req));
});

app.post('/api/public/register-team', publicRegisterLimiter, async (req, res) => {
  try {
    const data = loadData();
    const teams = loadTeams();
    const lifecycle = data.tournamentLifecycle || {};

    if (lifecycle.state !== TOURNAMENT_STATES.REGISTRATIONS_OPEN) {
      return res.status(400).json({
        ok: false,
        message: 'Le iscrizioni non sono aperte.'
      });
    }

    const teamName = sanitizeOptionalText(req.body.teamName, 50);
    const p1 = sanitizeOptionalText(req.body.p1, 40);
    const p2 = sanitizeOptionalText(req.body.p2, 40);
    const p3 = sanitizeOptionalText(req.body.p3, 40);

    if (!teamName || !p1 || !p2 || !p3) {
      return res.status(400).json({
        ok: false,
        message: 'Compila tutti i campi richiesti.'
      });
    }

    if (teams[teamName]) {
      return res.status(400).json({
        ok: false,
        message: 'Esiste già un team con questo nome.'
      });
    }

    if (Object.keys(teams).length >= MAX_TEAMS) {
      return res.status(400).json({
        ok: false,
        message: 'Le registrazioni sono chiuse: torneo pieno.'
      });
    }

    const slot = getNextAvailableSlot(teams, MAX_TEAMS);

    if (!slot) {
      return res.status(400).json({
        ok: false,
        message: 'Nessuno slot disponibile.'
      });
    }

    teams[teamName] = {
      slot,
      players: [p1, p2, p3]
    };

    const savedTeams = saveTeams(teams);

    syncBotState(data, savedTeams);

    await safeBotCall('handleRegistrationStateChange');
    await safeBotCall('updateRegistrationStatusMessage');

    logAudit(teamName, 'sito_pubblico', 'registrazione_team_pubblica', {
      team: teamName,
      slot,
      players: [p1, p2, p3]
    });

    return res.json({
      ok: true,
      message: `Team registrato correttamente nello slot #${slot}.`,
      slot
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message || 'Errore durante la registrazione del team.'
    });
  }
});

app.post('/api/login', loginLimiter, (req, res) => {
  const username = sanitizeText(req.body.username || req.body.email);
  const password = String(req.body.password || '');

  const user = findAdminUserByUsername(username);

  if (user && user.active !== false && verifyPassword(password, user.password)) {
    updateAdminUserRecord(user.username, current => ({
      ...current,
      lastLoginAt: new Date().toISOString()
    }));

    const freshUser = findAdminUserByUsername(user.username);
    const token = createToken(freshUser);

    res.setHeader('Set-Cookie', buildCookie(token));

    logAudit(freshUser.username, 'web', 'login_riuscito', {
      role: freshUser.role
    });

    return res.json({
      ok: true,
      username: freshUser.username,
      email: freshUser.username,
      role: freshUser.role,
      permissions: getUserPermissions(freshUser.role)
    });
  }

  if (
    process.env.NODE_ENV !== 'production' &&
    DASHBOARD_EMAIL &&
    DASHBOARD_PASSWORD &&
    username === DASHBOARD_EMAIL &&
    password === DASHBOARD_PASSWORD
  ) {
    const legacyUser = createAdminUser({
      username: OWNER_USERNAME,
      password: OWNER_INITIAL_PASSWORD,
      role: 'proprietario',
      createdBy: 'legacy',
      locked: true
    });

    const token = createToken(legacyUser);

    res.setHeader('Set-Cookie', buildCookie(token));

    logAudit(OWNER_USERNAME, 'web', 'login_riuscito_legacy', {
      role: 'proprietario'
    });

    return res.json({
      ok: true,
      username: OWNER_USERNAME,
      email: OWNER_USERNAME,
      role: 'proprietario',
      permissions: getUserPermissions('proprietario')
    });
  }

  logAudit(username || 'unknown', 'web', 'login_fallito', {});

  return res.status(401).json({
    ok: false,
    message: 'Credenziali non valide'
  });
});

app.get('/api/session', (req, res) => {
  const cookies = parseCookies(req.headers.cookie || '');
  const token = cookies[COOKIE_NAME];
  const session = verifyToken(token);

  if (!session) {
    return res.status(401).json({
      ok: false,
      autenticato: false
    });
  }

  return res.json({
    ok: true,
    autenticato: true,
    username: session.username,
    email: session.username,
    role: session.role,
    permissions: session.permissions
  });
});

app.post('/api/logout', (req, res) => {
  const cookies = parseCookies(req.headers.cookie || '');
  const token = cookies[COOKIE_NAME];
  const session = verifyToken(token);

  if (session?.username) {
    logAudit(session.username, 'web', 'logout', {});
  }

  res.setHeader('Set-Cookie', clearCookie());

  return res.json({
    ok: true
  });
});

app.get('/api/admin-users', authRequired, requireOwner, (req, res) => {
  return res.json({
    ok: true,
    users: loadAdminUsers().map(publicAdminUser)
  });
});

app.post('/api/admin-users/create', authRequired, requireOwner, (req, res) => {
  try {
    const username = sanitizeOptionalText(req.body.username, 40);
    const password = String(req.body.password || '');
    const role = sanitizeText(req.body.role || 'staff');

    if (!username) {
      return res.status(400).json({
        ok: false,
        message: 'Nome utente obbligatorio'
      });
    }

    if (username.length < 3) {
      return res.status(400).json({
        ok: false,
        message: 'Il nome utente deve avere almeno 3 caratteri'
      });
    }

    if (!password || password.length < 6) {
      return res.status(400).json({
        ok: false,
        message: 'La password deve avere almeno 6 caratteri'
      });
    }

    if (!['admin', 'staff'].includes(role)) {
      return res.status(400).json({
        ok: false,
        message: 'Ruolo non valido'
      });
    }

    const users = loadAdminUsers();

    if (users.some(user => user.username.toLowerCase() === username.toLowerCase())) {
      return res.status(400).json({
        ok: false,
        message: 'Esiste già un account con questo nome utente'
      });
    }

    const user = createAdminUser({
      username,
      password,
      role,
      createdBy: req.staffUser,
      locked: false
    });

    users.push(user);
    saveAdminUsers(users);

    logAudit(req.staffUser, 'web', 'account_staff_creato', {
      username,
      role
    });

    return res.json({
      ok: true,
      user: publicAdminUser(user),
      users: loadAdminUsers().map(publicAdminUser)
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message || 'Errore creazione account'
    });
  }
});

app.post('/api/admin-users/update', authRequired, requireOwner, (req, res) => {
  try {
    const username = sanitizeText(req.body.username);
    const role = sanitizeText(req.body.role || '');
    const active = sanitizeBoolean(req.body.active);

    if (!username) {
      return res.status(400).json({
        ok: false,
        message: 'Nome utente non valido'
      });
    }

    if (username.toLowerCase() === OWNER_USERNAME.toLowerCase() && role && role !== 'proprietario') {
      return res.status(400).json({
        ok: false,
        message: 'RooS deve restare proprietario'
      });
    }

    const updated = updateAdminUserRecord(username, user => {
      if (user.locked && user.username.toLowerCase() === OWNER_USERNAME.toLowerCase()) {
        return {
          ...user,
          active: true,
          role: 'proprietario',
          updatedAt: new Date().toISOString(),
          updatedBy: req.staffUser
        };
      }

      return {
        ...user,
        role: ['admin', 'staff'].includes(role) ? role : user.role,
        active,
        updatedAt: new Date().toISOString(),
        updatedBy: req.staffUser
      };
    });

    if (!updated) {
      return res.status(404).json({
        ok: false,
        message: 'Account non trovato'
      });
    }

    logAudit(req.staffUser, 'web', 'account_staff_modificato', {
      username: updated.username,
      role: updated.role,
      active: updated.active
    });

    return res.json({
      ok: true,
      user: publicAdminUser(updated),
      users: loadAdminUsers().map(publicAdminUser)
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message || 'Errore modifica account'
    });
  }
});

app.post('/api/admin-users/password', authRequired, requireOwner, (req, res) => {
  try {
    const username = sanitizeText(req.body.username);
    const password = String(req.body.password || '');

    if (!username) {
      return res.status(400).json({
        ok: false,
        message: 'Nome utente non valido'
      });
    }

    if (!password || password.length < 6) {
      return res.status(400).json({
        ok: false,
        message: 'La password deve avere almeno 6 caratteri'
      });
    }

    const updated = updateAdminUserRecord(username, user => ({
      ...user,
      password: hashPassword(password),
      updatedAt: new Date().toISOString(),
      updatedBy: req.staffUser
    }));

    if (!updated) {
      return res.status(404).json({
        ok: false,
        message: 'Account non trovato'
      });
    }

    logAudit(req.staffUser, 'web', 'password_account_staff_modificata', {
      username: updated.username
    });

    return res.json({
      ok: true,
      user: publicAdminUser(updated),
      users: loadAdminUsers().map(publicAdminUser)
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message || 'Errore modifica password'
    });
  }
});

app.post('/api/admin-users/delete', authRequired, requireOwner, (req, res) => {
  try {
    const username = sanitizeText(req.body.username);

    if (!username) {
      return res.status(400).json({
        ok: false,
        message: 'Nome utente non valido'
      });
    }

    if (username.toLowerCase() === OWNER_USERNAME.toLowerCase()) {
      return res.status(400).json({
        ok: false,
        message: 'Non puoi eliminare RooS'
      });
    }

    const users = loadAdminUsers();
    const exists = users.some(user => user.username.toLowerCase() === username.toLowerCase());

    if (!exists) {
      return res.status(404).json({
        ok: false,
        message: 'Account non trovato'
      });
    }

    const filtered = users.filter(user => user.username.toLowerCase() !== username.toLowerCase());
    saveAdminUsers(filtered);

    logAudit(req.staffUser, 'web', 'account_staff_eliminato', {
      username
    });

    return res.json({
      ok: true,
      users: loadAdminUsers().map(publicAdminUser)
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message || 'Errore eliminazione account'
    });
  }
});

app.get('/api/dashboard', authRequired, (req, res) => {
  return res.json(buildDashboardPayload(req));
});

app.get('/api/match-status/:matchNumber', authRequired, (req, res) => {
  const data = loadData();
  const teams = loadTeams();
  const matchNumber = sanitizePositiveInteger(req.params.matchNumber, Number(data.currentMatch || 1), 50);

  return res.json({
    ok: true,
    statoMatch: buildMatchOverview(data, teams, matchNumber)
  });
});

app.get('/api/bot/discord-channels', authRequired, requireAdmin, handleDiscordChannelsList);
app.get('/api/bot/discord/channels', authRequired, requireAdmin, handleDiscordChannelsList);

app.post('/api/tournament/new', authRequired, requireAdmin, async (req, res) => {
  try {
    const totalMatches = sanitizePositiveInteger(req.body.totalMatches, 3, 50);
    const autoNextMatch = req.body.autoNextMatch === false ? false : true;

    const result = archiveAndCreateFreshTournament({
      actor: req.staffUser,
      source: 'web',
      label: sanitizeOptionalText(req.body.archiveLabel, 100),
      note: sanitizeOptionalText(req.body.archiveNote, 250),
      totalMatches,
      autoNextMatch
    });

    syncBotState(result.data, result.teams);

    await updateLeaderboardAllowCreate(false);
    await refreshPanelsSoft();

    return res.json({
      ok: true,
      archiveId: result.archive.archiveId,
      data: result.data
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message || 'Errore creazione nuovo torneo'
    });
  }
});

app.post('/api/tournament/open-registrations', authRequired, requireAdmin, async (req, res) => {
  try {
    let data = loadData();
    const teams = loadTeams();

    data = openRegistrations(data, req.staffUser);

    syncBotState(data, teams);

    await safeBotCall('updateRegistrationStatusMessage');
    await safeBotCall('handleRegistrationStateChange');
    await sendGeneralAnnouncementFromData(data, 'openRegistrationsAnnouncement');

    logAudit(req.staffUser, 'web', 'iscrizioni_aperte', {});

    return res.json({
      ok: true,
      statoTorneo: data.tournamentLifecycle
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message || 'Errore apertura iscrizioni'
    });
  }
});

app.post('/api/tournament/close-registrations', authRequired, requireAdmin, async (req, res) => {
  try {
    let data = loadData();
    const teams = loadTeams();

    data = closeRegistrations(data, req.staffUser);

    syncBotState(data, teams);

    await safeBotCall('updateRegistrationStatusMessage');
    await safeBotCall('handleRegistrationStateChange');
    await sendGeneralAnnouncementFromData(data, 'closeRegistrationsAnnouncement');

    logAudit(req.staffUser, 'web', 'iscrizioni_chiuse', {});

    return res.json({
      ok: true,
      statoTorneo: data.tournamentLifecycle
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message || 'Errore chiusura iscrizioni'
    });
  }
});

app.post('/api/tournament/start', authRequired, requireAdmin, async (req, res) => {
  try {
    let data = loadData();
    const teams = loadTeams();

    if (Object.keys(teams).length === 0) {
      return res.status(400).json({
        ok: false,
        message: 'Non puoi iniziare il torneo senza team iscritti.'
      });
    }

    data = startTournament(data, teams, req.staffUser);

    syncBotState(data, teams);

    await safeBotCall('refreshTeamResultPanels');
    await updateLeaderboardAllowCreate(true);
    await sendGeneralAnnouncementFromData(data, 'tournamentStartAnnouncement');

    logAudit(req.staffUser, 'web', 'torneo_iniziato', {
      currentMatch: 1,
      totalMatches: data.tournamentSettings?.totalMatches || 3
    });

    return res.json({
      ok: true,
      statoTorneo: data.tournamentLifecycle,
      currentMatch: data.currentMatch
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message || 'Errore avvio torneo'
    });
  }
});

app.post('/api/tournament/finish', authRequired, requireAdmin, async (req, res) => {
  try {
    let data = loadData();
    const teams = loadTeams();

    data = finishTournament(data, req.staffUser);

    syncBotState(data, teams);

    await updateLeaderboardAllowCreate(true);
    await sendGeneralAnnouncementFromData(data, 'tournamentFinishedAnnouncement');

    logAudit(req.staffUser, 'web', 'torneo_terminato', {});

    return res.json({
      ok: true,
      statoTorneo: data.tournamentLifecycle
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message || 'Errore termine torneo'
    });
  }
});

app.post('/api/tournament/configure', authRequired, requireAdmin, async (req, res) => {
  try {
    const data = loadData();
    const teams = loadTeams();

    const totalMatches = sanitizePositiveInteger(req.body.totalMatches, 3, 50);
    const resetCurrentMatch = sanitizeBoolean(req.body.resetCurrentMatch);
    const autoNextMatch = req.body.autoNextMatch === false ? false : true;

    data.tournamentSettings = {
      ...(data.tournamentSettings || {}),
      tournamentName: FIXED_TOURNAMENT_NAME,
      totalMatches,
      playersPerTeam: PLAYERS_PER_TEAM,
      maxTeams: MAX_TEAMS,
      autoNextMatch,
      lockedRules: true,
      lockedPoints: true,
      createdAt: data.tournamentSettings?.createdAt || new Date().toISOString(),
      createdBy: data.tournamentSettings?.createdBy || req.staffUser,
      lastConfiguredAt: new Date().toISOString(),
      lastConfiguredBy: req.staffUser
    };

    if (resetCurrentMatch) {
      data.currentMatch = 1;
    }

    if (Number(data.currentMatch || 1) > totalMatches) {
      data.currentMatch = totalMatches;
    }

    if (!data.matches || typeof data.matches !== 'object') {
      data.matches = {};
    }

    for (let i = 1; i <= totalMatches; i++) {
      if (!data.matches[String(i)]) {
        data.matches[String(i)] = {
          matchNumber: i,
          status: i === Number(data.currentMatch || 1) ? MATCH_STATES.RUNNING : MATCH_STATES.NOT_STARTED,
          startedAt: null,
          completedAt: null,
          forcedAt: null,
          closedBy: '',
          autoAdvanced: false,
          teams: {}
        };
      }
    }

    const saved = saveData(data);

    syncBotState(saved, teams);

    await updateLeaderboardAllowCreate(true);

    logAudit(req.staffUser, 'web', 'torneo_configurato', {
      tournamentName: FIXED_TOURNAMENT_NAME,
      totalMatches,
      playersPerTeam: PLAYERS_PER_TEAM,
      maxTeams: MAX_TEAMS,
      autoNextMatch,
      resetCurrentMatch
    });

    return res.json({
      ok: true,
      impostazioniTorneo: saved.tournamentSettings
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message || 'Errore configurazione torneo'
    });
  }
});

app.post('/api/tournament/messages/save', authRequired, requireAdmin, async (req, res) => {
  try {
    const data = loadData();
    const defaults = getDefaultTournamentMessages();

    data.tournamentMessages = {
      ...defaults,
      ...(data.tournamentMessages || {}),

      openRegistrationsAnnouncement:
        sanitizeOptionalText(req.body.openRegistrationsAnnouncement, 3000) ||
        data.tournamentMessages?.openRegistrationsAnnouncement ||
        defaults.openRegistrationsAnnouncement,

      closeRegistrationsAnnouncement:
        sanitizeOptionalText(req.body.closeRegistrationsAnnouncement, 3000) ||
        data.tournamentMessages?.closeRegistrationsAnnouncement ||
        defaults.closeRegistrationsAnnouncement,

      tournamentStartAnnouncement:
        sanitizeOptionalText(req.body.tournamentStartAnnouncement, 3000) ||
        data.tournamentMessages?.tournamentStartAnnouncement ||
        defaults.tournamentStartAnnouncement,

      nextMatchAnnouncement:
        sanitizeOptionalText(req.body.nextMatchAnnouncement, 2000) ||
        data.tournamentMessages?.nextMatchAnnouncement ||
        defaults.nextMatchAnnouncement,

      forcedNextMatchAnnouncement:
        sanitizeOptionalText(req.body.forcedNextMatchAnnouncement, 2000) ||
        data.tournamentMessages?.forcedNextMatchAnnouncement ||
        defaults.forcedNextMatchAnnouncement,

      tournamentFinishedAnnouncement:
        sanitizeOptionalText(req.body.tournamentFinishedAnnouncement, 3000) ||
        data.tournamentMessages?.tournamentFinishedAnnouncement ||
        defaults.tournamentFinishedAnnouncement,

      lobbyInfoMessage:
        sanitizeOptionalText(req.body.lobbyInfoMessage, 1200) ||
        data.tournamentMessages?.lobbyInfoMessage ||
        defaults.lobbyInfoMessage,

      generalReminder:
        sanitizeOptionalText(req.body.generalReminder, 3000) ||
        data.tournamentMessages?.generalReminder ||
        defaults.generalReminder,

      regulationText: defaults.regulationText
    };

    if (req.body.generalAnnouncement) {
      data.tournamentMessages.openRegistrationsAnnouncement = sanitizeOptionalText(req.body.generalAnnouncement, 3000);
    }

    const saved = saveData(data);

    syncBotState(saved);

    logAudit(req.staffUser, 'web', 'messaggi_torneo_salvati', {
      regulationLocked: true
    });

    return res.json({
      ok: true,
      messaggiTorneo: saved.tournamentMessages
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message || 'Errore salvataggio messaggi torneo'
    });
  }
});

app.post('/api/tournament/send-reminder', authRequired, requireAdmin, async (req, res) => {
  try {
    const data = loadData();

    const result = await sendGeneralAnnouncementFromData(data, 'generalReminder');

    logAudit(req.staffUser, 'web', 'promemoria_generale_inviato', result);

    return res.json({
      ok: true,
      result
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message || 'Errore invio promemoria'
    });
  }
});

const REMINDER_LABELS = {
  iscrizioni: 'Promemoria iscrizioni',
  regolamento: 'Promemoria regolamento',
  risultati: 'Promemoria risultati'
};

const REMINDER_STATE_HINTS = {
  iscrizioni: 'Attivo solo durante le iscrizioni aperte.',
  regolamento: 'Attivo durante iscrizioni aperte/chiuse e torneo in corso.',
  risultati: 'Attivo solo durante il torneo in corso.'
};

function publicReminderState(data) {
  const config = data.automaticReminders || getDefaultAutomaticReminders();
  const generalChannelOk = Boolean(data.botSettings?.generalChannelId);

  return {
    masterEnabled: Boolean(config.masterEnabled),
    generalChannelOk,
    intervalOptions: REMINDER_INTERVAL_OPTIONS,
    types: REMINDER_TYPES.map(type => {
      const r = config.reminders[type] || {};
      return {
        type,
        label: REMINDER_LABELS[type],
        hint: REMINDER_STATE_HINTS[type],
        enabled: Boolean(r.enabled),
        intervalHours: Number(r.intervalHours || 12),
        message: String(r.message || ''),
        lastSentAt: r.lastSentAt || null
      };
    })
  };
}

app.get('/api/reminders', authRequired, requireAdmin, (req, res) => {
  try {
    const data = loadData();
    return res.json({ ok: true, reminders: publicReminderState(data) });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message || 'Errore lettura promemoria' });
  }
});

app.post('/api/reminders/master', authRequired, requireAdmin, (req, res) => {
  try {
    const enabled = sanitizeBoolean(req.body.enabled);
    let data = loadData();
    data = setReminderMasterEnabled(data, enabled);
    syncBotState(data);

    logAudit(req.staffUser, 'web', enabled ? 'promemoria_auto_attivati' : 'promemoria_auto_disattivati', {});

    return res.json({ ok: true, reminders: publicReminderState(data) });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message || 'Errore master promemoria' });
  }
});

app.post('/api/reminders/save', authRequired, requireAdmin, (req, res) => {
  try {
    const updates = {};
    for (const type of REMINDER_TYPES) {
      const item = req.body && req.body[type];
      if (!item || typeof item !== 'object') continue;
      updates[type] = {
        enabled: sanitizeBoolean(item.enabled),
        intervalHours: Number(item.intervalHours),
        message: sanitizeOptionalText(item.message, 1500)
      };
    }

    let data = loadData();
    data = updateAutomaticReminders(data, updates);
    syncBotState(data);

    logAudit(req.staffUser, 'web', 'promemoria_auto_salvati', { types: Object.keys(updates) });

    return res.json({ ok: true, reminders: publicReminderState(data) });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message || 'Errore salvataggio promemoria' });
  }
});

app.post('/api/reminders/test/:type', authRequired, requireAdmin, async (req, res) => {
  try {
    const type = String(req.params.type || '');
    if (!REMINDER_TYPES.includes(type)) {
      return res.status(400).json({ ok: false, message: 'Tipo promemoria non valido' });
    }

    if (typeof bot.sendAutomaticReminder !== 'function') {
      return res.status(500).json({ ok: false, message: 'Funzione bot non disponibile' });
    }

    const result = await bot.sendAutomaticReminder(type, { skipMark: true });

    logAudit(req.staffUser, 'web', 'promemoria_auto_test', { type, channelId: result.channelId });

    return res.json({ ok: true, result });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message || 'Errore invio promemoria di test' });
  }
});

app.post('/api/reminders/reset/:type', authRequired, requireAdmin, (req, res) => {
  try {
    const type = String(req.params.type || '');
    if (!REMINDER_TYPES.includes(type)) {
      return res.status(400).json({ ok: false, message: 'Tipo promemoria non valido' });
    }

    let data = loadData();
    data = resetReminderToDefault(data, type);
    syncBotState(data);

    logAudit(req.staffUser, 'web', 'promemoria_auto_reset', { type });

    return res.json({ ok: true, reminders: publicReminderState(data) });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message || 'Errore reset promemoria' });
  }
});

app.post('/api/project-settings/save', authRequired, requireAdmin, async (req, res) => {
  try {
    const data = loadData();

    data.projectSettings = {
      ...(data.projectSettings || getDefaultProjectSettings()),
      brandName: sanitizeOptionalText(req.body.brandName, 60) || 'RØDA',
      tournamentName: FIXED_TOURNAMENT_NAME,
      supportContact: sanitizeOptionalText(req.body.supportContact, 120),
      premiumMode: sanitizeBoolean(req.body.premiumMode),
      setupCompleted: sanitizeBoolean(req.body.setupCompleted)
    };

    const saved = saveData(data);

    syncBotState(saved);

    logAudit(req.staffUser, 'web', 'impostazioni_progetto_salvate', {
      brandName: saved.projectSettings.brandName,
      tournamentName: FIXED_TOURNAMENT_NAME,
      premiumMode: saved.projectSettings.premiumMode,
      setupCompleted: saved.projectSettings.setupCompleted
    });

    return res.json({
      ok: true,
      projectSettings: saved.projectSettings
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message || 'Errore salvataggio impostazioni progetto'
    });
  }
});

app.post('/api/bot/settings/save', authRequired, requireAdmin, handleBotSettingsSave);
app.post('/api/bot/settings', authRequired, requireAdmin, handleBotSettingsSave);

app.post('/api/teams/save', authRequired, async (req, res) => {
  try {
    const teams = loadTeams();
    let data = loadData();

    const oldTeamName = sanitizeText(req.body.oldTeamName);
    const teamName = sanitizeOptionalText(req.body.teamName, 50);
    const p1 = sanitizeOptionalText(req.body.p1, 40);
    const p2 = sanitizeOptionalText(req.body.p2, 40);
    const p3 = sanitizeOptionalText(req.body.p3, 40);

    if (!teamName || !p1 || !p2 || !p3) {
      return res.status(400).json({
        ok: false,
        message: 'Compila tutti i campi team/giocatori'
      });
    }

    if (oldTeamName && oldTeamName !== teamName && teams[teamName]) {
      return res.status(400).json({
        ok: false,
        message: 'Esiste già un team con questo nome'
      });
    }

    const isNewTeam = !oldTeamName || !teams[oldTeamName];

    if (isNewTeam && Object.keys(teams).length >= MAX_TEAMS) {
      return res.status(400).json({
        ok: false,
        message: `Limite massimo di ${MAX_TEAMS} team raggiunto`
      });
    }

    if (oldTeamName && oldTeamName !== teamName && teams[oldTeamName]) {
      teams[teamName] = {
        slot: teams[oldTeamName].slot,
        players: [p1, p2, p3]
      };

      delete teams[oldTeamName];

      if (typeof data.scores[oldTeamName] !== 'undefined') {
        data.scores[teamName] = data.scores[oldTeamName];
        delete data.scores[oldTeamName];
      }

      for (const id of Object.keys(data.pending || {})) {
        if (data.pending[id]?.team === oldTeamName) {
          data.pending[id].team = teamName;
        }
      }

      for (const match of Object.values(data.matches || {})) {
        if (match?.teams?.[oldTeamName]) {
          match.teams[teamName] = {
            ...match.teams[oldTeamName],
            team: teamName
          };
          delete match.teams[oldTeamName];
        }
      }

      const updatedSubmissions = {};

      for (const [key, record] of Object.entries(data.resultSubmissions || {})) {
        if (normalizeSubmissionTeamName(record.team) === normalizeSubmissionTeamName(oldTeamName)) {
          const newKey = buildSubmissionKey(teamName, Number(record.matchNumber || 1));
          updatedSubmissions[newKey] = {
            ...record,
            team: teamName,
            updatedAt: new Date().toISOString(),
            updatedBy: req.staffUser
          };
        } else {
          updatedSubmissions[key] = record;
        }
      }

      data.resultSubmissions = updatedSubmissions;
    } else {
      const existingSlot = teams[teamName]?.slot || null;

      teams[teamName] = {
        slot: existingSlot || getNextAvailableSlot(teams, MAX_TEAMS),
        players: [p1, p2, p3]
      };
    }

    const savedTeams = saveTeams(teams);
    data = saveData(data);

    syncBotState(data, savedTeams);

    await safeBotCall('handleRegistrationStateChange');
    await safeBotCall('updateRegistrationStatusMessage');
    await safeBotCall('refreshTeamResultPanels');

    logAudit(req.staffUser, 'web', 'team_salvato', {
      oldTeamName,
      teamName
    });

    return res.json({
      ok: true
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message || 'Errore salvataggio team'
    });
  }
});

app.post('/api/teams/delete', authRequired, async (req, res) => {
  try {
    const teamName = sanitizeText(req.body.teamName);

    if (!teamName) {
      return res.status(400).json({
        ok: false,
        message: 'Team non valido'
      });
    }

    const teams = loadTeams();
    let data = loadData();

    delete teams[teamName];
    delete data.scores[teamName];

    for (const id of Object.keys(data.pending || {})) {
      if (data.pending[id]?.team === teamName) {
        delete data.pending[id];
      }
    }

    for (const match of Object.values(data.matches || {})) {
      if (match?.teams?.[teamName]) {
        delete match.teams[teamName];
      }
    }

    for (const key of Object.keys(data.resultSubmissions || {})) {
      if (normalizeSubmissionTeamName(data.resultSubmissions[key]?.team) === normalizeSubmissionTeamName(teamName)) {
        delete data.resultSubmissions[key];
      }
    }

    const savedTeams = saveTeams(teams);
    data = saveData(data);

    syncBotState(data, savedTeams);

    await safeBotCall('handleRegistrationStateChange');
    await safeBotCall('updateRegistrationStatusMessage');
    await safeBotCall('refreshTeamResultPanels');

    logAudit(req.staffUser, 'web', 'team_eliminato', {
      teamName
    });

    return res.json({
      ok: true
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message || 'Errore eliminazione team'
    });
  }
});

app.post('/api/registration-settings/save', authRequired, requireAdmin, async (req, res) => {
  try {
    const data = loadData();

    const title = sanitizeOptionalText(req.body.title, 100);
    const text = sanitizeOptionalText(req.body.text, 250);

    data.registrationStatusTitle = title || '📋 Slot Team Registrati';
    data.registrationStatusText = text || '';
    data.registrationMaxTeams = MAX_TEAMS;

    const saved = saveData(data);

    syncBotState(saved);

    await safeBotCall('handleRegistrationStateChange');
    await safeBotCall('updateRegistrationStatusMessage');

    logAudit(req.staffUser, 'web', 'impostazioni_registrazione_salvate', {
      title: saved.registrationStatusTitle,
      maxTeams: MAX_TEAMS
    });

    return res.json({
      ok: true
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message || 'Errore salvataggio impostazioni registrazione'
    });
  }
});

app.post('/api/registration-settings/refresh', authRequired, requireAdmin, async (req, res) => {
  try {
    syncBotState();

    const result = await safeBotCall('updateRegistrationStatusMessage', { force: true });

    logAudit(req.staffUser, 'web', 'messaggio_registrazione_aggiornato', result);

    return res.json({
      ok: true,
      result
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message || 'Errore aggiornamento messaggio slot'
    });
  }
});

app.post('/api/match/set', authRequired, requireAdmin, async (req, res) => {
  try {
    const data = loadData();
    const teams = loadTeams();
    const totalMatches = Number(data.tournamentSettings?.totalMatches || 3);
    const match = sanitizePositiveInteger(req.body.match, 1, totalMatches);

    if (match > totalMatches) {
      return res.status(400).json({
        ok: false,
        message: `Il torneo ha solo ${totalMatches} match configurati.`
      });
    }

    data.currentMatch = match;

    const saved = ensureMatchForTeams(data, teams, match);
    const finalData = saveData(saved);

    syncBotState(finalData, teams);

    await safeBotCall('refreshTeamResultPanels');

    logAudit(req.staffUser, 'web', 'match_impostato', {
      currentMatch: match
    });

    return res.json({
      ok: true,
      currentMatch: match
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message || 'Errore aggiornamento match'
    });
  }
});

app.post('/api/match/next', authRequired, requireAdmin, async (req, res) => {
  try {
    let data = loadData();
    let teams = loadTeams();

    const forceMissingAbsent = req.body.forceMissingAbsent !== false;

    if (forceMissingAbsent) {
      data = forceCompleteCurrentMatch(data, teams, req.staffUser);
    }

    const advance = advanceToNextMatch(data, teams, req.staffUser, {
      forced: true,
      autoAdvanced: false
    });

    data = advance.data;

    syncBotState(data, teams);

    await updateLeaderboardAllowCreate(true);
    await refreshPanelsSoft();

    if (advance.finished) {
      await sendGeneralAnnouncementFromData(data, 'tournamentFinishedAnnouncement');

      logAudit(req.staffUser, 'web', 'torneo_finito_da_prossimo_match', {
        currentMatch: advance.currentMatch
      });

      return res.json({
        ok: true,
        currentMatch: data.currentMatch,
        finished: true
      });
    }

    await sendGeneralAnnouncementFromData(data, 'forcedNextMatchAnnouncement', {
      match: advance.currentMatch,
      nextMatch: advance.nextMatch
    });

    logAudit(req.staffUser, 'web', 'match_successivo_forzato', {
      from: advance.currentMatch,
      to: advance.nextMatch,
      forceMissingAbsent
    });

    return res.json({
      ok: true,
      currentMatch: data.currentMatch,
      nextMatch: advance.nextMatch,
      forced: true
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message || 'Errore passaggio match'
    });
  }
});

app.post('/api/match/mark-absent', authRequired, requireAdmin, async (req, res) => {
  try {
    const data = loadData();
    const teams = loadTeams();

    const team = sanitizeText(req.body.team);
    const matchNumber = sanitizePositiveInteger(req.body.matchNumber, Number(data.currentMatch || 1), 50);

    if (!team || !teams[team]) {
      return res.status(400).json({
        ok: false,
        message: 'Team non trovato'
      });
    }

    const saved = markTeamMatchState(data, teams, matchNumber, team, {
      status: TEAM_MATCH_STATES.ABSENT,
      absentBy: req.staffUser,
      updatedBy: req.staffUser,
      source: 'staff',
      kills: [0, 0, 0],
      totalKills: 0,
      placement: 0,
      points: 0
    });

    syncBotState(saved, teams);

    await safeBotCall('refreshTeamResultPanels');

    logAudit(req.staffUser, 'web', 'team_segnato_assente', {
      team,
      matchNumber
    });

    const autoAdvance = await maybeAutoAdvanceMatch(req.staffUser);

    return res.json({
      ok: true,
      autoAdvance
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message || 'Errore segna assente'
    });
  }
});

app.post('/api/scores/set', authRequired, async (req, res) => {
  try {
    const data = loadData();
    const teams = loadTeams();

    const team = sanitizeText(req.body.team);
    const points = Number(req.body.points || 0);

    if (!team || !teams[team]) {
      return res.status(400).json({
        ok: false,
        message: 'Team non trovato'
      });
    }

    if (!Number.isFinite(points)) {
      return res.status(400).json({
        ok: false,
        message: 'Punti non validi'
      });
    }

    data.scores[team] = points;

    const saved = saveData(data);

    syncBotState(saved, teams);

    await updateLeaderboardAllowCreate(true);

    logAudit(req.staffUser, 'web', 'punti_team_modificati', {
      team,
      points
    });

    return res.json({
      ok: true,
      team,
      points
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message || 'Errore modifica punti'
    });
  }
});

app.post('/api/fragger/set', authRequired, async (req, res) => {
  try {
    const data = loadData();
    const player = sanitizeOptionalText(req.body.player, 40);
    const kills = Number(req.body.kills || 0);

    if (!player || !Number.isFinite(kills)) {
      return res.status(400).json({
        ok: false,
        message: 'Dati fragger non validi'
      });
    }

    data.fragger[player] = kills;

    const saved = saveData(data);

    syncBotState(saved);

    await updateLeaderboardAllowCreate(true);

    logAudit(req.staffUser, 'web', 'fragger_salvato', {
      player,
      kills
    });

    return res.json({
      ok: true,
      kills
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message || 'Errore salvataggio giocatore'
    });
  }
});

app.post('/api/fragger/delete', authRequired, async (req, res) => {
  try {
    const data = loadData();
    const player = sanitizeText(req.body.player);

    if (!player) {
      return res.status(400).json({
        ok: false,
        message: 'Giocatore non valido'
      });
    }

    delete data.fragger[player];

    const saved = saveData(data);

    syncBotState(saved);

    await updateLeaderboardAllowCreate(true);

    logAudit(req.staffUser, 'web', 'fragger_eliminato', {
      player
    });

    return res.json({
      ok: true
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message || 'Errore eliminazione giocatore'
    });
  }
});

app.post('/api/approve/:id', authRequired, async (req, res) => {
  try {
    let data = loadData();
    const teams = loadTeams();

    const pendingId = sanitizeText(req.params.id);
    const pendingEntry = data.pending?.[pendingId];

    if (!pendingEntry) {
      return res.status(404).json({
        ok: false,
        message: 'Risultato non trovato'
      });
    }

    const team = pendingEntry.team;
    const matchNumber = Number(pendingEntry.matchNumber || data.currentMatch || 1);
    const kills = Array.isArray(pendingEntry.kills) ? pendingEntry.kills.map(v => Number(v || 0)) : [0, 0, 0];
    const totalKills = Number(pendingEntry.total || kills.reduce((sum, value) => sum + Number(value || 0), 0));
    const placement = Number(pendingEntry.pos || 0);
    const points = calcPoints(placement, totalKills);

    let botResult = null;

    if (typeof bot.approvePending === 'function') {
      botResult = await bot.approvePending(pendingId, req.staffUser, 'web');
      data = loadData();
    } else {
      data.scores[team] = Number(data.scores[team] || 0) + points;

      const players = teams[team]?.players || [];

      kills.forEach((killValue, index) => {
        const playerName = sanitizeText(players[index]) || `Giocatore ${index + 1}`;
        data.fragger[playerName] = Number(data.fragger[playerName] || 0) + Number(killValue || 0);
      });

      delete data.pending[pendingId];

      data = saveData(data);

      botResult = {
        ok: true,
        fallback: true
      };
    }

    data = markTeamMatchState(data, teams, matchNumber, team, {
      status: TEAM_MATCH_STATES.APPROVED,
      kills,
      totalKills,
      placement,
      points,
      source: pendingEntry.source || 'discord',
      pendingId,
      image: pendingEntry.image || '',
      submittedBy: pendingEntry.submittedBy || '',
      approvedBy: req.staffUser,
      updatedBy: req.staffUser
    });

    syncBotState(data, teams);

    await updateLeaderboardAllowCreate(true);
    await refreshPanelsSoft();

    logAudit(req.staffUser, 'web', 'risultato_approvato', {
      id: pendingId,
      team,
      matchNumber,
      totalKills,
      placement,
      points
    });

    const autoAdvance = await maybeAutoAdvanceMatch(req.staffUser);

    return res.json({
      ok: true,
      result: botResult,
      autoAdvance
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message || 'Errore approvazione'
    });
  }
});

app.post('/api/reject/:id', authRequired, async (req, res) => {
  try {
    let data = loadData();
    const teams = loadTeams();

    const pendingId = sanitizeText(req.params.id);
    const pendingEntry = data.pending?.[pendingId];

    if (!pendingEntry) {
      return res.status(404).json({
        ok: false,
        message: 'Risultato non trovato'
      });
    }

    const team = pendingEntry.team;
    const matchNumber = Number(pendingEntry.matchNumber || data.currentMatch || 1);

    let botResult = null;

    if (typeof bot.rejectPending === 'function') {
      botResult = await bot.rejectPending(pendingId, req.staffUser, 'web');
      data = loadData();
    } else {
      delete data.pending[pendingId];
      data = saveData(data);

      botResult = {
        ok: true,
        fallback: true
      };
    }

    data = markTeamMatchState(data, teams, matchNumber, team, {
      status: TEAM_MATCH_STATES.REJECTED,
      source: pendingEntry.source || 'discord',
      pendingId: null,
      image: pendingEntry.image || '',
      submittedBy: pendingEntry.submittedBy || '',
      rejectedBy: req.staffUser,
      updatedBy: req.staffUser
    });

    syncBotState(data, teams);

    await refreshPanelsSoft();

    logAudit(req.staffUser, 'web', 'risultato_rifiutato', {
      id: pendingId,
      team,
      matchNumber
    });

    return res.json({
      ok: true,
      result: botResult
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message || 'Errore rifiuto'
    });
  }
});

app.post('/api/manual-result', authRequired, async (req, res) => {
  try {
    const data = loadData();

    const result = await applyManualResult({
      req,
      team: sanitizeText(req.body.team),
      k1: Number(req.body.k1 || 0),
      k2: Number(req.body.k2 || 0),
      k3: Number(req.body.k3 || 0),
      pos: Number(req.body.pos || 0),
      matchNumber: sanitizePositiveInteger(req.body.matchNumber, Number(data.currentMatch || 1), 50)
    });

    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message || 'Errore inserimento risultato manuale'
    });
  }
});

app.post('/api/web-submit-result', authRequired, async (req, res) => {
  try {
    let data = loadData();
    const teams = loadTeams();

    const team = sanitizeText(req.body.team);
    const k1 = Number(req.body.k1 || 0);
    const k2 = Number(req.body.k2 || 0);
    const k3 = Number(req.body.k3 || 0);
    const pos = Number(req.body.pos || 0);
    const imageData = req.body.imageData;

    if (!team || !teams[team] || !Number.isFinite(k1) || !Number.isFinite(k2) || !Number.isFinite(k3) || !Number.isFinite(pos)) {
      return res.status(400).json({
        ok: false,
        message: 'Dati risultato non validi'
      });
    }

    let image = '';

    if (imageData) {
      image = saveBase64Image(imageData, req);
    }

    if (typeof bot.submitWebResult === 'function') {
      await bot.submitWebResult({
        team,
        k1,
        k2,
        k3,
        pos,
        image,
        submittedBy: req.staffUser
      });
    } else {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const kills = [k1, k2, k3];

      data.pending[id] = {
        team,
        kills,
        total: k1 + k2 + k3,
        pos,
        image,
        source: 'web',
        submittedBy: req.staffUser,
        staffMessageId: null,
        matchNumber: Number(data.currentMatch || 1),
        teamResultChannelId: '',
        slot: teams[team]?.slot || null
      };

      data = saveData(data);
    }

    data = loadData();

    const pendingId = Object.keys(data.pending || {}).find(id => {
      const p = data.pending[id];

      return p?.team === team && Number(p?.matchNumber || 1) === Number(data.currentMatch || 1);
    });

    if (pendingId) {
      data = markTeamMatchState(data, teams, Number(data.currentMatch || 1), team, {
        status: TEAM_MATCH_STATES.PENDING,
        kills: [k1, k2, k3],
        totalKills: k1 + k2 + k3,
        placement: pos,
        source: 'web',
        pendingId,
        image,
        submittedBy: req.staffUser,
        updatedBy: req.staffUser
      });
    }

    syncBotState(data, teams);

    logAudit(req.staffUser, 'web', 'risultato_inviato_dalla_dashboard', {
      team,
      pos,
      total: k1 + k2 + k3
    });

    return res.json({
      ok: true
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message || 'Errore invio risultato web'
    });
  }
});

app.post('/api/reset-data', authRequired, requireAdmin, async (req, res) => {
  try {
    const currentTeams = loadTeams();
    const currentData = loadData();

    createTournamentArchive(currentData, currentTeams, {
      label: `Backup prima reset classifica ${new Date().toLocaleString('it-IT')}`,
      note: 'Backup automatico prima del reset classifica, fragger e match',
      actor: req.staffUser,
      source: 'web'
    });

    const data = getDefaultData();

    data.projectSettings = currentData.projectSettings || getDefaultProjectSettings();
    data.tournamentSettings = currentData.tournamentSettings || data.tournamentSettings;
    data.tournamentLifecycle = currentData.tournamentLifecycle || data.tournamentLifecycle;
    data.tournamentMessages = currentData.tournamentMessages || data.tournamentMessages;
    data.botSettings = currentData.botSettings || getDefaultBotSettings();

    data.registrationStatusTitle = currentData.registrationStatusTitle || data.registrationStatusTitle;
    data.registrationStatusText = currentData.registrationStatusText || data.registrationStatusText;
    data.registrationMaxTeams = MAX_TEAMS;
    data.registrationStatusMessageId = currentData.registrationStatusMessageId || null;
    data.registrationGraphicMessageId = currentData.registrationGraphicMessageId || null;

    data.leaderboardMessageId = currentData.leaderboardMessageId || null;
    data.leaderboardGraphicMessageId = currentData.leaderboardGraphicMessageId || null;
    data.topFraggerGraphicMessageId = currentData.topFraggerGraphicMessageId || null;

    data.currentMatch = 1;
    data.pending = {};
    data.tempSubmit = {};
    data.resultSubmissions = {};
    data.matches = {};
    data.scores = {};
    data.fragger = {};

    const saved = saveData(data, { allowReset: true });

    syncBotState(saved, currentTeams);

    await updateLeaderboardAllowCreate(false);
    await refreshPanelsSoft();

    logAudit(req.staffUser, 'web', 'reset_dati_senza_creare_messaggi', {});

    return res.json({
      ok: true
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message || 'Errore reset dati'
    });
  }
});

app.post('/api/reset-teams', authRequired, requireAdmin, async (req, res) => {
  try {
    const data = loadData();
    const currentTeams = loadTeams();

    createTournamentArchive(data, currentTeams, {
      label: `Backup prima reset team ${new Date().toLocaleString('it-IT')}`,
      note: 'Backup automatico prima del reset team',
      actor: req.staffUser,
      source: 'web'
    });

    data.pending = {};
    data.tempSubmit = {};
    data.resultSubmissions = {};
    data.matches = {};
    data.registrationClosedAnnounced = false;
    data.registrationMaxTeams = MAX_TEAMS;

    const savedData = saveData(data);
    const savedTeams = saveTeams({});

    syncBotState(savedData, savedTeams);

    await updateLeaderboardAllowCreate(false);
    await refreshPanelsSoft();

    logAudit(req.staffUser, 'web', 'reset_team_senza_creare_messaggi', {});

    return res.json({
      ok: true
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message || 'Errore reset team'
    });
  }
});

app.get('/api/audit-log', authRequired, (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit || 120), 1), 500);
  const auditLog = loadAuditLog().slice(-limit).reverse();

  return res.json({
    ok: true,
    auditLog
  });
});

app.get('/api/archivi', authRequired, (req, res) => {
  const archivi = listTournamentArchives();

  return res.json({
    ok: true,
    archivi
  });
});

app.post('/api/archivi/crea', authRequired, requireAdmin, (req, res) => {
  try {
    const data = loadData();
    const teams = loadTeams();

    const archive = createTournamentArchive(data, teams, {
      label: sanitizeOptionalText(req.body.label, 80),
      note: sanitizeOptionalText(req.body.note, 180),
      actor: req.staffUser,
      source: 'web'
    });

    logAudit(req.staffUser, 'web', 'archivio_creato', {
      archiveId: archive.archiveId,
      label: archive.meta.label
    });

    return res.json({
      ok: true,
      archivio: archive
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message || 'Errore creazione archivio'
    });
  }
});

app.post('/api/archivi/ripristina', authRequired, requireAdmin, async (req, res) => {
  try {
    const archiveId = sanitizeText(req.body.archiveId);

    if (!archiveId) {
      return res.status(400).json({
        ok: false,
        message: 'Archivio non valido'
      });
    }

    const archive = getTournamentArchive(archiveId);

    if (!archive) {
      return res.status(404).json({
        ok: false,
        message: 'Archivio non trovato'
      });
    }

    const currentData = loadData();
    const currentTeams = loadTeams();

    createTournamentArchive(currentData, currentTeams, {
      label: `Backup pre-ripristino ${archive.meta.label || archive.archiveId}`,
      note: `Backup automatico prima del ripristino di ${archive.archiveId}`,
      actor: req.staffUser,
      source: 'web'
    });

    const savedData = saveData(archive.data);
    const savedTeams = saveTeams(archive.teams);

    syncBotState(savedData, savedTeams);

    await updateLeaderboardAllowCreate(false);
    await refreshPanelsSoft();

    logAudit(req.staffUser, 'web', 'archivio_ripristinato', {
      archiveId: archive.archiveId,
      label: archive.meta.label || ''
    });

    return res.json({
      ok: true,
      archiveId: archive.archiveId
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message || 'Errore ripristino archivio'
    });
  }
});

app.post('/api/bot/prepare-discord-structure', authRequired, requireAdmin, handlePrepareDiscordStructure);
app.post('/api/bot/prepare-discord', authRequired, requireAdmin, handlePrepareDiscordStructure);

app.post('/api/bot/spawn-register-panel', authRequired, requireAdmin, async (req, res) => {
  try {
    const channelId = sanitizeText(req.body.channelId);
    const result = await safeBotCall('spawnRegisterPanel', channelId);

    logAudit(req.staffUser, 'web', 'pannello_registrazione_inviato', {
      channelId,
      result
    });

    return res.json({
      ok: true,
      ...result
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message || 'Errore invio pannello registrazione'
    });
  }
});

app.post('/api/bot/spawn-results-panel', authRequired, requireAdmin, async (req, res) => {
  try {
    const channelId = sanitizeText(req.body.channelId);
    const result = await safeBotCall('spawnResultsPanel', channelId);

    logAudit(req.staffUser, 'web', 'pannelli_risultati_team_aggiornati', {
      channelId,
      result
    });

    return res.json({
      ok: true,
      ...result
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message || 'Errore aggiornamento pannelli risultati team'
    });
  }
});

app.post('/api/bot/refresh-team-result-panels', authRequired, requireAdmin, async (req, res) => {
  try {
    const categoryId = sanitizeText(req.body.categoryId);
    const result = await safeBotCall('refreshTeamResultPanels', categoryId);

    logAudit(req.staffUser, 'web', 'pannelli_risultati_team_refresh_manuale', {
      categoryId,
      result
    });

    return res.json({
      ok: true,
      ...result
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message || 'Errore aggiornamento pannelli team'
    });
  }
});

app.get('/api/bot/diagnose-panels', authRequired, requireAdmin, async (req, res) => {
  try {
    const categoryId = sanitizeText(req.query.categoryId) || '';
    const result = await safeBotCall('diagnosePanels', categoryId);
    return res.json({ ok: true, ...result });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message || 'Errore diagnostica' });
  }
});

app.post('/api/bot/create-rooms', authRequired, requireAdmin, async (req, res) => {
  try {
    const categoryId = sanitizeText(req.body.categoryId);
    const result = await safeBotCall('createTeamRooms', categoryId);

    logAudit(req.staffUser, 'web', 'stanze_team_create', {
      categoryId,
      result
    });

    return res.json({
      ok: true,
      ...result
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message || 'Errore creazione stanze'
    });
  }
});

app.post('/api/bot/delete-rooms', authRequired, requireAdmin, async (req, res) => {
  try {
    const categoryId = sanitizeText(req.body.categoryId);
    const result = await safeBotCall('deleteTeamRooms', categoryId);

    logAudit(req.staffUser, 'web', 'stanze_team_eliminate', {
      categoryId,
      result
    });

    return res.json({
      ok: true,
      ...result
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message || 'Errore eliminazione stanze'
    });
  }
});

app.post('/api/bot/send-lobby-code', authRequired, requireAdmin, async (req, res) => {
  try {
    let data = loadData();

    const lobbyCode = sanitizeText(req.body.lobbyCode);
    const categoryId = sanitizeText(req.body.categoryId);

    if (!lobbyCode) {
      return res.status(400).json({
        ok: false,
        message: 'Codice lobby non valido'
      });
    }

    let message = data.tournamentMessages?.lobbyInfoMessage || '**🎮 CODICE LOBBY**\n\nCodice: **{code}**';
    message = replaceMessagePlaceholders(message, { code: lobbyCode });

    let result;

    if (typeof bot.sendLobbyCodeToTeamRooms === 'function') {
      result = await bot.sendLobbyCodeToTeamRooms(lobbyCode, categoryId, message);
    } else {
      result = await safeBotCall('sendLobbyCodeToTeamRooms', lobbyCode, categoryId);
    }

    logAudit(req.staffUser, 'web', 'codice_lobby_inviato', {
      lobbyCode,
      categoryId,
      result
    });

    return res.json({
      ok: true,
      ...result
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message || 'Errore invio codice lobby'
    });
  }
});

app.post('/api/bot/update-leaderboard', authRequired, requireAdmin, async (req, res) => {
  try {
    const result = await updateLeaderboardAllowCreate(true);

    logAudit(req.staffUser, 'web', 'classifica_discord_aggiornata_manualmente', result);

    return res.json({
      ok: true,
      ...result
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message || 'Errore aggiornamento classifica Discord'
    });
  }
});

app.get('/api/reports', authRequired, (req, res) => {
  try {
    const reports = getReports();
    res.json({ ok: true, reports });
  } catch (e) {
    res.status(500).json({ ok: false, message: e.message });
  }
});

app.patch('/api/reports/:id/review', authRequired, express.json(), (req, res) => {
  try {
    const { id } = req.params;
    const reviewedBy = (req.body && req.body.reviewedBy) || req.session?.username || 'admin';
    const success = markReportReviewed(id, reviewedBy);
    if (!success) return res.json({ ok: false, message: 'Segnalazione non trovata' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, message: e.message });
  }
});

app.delete('/api/reports/:id', authRequired, (req, res) => {
  try {
    const { id } = req.params;
    const success = deleteReport(id);
    if (!success) return res.json({ ok: false, message: 'Segnalazione non trovata' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, message: e.message });
  }
});

app.use((req, res) => {
  if (req.originalUrl.startsWith('/api/')) {
    return res.status(404).json({
      ok: false,
      message: 'Endpoint non trovato'
    });
  }

  return res.status(404).sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.use((error, req, res, next) => {
  console.error('Errore server:', error);

  if (res.headersSent) {
    return next(error);
  }

  if (req.originalUrl.startsWith('/api/')) {
    return res.status(500).json({
      ok: false,
      message: 'Errore interno del server'
    });
  }

  return res.status(500).send('Errore interno del server');
});

app.listen(PORT, HOST, () => {
  console.log(`🌐 DASHBOARD ONLINE su porta ${PORT}`);
  console.log(`🔐 Login principale: ${OWNER_USERNAME}`);
});
