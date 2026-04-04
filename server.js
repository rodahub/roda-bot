const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const {
  initializeFiles,
  loadData,
  loadTeams,
  saveData,
  saveTeams,
  saveAll,
  getDefaultData
} = require('./storage');

initializeFiles();

const bot = require('./index');

const app = express();

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOADS_DIR = path.join(PUBLIC_DIR, 'uploads');

const DASHBOARD_USERNAME = process.env.DASHBOARD_USERNAME || 'admin';
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
app.use(express.static(PUBLIC_DIR));

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

function createToken(username) {
  const payload = {
    username,
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
    if (!payload.username || !payload.exp) return null;
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
      return res.status(401).json({ ok: false, message: 'Non autorizzato' });
    }
    return res.redirect('/login');
  }

  req.staffUser = session.username;
  next();
}

function sanitizeText(value) {
  return String(value || '').trim();
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
      rank: index + 1,
      team,
      points: Number(points || 0)
    }));
}

function buildFraggers(fragger) {
  return Object.entries(fragger || {})
    .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))
    .map(([name, kills], index) => ({
      rank: index + 1,
      name,
      kills: Number(kills || 0)
    }));
}

function buildPending(pending, teams) {
  return Object.entries(pending || {}).map(([id, p]) => ({
    id,
    team: p.team,
    slot: teams[p.team]?.slot || null,
    total: Number(p.total || 0),
    pos: Number(p.pos || 0),
    kills: Array.isArray(p.kills) ? p.kills.map(v => Number(v || 0)) : [],
    players: teams[p.team]?.players || [],
    image: p.image || '',
    submittedBy: p.submittedBy || '',
    staffMessageId: p.staffMessageId || null
  }));
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

app.get('/login', (req, res) => {
  const cookies = parseCookies(req.headers.cookie || '');
  const token = cookies[COOKIE_NAME];
  const session = verifyToken(token);

  if (session) return res.redirect('/');
  return res.sendFile(path.join(PUBLIC_DIR, 'login.html'));
});

app.post('/api/login', (req, res) => {
  const username = sanitizeText(req.body.username);
  const password = String(req.body.password || '');

  if (username !== DASHBOARD_USERNAME || password !== DASHBOARD_PASSWORD) {
    return res.status(401).json({ ok: false, message: 'Credenziali non valide' });
  }

  const token = createToken(username);
  res.setHeader('Set-Cookie', buildCookie(token));

  return res.json({ ok: true, username });
});

app.get('/api/session', (req, res) => {
  const cookies = parseCookies(req.headers.cookie || '');
  const token = cookies[COOKIE_NAME];
  const session = verifyToken(token);

  if (!session) {
    return res.status(401).json({ ok: false, authenticated: false });
  }

  return res.json({
    ok: true,
    authenticated: true,
    username: session.username
  });
});

app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', clearCookie());
  return res.json({ ok: true });
});

app.get('/', authRequired, (req, res) => {
  return res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.get('/api/dashboard', authRequired, (req, res) => {
  const data = loadData();
  const teams = loadTeams();

  bot.setDataState(data);
  bot.setTeamsState(teams);

  return res.json({
    ok: true,
    currentMatch: Number(data.currentMatch || 1),
    leaderboard: buildLeaderboard(data.scores),
    fraggers: buildFraggers(data.fragger),
    pending: buildPending(data.pending, teams),
    teams,
    sortedTeams: sortTeamsWithSlot(teams).map(([teamName, teamData]) => ({
      team: teamName,
      slot: teamData.slot || null,
      players: teamData.players || []
    })),
    scores: data.scores || {},
    fragger: data.fragger || {},
    botConfig: bot.getBotConfig(),
    registrationSettings: {
      title: data.registrationStatusTitle || '📋 Slot Team Registrati',
      text: data.registrationStatusText || '',
      maxTeams: Number(data.registrationMaxTeams || 16)
    },
    stats: {
      teamCount: Object.keys(teams).length,
      pendingCount: Object.keys(data.pending || {}).length,
      fraggerCount: Object.keys(data.fragger || {}).length
    }
  });
});

app.post('/api/teams/save', authRequired, async (req, res) => {
  const teams = loadTeams();
  const data = loadData();

  const oldTeamName = sanitizeText(req.body.oldTeamName);
  const teamName = sanitizeText(req.body.teamName);
  const p1 = sanitizeText(req.body.p1);
  const p2 = sanitizeText(req.body.p2);
  const p3 = sanitizeText(req.body.p3);

  if (!teamName || !p1 || !p2 || !p3) {
    return res.status(400).json({ ok: false, message: 'Compila tutti i campi team/player' });
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

  if (Object.keys(teams).length < Number(data.registrationMaxTeams || 16)) {
    data.registrationClosedAnnounced = false;
  }

  const saved = saveAll(data, teams);
  bot.setDataState(saved.data);
  bot.setTeamsState(saved.teams);
  await bot.handleRegistrationStateChange();

  return res.json({ ok: true });
});

app.post('/api/registration-settings/save', authRequired, async (req, res) => {
  const data = loadData();
  const teams = loadTeams();

  const title = sanitizeText(req.body.title);
  const text = sanitizeText(req.body.text);
  const maxTeams = Number(req.body.maxTeams || 16);

  if (!Number.isInteger(maxTeams) || maxTeams < 1) {
    return res.status(400).json({ ok: false, message: 'Numero massimo team non valido' });
  }

  if (Object.keys(teams).length > maxTeams) {
    return res.status(400).json({
      ok: false,
      message: `Hai già ${Object.keys(teams).length} team registrati. Imposta un numero massimo uguale o superiore.`
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

  return res.json({ ok: true });
});

app.post('/api/registration-settings/refresh', authRequired, async (req, res) => {
  try {
    const data = loadData();
    const teams = loadTeams();

    bot.setDataState(data);
    bot.setTeamsState(teams);

    await bot.updateRegistrationStatusMessage();
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message || 'Errore aggiornamento messaggio slot' });
  }
});

app.post('/api/match/set', authRequired, (req, res) => {
  const match = Number(req.body.match || 1);

  if (!Number.isInteger(match) || match < 1) {
    return res.status(400).json({ ok: false, message: 'Match non valido' });
  }

  const data = loadData();
  data.currentMatch = match;
  const saved = saveData(data);
  bot.setDataState(saved);

  return res.json({ ok: true, currentMatch: match });
});

app.post('/api/match/next', authRequired, (req, res) => {
  const data = loadData();
  data.currentMatch = Number(data.currentMatch || 1) + 1;
  const saved = saveData(data);
  bot.setDataState(saved);

  return res.json({ ok: true, currentMatch: saved.currentMatch });
});

app.post('/api/scores/add', authRequired, (req, res) => {
  const data = loadData();
  const team = sanitizeText(req.body.team);
  const points = Number(req.body.points || 0);

  if (!team || !Number.isFinite(points)) {
    return res.status(400).json({ ok: false, message: 'Dati punti non validi' });
  }

  data.scores[team] = Number(data.scores[team] || 0) + points;
  const saved = saveData(data);
  bot.setDataState(saved);

  return res.json({ ok: true, score: saved.scores[team] });
});

app.post('/api/scores/set', authRequired, (req, res) => {
  const data = loadData();
  const team = sanitizeText(req.body.team);
  const points = Number(req.body.points || 0);

  if (!team || !Number.isFinite(points)) {
    return res.status(400).json({ ok: false, message: 'Dati non validi' });
  }

  data.scores[team] = points;
  const saved = saveData(data);
  bot.setDataState(saved);

  return res.json({ ok: true, score: saved.scores[team] });
});

app.post('/api/scores/reset-team', authRequired, (req, res) => {
  const data = loadData();
  const team = sanitizeText(req.body.team);

  if (!team) {
    return res.status(400).json({ ok: false, message: 'Team non valido' });
  }

  data.scores[team] = 0;
  const saved = saveData(data);
  bot.setDataState(saved);

  return res.json({ ok: true });
});

app.post('/api/fragger/set', authRequired, (req, res) => {
  const data = loadData();
  const player = sanitizeText(req.body.player);
  const kills = Number(req.body.kills || 0);

  if (!player || !Number.isFinite(kills)) {
    return res.status(400).json({ ok: false, message: 'Dati fragger non validi' });
  }

  data.fragger[player] = kills;
  const saved = saveData(data);
  bot.setDataState(saved);

  return res.json({ ok: true, kills });
});

app.post('/api/fragger/delete', authRequired, (req, res) => {
  const data = loadData();
  const player = sanitizeText(req.body.player);

  if (!player) {
    return res.status(400).json({ ok: false, message: 'Player non valido' });
  }

  delete data.fragger[player];
  const saved = saveData(data);
  bot.setDataState(saved);

  return res.json({ ok: true });
});

app.post('/api/approve/:id', authRequired, async (req, res) => {
  try {
    const result = await bot.approvePending(req.params.id);
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message || 'Errore approvazione' });
  }
});

app.post('/api/reject/:id', authRequired, async (req, res) => {
  try {
    const result = await bot.rejectPending(req.params.id);
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message || 'Errore rifiuto' });
  }
});

app.post('/api/reset-data', authRequired, (req, res) => {
  const currentTeams = loadTeams();
  const data = getDefaultData();

  const saved = saveData(data);
  bot.setDataState(saved);
  bot.setTeamsState(currentTeams);

  return res.json({ ok: true });
});

app.post('/api/reset-teams', authRequired, async (req, res) => {
  const data = loadData();
  const emptyTeams = {};

  data.pending = {};
  data.tempSubmit = {};
  data.registrationClosedAnnounced = false;

  const saved = saveAll(data, emptyTeams);
  bot.setDataState(saved.data);
  bot.setTeamsState(saved.teams);
  await bot.handleRegistrationStateChange();

  return res.json({ ok: true });
});

app.post('/api/reset-all', authRequired, async (req, res) => {
  const data = getDefaultData();
  const emptyTeams = {};

  const saved = saveAll(data, emptyTeams);
  bot.setDataState(saved.data);
  bot.setTeamsState(saved.teams);
  await bot.handleRegistrationStateChange();

  return res.json({ ok: true });
});

app.post('/api/bot/spawn-register-panel', authRequired, async (req, res) => {
  try {
    const channelId = sanitizeText(req.body.channelId);
    if (!channelId) return res.status(400).json({ ok: false, message: 'Channel ID richiesto' });

    await bot.spawnRegisterPanel(channelId);
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message || 'Errore spawn pannello register' });
  }
});

app.post('/api/bot/spawn-results-panel', authRequired, async (req, res) => {
  try {
    const channelId = sanitizeText(req.body.channelId);
    if (!channelId) return res.status(400).json({ ok: false, message: 'Channel ID richiesto' });

    await bot.spawnResultsPanel(channelId);
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message || 'Errore spawn pannello risultati' });
  }
});

app.post('/api/bot/create-rooms', authRequired, async (req, res) => {
  try {
    const categoryId = sanitizeText(req.body.categoryId);
    await bot.createTeamRooms(categoryId);
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message || 'Errore creazione stanze' });
  }
});

app.post('/api/bot/delete-rooms', authRequired, async (req, res) => {
  try {
    const categoryId = sanitizeText(req.body.categoryId);
    await bot.deleteTeamRooms(categoryId);
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message || 'Errore eliminazione stanze' });
  }
});

app.post('/api/bot/update-leaderboard', authRequired, async (req, res) => {
  try {
    await bot.updateLeaderboard();
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message || 'Errore update leaderboard' });
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

    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message || 'Errore invio risultato web' });
  }
});

app.listen(PORT, HOST, () => {
  console.log(`🌐 DASHBOARD ONLINE su porta ${PORT}`);
});
