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
  saveAll,
  appendAuditLog,
  createTournamentArchive,
  listTournamentArchives,
  getTournamentArchive,
  getDefaultData,
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

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

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
      return res.status(401).json({ ok: false, message: 'Accesso non autorizzato' });
    }

    return res.redirect('/login');
  }

  req.staffUser = session.email;
  next();
}

function sanitizeText(value) {
  return String(value || '').trim();
}

function sanitizeOptionalText(value, maxLength = 200) {
  return String(value || '').trim().slice(0, maxLength);
}

function sanitizePositiveInteger(value, fallback = 1) {
  const num = Number(value);
  return Number.isInteger(num) && num > 0 ? num : fallback;
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
  const key = buildSubmissionKey(teamName, matchNumber);
  const saved = data.resultSubmissions?.[key];

  if (saved) {
    return {
      team: saved.team || teamName,
      matchNumber: Number(saved.matchNumber || matchNumber || 1),
      stato: saved.status || 'non_inviato',
      pendingId: saved.pendingId || null,
      aggiornatoIl: saved.updatedAt || '',
      aggiornatoDa: saved.updatedBy || ''
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
      aggiornatoDa: pending.submittedBy || ''
    };
  }

  return {
    team: teamName,
    matchNumber: Number(matchNumber || 1),
    stato: 'non_inviato',
    pendingId: null,
    aggiornatoIl: '',
    aggiornatoDa: ''
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
  const currentMatch = Number(data.currentMatch || 1);
  const matchCount = Math.max(currentMatch, 1);
  const out = [];

  for (let i = 1; i <= matchCount; i++) {
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
  const projectSettings = data.projectSettings || getDefaultProjectSettings();
  const botSettings = data.botSettings || getDefaultBotSettings();

  return {
    completato: Boolean(projectSettings.setupCompleted),
    controlli: {
      nomeBrand: Boolean(projectSettings.brandName),
      nomeTorneo: Boolean(projectSettings.tournamentName),
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
  return {
    projectSettings: {
      ...(data.projectSettings || getDefaultProjectSettings())
    },
    botSettings: {
      ...(data.botSettings || getDefaultBotSettings())
    },
    registrationStatusTitle: sanitizeText(data.registrationStatusTitle || '📋 Slot Team Registrati') || '📋 Slot Team Registrati',
    registrationStatusText: sanitizeText(data.registrationStatusText || ''),
    registrationMaxTeams: sanitizePositiveInteger(data.registrationMaxTeams, 16),
    registrationStatusMessageId: data.registrationStatusMessageId || null
  };
}

function applyPreservedSettings(targetData, preserved) {
  targetData.projectSettings = preserved.projectSettings;
  targetData.botSettings = preserved.botSettings;
  targetData.registrationStatusTitle = preserved.registrationStatusTitle;
  targetData.registrationStatusText = preserved.registrationStatusText;
  targetData.registrationMaxTeams = preserved.registrationMaxTeams;
  targetData.registrationStatusMessageId = preserved.registrationStatusMessageId;
  return targetData;
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

function buildDashboardPayload() {
  const data = loadData();
  const teams = loadTeams();
  const auditLog = loadAuditLog();
  const archives = listTournamentArchives();
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
      maxTeams: Number(data.registrationMaxTeams || 16)
    },
    impostazioniProgetto: data.projectSettings || getDefaultProjectSettings(),
    statoSetup: buildSetupStatus(data),
    statistiche: {
      totaleTeam: Object.keys(teams).length,
      totalePending: Object.keys(data.pending || {}).length,
      totaleFragger: Object.keys(data.fragger || {}).length,
      teamMancantiMatchCorrente: statoMatchCorrente.teamMancanti.length,
      risultatiInAttesaMatchCorrente: statoMatchCorrente.inAttesa
    },
    auditLog: auditLog.slice(-120).reverse(),
    archivi: archives
  };
}

function buildPublicPayload(req) {
  const data = loadData();
  const teams = loadTeams();
  const projectSettings = data.projectSettings || getDefaultProjectSettings();
  const maxTeams = Number(data.registrationMaxTeams || 16);
  const teamOrdinati = sortTeamsWithSlot(teams).map(([teamName, teamData]) => ({
    team: teamName,
    slot: teamData.slot || null,
    players: teamData.players || []
  }));

  return {
    ok: true,
    torneo: {
      brandName: projectSettings.brandName || 'RØDA',
      tournamentName: projectSettings.tournamentName || 'RØDA CUP',
      supportContact: projectSettings.supportContact || '',
      premiumMode: Boolean(projectSettings.premiumMode),
      matchCorrente: Number(data.currentMatch || 1),
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
    const data = loadData();
    const teams = loadTeams();

    const teamName = sanitizeOptionalText(req.body.teamName, 50);
    const p1 = sanitizeOptionalText(req.body.p1, 40);
    const p2 = sanitizeOptionalText(req.body.p2, 40);
    const p3 = sanitizeOptionalText(req.body.p3, 40);

    if (!teamName || !p1 || !p2 || !p3) {
      return res.status(400).json({ ok: false, message: 'Compila tutti i campi richiesti.' });
    }

    if (teams[teamName]) {
      return res.status(400).json({ ok: false, message: 'Esiste già un team con questo nome.' });
    }

    const maxTeams = Number(data.registrationMaxTeams || 16);
    const totalTeams = Object.keys(teams).length;

    if (totalTeams >= maxTeams) {
      return res.status(400).json({ ok: false, message: 'Le registrazioni sono chiuse: torneo pieno.' });
    }

    const slot = getNextAvailableSlot(teams, maxTeams);
    if (!slot) {
      return res.status(400).json({ ok: false, message: 'Nessuno slot disponibile.' });
    }

    teams[teamName] = {
      slot,
      players: [p1, p2, p3]
    };

    if (Object.keys(teams).length < maxTeams) {
      data.registrationClosedAnnounced = false;
    }

    const saved = saveAll(data, teams);
    bot.setDataState(saved.data);
    bot.setTeamsState(saved.teams);

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
    return res.status(401).json({ ok: false, message: 'Credenziali non valide' });
  }

  const token = createToken(email);
  res.setHeader('Set-Cookie', buildCookie(token));

  logAudit(email, 'web', 'login_riuscito', {});
  return res.json({ ok: true, email });
});

app.get('/api/session', (req, res) => {
  const cookies = parseCookies(req.headers.cookie || '');
  const token = cookies[COOKIE_NAME];
  const session = verifyToken(token);

  if (!session) {
    return res.status(401).json({ ok: false, autenticato: false });
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
  return res.json({ ok: true });
});

app.get('/api/dashboard', authRequired, (req, res) => {
  return res.json(buildDashboardPayload());
});

app.get('/api/match-status/:matchNumber', authRequired, (req, res) => {
  const data = loadData();
  const teams = loadTeams();
  const matchNumber = sanitizePositiveInteger(req.params.matchNumber, Number(data.currentMatch || 1));

  return res.json({
    ok: true,
    statoMatch: buildMatchOverview(data, teams, matchNumber)
  });
});

app.get('/api/audit-log', authRequired, (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit || 120), 1), 500);
  const auditLog = loadAuditLog().slice(-limit).reverse();
  return res.json({ ok: true, auditLog });
});

app.get('/api/archivi', authRequired, (req, res) => {
  const archivi = listTournamentArchives();
  return res.json({ ok: true, archivi });
});

app.post('/api/archivi/crea', authRequired, (req, res) => {
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

    return res.json({ ok: true, archivio: archive });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message || 'Errore creazione archivio' });
  }
});

app.post('/api/archivi/ripristina', authRequired, async (req, res) => {
  try {
    const archiveId = sanitizeText(req.body.archiveId);
    if (!archiveId) {
      return res.status(400).json({ ok: false, message: 'Archivio non valido' });
    }

    const archive = getTournamentArchive(archiveId);
    if (!archive) {
      return res.status(404).json({ ok: false, message: 'Archivio non trovato' });
    }

    const currentData = loadData();
    const currentTeams = loadTeams();

    createTournamentArchive(currentData, currentTeams, {
      label: `Backup pre-ripristino ${archive.meta.label || archive.archiveId}`,
      note: `Backup automatico prima del ripristino di ${archive.archiveId}`,
      actor: req.staffUser,
      source: 'web'
    });

    const saved = saveAll(archive.data, archive.teams);
    bot.setDataState(saved.data);
    bot.setTeamsState(saved.teams);

    await bot.handleRegistrationStateChange();
    await bot.refreshSavedPanels();

    logAudit(req.staffUser, 'web', 'archivio_ripristinato', {
      archiveId: archive.archiveId,
      label: archive.meta.label || ''
    });

    return res.json({ ok: true, archiveId: archive.archiveId });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message || 'Errore ripristino archivio' });
  }
});

app.post('/api/project-settings/save', authRequired, async (req, res) => {
  try {
    const data = loadData();

    data.projectSettings = {
      ...(data.projectSettings || getDefaultProjectSettings()),
      brandName: sanitizeOptionalText(req.body.brandName, 60) || 'RØDA',
      tournamentName: sanitizeOptionalText(req.body.tournamentName, 80) || 'RØDA CUP',
      supportContact: sanitizeOptionalText(req.body.supportContact, 120),
      premiumMode: sanitizeBoolean(req.body.premiumMode),
      setupCompleted: sanitizeBoolean(req.body.setupCompleted)
    };

    const saved = saveData(data);
    bot.setDataState(saved);

    await bot.refreshSavedPanels();
    await bot.updateRegistrationStatusMessage();

    logAudit(req.staffUser, 'web', 'impostazioni_progetto_salvate', {
      brandName: saved.projectSettings.brandName,
      tournamentName: saved.projectSettings.tournamentName,
      premiumMode: saved.projectSettings.premiumMode,
      setupCompleted: saved.projectSettings.setupCompleted
    });

    return res.json({ ok: true, projectSettings: saved.projectSettings });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message || 'Errore salvataggio impostazioni progetto' });
  }
});

app.post('/api/bot/settings/save', authRequired, async (req, res) => {
  try {
    const settings = bot.saveBotPanelSettings({
      registerPanelChannelId: sanitizeText(req.body.registerPanelChannelId),
      resultsPanelChannelId: sanitizeText(req.body.resultsPanelChannelId),
      roomsCategoryId: sanitizeText(req.body.roomsCategoryId)
    });

    logAudit(req.staffUser, 'web', 'impostazioni_bot_salvate', settings);

    return res.json({ ok: true, settings });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message || 'Errore salvataggio impostazioni bot' });
  }
});

app.post('/api/teams/save', authRequired, async (req, res) => {
  const teams = loadTeams();
  const data = loadData();

  const oldTeamName = sanitizeText(req.body.oldTeamName);
  const teamName = sanitizeOptionalText(req.body.teamName, 50);
  const p1 = sanitizeOptionalText(req.body.p1, 40);
  const p2 = sanitizeOptionalText(req.body.p2, 40);
  const p3 = sanitizeOptionalText(req.body.p3, 40);

  if (!teamName || !p1 || !p2 || !p3) {
    return res.status(400).json({ ok: false, message: 'Compila tutti i campi team/giocatori' });
  }

  if (oldTeamName && oldTeamName !== teamName && teams[teamName]) {
    return res.status(400).json({ ok: false, message: 'Esiste già un team con questo nome' });
  }

  const limit = Number(data.registrationMaxTeams || 16);
  const isNewTeam = !oldTeamName || !teams[oldTeamName];

  if (isNewTeam && Object.keys(teams).length >= limit) {
    return res.status(400).json({ ok: false, message: `Limite massimo di ${limit} team raggiunto` });
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
      slot: existingSlot,
      players: [p1, p2, p3]
    };
  }

  if (Object.keys(teams).length < limit) {
    data.registrationClosedAnnounced = false;
  }

  const saved = saveAll(data, teams);
  bot.setDataState(saved.data);
  bot.setTeamsState(saved.teams);
  await bot.handleRegistrationStateChange();

  logAudit(req.staffUser, 'web', 'team_salvato', {
    oldTeamName,
    teamName
  });

  return res.json({ ok: true });
});

app.post('/api/teams/delete', authRequired, async (req, res) => {
  const teamName = sanitizeText(req.body.teamName);
  if (!teamName) {
    return res.status(400).json({ ok: false, message: 'Team non valido' });
  }

  const teams = loadTeams();
  const data = loadData();

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

  if (Object.keys(teams).length < Number(data.registrationMaxTeams || 16)) {
    data.registrationClosedAnnounced = false;
  }

  const saved = saveAll(data, teams);
  bot.setDataState(saved.data);
  bot.setTeamsState(saved.teams);
  await bot.handleRegistrationStateChange();

  logAudit(req.staffUser, 'web', 'team_eliminato', {
    teamName
  });

  return res.json({ ok: true });
});

app.post('/api/registration-settings/save', authRequired, async (req, res) => {
  const data = loadData();
  const teams = loadTeams();

  const title = sanitizeOptionalText(req.body.title, 100);
  const text = sanitizeOptionalText(req.body.text, 250);
  const maxTeams = sanitizePositiveInteger(req.body.maxTeams, 16);

  if (Object.keys(teams).length > maxTeams) {
    return res.status(400).json({
      ok: false,
      message: `Hai già ${Object.keys(teams).length} team registrati. Imposta un numero massimo uguale o superiore.`
    });
  }

  if (maxTeams > 16) {
    return res.status(400).json({
      ok: false,
      message: 'Il numero massimo consentito è 16 team.'
    });
  }

  data.registrationStatusTitle = title || '📋 Slot Team Registrati';
  data.registrationStatusText = text || '';
  data.registrationMaxTeams = maxTeams;

  if (Object.keys(teams).length < maxTeams) {
    data.registrationClosedAnnounced = false;
  }

  const saved = saveData(data);
  bot.setDataState(saved);
  bot.setTeamsState(teams);
  await bot.handleRegistrationStateChange();

  logAudit(req.staffUser, 'web', 'impostazioni_registrazione_salvate', {
    title: saved.registrationStatusTitle,
    maxTeams: saved.registrationMaxTeams
  });

  return res.json({ ok: true });
});

app.post('/api/registration-settings/refresh', authRequired, async (req, res) => {
  try {
    const data = loadData();
    const teams = loadTeams();

    bot.setDataState(data);
    bot.setTeamsState(teams);

    await bot.updateRegistrationStatusMessage();

    logAudit(req.staffUser, 'web', 'messaggio_registrazione_aggiornato', {});

    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message || 'Errore aggiornamento messaggio slot' });
  }
});

app.post('/api/match/set', authRequired, async (req, res) => {
  try {
    const match = sanitizePositiveInteger(req.body.match, 1);
    const currentMatch = await bot.setCurrentMatchAndRefresh(match);

    logAudit(req.staffUser, 'web', 'match_impostato', {
      currentMatch: match
    });

    return res.json({ ok: true, currentMatch });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message || 'Errore aggiornamento match' });
  }
});

app.post('/api/match/next', authRequired, async (req, res) => {
  try {
    const currentMatch = await bot.nextMatchAndRefresh();

    logAudit(req.staffUser, 'web', 'match_successivo', {
      currentMatch
    });

    return res.json({ ok: true, currentMatch });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message || 'Errore passaggio match' });
  }
});

app.post('/api/scores/add', authRequired, async (req, res) => {
  const data = loadData();
  const team = sanitizeText(req.body.team);
  const points = Number(req.body.points || 0);

  if (!team || !Number.isFinite(points)) {
    return res.status(400).json({ ok: false, message: 'Dati punti non validi' });
  }

  data.scores[team] = Number(data.scores[team] || 0) + points;
  const saved = saveData(data);
  bot.setDataState(saved);

  await bot.updateLeaderboard();

  logAudit(req.staffUser, 'web', 'punti_aggiunti', {
    team,
    points,
    total: saved.scores[team]
  });

  return res.json({ ok: true, score: saved.scores[team] });
});

app.post('/api/scores/set', authRequired, async (req, res) => {
  const data = loadData();
  const team = sanitizeText(req.body.team);
  const points = Number(req.body.points || 0);

  if (!team || !Number.isFinite(points)) {
    return res.status(400).json({ ok: false, message: 'Dati non validi' });
  }

  data.scores[team] = points;
  const saved = saveData(data);
  bot.setDataState(saved);

  await bot.updateLeaderboard();

  logAudit(req.staffUser, 'web', 'punti_impostati', {
    team,
    points
  });

  return res.json({ ok: true, score: saved.scores[team] });
});

app.post('/api/scores/reset-team', authRequired, async (req, res) => {
  const data = loadData();
  const team = sanitizeText(req.body.team);

  if (!team) {
    return res.status(400).json({ ok: false, message: 'Team non valido' });
  }

  data.scores[team] = 0;
  const saved = saveData(data);
  bot.setDataState(saved);

  await bot.updateLeaderboard();

  logAudit(req.staffUser, 'web', 'punti_team_azzerati', {
    team
  });

  return res.json({ ok: true });
});

app.post('/api/fragger/set', authRequired, async (req, res) => {
  const data = loadData();
  const player = sanitizeOptionalText(req.body.player, 40);
  const kills = Number(req.body.kills || 0);

  if (!player || !Number.isFinite(kills)) {
    return res.status(400).json({ ok: false, message: 'Dati fragger non validi' });
  }

  data.fragger[player] = kills;
  const saved = saveData(data);
  bot.setDataState(saved);

  await bot.updateLeaderboard();

  logAudit(req.staffUser, 'web', 'fragger_salvato', {
    player,
    kills
  });

  return res.json({ ok: true, kills });
});

app.post('/api/fragger/delete', authRequired, async (req, res) => {
  const data = loadData();
  const player = sanitizeText(req.body.player);

  if (!player) {
    return res.status(400).json({ ok: false, message: 'Giocatore non valido' });
  }

  delete data.fragger[player];
  const saved = saveData(data);
  bot.setDataState(saved);

  await bot.updateLeaderboard();

  logAudit(req.staffUser, 'web', 'fragger_eliminato', {
    player
  });

  return res.json({ ok: true });
});

app.post('/api/approve/:id', authRequired, async (req, res) => {
  try {
    const result = await bot.approvePending(req.params.id, req.staffUser, 'web');
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message || 'Errore approvazione' });
  }
});

app.post('/api/reject/:id', authRequired, async (req, res) => {
  try {
    const result = await bot.rejectPending(req.params.id, req.staffUser, 'web');
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message || 'Errore rifiuto' });
  }
});

app.post('/api/reset-data', authRequired, async (req, res) => {
  const currentTeams = loadTeams();
  const currentData = loadData();

  createTournamentArchive(currentData, currentTeams, {
    label: `Backup prima reset classifica ${new Date().toLocaleString('it-IT')}`,
    note: 'Backup automatico prima del reset classifica/fragger/match',
    actor: req.staffUser,
    source: 'web'
  });

  const preserved = getPreservedSettings(currentData);

  const data = getDefaultData();
  applyPreservedSettings(data, preserved);
  data.registrationClosedAnnounced = Object.keys(currentTeams).length >= Number(data.registrationMaxTeams || 16);

  const saved = saveData(data);
  bot.setDataState(saved);
  bot.setTeamsState(currentTeams);

  await bot.updateRegistrationStatusMessage();
  await bot.refreshSavedPanels();
  await bot.updateLeaderboard();

  logAudit(req.staffUser, 'web', 'reset_dati', {});

  return res.json({ ok: true });
});

app.post('/api/reset-teams', authRequired, async (req, res) => {
  const data = loadData();
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

  const saved = saveAll(data, emptyTeams);
  bot.setDataState(saved.data);
  bot.setTeamsState(saved.teams);
  await bot.handleRegistrationStateChange();
  await bot.updateLeaderboard();

  logAudit(req.staffUser, 'web', 'reset_team', {});

  return res.json({ ok: true });
});

app.post('/api/reset-all', authRequired, async (req, res) => {
  const currentData = loadData();
  const currentTeams = loadTeams();

  createTournamentArchive(currentData, currentTeams, {
    label: `Backup prima reset totale ${new Date().toLocaleString('it-IT')}`,
    note: 'Backup automatico prima del reset totale',
    actor: req.staffUser,
    source: 'web'
  });

  const preserved = getPreservedSettings(currentData);
  const data = getDefaultData();
  applyPreservedSettings(data, preserved);

  const emptyTeams = {};
  const saved = saveAll(data, emptyTeams);

  bot.setDataState(saved.data);
  bot.setTeamsState(saved.teams);
  await bot.handleRegistrationStateChange();
  await bot.updateLeaderboard();

  logAudit(req.staffUser, 'web', 'reset_totale', {});

  return res.json({ ok: true });
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
    return res.status(500).json({ ok: false, message: error.message || 'Errore invio pannello registrazione' });
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
    return res.status(500).json({ ok: false, message: error.message || 'Errore aggiornamento pannelli risultati team' });
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
    return res.status(500).json({ ok: false, message: error.message || 'Errore aggiornamento pannelli team' });
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
    return res.status(500).json({ ok: false, message: error.message || 'Errore creazione stanze' });
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
    return res.status(500).json({ ok: false, message: error.message || 'Errore eliminazione stanze' });
  }
});

app.post('/api/bot/send-lobby-code', authRequired, async (req, res) => {
  try {
    const lobbyCode = sanitizeText(req.body.lobbyCode);
    const categoryId = sanitizeText(req.body.categoryId);

    if (!lobbyCode) {
      return res.status(400).json({ ok: false, message: 'Codice lobby non valido' });
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
    return res.status(500).json({ ok: false, message: error.message || 'Errore invio codice lobby' });
  }
});

app.post('/api/bot/update-leaderboard', authRequired, async (req, res) => {
  try {
    const result = await bot.updateLeaderboard();

    logAudit(req.staffUser, 'web', 'classifica_discord_aggiornata_manualmente', {
      created: Boolean(result.created),
      updated: Boolean(result.updated)
    });

    return res.json(result);
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message || 'Errore aggiornamento classifica Discord' });
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
      return res.status(400).json({ ok: false, message: 'Dati risultato non validi' });
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

    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message || 'Errore invio risultato web' });
  }
});

app.listen(PORT, HOST, () => {
  console.log(`🌐 DASHBOARD ONLINE su porta ${PORT}`);
});
