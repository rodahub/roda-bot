const express = require('express');
const fs = require('fs');
const app = express();

app.use(express.json());
app.use(express.static('public'));

function getData() {
  try {
    return JSON.parse(fs.readFileSync('./data.json'));
  } catch {
    return { scores: {}, pending: {}, fragger: {}, currentMatch: 1 };
  }
}

function getTeams() {
  try {
    return JSON.parse(fs.readFileSync('./teams.json'));
  } catch {
    return {};
  }
}

function saveData(data) {
  fs.writeFileSync('./data.json', JSON.stringify(data, null, 2));
}

// CLASSIFICA
app.get('/api/leaderboard', (req, res) => {
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
app.get('/api/pending', (req, res) => {
  const data = getData();
  res.json(data.pending || {});
});

// APPROVA
app.post('/api/approve/:id', (req, res) => {
  const data = getData();
  const teams = getTeams();

  const p = data.pending[req.params.id];

  // 💥 BLOCCO doppia approvazione
  if (!p) return res.json({ already: true });

  data.scores[p.team] = (data.scores[p.team] || 0) + (p.total + 10);

  p.kills.forEach((k, i) => {
    const name = teams[p.team]?.players?.[i] || `Player${i+1}`;
    data.fragger[name] = (data.fragger[name] || 0) + k;
  });

  delete data.pending[req.params.id];
  saveData(data);

  res.json({ ok: true });
});

// RIFIUTA
app.post('/api/reject/:id', (req, res) => {
  const data = getData();

  if (!data.pending[req.params.id]) {
    return res.json({ already: true });
  }

  delete data.pending[req.params.id];
  saveData(data);

  res.json({ ok: true });
});

app.listen(3000, () => console.log("🌐 DASHBOARD ONLINE"));
