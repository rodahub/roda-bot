const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const {
  initializeFiles,
  loadData,
  loadTeams,
  loadAuditLog,
  saveData,
  saveTeams,
  saveAll,
  appendAuditLog,
  createTournamentArchive,
  listTournamentArchives,
  getTournamentArchive,
  getDefaultData,
  getDefaultTeams,
  getDefaultProjectSettings,
  getDefaultBotSettings,
  UPLOADS_DIR
} = require('./storage');

initializeFiles();

const bot = require('./index');

const app = express();

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');

const DASHBOARD_EMAIL = process.env.DASHBOARD_EMAIL || 'admin@example.com';
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || 'admin123';
const DASHBOARD_COOKIE_SECRET = process.env.DASHBOARD_COOKIE_SECRET || 'change-this-secret-now';

const COOKIE_NAME = 'staff_auth';
const COOKIE_DURATION_MS = 1000 * 60 * 60 * 12;

const FIXED_TOURNAMENT_NAME = 'RØDA CUP';
const MAX_TEAMS = 16;
const PLAYERS_PER_TEAM = 3;

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

function getDefaultTournamentSettings() {
  return {
    tournamentName: FIXED_TOURNAMENT_NAME,
    totalMatches: 3,
    playersPerTeam: PLAYERS_PER_TEAM,
    maxTeams: MAX_TEAMS,
    lockedRules: true,
    lockedPoints: true,
    createdAt: null,
    createdBy: '',
    lastConfiguredAt: null,
    lastConfiguredBy: ''
  };
}

function getDefaultTournamentMessages() {
  return {
    generalAnnouncement:
      '@everyone\n\n' +
      '**🏆 BENVENUTI ALLA RØDA CUP**\n\n' +
      '**Leggete il regolamento ufficiale prima dell’inizio del torneo.**\n\n' +
      'Ogni team userà la propria stanza vocale ufficiale.\n' +
      'Dentro la stanza del team troverete il pannello per inviare i risultati.\n' +
      'Il codice lobby verrà mandato nelle stanze ufficiali dei team.\n\n' +
      '**Buona fortuna a tutti. 🔥**',
    lobbyInfoMessage:
      '**🎮 CODICE LOBBY**\n\n' +
      'Il codice lobby verrà inviato nelle stanze ufficiali dei team.\n' +
      'Controllate sempre la vostra stanza durante il torneo.',
    regulationText:
      '🏆 RØDA CUP\n\n' +
      '👥 FORMATO TORNEO\n\n' +
      'Il torneo si svolge in modalità TERZETTI (TRIO).\n\n' +
      'Ogni squadra deve essere composta da 3 giocatori titolari.\n' +
      'Non sono ammessi quartetti o cambi non autorizzati dallo staff.\n\n' +
      '🎮 OBBLIGO UTILIZZO DISCORD\n\n' +
      'Per tutta la durata dell’evento è obbligatorio:\n\n' +
      '• Utilizzare le stanze vocali Discord ufficiali\n' +
      '• Aprire una stanza temporanea Trio nella sezione RØDA HUB\n' +
      '• Restare presenti in vocale per tutto il torneo\n\n' +
      '⚠️ La mancata presenza in stanza comporta penalità o annullamento del match.\n\n' +
      '🚫 RESTRIZIONI EQUIPAGGIAMENTO\n\n' +
      'È severamente vietato l’utilizzo di:\n\n' +
      '❌ Mine\n' +
      '❌ Claymore\n' +
      '❌ Psicogranate\n' +
      '❌ Granate Stordenti\n' +
      '❌ Lacrimogeni\n' +
      '❌ Scarica Elettrica\n' +
      '❌ Skin Terminator\n\n' +
      '⚖️ SISTEMA DISCIPLINARE\n\n' +
      '• 1ª infrazione → Richiamo ufficiale\n' +
      '• 2ª infrazione → Sottrazione punti\n' +
      '• 3ª infrazione → Squalifica dal torneo\n\n' +
      'Lo staff può applicare sanzioni immediate in caso di violazioni gravi.\n\n' +
      '🔫 ARMI CONSENTITE\n\n' +
      '✅ Solo ARMI META approvate dallo staff\n' +
      '🎯 È ammesso 1 SOLO CECCHINO per team\n\n' +
      '⚠️ Violazioni:\n\n' +
      '• Utilizzo di 2 cecchini → Penalità immediata\n' +
      '• Uso di armi non consentite → Kill annullate o sottrazione punti\n\n' +
      '🏆 SISTEMA DI PUNTEGGIO\n\n' +
      '🔹 Kill di squadra\n\n' +
      '👉 Si sommano tutte le kill del team\n\n' +
      '📊 Formula ufficiale:\n\n' +
      '(Kill totali di squadra) + Bonus Posizionamento\n\n' +
      '🔹 Bonus Posizionamento\n\n' +
      '🥇 1° Posto → 10 punti\n' +
      '🥈 2° Posto → 6 punti\n' +
      '🥉 3° Posto → 5 punti\n' +
      '4° Posto → 4 punti\n' +
      '5° Posto → 3 punti\n' +
      '6° Posto → 2 punti\n' +
      '7° Posto → 1 punto\n' +
      '8° Posto → 1 punto\n\n' +
      '📸 VALIDAZIONE RISULTATI OBBLIGATORIA\n\n' +
      'Ogni team deve inviare il risultato dal pannello nella propria stanza ufficiale.\n\n' +
      'Lo screenshot deve mostrare chiaramente:\n\n' +
      '• Classifica finale\n' +
      '• Numero totale kill di squadra\n' +
      '• Posizionamento\n\n' +
      'Nel messaggio è obbligatorio indicare:\n\n' +
      '• Nome Team\n' +
      '• Posizione ottenuta\n' +
      '• Kill totali di squadra\n\n' +
      'Se una di queste informazioni manca, il risultato non verrà convalidato.\n\n' +
      '✅ ESEMPIO CORRETTO INVIO RISULTATO\n\n' +
      'Team: RØDA Black\n' +
      'Posizione: 2° Posto\n' +
      'Kill Totali Squadra: 18\n\n' +
      '⚖️ FAIR PLAY\n\n' +
      '• Vietato glitch, exploit o vantaggi illeciti\n' +
      '• Vietato comportamento tossico o antisportivo\n' +
      '• Rispetto obbligatorio verso staff e avversari\n' +
      '• Le decisioni dello staff sono definitive'
  };
}

function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;

  const parts = cookieHeader.split(';');

  for (const part of parts) {
    const index = part.indexOf('=');
    if (index === -1) continue;

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
  while (value.length % 4) value += '=';
  return Buffer.from(value, 'base64').toString('utf8');
}

function createToken(email) {
  const payload = {
    email,
    exp: Date.now() + COOKIE_DURATION_MS
  };

  const encoded = toBase64Url(JSON.stringify(payload));
  const signature = sign(encoded);

  return `${encoded}.${signature}`;
}

function verifyToken(token) {
  try {
    if (!token || typeof token !== 'string') return null;

    const parts = token.split('.');
    if (parts.length !== 2) return null;

    const encoded = parts[0];
    const signature = parts[1];

    if (sign(encoded) !== signature) return null;

    const payload = JSON.parse(fromBase64Url(encoded));

    if (!payload.email || !payload.exp) return null;
    if (Date.now() > payload.exp) return null;

    return payload;
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

  req.staffUser = session.email;
  return next();
}

function sanitizeText(value) {
  return String(value || '').trim();
}

function sanitizeOptionalText(value, maxLength = 200) {
  return String(value || '').trim().slice(0, maxLength);
}

function sanitizePositiveInteger(value, fallback = 1, max = 9999) {
  const num = Number(value);
  if (!Number.isInteger(num) || num <= 0) return fallback;
  return Math.min(num, max);
}

function sanitizeBoolean(value) {
  return value === true || value === 'true' || value === 1 || value === '1' || value === 'on';
}

function normalizeBaseUrl(value) {
  const clean = String(value || '').trim();
  if (!clean) return '';
  return clean.endsWith('/') ? clean.slice(0, -1) : clean;
}

function getPublicBaseUrl(req) {
  const explicit = normalizeBaseUrl(process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL);
  if (explicit) return explicit;

  const railwayDomain = sanitizeText(process.env.RAILWAY_PUBLIC_DOMAIN);
  if (railwayDomain) return `https://${railwayDomain}`;

  if (req) {
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
    const host = req.headers['x-forwarded-host'] || req.get('host');
    if (host) return `${protocol}://${host}`;
  }

  return '';
}

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeProjectSettings(projectSettings) {
  const defaults = getDefaultProjectSettings ? getDefaultProjectSettings() : {
    brandName: 'RØDA',
    tournamentName: FIXED_TOURNAMENT_NAME,
    supportContact: '',
    premiumMode: false,
    setupCompleted: false
  };

  const safe = isObject(projectSettings) ? projectSettings : {};

  return {
    brandName: sanitizeText(safe.brandName) || defaults.brandName || 'RØDA',
    tournamentName: FIXED_TOURNAMENT_NAME,
    supportContact: sanitizeText(safe.supportContact),
    premiumMode: Boolean(safe.premiumMode),
    setupCompleted: Boolean(safe.setupCompleted)
  };
}

function normalizeBotSettings(botSettings) {
  const defaults = getDefaultBotSettings ? getDefaultBotSettings() : {};
  const safe = isObject(botSettings) ? botSettings : {};

  return {
    registerPanelMessageId: safe.registerPanelMessageId || defaults.registerPanelMessageId || null,
    registerPanelChannelId: sanitizeText(safe.registerPanelChannelId || defaults.registerPanelChannelId || ''),
    resultsPanelMessageId: safe.resultsPanelMessageId || defaults.resultsPanelMessageId || null,
    resultsPanelChannelId: sanitizeText(safe.resultsPanelChannelId || defaults.resultsPanelChannelId || ''),
    roomsCategoryId: sanitizeText(safe.roomsCategoryId || defaults.roomsCategoryId || ''),
    generalChannelId: sanitizeText(safe.generalChannelId || defaults.generalChannelId || ''),
    rulesChannelId: sanitizeText(safe.rulesChannelId || defaults.rulesChannelId || ''),
    lobbyChannelId: sanitizeText(safe.lobbyChannelId || defaults.lobbyChannelId || '')
  };
}

function normalizeTournamentSettings(tournamentSettings) {
  const defaults = getDefaultTournamentSettings();
  const safe = isObject(tournamentSettings) ? tournamentSettings : {};

  return {
    tournamentName: FIXED_TOURNAMENT_NAME,
    totalMatches: sanitizePositiveInteger(safe.totalMatches, defaults.totalMatches, 50),
    playersPerTeam: PLAYERS_PER_TEAM,
    maxTeams: MAX_TEAMS,
    lockedRules: true,
    lockedPoints: true,
    createdAt: safe.createdAt || null,
    createdBy: sanitizeText(safe.createdBy),
    lastConfiguredAt: safe.lastConfiguredAt || null,
    lastConfiguredBy: sanitizeText(safe.lastConfiguredBy)
  };
}

function normalizeTournamentMessages(tournamentMessages) {
  const defaults = getDefaultTournamentMessages();
  const safe = isObject(tournamentMessages) ? tournamentMessages : {};

  return {
    generalAnnouncement: sanitizeText(safe.generalAnnouncement) || defaults.generalAnnouncement,
    lobbyInfoMessage: sanitizeText(safe.lobbyInfoMessage) || defaults.lobbyInfoMessage,
    regulationText: defaults.regulationText
  };
}

function ensureRuntimeData(data) {
  const defaults = getDefaultData();
  const safe = isObject(data) ? data : defaults;

  if (!safe.pending || !isObject(safe.pending)) safe.pending = {};
  if (!safe.tempSubmit || !isObject(safe.tempSubmit)) safe.tempSubmit = {};
  if (!safe.resultSubmissions || !isObject(safe.resultSubmissions)) safe.resultSubmissions = {};
  if (!safe.scores || !isObject(safe.scores)) safe.scores = {};
  if (!safe.fragger || !isObject(safe.fragger)) safe.fragger = {};

  safe.currentMatch = sanitizePositiveInteger(safe.currentMatch, 1, 50);

  safe.projectSettings = normalizeProjectSettings(safe.projectSettings);
  safe.botSettings = normalizeBotSettings(safe.botSettings);
  safe.tournamentSettings = normalizeTournamentSettings(safe.tournamentSettings);
  safe.tournamentMessages = normalizeTournamentMessages(safe.tournamentMessages);

  safe.registrationMaxTeams = MAX_TEAMS;
  safe.registrationStatusTitle = sanitizeText(safe.registrationStatusTitle || '📋 Slot Team Registrati') || '📋 Slot Team Registrati';
  safe.registrationStatusText = sanitizeText(safe.registrationStatusText || '');
  safe.registrationStatusMessageId = safe.registrationStatusMessageId || null;
  safe.registrationClosedAnnounced = Boolean(safe.registrationClosedAnnounced);

  safe.projectSettings.tournamentName = FIXED_TOURNAMENT_NAME;
  safe.tournamentSettings.tournamentName = FIXED_TOURNAMENT_NAME;
  safe.tournamentSettings.playersPerTeam = PLAYERS_PER_TEAM;
  safe.tournamentSettings.maxTeams = MAX_TEAMS;
  safe.tournamentSettings.lockedRules = true;
  safe.tournamentSettings.lockedPoints = true;

  if (safe.currentMatch > safe.tournamentSettings.totalMatches) {
    safe.currentMatch = safe.tournamentSettings.totalMatches;
  }

  return safe;
}

function loadRuntimeData() {
  return ensureRuntimeData(loadData());
}

function saveRuntimeData(data) {
  const safe = ensureRuntimeData(data);
  return saveData(safe);
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

function normalizeSubmissionTeamName(teamName) {
  return sanitizeText(teamName).toLowerCase();
}

function buildSubmissionKey(teamName, matchNumber) {
  return `${normalizeSubmissionTeamName(teamName)}::match_${Number(matchNumber || 1)}`;
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

function getResultSubmissionRecord(data, teamName, matchNumber) {
  data = ensureRuntimeData(data);

  const key = buildSubmissionKey(teamName, matchNumber);
  const saved = data.resultSubmissions?.[key];

  if (saved) {
    return {
      team: saved.team || teamName,
      matchNumber: Number(saved.matchNumber || matchNumber || 1),
      stato: saved.status || 'non_inviato',
      pendingId: saved.pendingId || null,
      aggiornatoIl: saved.updatedAt || '',
      aggiornatoDa: saved.updatedBy || '',
      origine: saved.source || ''
    };
  }

  const pending = getPendingForTeamMatch(data, teamName, matchNumber);

  if (pending) {
    return {
      team: pending.team || teamName,
      matchNumber: Number(pending.matchNumber || matchNumber || 1),
      stato: 'in_attesa',
      pendingId: pending.id,
      aggiornatoIl: '',
      aggiornatoDa: pending.submittedBy || '',
      origine: pending.source || ''
    };
  }

  return {
    team: teamName,
    matchNumber: Number(matchNumber || 1),
    stato: 'non_inviato',
    pendingId: null,
    aggiornatoIl: '',
    aggiornatoDa: '',
    origine: ''
  };
}

function getItalianStatusLabel(status) {
  if (status === 'in_attesa') return 'In attesa';
  if (status === 'approvato') return 'Approvato';
  if (status === 'rifiutato') return 'Rifiutato';
  if (status === 'assente') return 'Assente';
  if (status === 'inserito_manualmente') return 'Inserito manualmente';
  return 'Non inviato';
}

function isFinalMatchStatus(status) {
  return ['approvato', 'assente', 'inserito_manualmente'].includes(status);
}

function buildMatchTeamRows(data, teams, matchNumber) {
  data = ensureRuntimeData(data);
  const targetMatch = Number(matchNumber || 1);

  return sortTeamsWithSlot(teams).map(([teamName, teamData]) => {
    const record = getResultSubmissionRecord(data, teamName, targetMatch);
    const pending = getPendingForTeamMatch(data, teamName, targetMatch);

    return {
      team: teamName,
      slot: teamData?.slot || null,
      players: Array.isArray(teamData?.players) ? teamData.players : [],
      matchNumber: targetMatch,
      stato: record.stato,
      statoTesto: getItalianStatusLabel(record.stato),
      pendingId: record.pendingId || pending?.id || null,
      aggiornatoIl: record.aggiornatoIl || '',
      aggiornatoDa: record.aggiornatoDa || '',
      origine: record.origine || '',
      risultato: pending
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
        : null
    };
  });
}

function buildMatchOverview(data, teams, matchNumber) {
  const rows = buildMatchTeamRows(data, teams, matchNumber);

  const teamInAttesa = rows.filter(row => row.stato === 'in_attesa');
  const teamApprovati = rows.filter(row => row.stato === 'approvato' || row.stato === 'inserito_manualmente');
  const teamRifiutati = rows.filter(row => row.stato === 'rifiutato');
  const teamNonInviati = rows.filter(row => row.stato === 'non_inviato');
  const teamAssenti = rows.filter(row => row.stato === 'assente');
  const teamChiusi = rows.filter(row => isFinalMatchStatus(row.stato));

  return {
    matchNumber: Number(matchNumber || 1),
    totaleTeam: rows.length,
    completato: rows.length > 0 && teamChiusi.length === rows.length,
    inviati: rows.filter(row => row.stato !== 'non_inviato').length,
    chiusi: teamChiusi.length,
    inAttesa: teamInAttesa.length,
    approvati: teamApprovati.length,
    rifiutati: teamRifiutati.length,
    nonInviati: teamNonInviati.length,
    assenti: teamAssenti.length,
    righe: rows,
    teamMancanti: rows.filter(row => row.stato === 'non_inviato' || row.stato === 'rifiutato')
  };
}

function buildAllMatchOverviews(data, teams) {
  data = ensureRuntimeData(data);

  const tournamentSettings = normalizeTournamentSettings(data.tournamentSettings);
  const totalMatches = Math.max(Number(tournamentSettings.totalMatches || 3), Number(data.currentMatch || 1), 1);
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
    stato: 'in_attesa',
    statoTesto: 'In attesa'
  }));
}

function buildSetupStatus(data) {
  data = ensureRuntimeData(data);

  const projectSettings = normalizeProjectSettings(data.projectSettings);
  const botSettings = normalizeBotSettings(data.botSettings);

  return {
    completato: Boolean(projectSettings.setupCompleted),
    controlli: {
      nomeBrand: Boolean(projectSettings.brandName),
      nomeTorneo: projectSettings.tournamentName === FIXED_TOURNAMENT_NAME,
      canalePannelloRegistrazione: Boolean(botSettings.registerPanelChannelId),
      categoriaStanze: Boolean(botSettings.roomsCategoryId)
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
  const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
  const filePath = path.join(UPLOADS_DIR, fileName);

  fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));

  const baseUrl = getPublicBaseUrl(req);
  if (!baseUrl) return `/uploads/${fileName}`;

  return `${baseUrl}/uploads/${fileName}`;
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

function getPreservedSettings(data) {
  data = ensureRuntimeData(data);

  return {
    projectSettings: normalizeProjectSettings(data.projectSettings),
    tournamentSettings: normalizeTournamentSettings(data.tournamentSettings),
    botSettings: normalizeBotSettings(data.botSettings),
    tournamentMessages: normalizeTournamentMessages(data.tournamentMessages),
    registrationStatusTitle: sanitizeText(data.registrationStatusTitle || '📋 Slot Team Registrati') || '📋 Slot Team Registrati',
    registrationStatusText: sanitizeText(data.registrationStatusText || ''),
    registrationMaxTeams: MAX_TEAMS,
    registrationStatusMessageId: data.registrationStatusMessageId || null,
    leaderboardMessageId: data.leaderboardMessageId || null,
    leaderboardGraphicMessageId: data.leaderboardGraphicMessageId || null,
    topFraggerGraphicMessageId: data.topFraggerGraphicMessageId || null
  };
}

function applyPreservedSettings(targetData, preserved) {
  targetData.projectSettings = preserved.projectSettings;
  targetData.tournamentSettings = preserved.tournamentSettings;
  targetData.botSettings = preserved.botSettings;
  targetData.tournamentMessages = preserved.tournamentMessages;
  targetData.registrationStatusTitle = preserved.registrationStatusTitle;
  targetData.registrationStatusText = preserved.registrationStatusText;
  targetData.registrationMaxTeams = MAX_TEAMS;
  targetData.registrationStatusMessageId = preserved.registrationStatusMessageId;

  targetData.leaderboardMessageId = preserved.leaderboardMessageId || null;
  targetData.leaderboardGraphicMessageId = preserved.leaderboardGraphicMessageId || null;
  targetData.topFraggerGraphicMessageId = preserved.topFraggerGraphicMessageId || null;

  return ensureRuntimeData(targetData);
}

function getNextAvailableSlot(teams, maxTeams) {
  const used = new Set(
    Object.values(teams || {})
      .map(team => Number(team?.slot))
      .filter(slot => Number.isInteger(slot) && slot >= 1)
  );

  for (let i = 1; i <= maxTeams; i++) {
    if (!used.has(i)) return i;
  }

  return null;
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
      console.error(`Errore lettura ${pointsPath}:`, error);
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

function canManualInsertResult(data, teamName, matchNumber) {
  data = ensureRuntimeData(data);

  const record = getResultSubmissionRecord(data, teamName, matchNumber);

  if (record.stato === 'approvato' || record.stato === 'inserito_manualmente') {
    return {
      allowed: false,
      message: 'Questo team ha già un risultato valido per questo match.'
    };
  }

  if (record.stato === 'in_attesa') {
    return {
      allowed: false,
      message: 'Questo team ha già un risultato in attesa. Approvalo o rifiutalo prima di inserire un risultato manuale.'
    };
  }

  return {
    allowed: true,
    message: ''
  };
}

async function updateLeaderboardWithoutCreating() {
  try {
    return await bot.updateLeaderboard({
      allowCreate: false
    });
  } catch (error) {
    console.error('Errore aggiornamento classifica senza creare:', error);
    return {
      ok: false,
      message: error.message || 'Errore aggiornamento classifica'
    };
  }
}

async function applyManualResult({ req, team, k1, k2, k3, pos, matchNumber }) {
  let data = loadRuntimeData();
  const teams = loadTeams();

  const teamName = sanitizeText(team);
  const targetMatch = sanitizePositiveInteger(matchNumber, Number(data.currentMatch || 1), 50);

  if (!teamName || !teams[teamName]) {
    throw new Error('Team non trovato');
  }

  const tournamentSettings = normalizeTournamentSettings(data.tournamentSettings);

  if (targetMatch > tournamentSettings.totalMatches) {
    throw new Error(`Il torneo ha solo ${tournamentSettings.totalMatches} match configurati.`);
  }

  const check = canManualInsertResult(data, teamName, targetMatch);

  if (!check.allowed) {
    throw new Error(check.message);
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

  const key = buildSubmissionKey(teamName, targetMatch);

  data.resultSubmissions[key] = {
    team: teamName,
    matchNumber: targetMatch,
    status: 'inserito_manualmente',
    pendingId: null,
    updatedAt: new Date().toISOString(),
    updatedBy: sanitizeText(req.staffUser || 'admin'),
    source: 'web'
  };

  const saved = saveRuntimeData(data);

  bot.setDataState(saved);
  bot.setTeamsState(teams);

  await bot.refreshTeamResultPanels().catch(error => {
    console.error('Errore aggiornamento pannelli dopo risultato manuale:', error);
  });

  await bot.updateLeaderboard({
    allowCreate: true
  }).catch(error => {
    console.error('Errore aggiornamento classifica dopo risultato manuale:', error);
  });

  logAudit(req.staffUser, 'web', 'risultato_inserito_manualmente', {
    team: teamName,
    matchNumber: targetMatch,
    kills,
    totalKills,
    pos: placement,
    addedPoints
  });

  return {
    ok: true,
    team: teamName,
    matchNumber: targetMatch,
    kills,
    totalKills,
    pos: placement,
    addedPoints,
    totalScore: saved.scores[teamName]
  };
}

function buildDashboardPayload() {
  const data = loadRuntimeData();
  const teams = loadTeams();
  const auditLog = loadAuditLog();
  const archives = listTournamentArchives();

  const projectSettings = normalizeProjectSettings(data.projectSettings);
  const tournamentSettings = normalizeTournamentSettings(data.tournamentSettings);
  const tournamentMessages = normalizeTournamentMessages(data.tournamentMessages);

  const currentMatch = Number(data.currentMatch || 1);
  const statoMatchCorrente = buildMatchOverview(data, teams, currentMatch);

  bot.setDataState(data);
  bot.setTeamsState(teams);

  return {
    ok: true,
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
    botConfig: bot.getBotConfig(),
    impostazioniRegistrazione: {
      titolo: data.registrationStatusTitle || '📋 Slot Team Registrati',
      testo: data.registrationStatusText || '',
      maxTeams: MAX_TEAMS
    },
    impostazioniProgetto: projectSettings,
    impostazioniTorneo: tournamentSettings,
    messaggiTorneo: tournamentMessages,
    statoSetup: buildSetupStatus(data),
    statistiche: {
      totaleTeam: Object.keys(teams).length,
      totalePending: Object.keys(data.pending || {}).length,
      totaleFragger: Object.keys(data.fragger || {}).length,
      teamMancantiMatchCorrente: statoMatchCorrente.teamMancanti.length,
      risultatiInAttesaMatchCorrente: statoMatchCorrente.inAttesa,
      totaleMatch: tournamentSettings.totalMatches
    },
    auditLog: auditLog.slice(-120).reverse(),
    archivi: archives,
    puntiUfficiali: loadPointsConfig()
  };
}

function buildPublicPayload(req) {
  const data = loadRuntimeData();
  const teams = loadTeams();
  const projectSettings = normalizeProjectSettings(data.projectSettings);
  const tournamentSettings = normalizeTournamentSettings(data.tournamentSettings);

  const maxTeams = MAX_TEAMS;
  const teamOrdinati = sortTeamsWithSlot(teams).map(([teamName, teamData]) => ({
    team: teamName,
    slot: teamData.slot || null,
    players: teamData.players || []
  }));

  return {
    ok: true,
    torneo: {
      brandName: projectSettings.brandName || 'RØDA',
      tournamentName: FIXED_TOURNAMENT_NAME,
      supportContact: projectSettings.supportContact || '',
      premiumMode: Boolean(projectSettings.premiumMode),
      matchCorrente: Number(data.currentMatch || 1),
      totalMatches: tournamentSettings.totalMatches,
      playersPerTeam: PLAYERS_PER_TEAM,
      teamRegistrati: Object.keys(teams).length,
      maxTeams,
      postiDisponibili: Math.max(maxTeams - Object.keys(teams).length, 0),
      registrazioniAperte: Object.keys(teams).length < maxTeams
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

  if (session) return res.redirect('/admin');

  return res.sendFile(path.join(PUBLIC_DIR, 'login.html'));
});

app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static(PUBLIC_DIR, { index: false }));

app.get('/api/public/dashboard', (req, res) => {
  return res.json(buildPublicPayload(req));
});

app.post('/api/public/register-team', async (req, res) => {
  try {
    const data = loadRuntimeData();
    const teams = loadTeams();

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

    const totalTeams = Object.keys(teams).length;

    if (totalTeams >= MAX_TEAMS) {
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

    if (Object.keys(teams).length < MAX_TEAMS) {
      data.registrationClosedAnnounced = false;
    }

    data.registrationMaxTeams = MAX_TEAMS;

    const savedTeams = saveTeams(teams);
    const savedData = saveRuntimeData(data);

    bot.setDataState(savedData);
    bot.setTeamsState(savedTeams);

    await bot.handleRegistrationStateChange();

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

app.post('/api/login', (req, res) => {
  const email = sanitizeText(req.body.email);
  const password = String(req.body.password || '');

  if (email !== DASHBOARD_EMAIL || password !== DASHBOARD_PASSWORD) {
    logAudit(email || 'unknown', 'web', 'login_fallito', {});
    return res.status(401).json({
      ok: false,
      message: 'Credenziali non valide'
    });
  }

  const token = createToken(email);
  res.setHeader('Set-Cookie', buildCookie(token));

  logAudit(email, 'web', 'login_riuscito', {});

  return res.json({
    ok: true,
    email
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
    email: session.email
  });
});

app.post('/api/logout', (req, res) => {
  const cookies = parseCookies(req.headers.cookie || '');
  const token = cookies[COOKIE_NAME];
  const session = verifyToken(token);

  if (session?.email) {
    logAudit(session.email, 'web', 'logout', {});
  }

  res.setHeader('Set-Cookie', clearCookie());

  return res.json({
    ok: true
  });
});

app.get('/api/dashboard', authRequired, (req, res) => {
  return res.json(buildDashboardPayload());
});

app.get('/api/match-status/:matchNumber', authRequired, (req, res) => {
  const data = loadRuntimeData();
  const teams = loadTeams();
  const matchNumber = sanitizePositiveInteger(req.params.matchNumber, Number(data.currentMatch || 1), 50);

  return res.json({
    ok: true,
    statoMatch: buildMatchOverview(data, teams, matchNumber)
  });
});

app.get('/api/tournament/settings', authRequired, (req, res) => {
  const data = loadRuntimeData();

  return res.json({
    ok: true,
    impostazioniTorneo: normalizeTournamentSettings(data.tournamentSettings),
    messaggiTorneo: normalizeTournamentMessages(data.tournamentMessages),
    puntiUfficiali: loadPointsConfig()
  });
});

app.post('/api/tournament/configure', authRequired, async (req, res) => {
  try {
    const data = loadRuntimeData();
    const teams = loadTeams();

    const totalMatches = sanitizePositiveInteger(req.body.totalMatches, 3, 50);
    const resetCurrentMatch = sanitizeBoolean(req.body.resetCurrentMatch);

    data.projectSettings = normalizeProjectSettings(data.projectSettings);

    data.tournamentSettings = {
      ...normalizeTournamentSettings(data.tournamentSettings),
      tournamentName: FIXED_TOURNAMENT_NAME,
      totalMatches,
      playersPerTeam: PLAYERS_PER_TEAM,
      maxTeams: MAX_TEAMS,
      lockedRules: true,
      lockedPoints: true,
      createdAt: data.tournamentSettings?.createdAt || new Date().toISOString(),
      createdBy: data.tournamentSettings?.createdBy || req.staffUser,
      lastConfiguredAt: new Date().toISOString(),
      lastConfiguredBy: req.staffUser
    };

    data.registrationMaxTeams = MAX_TEAMS;

    if (resetCurrentMatch) {
      data.currentMatch = 1;
    }

    if (Number(data.currentMatch || 1) > totalMatches) {
      data.currentMatch = totalMatches;
    }

    const saved = saveRuntimeData(data);

    bot.setDataState(saved);
    bot.setTeamsState(teams);

    await bot.updateLeaderboard({
      allowCreate: true
    }).catch(error => {
      console.error('Errore aggiornamento classifica dopo configurazione torneo:', error);
    });

    logAudit(req.staffUser, 'web', 'torneo_configurato', {
      tournamentName: FIXED_TOURNAMENT_NAME,
      totalMatches,
      playersPerTeam: PLAYERS_PER_TEAM,
      maxTeams: MAX_TEAMS,
      resetCurrentMatch
    });

    return res.json({
      ok: true,
      impostazioniTorneo: normalizeTournamentSettings(saved.tournamentSettings)
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message || 'Errore configurazione torneo'
    });
  }
});

app.post('/api/tournament/messages/save', authRequired, async (req, res) => {
  try {
    const data = loadRuntimeData();
    const defaults = getDefaultTournamentMessages();

    data.tournamentMessages = {
      generalAnnouncement: sanitizeOptionalText(req.body.generalAnnouncement, 3000) || defaults.generalAnnouncement,
      lobbyInfoMessage: sanitizeOptionalText(req.body.lobbyInfoMessage, 1200) || defaults.lobbyInfoMessage,
      regulationText: defaults.regulationText
    };

    const saved = saveRuntimeData(data);
    bot.setDataState(saved);

    logAudit(req.staffUser, 'web', 'messaggi_torneo_salvati', {
      generalAnnouncementLength: data.tournamentMessages.generalAnnouncement.length,
      lobbyInfoMessageLength: data.tournamentMessages.lobbyInfoMessage.length,
      regulationLocked: true
    });

    return res.json({
      ok: true,
      messaggiTorneo: normalizeTournamentMessages(saved.tournamentMessages)
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message || 'Errore salvataggio messaggi torneo'
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

app.post('/api/archivi/crea', authRequired, (req, res) => {
  try {
    const data = loadRuntimeData();
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

app.post('/api/archivi/ripristina', authRequired, async (req, res) => {
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

    const currentData = loadRuntimeData();
    const currentTeams = loadTeams();

    createTournamentArchive(currentData, currentTeams, {
      label: `Backup pre-ripristino ${archive.meta.label || archive.archiveId}`,
      note: `Backup automatico prima del ripristino di ${archive.archiveId}`,
      actor: req.staffUser,
      source: 'web'
    });

    const restoredData = ensureRuntimeData(archive.data);
    const restoredTeams = archive.teams || {};

    const savedData = saveRuntimeData(restoredData);
    const savedTeams = saveTeams(restoredTeams);

    bot.setDataState(savedData);
    bot.setTeamsState(savedTeams);

    await updateLeaderboardWithoutCreating();

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

app.post('/api/project-settings/save', authRequired, async (req, res) => {
  try {
    const data = loadRuntimeData();

    data.projectSettings = {
      ...(data.projectSettings || getDefaultProjectSettings()),
      brandName: sanitizeOptionalText(req.body.brandName, 60) || 'RØDA',
      tournamentName: FIXED_TOURNAMENT_NAME,
      supportContact: sanitizeOptionalText(req.body.supportContact, 120),
      premiumMode: sanitizeBoolean(req.body.premiumMode),
      setupCompleted: sanitizeBoolean(req.body.setupCompleted)
    };

    const saved = saveRuntimeData(data);

    bot.setDataState(saved);

    logAudit(req.staffUser, 'web', 'impostazioni_progetto_salvate', {
      brandName: saved.projectSettings.brandName,
      tournamentName: FIXED_TOURNAMENT_NAME,
      premiumMode: saved.projectSettings.premiumMode,
      setupCompleted: saved.projectSettings.setupCompleted
    });

    return res.json({
      ok: true,
      projectSettings: normalizeProjectSettings(saved.projectSettings)
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message || 'Errore salvataggio impostazioni progetto'
    });
  }
});

app.post('/api/bot/settings/save', authRequired, async (req, res) => {
  try {
    const settings = bot.saveBotPanelSettings({
      registerPanelChannelId: sanitizeText(req.body.registerPanelChannelId),
      resultsPanelChannelId: sanitizeText(req.body.resultsPanelChannelId),
      roomsCategoryId: sanitizeText(req.body.roomsCategoryId),
      generalChannelId: sanitizeText(req.body.generalChannelId),
      rulesChannelId: sanitizeText(req.body.rulesChannelId),
      lobbyChannelId: sanitizeText(req.body.lobbyChannelId)
    });

    logAudit(req.staffUser, 'web', 'impostazioni_bot_salvate', settings);

    return res.json({
      ok: true,
      settings
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message || 'Errore salvataggio impostazioni bot'
    });
  }
});

app.post('/api/teams/save', authRequired, async (req, res) => {
  const teams = loadTeams();
  const data = loadRuntimeData();

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

  if (oldTeamName && oldTeamName !== teamName) {
    if (teams[oldTeamName]) {
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
    }
  } else {
    const existingSlot = teams[teamName]?.slot || null;

    teams[teamName] = {
      slot: existingSlot || getNextAvailableSlot(teams, MAX_TEAMS),
      players: [p1, p2, p3]
    };
  }

  if (Object.keys(teams).length < MAX_TEAMS) {
    data.registrationClosedAnnounced = false;
  }

  data.registrationMaxTeams = MAX_TEAMS;

  const savedTeams = saveTeams(teams);
  const savedData = saveRuntimeData(data);

  bot.setDataState(savedData);
  bot.setTeamsState(savedTeams);

  await bot.handleRegistrationStateChange();

  logAudit(req.staffUser, 'web', 'team_salvato', {
    oldTeamName,
    teamName
  });

  return res.json({
    ok: true
  });
});

app.post('/api/teams/delete', authRequired, async (req, res) => {
  const teamName = sanitizeText(req.body.teamName);

  if (!teamName) {
    return res.status(400).json({
      ok: false,
      message: 'Team non valido'
    });
  }

  const teams = loadTeams();
  const data = loadRuntimeData();

  delete teams[teamName];
  delete data.scores[teamName];

  for (const id of Object.keys(data.pending || {})) {
    if (data.pending[id]?.team === teamName) {
      delete data.pending[id];
    }
  }

  for (const key of Object.keys(data.resultSubmissions || {})) {
    if (normalizeSubmissionTeamName(data.resultSubmissions[key]?.team) === normalizeSubmissionTeamName(teamName)) {
      delete data.resultSubmissions[key];
    }
  }

  if (Object.keys(teams).length < MAX_TEAMS) {
    data.registrationClosedAnnounced = false;
  }

  data.registrationMaxTeams = MAX_TEAMS;

  const savedTeams = saveTeams(teams);
  const savedData = saveRuntimeData(data);

  bot.setDataState(savedData);
  bot.setTeamsState(savedTeams);

  await bot.handleRegistrationStateChange();

  logAudit(req.staffUser, 'web', 'team_eliminato', {
    teamName
  });

  return res.json({
    ok: true
  });
});

app.post('/api/registration-settings/save', authRequired, async (req, res) => {
  const data = loadRuntimeData();
  const teams = loadTeams();

  const title = sanitizeOptionalText(req.body.title, 100);
  const text = sanitizeOptionalText(req.body.text, 250);

  data.registrationStatusTitle = title || '📋 Slot Team Registrati';
  data.registrationStatusText = text || '';
  data.registrationMaxTeams = MAX_TEAMS;

  if (Object.keys(teams).length < MAX_TEAMS) {
    data.registrationClosedAnnounced = false;
  }

  const saved = saveRuntimeData(data);

  bot.setDataState(saved);
  bot.setTeamsState(teams);

  await bot.handleRegistrationStateChange();

  logAudit(req.staffUser, 'web', 'impostazioni_registrazione_salvate', {
    title: saved.registrationStatusTitle,
    maxTeams: MAX_TEAMS
  });

  return res.json({
    ok: true
  });
});

app.post('/api/registration-settings/refresh', authRequired, async (req, res) => {
  try {
    const data = loadRuntimeData();
    const teams = loadTeams();

    bot.setDataState(data);
    bot.setTeamsState(teams);

    await bot.updateRegistrationStatusMessage();

    logAudit(req.staffUser, 'web', 'messaggio_registrazione_aggiornato', {});

    return res.json({
      ok: true
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message || 'Errore aggiornamento messaggio slot'
    });
  }
});

app.post('/api/match/set', authRequired, async (req, res) => {
  try {
    const data = loadRuntimeData();
    const tournamentSettings = normalizeTournamentSettings(data.tournamentSettings);
    const match = sanitizePositiveInteger(req.body.match, 1, tournamentSettings.totalMatches);

    if (match > tournamentSettings.totalMatches) {
      return res.status(400).json({
        ok: false,
        message: `Il torneo ha solo ${tournamentSettings.totalMatches} match configurati.`
      });
    }

    const currentMatch = await bot.setCurrentMatchAndRefresh(match);

    logAudit(req.staffUser, 'web', 'match_impostato', {
      currentMatch: match
    });

    return res.json({
      ok: true,
      currentMatch
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message || 'Errore aggiornamento match'
    });
  }
});

app.post('/api/match/next', authRequired, async (req, res) => {
  try {
    const currentMatch = await bot.nextMatchAndRefresh();

    logAudit(req.staffUser, 'web', 'match_successivo', {
      currentMatch
    });

    return res.json({
      ok: true,
      currentMatch
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message || 'Errore passaggio match'
    });
  }
});

app.post('/api/scores/add', authRequired, async (req, res) => {
  const data = loadRuntimeData();
  const team = sanitizeText(req.body.team);
  const points = Number(req.body.points || 0);

  if (!team || !Number.isFinite(points)) {
    return res.status(400).json({
      ok: false,
      message: 'Dati punti non validi'
    });
  }

  data.scores[team] = Number(data.scores[team] || 0) + points;

  const saved = saveRuntimeData(data);

  bot.setDataState(saved);

  await bot.updateLeaderboard({
    allowCreate: true
  });

  logAudit(req.staffUser, 'web', 'punti_aggiunti', {
    team,
    points,
    total: saved.scores[team]
  });

  return res.json({
    ok: true,
    score: saved.scores[team]
  });
});

app.post('/api/scores/set', authRequired, async (req, res) => {
  const data = loadRuntimeData();
  const team = sanitizeText(req.body.team);
  const points = Number(req.body.points || 0);

  if (!team || !Number.isFinite(points)) {
    return res.status(400).json({
      ok: false,
      message: 'Dati non validi'
    });
  }

  data.scores[team] = points;

  const saved = saveRuntimeData(data);

  bot.setDataState(saved);

  await bot.updateLeaderboard({
    allowCreate: true
  });

  logAudit(req.staffUser, 'web', 'punti_impostati', {
    team,
    points
  });

  return res.json({
    ok: true,
    score: saved.scores[team]
  });
});

app.post('/api/scores/reset-team', authRequired, async (req, res) => {
  const data = loadRuntimeData();
  const team = sanitizeText(req.body.team);

  if (!team) {
    return res.status(400).json({
      ok: false,
      message: 'Team non valido'
    });
  }

  data.scores[team] = 0;

  const saved = saveRuntimeData(data);

  bot.setDataState(saved);

  await bot.updateLeaderboard({
    allowCreate: true
  });

  logAudit(req.staffUser, 'web', 'punti_team_azzerati', {
    team
  });

  return res.json({
    ok: true
  });
});

app.post('/api/fragger/set', authRequired, async (req, res) => {
  const data = loadRuntimeData();
  const player = sanitizeOptionalText(req.body.player, 40);
  const kills = Number(req.body.kills || 0);

  if (!player || !Number.isFinite(kills)) {
    return res.status(400).json({
      ok: false,
      message: 'Dati fragger non validi'
    });
  }

  data.fragger[player] = kills;

  const saved = saveRuntimeData(data);

  bot.setDataState(saved);

  await bot.updateLeaderboard({
    allowCreate: true
  });

  logAudit(req.staffUser, 'web', 'fragger_salvato', {
    player,
    kills
  });

  return res.json({
    ok: true,
    kills
  });
});

app.post('/api/fragger/delete', authRequired, async (req, res) => {
  const data = loadRuntimeData();
  const player = sanitizeText(req.body.player);

  if (!player) {
    return res.status(400).json({
      ok: false,
      message: 'Giocatore non valido'
    });
  }

  delete data.fragger[player];

  const saved = saveRuntimeData(data);

  bot.setDataState(saved);

  await bot.updateLeaderboard({
    allowCreate: true
  });

  logAudit(req.staffUser, 'web', 'fragger_eliminato', {
    player
  });

  return res.json({
    ok: true
  });
});

app.post('/api/approve/:id', authRequired, async (req, res) => {
  try {
    const result = await bot.approvePending(req.params.id, req.staffUser, 'web');
    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message || 'Errore approvazione'
    });
  }
});

app.post('/api/reject/:id', authRequired, async (req, res) => {
  try {
    const result = await bot.rejectPending(req.params.id, req.staffUser, 'web');
    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message || 'Errore rifiuto'
    });
  }
});

app.post('/api/manual-result', authRequired, async (req, res) => {
  try {
    const data = loadRuntimeData();

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

app.post('/api/reset-data', authRequired, async (req, res) => {
  try {
    const currentTeams = loadTeams();
    const currentData = loadRuntimeData();

    createTournamentArchive(currentData, currentTeams, {
      label: `Backup prima reset classifica ${new Date().toLocaleString('it-IT')}`,
      note: 'Backup automatico prima del reset classifica, fragger e match',
      actor: req.staffUser,
      source: 'web'
    });

    const preserved = getPreservedSettings(currentData);

    let data = getDefaultData();
    data = applyPreservedSettings(data, preserved);

    data.currentMatch = 1;
    data.pending = {};
    data.tempSubmit = {};
    data.resultSubmissions = {};
    data.scores = {};
    data.fragger = {};
    data.registrationClosedAnnounced = Object.keys(currentTeams).length >= MAX_TEAMS;
    data.registrationMaxTeams = MAX_TEAMS;

    const saved = saveRuntimeData(data);

    bot.setDataState(saved);
    bot.setTeamsState(currentTeams);

    await updateLeaderboardWithoutCreating();

    logAudit(req.staffUser, 'web', 'reset_dati_senza_creare_messaggi', {
      keepLeaderboardMessageId: Boolean(saved.leaderboardMessageId),
      keepLeaderboardGraphicMessageId: Boolean(saved.leaderboardGraphicMessageId),
      keepTopFraggerGraphicMessageId: Boolean(saved.topFraggerGraphicMessageId)
    });

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

app.post('/api/reset-teams', authRequired, async (req, res) => {
  try {
    const data = loadRuntimeData();
    const currentTeams = loadTeams();

    createTournamentArchive(data, currentTeams, {
      label: `Backup prima reset team ${new Date().toLocaleString('it-IT')}`,
      note: 'Backup automatico prima del reset team',
      actor: req.staffUser,
      source: 'web'
    });

    const emptyTeams = {};

    data.pending = {};
    data.tempSubmit = {};
    data.resultSubmissions = {};
    data.registrationClosedAnnounced = false;
    data.registrationMaxTeams = MAX_TEAMS;

    const savedData = saveRuntimeData(data);
    const savedTeams = saveTeams(emptyTeams);

    bot.setDataState(savedData);
    bot.setTeamsState(savedTeams);

    await updateLeaderboardWithoutCreating();

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

app.post('/api/reset-all', authRequired, async (req, res) => {
  try {
    const currentData = loadRuntimeData();
    const currentTeams = loadTeams();

    createTournamentArchive(currentData, currentTeams, {
      label: `Backup prima reset totale ${new Date().toLocaleString('it-IT')}`,
      note: 'Backup automatico prima del reset totale',
      actor: req.staffUser,
      source: 'web'
    });

    const preserved = getPreservedSettings(currentData);
    let data = getDefaultData();
    data = applyPreservedSettings(data, preserved);

    data.currentMatch = 1;
    data.pending = {};
    data.tempSubmit = {};
    data.resultSubmissions = {};
    data.scores = {};
    data.fragger = {};
    data.registrationClosedAnnounced = false;
    data.registrationMaxTeams = MAX_TEAMS;

    const emptyTeams = {};

    const savedData = saveRuntimeData(data);
    const savedTeams = saveTeams(emptyTeams);

    bot.setDataState(savedData);
    bot.setTeamsState(savedTeams);

    await updateLeaderboardWithoutCreating();

    logAudit(req.staffUser, 'web', 'reset_totale_senza_creare_messaggi', {});

    return res.json({
      ok: true
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message || 'Errore reset totale'
    });
  }
});

app.post('/api/bot/prepare-discord-structure', authRequired, async (req, res) => {
  try {
    const categoryId = sanitizeText(req.body.categoryId);
    const result = await bot.ensureTournamentDiscordStructure(categoryId);

    logAudit(req.staffUser, 'web', 'struttura_discord_preparata', result);

    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message || 'Errore preparazione struttura Discord'
    });
  }
});

app.post('/api/bot/spawn-register-panel', authRequired, async (req, res) => {
  try {
    const channelId = sanitizeText(req.body.channelId);
    const result = await bot.spawnRegisterPanel(channelId);

    logAudit(req.staffUser, 'web', 'pannello_registrazione_inviato', {
      channelId,
      created: Boolean(result.created),
      updated: Boolean(result.updated)
    });

    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message || 'Errore invio pannello registrazione'
    });
  }
});

app.post('/api/bot/spawn-results-panel', authRequired, async (req, res) => {
  try {
    const channelId = sanitizeText(req.body.channelId);
    const result = await bot.spawnResultsPanel(channelId);

    logAudit(req.staffUser, 'web', 'pannelli_risultati_team_aggiornati', {
      channelId,
      teamPanelsCreated: Number(result.teamPanels?.created || 0),
      teamPanelsUpdated: Number(result.teamPanels?.updated || 0),
      missingRooms: Number(result.teamPanels?.missingRooms || 0)
    });

    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message || 'Errore aggiornamento pannelli risultati team'
    });
  }
});

app.post('/api/bot/refresh-team-result-panels', authRequired, async (req, res) => {
  try {
    const categoryId = sanitizeText(req.body.categoryId);
    const result = await bot.refreshTeamResultPanels(categoryId);

    logAudit(req.staffUser, 'web', 'pannelli_risultati_team_refresh_manuale', {
      categoryId,
      created: Number(result.created || 0),
      updated: Number(result.updated || 0),
      missingRooms: Number(result.missingRooms || 0)
    });

    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message || 'Errore aggiornamento pannelli team'
    });
  }
});

app.post('/api/bot/create-rooms', authRequired, async (req, res) => {
  try {
    const categoryId = sanitizeText(req.body.categoryId);
    const result = await bot.createTeamRooms(categoryId);

    logAudit(req.staffUser, 'web', 'stanze_team_create', {
      categoryId,
      created: Number(result.created || 0),
      skipped: Number(result.skipped || 0)
    });

    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message || 'Errore creazione stanze'
    });
  }
});

app.post('/api/bot/delete-rooms', authRequired, async (req, res) => {
  try {
    const categoryId = sanitizeText(req.body.categoryId);
    const result = await bot.deleteTeamRooms(categoryId);

    logAudit(req.staffUser, 'web', 'stanze_team_eliminate', {
      categoryId,
      deleted: Number(result.deleted || 0)
    });

    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message || 'Errore eliminazione stanze'
    });
  }
});

app.post('/api/bot/send-lobby-code', authRequired, async (req, res) => {
  try {
    const lobbyCode = sanitizeText(req.body.lobbyCode);
    const categoryId = sanitizeText(req.body.categoryId);

    if (!lobbyCode) {
      return res.status(400).json({
        ok: false,
        message: 'Codice lobby non valido'
      });
    }

    const result = await bot.sendLobbyCodeToTeamRooms(lobbyCode, categoryId);

    logAudit(req.staffUser, 'web', 'codice_lobby_inviato', {
      lobbyCode,
      categoryId,
      sent: Number(result.sent || 0),
      failed: Number(result.failed || 0),
      total: Number(result.total || 0)
    });

    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message || 'Errore invio codice lobby'
    });
  }
});

app.post('/api/bot/update-leaderboard', authRequired, async (req, res) => {
  try {
    const result = await bot.updateLeaderboard({
      allowCreate: true
    });

    logAudit(req.staffUser, 'web', 'classifica_discord_aggiornata_manualmente', {
      created: Boolean(result.created),
      updated: Boolean(result.updated),
      skipped: Boolean(result.skipped)
    });

    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message || 'Errore aggiornamento classifica Discord'
    });
  }
});

app.post('/api/web-submit-result', authRequired, async (req, res) => {
  try {
    const team = sanitizeText(req.body.team);
    const k1 = Number(req.body.k1 || 0);
    const k2 = Number(req.body.k2 || 0);
    const k3 = Number(req.body.k3 || 0);
    const pos = Number(req.body.pos || 0);
    const imageData = req.body.imageData;

    if (!team || !Number.isFinite(k1) || !Number.isFinite(k2) || !Number.isFinite(k3) || !Number.isFinite(pos)) {
      return res.status(400).json({
        ok: false,
        message: 'Dati risultato non validi'
      });
    }

    let image = '';

    if (imageData) {
      image = saveBase64Image(imageData, req);
    }

    await bot.submitWebResult({
      team,
      k1,
      k2,
      k3,
      pos,
      image,
      submittedBy: req.staffUser
    });

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

app.listen(PORT, HOST, () => {
  console.log(`🌐 DASHBOARD ONLINE su porta ${PORT}`);
});
