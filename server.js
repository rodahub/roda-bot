const express = require('express');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const fs = require('fs');

const {
  loadData,
  saveData,
  loadTeams,
  saveTeams,
  saveAll,
  resetData
} = require('./store');

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

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(PUBLIC_DIR));

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || '.png') || '.png';
      cb(null, `${Date.now()}-${crypto.randomUUID()}${ext}`);
    }
  }),
  limits: {
    fileSize: 10 * 1024 * 1024
  }
});

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
  return crypto.createHmac('sha256', DASHBOARD_COOKIE_SECRET).update(value).digest('hex');
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
  const payload = { username, exp: Date.now() + COOKIE_DURATION_MS };
  const encoded = toBase64Url(JSON.stringify(payload));
  const signature = sign(encoded);
  return `${encoded}.${signature}`;
}

function verifyToken(token) {
  try {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 2) return null;

    const [encoded, signature] = parts;
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
    total: Number(p.total || 0),
    pos: Number(p.pos || 0),
    kills: Array.isArray(p.kills) ? p.kills.map(v => Number(v || 0)) : [],
    players: teams[p.team]?.players || [],
    image: p.image || ''
  }));
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

  return res.json({
    ok: true,
    currentMatch: Number(data.currentMatch || 1),
    leaderboard: buildLeaderboard(data.scores),
    fraggers: buildFraggers(data.fragger),
    pending: buildPending(data.pending, teams),
    teams,
    scores: data.scores || {},
    fragger: data.fragger || {},
    history: Array.isArray(data.resultHistory) ? data.resultHistory.slice(0, 100) : [],
    stats: {
      teamCount: Object.keys(teams).length,
      pendingCount: Object.keys(data.pending || {}).length,
      fraggerCount: Object.keys(data.fragger || {}).length
    }
  });
});

/* BOT ACTIONS */
app.post('/api/bot/spawn-register-panel', authRequired, async (req, res) => {
  try {
    const result = await bot.spawnRegisterPanel();
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message });
  }
});

app.post('/api/bot/spawn-results-panel', authRequired, async (req, res) => {
  try {
    const result = await bot.spawnResultsPanel();
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message });
  }
});

app.post('/api/bot/create-rooms', authRequired, async (req, res) => {
  try {
    const result = await bot.createRooms();
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message });
  }
});

app.post('/api/bot/delete-rooms', authRequired, async (req, res) => {
  try {
    const result = await bot.deleteRooms();
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message });
  }
});

app.post('/api/bot/update-leaderboard', authRequired, async (req, res) => {
  try {
    const result = await bot.updateLeaderboard();
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message });
  }
});

/* MATCH */
app.post('/api/match/set', authRequired, async (req, res) => {
  const data = loadData();
  const match = Number(req.body.match || 1);

  if (!Number.isInteger(match) || match < 1) {
    return res.status(400).json({ ok: false, message: 'Match non valido' });
  }

  data.currentMatch = match;
  saveData(data);
  await bot.updateLeaderboard().catch(() => {});
  return res.json({ ok: true, currentMatch: match });
});

app.post('/api/match/next', authRequired, async (req, res) => {
  try {
    const result = await bot.nextMatchAndSync();
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message });
  }
});

/* TEAMS */
app.post('/api/teams/save', authRequired, (req, res) => {
  const teams = loadTeams();
  const data = loadData();

  const oldTeamName = sanitizeText(req.body.oldTeamName);
  const teamName = sanitizeText(req.body.teamName);
  const p1 = sanitizeText(req.body.p1);
  const p2 = sanitizeText(req.body.p2);
  const p3 = sanitizeText(req.body.p3);

  if (!teamName || !p1 || !p2 || !p3) {
    return res.status(400).json({ ok: false, message: 'Compila tutti i campi' });
  }

  if (oldTeamName && oldTeamName !== teamName && teams[teamName]) {
    return res.status(400).json({ ok: false, message: 'Esiste già un team con questo nome' });
  }

  if (oldTeamName && oldTeamName !== teamName && teams[oldTeamName]) {
    teams[teamName] = { players: [p1, p2, p3] };
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
  } else {
    teams[teamName] = { players: [p1, p2, p3] };
  }

  saveAll(data, teams);
  return res.json({ ok: true });
});

app.post('/api/teams/delete', authRequired, (req, res) => {
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

  saveAll(data, teams);
  return res.json({ ok: true });
});

/* SCORES */
app.post('/api/scores/add', authRequired, async (req, res) => {
  const data = loadData();
  const team = sanitizeText(req.body.team);
  const points = Number(req.body.points || 0);

  if (!team || !Number.isFinite(points)) {
    return res.status(400).json({ ok: false, message: 'Dati non validi' });
  }

  data.scores[team] = Number(data.scores[team] || 0) + points;
  saveData(data);
  await bot.updateLeaderboard().catch(() => {});
  return res.json({ ok: true, score: data.scores[team] });
});

app.post('/api/scores/set', authRequired, async (req, res) => {
  const data = loadData();
  const team = sanitizeText(req.body.team);
  const points = Number(req.body.points || 0);

  if (!team || !Number.isFinite(points)) {
    return res.status(400).json({ ok: false, message: 'Dati non validi' });
  }

  data.scores[team] = points;
  saveData(data);
  await bot.updateLeaderboard().catch(() => {});
  return res.json({ ok: true, score: data.scores[team] });
});

app.post('/api/scores/reset-team', authRequired, async (req, res) => {
  const data = loadData();
  const team = sanitizeText(req.body.team);

  if (!team) {
    return res.status(400).json({ ok: false, message: 'Team non valido' });
  }

  data.scores[team] = 0;
  saveData(data);
  await bot.updateLeaderboard().catch(() => {});
  return res.json({ ok: true });
});

/* FRAGGER */
app.post('/api/fragger/set', authRequired, async (req, res) => {
  const data = loadData();
  const player = sanitizeText(req.body.player);
  const kills = Number(req.body.kills || 0);

  if (!player || !Number.isFinite(kills)) {
    return res.status(400).json({ ok: false, message: 'Dati fragger non validi' });
  }

  data.fragger[player] = kills;
  saveData(data);
  await bot.updateLeaderboard().catch(() => {});
  return res.json({ ok: true, kills });
});

app.post('/api/fragger/delete', authRequired, async (req, res) => {
  const data = loadData();
  const player = sanitizeText(req.body.player);

  if (!player) {
    return res.status(400).json({ ok: false, message: 'Player non valido' });
  }

  delete data.fragger[player];
  saveData(data);
  await bot.updateLeaderboard().catch(() => {});
  return res.json({ ok: true });
});

/* PENDING */
app.post('/api/pending/approve', authRequired, async (req, res) => {
  try {
    const pendingId = sanitizeText(req.body.id);
    const result = await bot.approvePending(pendingId, 'dashboard');
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message });
  }
});

app.post('/api/pending/reject', authRequired, async (req, res) => {
  try {
    const pendingId = sanitizeText(req.body.id);
    const result = await bot.rejectPending(pendingId, 'dashboard');
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message });
  }
});

/* WEB RESULT + SCREENSHOT */
app.post('/api/results/submit', authRequired, upload.single('screenshot'), async (req, res) => {
  try {
    const team = sanitizeText(req.body.team);
    const k1 = Number(req.body.k1 || 0);
    const k2 = Number(req.body.k2 || 0);
    const k3 = Number(req.body.k3 || 0);
    const pos = Number(req.body.pos || 0);

    if (!team) {
      return res.status(400).json({ ok: false, message: 'Team mancante' });
    }

    if (!req.file) {
      return res.status(400).json({ ok: false, message: 'Screenshot mancante' });
    }

    const image = `/uploads/${req.file.filename}`;

    const result = await bot.createPendingFromWeb({
      team,
      kills: [k1, k2, k3],
      pos,
      image
    });

    return res.json(result);
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message });
  }
});

/* RESET */
app.post('/api/reset-all', authRequired, async (req, res) => {
  resetData();
  await bot.updateLeaderboard().catch(() => {});
  return res.json({ ok: true });
});

app.listen(PORT, HOST, () => {
  console.log(`🌐 DASHBOARD ONLINE su porta ${PORT}`);
});
