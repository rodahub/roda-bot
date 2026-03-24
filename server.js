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

function getData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return { scores: {}, pending: {}, fragger: {}, currentMatch: 1 };
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

/* -------------------- LOGIN -------------------- */

app.get('/login', (req, res) => {
  const cookies = parseCookies(req.headers.cookie || '');
  const token = cookies[COOKIE_NAME];
  const session = verifyToken(token);

  if (session) {
    return res.redirect('/');
  }

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

/* -------------------- STATIC FILES SICURI -------------------- */

app.get('/', authRequired, (req, res) => {
  return res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

/* -------------------- API PROTETTE -------------------- */

// CLASSIFICA
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

// PENDING
app.get('/api/pending', authRequired, (req, res) => {
  const data = getData();
  res.json(data.pending || {});
});

// APPROVA
app.post('/api/approve/:id', authRequired, (req, res) => {
  const data = getData();
  const teams = getTeams();

  const p = data.pending[req.params.id];

  if (!p) {
    return res.json({ already: true });
  }

  data.scores[p.team] = (data.scores[p.team] || 0) + (p.total + 10);

  (p.kills || []).forEach((k, i) => {
    const name = teams[p.team]?.players?.[i] || `Player${i + 1}`;
    data.fragger[name] = (data.fragger[name] || 0) + Number(k || 0);
  });

  delete data.pending[req.params.id];
  saveData(data);

  res.json({ ok: true });
});

// RIFIUTA
app.post('/api/reject/:id', authRequired, (req, res) => {
  const data = getData();

  if (!data.pending[req.params.id]) {
    return res.json({ already: true });
  }

  delete data.pending[req.params.id];
  saveData(data);

  res.json({ ok: true });
});

app.listen(PORT, HOST, () => {
  console.log(`🌐 DASHBOARD ONLINE su porta ${PORT}`);
});
