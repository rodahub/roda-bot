const express = require('express');
const fs = require('fs');
const app = express();

app.use(express.json());
app.use(express.static('public'));

function getData() {
  return JSON.parse(fs.readFileSync('./data.json'));
}

function getTeams() {
  return JSON.parse(fs.readFileSync('./teams.json'));
}

function saveData(data) {
  fs.writeFileSync('./data.json', JSON.stringify(data, null, 2));
}

app.get('/api/leaderboard', (req, res) => {
  const data = getData();

  const sorted = Object.entries(data.scores || {})
    .sort((a,b)=>b[1]-a[1]);

  res.json({
    match: data.currentMatch,
    scores: sorted,
    fragger: data.fragger || {}
  });
});

app.get('/api/pending', (req, res) => {
  const data = getData();
  res.json(data.pending || {});
});

app.post('/api/approve/:id', (req, res) => {
  const data = getData();
  const teams = getTeams();

  const p = data.pending[req.params.id];
  if (!p) return res.sendStatus(404);

  data.scores[p.team] = (data.scores[p.team] || 0) + (p.total + 10);

  p.kills.forEach((k,i)=>{
    const name = teams[p.team].players[i];
    data.fragger[name] = (data.fragger[name] || 0) + k;
  });

  delete data.pending[req.params.id];
  saveData(data);

  res.json({ ok: true });
});

app.post('/api/reject/:id', (req, res) => {
  const data = getData();

  delete data.pending[req.params.id];
  saveData(data);

  res.json({ ok: true });
});

app.get('/api/teams', (req, res) => {
  res.json(getTeams());
});

app.listen(3000, () => console.log("DASHBOARD ONLINE"));
