const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

const DATA_FILE = path.join(__dirname, 'data.json');
const TEAMS_FILE = path.join(__dirname, 'teams.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

const DASHBOARD_USERNAME = process.env.DASHBOARD_USERNAME || 'admin';
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || 'admin123';
const DASHBOARD_COOKIE_SECRET = process.env.DASHBOARD_COOKIE_SECRET || 'change-this-secret-now';
const COOKIE_NAME = 'staff_auth';
const COOKIE_DURATION_MS = 1000 * 60 * 60 * 12;

app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(PUBLIC_DIR));

function ensureFiles() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({
      currentMatch: 1,
      pending: {},
      tempSubmit: {},
      scores: {},
      fragger: {},
      leaderboardMessageId: null
    }, null, 2));
  }

  if (!fs.existsSync(TEAMS_FILE)) {
    fs.writeFileSync(TEAMS_FILE, JSON.stringify({}, null, 2));
  }
}

ensureFiles();

function getData() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    parsed.currentMatch ??= 1;
    parsed.pending ??= {};
    parsed.tempSubmit ??= {};
    parsed.scores ??= {};
    parsed.fragger ??= {};
    parsed.leaderboardMessageId ??= null;
    return parsed;
  } catch {
    return {
      currentMatch: 1,
      pending: {},
      tempSubmit: {},
      scores: {},
      fragger: {},
      leaderboardMessageId: null
    };
  }
}

function getTeams() {
  try {
    return JSON.parse(fs.readFileSync(TEAMS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function saveTeams(teams) {
  fs.writeFileSync(TEAMS_FILE, JSON.stringify(teams, null, 2));
}

function saveAll(data, teams) {
  saveData(data);
  saveTeams(teams);
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

function buildTopFraggers(fragger) {
  return Object.entries(fragger || {})
    .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))
    .map(([name, kills], index) => ({
      rank: index + 1,
      name,
      kills: Number(kills || 0)
    }));
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

function buildPendingView(pending, teams) {
  return Object.entries(pending || {}).map(([id, p]) => {
    const players = teams[p.team]?.players || [];
    return {
      id,
      team: p.team,
      total: Number(p.total || 0),
      pos: Number(p.pos || 0),
      kills: Array.isArray(p.kills) ? p.kills.map(v => Number(v || 0)) : [],
      players,
      image: p.image || ''
    };
  });
}

app.get('/login', (req, res) => {
  const cookies = parseCookies(req.headers.cookie || '');
  const token = cookies[COOKIE_NAME];
  const session = verifyToken(token);

  if (session) return res.redirect('/');
  return res.sendFile(path.join(PUBLIC_DIR, 'login.html'));
});

app.post('/api/login', (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');

  if (username !== DASHBOARD_USERNAME || password !== DASHBOARD_PASSWORD) {
    return res.status(401).json({
      ok: false,
      message: 'Credenziali non valide'
    });
  }

  const token = createToken(username);
  res.setHeader('Set-Cookie', buildCookie(token));

  return res.json({
    ok: true,
    username
  });
});

app.get('/api/session', (req, res) => {
  const cookies = parseCookies(req.headers.cookie || '');
  const token = cookies[COOKIE_NAME];
  const session = verifyToken(token);

  if (!session) {
    return res.status(401).json({
      ok: false,
      authenticated: false
    });
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

/* DASHBOARD DATA */
app.get('/api/dashboard', authRequired, (req, res) => {
  const data = getData();
  const teams = getTeams();

  const leaderboard = buildLeaderboard(data.scores);
  const fraggers = buildTopFraggers(data.fragger);
  const pending = buildPendingView(data.pending, teams);

  return res.json({
    ok: true,
    currentMatch: Number(data.currentMatch || 1),
    leaderboard,
    fraggers,
    pending,
    teams,
    scores: data.scores || {},
    fragger: data.fragger || {},
    stats: {
      teamCount: Object.keys(teams).length,
      pendingCount: Object.keys(data.pending || {}).length,
      fraggerCount: Object.keys(data.fragger || {}).length
    }
  });
});

/* COMPATIBILITÀ VECCHIE API */
app.get('/api/leaderboard', authRequired, (req, res) => {
  const data = getData();

  const sorted = Object.entries(data.scores || {})
    .sort((a, b) => b[1] - a[1]);

  res.json({
    match: data.currentMatch,
    scores: sorted,
    fragger: data.fragger || {}
  });
});

app.get('/api/pending', authRequired, (req, res) => {
  const data = getData();
  res.json(data.pending || {});
});

app.post('/api/approve/:id', authRequired, (req, res) => {
  const data = getData();
  const teams = getTeams();
  const p = data.pending[req.params.id];

  if (!p) return res.json({ already: true });

  data.scores[p.team] = (data.scores[p.team] || 0) + (Number(p.total || 0) + 10);

  (p.kills || []).forEach((k, i) => {
    const name = teams[p.team]?.players?.[i] || `Player${i + 1}`;
    data.fragger[name] = (data.fragger[name] || 0) + Number(k || 0);
  });

  delete data.pending[req.params.id];
  saveData(data);

  return res.json({ ok: true });
});

app.post('/api/reject/:id', authRequired, (req, res) => {
  const data = getData();

  if (!data.pending[req.params.id]) {
    return res.json({ already: true });
  }

  delete data.pending[req.params.id];
  saveData(data);

  return res.json({ ok: true });
});

/* TEAM CRUD */
app.post('/api/teams/save', authRequired, (req, res) => {
  const teams = getTeams();
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

  const data = getData();

  if (oldTeamName && oldTeamName !== teamName) {
    if (teams[oldTeamName]) {
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

  const teams = getTeams();
  const data = getData();

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

/* MATCH */
app.post('/api/match/set', authRequired, (req, res) => {
  const data = getData();
  const match = Number(req.body.match || 1);

  if (!Number.isInteger(match) || match < 1) {
    return res.status(400).json({ ok: false, message: 'Match non valido' });
  }

  data.currentMatch = match;
  saveData(data);
  return res.json({ ok: true, currentMatch: match });
});

app.post('/api/match/next', authRequired, (req, res) => {
  const data = getData();
  data.currentMatch = Number(data.currentMatch || 1) + 1;
  saveData(data);
  return res.json({ ok: true, currentMatch: data.currentMatch });
});

/* PUNTI */
app.post('/api/scores/add', authRequired, (req, res) => {
  const data = getData();
  const team = sanitizeText(req.body.team);
  const points = Number(req.body.points || 0);

  if (!team || !Number.isFinite(points)) {
    return res.status(400).json({ ok: false, message: 'Dati punti non validi' });
  }

  data.scores[team] = Number(data.scores[team] || 0) + points;
  saveData(data);

  return res.json({ ok: true, score: data.scores[team] });
});

app.post('/api/scores/set', authRequired, (req, res) => {
  const data = getData();
  const team = sanitizeText(req.body.team);
  const points = Number(req.body.points || 0);

  if (!team || !Number.isFinite(points)) {
    return res.status(400).json({ ok: false, message: 'Dati non validi' });
  }

  data.scores[team] = points;
  saveData(data);

  return res.json({ ok: true, score: data.scores[team] });
});

app.post('/api/scores/reset-team', authRequired, (req, res) => {
  const data = getData();
  const team = sanitizeText(req.body.team);

  if (!team) {
    return res.status(400).json({ ok: false, message: 'Team non valido' });
  }

  data.scores[team] = 0;
  saveData(data);

  return res.json({ ok: true });
});

/* FRAGGER */
app.post('/api/fragger/set', authRequired, (req, res) => {
  const data = getData();
  const player = sanitizeText(req.body.player);
  const kills = Number(req.body.kills || 0);

  if (!player || !Number.isFinite(kills)) {
    return res.status(400).json({ ok: false, message: 'Dati fragger non validi' });
  }

  data.fragger[player] = kills;
  saveData(data);

  return res.json({ ok: true, kills });
});

app.post('/api/fragger/delete', authRequired, (req, res) => {
  const data = getData();
  const player = sanitizeText(req.body.player);

  if (!player) {
    return res.status(400).json({ ok: false, message: 'Player non valido' });
  }

  delete data.fragger[player];
  saveData(data);

  return res.json({ ok: true });
});

/* RESET */
app.post('/api/reset-all', authRequired, (req, res) => {
  const data = {
    currentMatch: 1,
    pending: {},
    tempSubmit: {},
    scores: {},
    fragger: {},
    leaderboardMessageId: null
  };

  saveData(data);
  return res.json({ ok: true });
});

app.listen(PORT, HOST, () => {
  console.log(`🌐 DASHBOARD ONLINE su porta ${PORT}`);
});
