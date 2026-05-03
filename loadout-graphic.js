'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const graphics = require('./loadout-graphics');

const ROOT_DIR = __dirname;
const STORAGE_DIR = process.env.STORAGE_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(ROOT_DIR, 'storage-data');
const TEAMS_FILE = path.join(STORAGE_DIR, 'teams.json');
const DATA_FILE = path.join(STORAGE_DIR, 'data.json');

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf8');
    return raw.trim() ? JSON.parse(raw) : fallback;
  } catch (error) {
    console.error('[roda-hotfix] errore lettura json:', filePath, error.message);
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value || {}, null, 2), 'utf8');
}

function readTeamsDirect() { return readJson(TEAMS_FILE, {}); }
function writeTeamsDirect(teams) { writeJson(TEAMS_FILE, teams || {}); }
function readDataDirect() { return readJson(DATA_FILE, {}); }
function writeDataDirect(data) { writeJson(DATA_FILE, data || {}); }

function safeText(value) { return String(value || '').trim(); }
function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function calcPoints(pos, kills) {
  const placement = { 1: 10, 2: 6, 3: 5, 4: 4, 5: 3, 6: 2, 7: 1, 8: 1 };
  return safeNumber(kills, 0) + safeNumber(placement[Number(pos)] || 0, 0);
}
function submissionKey(team, matchNumber) {
  return `${safeText(team).toLowerCase()}__${Number(matchNumber || 1)}`;
}
function ensureDataShape(data) {
  data.currentMatch = safeNumber(data.currentMatch, 1) || 1;
  data.pending = data.pending && typeof data.pending === 'object' ? data.pending : {};
  data.scores = data.scores && typeof data.scores === 'object' ? data.scores : {};
  data.fragger = data.fragger && typeof data.fragger === 'object' ? data.fragger : {};
  data.matches = data.matches && typeof data.matches === 'object' ? data.matches : {};
  data.resultSubmissions = data.resultSubmissions && typeof data.resultSubmissions === 'object' ? data.resultSubmissions : {};
  return data;
}
function findTeamName(teams, teamName) {
  const clean = safeText(teamName);
  return Object.keys(teams || {}).find(k => k.toLowerCase() === clean.toLowerCase()) || clean;
}
function forceApproveResult(payload = {}, actor = 'admin') {
  const data = ensureDataShape(readDataDirect());
  const teams = readTeamsDirect();
  const team = findTeamName(teams, payload.team || payload.teamName || payload.nome);
  if (!team || !teams[team]) throw new Error('Team non trovato');

  const matchNumber = safeNumber(payload.matchNumber || payload.match || data.currentMatch || 1, 1) || 1;
  const kills = Array.isArray(payload.kills) ? payload.kills.slice(0, 3).map(v => safeNumber(v, 0)) : [safeNumber(payload.k1, 0), safeNumber(payload.k2, 0), safeNumber(payload.k3, 0)];
  while (kills.length < 3) kills.push(0);
  const total = safeNumber(payload.total || payload.totaleUccisioni || kills.reduce((a, b) => a + b, 0), 0);
  const pos = safeNumber(payload.pos || payload.position || payload.posizione, 0);
  if (!pos || pos < 1) throw new Error('Posizione non valida');

  const matchId = String(matchNumber);
  data.matches[matchId] = data.matches[matchId] && typeof data.matches[matchId] === 'object'
    ? data.matches[matchId]
    : { matchNumber, status: 'in_corso', teams: {} };
  data.matches[matchId].teams = data.matches[matchId].teams && typeof data.matches[matchId].teams === 'object' ? data.matches[matchId].teams : {};

  const existing = data.matches[matchId].teams[team];
  if (existing && ['approvato', 'inserito_manualmente'].includes(existing.status)) {
    return { alreadyApproved: true, team, matchNumber, points: safeNumber(existing.points, 0) };
  }

  const points = calcPoints(pos, total);
  data.scores[team] = safeNumber(data.scores[team], 0) + points;
  const players = Array.isArray(teams[team].players) ? teams[team].players : ['Giocatore 1', 'Giocatore 2', 'Giocatore 3'];
  kills.forEach((k, index) => {
    const name = safeText(players[index] || `Giocatore ${index + 1}`);
    if (name) data.fragger[name] = safeNumber(data.fragger[name], 0) + safeNumber(k, 0);
  });

  for (const [id, entry] of Object.entries(data.pending || {})) {
    if (id === String(payload.id || payload.pendingId || '') || (safeText(entry && entry.team).toLowerCase() === team.toLowerCase() && safeNumber(entry && entry.matchNumber, 1) === matchNumber)) {
      delete data.pending[id];
    }
  }

  data.matches[matchId].teams[team] = {
    team,
    matchNumber,
    status: 'approvato',
    kills,
    totalKills: total,
    placement: pos,
    points,
    source: 'admin_force_approve',
    pendingId: null,
    image: safeText(payload.image || payload.immagine || ''),
    submittedBy: safeText(payload.submittedBy || payload.inviatoDa || 'Admin'),
    approvedBy: safeText(actor || 'admin'),
    rejectedBy: '',
    manualBy: '',
    absentBy: '',
    updatedAt: new Date().toISOString(),
    createdAt: existing && existing.createdAt ? existing.createdAt : new Date().toISOString()
  };

  data.resultSubmissions[submissionKey(team, matchNumber)] = {
    team,
    matchNumber,
    status: 'approvato',
    pendingId: null,
    updatedAt: new Date().toISOString(),
    updatedBy: safeText(actor || 'admin'),
    source: 'admin_force_approve'
  };

  writeDataDirect(data);
  return { team, matchNumber, kills, total, pos, points };
}

function stripHtmlTagContainingAll(html, tagName, needles) {
  let out = String(html || '');
  const lowerTag = String(tagName || '').toLowerCase();
  const items = (Array.isArray(needles) ? needles : [needles]).map(x => String(x || '').toLowerCase()).filter(Boolean);
  if (!lowerTag || !items.length) return out;
  const openToken = '<' + lowerTag;
  const closeToken = '</' + lowerTag + '>';
  let searchFrom = 0;
  while (true) {
    const lower = out.toLowerCase();
    const start = lower.indexOf(openToken, searchFrom);
    if (start === -1) break;
    const end = lower.indexOf(closeToken, start);
    if (end === -1) break;
    const endWithClose = end + closeToken.length;
    const chunk = out.slice(start, endWithClose).toLowerCase();
    if (items.every(n => chunk.includes(n))) {
      out = out.slice(0, start) + out.slice(endWithClose);
      searchFrom = Math.max(0, start - 1);
    } else searchFrom = endWithClose;
  }
  return out;
}
function injectBeforeBodyEnd(html, snippet, marker) {
  const source = String(html || '');
  if (marker && source.includes(marker)) return source;
  const idx = source.toLowerCase().lastIndexOf('</body>');
  if (idx === -1) return source + snippet;
  return source.slice(0, idx) + snippet + source.slice(idx);
}
function patchBackButtonStyle(html) {
  let out = String(html || '');
  const loadoutStyle = `.back-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:12px 18px;border-radius:999px;font-size:15px;font-weight:950;color:var(--text);background:linear-gradient(135deg,rgba(123,44,255,.30),rgba(255,255,255,.04));border:1px solid rgba(160,110,255,.34);box-shadow:0 0 26px rgba(123,44,255,.26);white-space:nowrap;transition:.16s ease;touch-action:manipulation}.back-btn:hover{background:rgba(123,44,255,.22);border-color:rgba(160,110,255,.45);transform:translateY(-1px)}.back-btn:active{transform:translateY(1px);opacity:.82}`;
  out = out.replace(/\.back-btn\s*\{[^{}]*\}\s*\.back-btn:hover\s*\{[^{}]*\}\s*\.back-btn:active\s*\{[^{}]*\}/, loadoutStyle);
  return out.replace(/Torna al sito/g, 'Indietro').replace(/←\s*Indietro/g, 'Indietro');
}

function patchAdminHtml(html) {
  const style = `
<style id="roda-team-slot-editor-style">
.roda-slot-pencil{width:30px;height:30px;min-width:30px;min-height:30px;display:inline-flex!important;align-items:center;justify-content:center;border-radius:999px;border:1px solid rgba(170,120,255,.34);background:rgba(123,44,255,.18);color:#f7f1ff;font-weight:950;margin-left:7px;box-shadow:0 0 18px rgba(123,44,255,.22);vertical-align:middle;cursor:pointer!important;opacity:1!important;visibility:visible!important;z-index:5}.roda-slot-pencil:hover{background:rgba(123,44,255,.32);transform:translateY(-1px)}
.roda-recalibrate-btn,.roda-force-approve-btn{margin-top:10px;min-height:42px;border:1px solid rgba(170,120,255,.34);border-radius:14px;background:linear-gradient(135deg,rgba(123,44,255,.22),rgba(169,99,255,.12));color:#f7f1ff;font-weight:950;padding:10px 14px;box-shadow:0 0 18px rgba(123,44,255,.18);cursor:pointer!important}.roda-force-approve-btn{background:linear-gradient(135deg,#18c964,#13a952);color:#04150a;border-color:rgba(24,201,100,.48);display:inline-flex!important;align-items:center;justify-content:center;margin:10px 6px 0 0}
</style>`;
  const script = `
<script id="rodaTeamSlotEditor">
(function(){
  function text(v){return String(v||'').trim();}
  function numAfter(txt,label){var r=new RegExp(label+'\\s*[:：]?\\s*#?([0-9]+)','i');var m=String(txt||'').match(r);return m?Number(m[1]):0;}
  function cleanTeamFromRow(row){if(!row)return'';var title=row.querySelector('.item-title,.team-name,[data-team],td:nth-child(2),td:first-child,strong,b');var raw=title?(title.getAttribute('data-team')||title.textContent):'';raw=text(raw).replace(/^#?\\d+\\s*/,'').replace(/^Slot\\s*\\d+\\s*/i,'').replace(/✏️|✎|📝/g,'').trim();if(raw&&!/^slot$/i.test(raw))return raw;var cells=Array.from(row.querySelectorAll('td')).map(function(td){return text(td.textContent);}).filter(Boolean);for(var i=0;i<cells.length;i++){if(!/^\\d+$/.test(cells[i])&&!/slot/i.test(cells[i])&&!/azioni/i.test(cells[i]))return cells[i];}return'';}
  function slotRows(){var rows=[];document.querySelectorAll('.slot').forEach(function(slotEl){var value=text(slotEl.textContent).replace(/[^0-9]/g,'');if(!value)return;var row=slotEl.closest('tr,.item,.mini-row,.slot-card');if(!row)return;if(rows.indexOf(row)===-1)rows.push(row);});return rows;}
  function normalizeVisibleSlots(){slotRows().forEach(function(row,idx){var slotEl=row.querySelector('.slot');if(!slotEl)return;var next=idx+1;slotEl.textContent='#'+next;slotEl.dataset.slot=String(next);var edit=row.querySelector('.roda-slot-pencil');if(edit)edit.dataset.currentSlot=String(next);});}
  async function normalizeSlots(silent){try{var res=await fetch('/api/dashboard/team-slots/recalibrate?ts='+Date.now(),{method:'POST',headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify({})});var data=await res.json().catch(function(){return{};});if(!res.ok||data.ok===false)throw new Error(data.message||data.error||'Errore ricalibrazione slot');normalizeVisibleSlots();enhance();if(!silent)alert('Slot ricalibrati: ora sono consecutivi.');return true;}catch(err){if(!silent)alert(err.message||'Errore ricalibrazione slot');return false;}}
  async function saveSlot(teamName,currentSlot){var team=text(teamName)||prompt('Nome team da modificare:','');if(!team)return;var raw=prompt('Nuovo slot per '+team+':',currentSlot||'');if(raw===null)return;var slot=Number(raw);if(!Number.isInteger(slot)||slot<1||slot>16){alert('Slot non valido. Inserisci un numero da 1 a 16.');return;}try{var res=await fetch('/api/dashboard/team-slot?ts='+Date.now(),{method:'POST',headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify({team:team,slot:slot})});var data=await res.json().catch(function(){return{};});if(!res.ok||data.ok===false)throw new Error(data.message||data.error||'Errore salvataggio slot');alert('Slot aggiornato.');location.reload();}catch(err){alert(err.message||'Errore salvataggio slot');}}
  function addRecalibrateButton(){var teamsPage=[].slice.call(document.querySelectorAll('h1,h2,h3,.card-title,.page-title')).find(function(el){return /team iscritti|team registrati|team/i.test(text(el.textContent));});if(!teamsPage)return;var host=teamsPage.closest('.card,.hero,.page')||teamsPage.parentElement;if(!host||host.querySelector('.roda-recalibrate-btn'))return;var btn=document.createElement('button');btn.type='button';btn.className='roda-recalibrate-btn';btn.textContent='Ricalibra slot';btn.addEventListener('click',async function(ev){ev.preventDefault();ev.stopPropagation();await normalizeSlots(false);});teamsPage.insertAdjacentElement('afterend',btn);}
  function parseResultCard(card){var all=text(card&&card.textContent);var title=(card.querySelector('.item-title,h2,h3,strong,b')||{}).textContent||'';var team=text(title).replace(/^📸/,'').replace(/Match.*$/i,'').trim();if(!team){var first=all.split('\n').map(text).filter(Boolean)[0]||'';team=first.replace(/^📸/,'').replace(/Match.*$/i,'').trim();}var match=numAfter(all,'Match')||1;var slot=numAfter(all,'Slot')||0;var total=numAfter(all,'Kill totali')||0;var pos=numAfter(all,'Posizione')||0;var killMatches=[].slice.call(all.matchAll(/([0-9]+)\s*kill/gi)).map(function(m){return Number(m[1]||0);}).slice(0,3);while(killMatches.length<3)killMatches.push(0);if(!total)total=killMatches.reduce(function(a,b){return a+b;},0);return{team:team,matchNumber:match,slot:slot,total:total,pos:pos,kills:killMatches,submittedBy:'Admin pannello'};}
  async function forceApprove(card){var payload=parseResultCard(card);if(!payload.team||!payload.pos){alert('Non riesco a leggere team/posizione. Usa inserimento manuale se necessario.');return;}if(!confirm('Forzare approvazione risultato per '+payload.team+'?'))return;try{var res=await fetch('/api/dashboard/result-force-approve?ts='+Date.now(),{method:'POST',headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(payload)});var data=await res.json().catch(function(){return{};});if(!res.ok||data.ok===false)throw new Error(data.message||'Errore approvazione forzata');alert('Risultato approvato e punti assegnati.');location.reload();}catch(err){alert(err.message||'Errore approvazione forzata');}}
  function addForceApproveButtons(){document.querySelectorAll('.item,.card,.modal,.result-card').forEach(function(card){var all=text(card.textContent);if(!/kill totali/i.test(all)||!/posizione/i.test(all)||!/slot/i.test(all))return;if(card.querySelector('.roda-force-approve-btn'))return;var btn=document.createElement('button');btn.type='button';btn.className='roda-force-approve-btn';btn.textContent='✅ Forza approva';btn.addEventListener('click',function(ev){ev.preventDefault();ev.stopPropagation();forceApprove(card);});var target=card.querySelector('.split-actions,.row,.actions')||card;target.appendChild(btn);});}
  function enhance(){document.querySelectorAll('.slot').forEach(function(slotEl){var value=text(slotEl.textContent).replace(/[^0-9]/g,'');if(!value)return;var scope=slotEl.closest('tr,.item,.mini-row,.slot-card,.card')||slotEl.parentElement;if(!scope)return;var existing=scope.querySelector('.roda-slot-pencil');var team=cleanTeamFromRow(scope);if(existing){existing.dataset.currentSlot=value;return;}var btn=document.createElement('button');btn.type='button';btn.className='roda-slot-pencil';btn.title='Modifica slot team';btn.textContent='✏️';btn.dataset.currentSlot=value;btn.addEventListener('click',function(ev){ev.preventDefault();ev.stopPropagation();saveSlot(team,btn.dataset.currentSlot||value);});slotEl.dataset.rodaSlotEditor='1';slotEl.insertAdjacentElement('afterend',btn);});addRecalibrateButton();addForceApproveButtons();}
  var scheduled=false;function scheduleEnhance(){if(scheduled)return;scheduled=true;requestAnimationFrame(function(){scheduled=false;enhance();});}
  var originalFetch=window.fetch;if(originalFetch&&!window.__rodaSlotFetchPatched){window.__rodaSlotFetchPatched=true;window.fetch=async function(input,init){var method=String((init&&init.method)||'GET').toUpperCase();var url=String(typeof input==='string'?input:(input&&input.url)||'');var res=await originalFetch.apply(this,arguments);try{if(method==='DELETE'&&/team/i.test(url)&&res.ok){await normalizeSlots(true);}}catch(e){}setTimeout(scheduleEnhance,50);return res;};}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',enhance);else enhance();try{new MutationObserver(scheduleEnhance).observe(document.body,{childList:true,subtree:true,characterData:true});}catch(e){}setInterval(enhance,600);
})();
</script>`;
  let out = String(html || '');
  if (!out.includes('roda-team-slot-editor-style')) out = out.replace('</head>', style + '</head>');
  return injectBeforeBodyEnd(out, script, 'rodaTeamSlotEditor');
}

function patchPublicHtml(html, filePath) {
  const name = path.basename(String(filePath || '')).toLowerCase();
  let out = String(html || '');
  if (name === 'index.html') {
    out = stripHtmlTagContainingAll(out, 'button', ['class="tab-btn"', 'loadout']);
    out = stripHtmlTagContainingAll(out, 'button', ["class='tab-btn'", 'loadout']);
    out = stripHtmlTagContainingAll(out, 'button', ['class="fl-btn"', 'loadout']);
    out = stripHtmlTagContainingAll(out, 'button', ["class='fl-btn'", 'loadout']);
    out = stripHtmlTagContainingAll(out, 'button', ['data-page="loadout"']);
    out = stripHtmlTagContainingAll(out, 'button', ["data-page='loadout'"]);
    return out;
  }
  if (name === 'clan.html' || name === 'streamer.html') return patchBackButtonStyle(out);
  if (name === 'admin.html') return patchAdminHtml(out);
  return out;
}
function sortTeamEntries(teams) { return Object.entries(teams || {}).sort((a, b) => { const sa = Number(a[1] && a[1].slot) || 999999; const sb = Number(b[1] && b[1].slot) || 999999; if (sa !== sb) return sa - sb; return String(a[0]).localeCompare(String(b[0]), 'it'); }); }
function recalibrateTeamSlots() { const teams = readTeamsDirect(); const next = {}; sortTeamEntries(teams).forEach(([name, team], index) => { next[name] = { ...(team || {}), slot: index + 1, updatedAt: new Date().toISOString() }; }); writeTeamsDirect(next); return next; }
function updateTeamSlotDirect(teamName, slot) {
  const cleanName = String(teamName || '').trim();
  const slotNumber = Number(slot);
  if (!cleanName) throw new Error('Nome team mancante.');
  if (!Number.isInteger(slotNumber) || slotNumber < 1 || slotNumber > 16) throw new Error('Slot non valido. Usa un numero da 1 a 16.');
  const teams = readTeamsDirect();
  const key = Object.keys(teams).find(k => k.toLowerCase() === cleanName.toLowerCase()) || cleanName;
  if (!teams[key]) throw new Error('Team non trovato.');
  const usedBy = Object.entries(teams).find(([name, team]) => name !== key && Number(team && team.slot) === slotNumber);
  if (usedBy) throw new Error(`Lo slot ${slotNumber} è già occupato da ${usedBy[0]}.`);
  teams[key] = { ...(teams[key] || {}), slot: slotNumber, updatedAt: new Date().toISOString() };
  writeTeamsDirect(teams);
  return { team: key, slot: slotNumber };
}
function installTeamSlotRoute(app) {
  if (!app || app.__rodaTeamSlotRouteInstalled) return;
  Object.defineProperty(app, '__rodaTeamSlotRouteInstalled', { value: true, enumerable: false });
  app.post('/api/dashboard/team-slot', (req, res) => { try { const result = updateTeamSlotDirect(req.body && (req.body.team || req.body.teamName || req.body.nome), req.body && req.body.slot); return res.json({ ok: true, ...result }); } catch (error) { const message = error.message || 'Errore aggiornamento slot.'; const status = /occupato/i.test(message) ? 409 : /non trovato/i.test(message) ? 404 : 400; return res.status(status).json({ ok: false, message }); } });
  app.post('/api/dashboard/team-slots/recalibrate', (req, res) => { try { const teams = recalibrateTeamSlots(); return res.json({ ok: true, teams, count: Object.keys(teams || {}).length }); } catch (error) { return res.status(500).json({ ok: false, message: error.message || 'Errore ricalibrazione slot.' }); } });
  app.get('/api/dashboard/team-slots/recalibrate', (req, res) => { try { const teams = recalibrateTeamSlots(); return res.json({ ok: true, teams, count: Object.keys(teams || {}).length }); } catch (error) { return res.status(500).json({ ok: false, message: error.message || 'Errore ricalibrazione slot.' }); } });
  app.post('/api/dashboard/result-force-approve', (req, res) => { try { const result = forceApproveResult(req.body || {}, req.staffUser || 'admin'); return res.json({ ok: true, ...result }); } catch (error) { return res.status(400).json({ ok: false, message: error.message || 'Errore approvazione forzata.' }); } });
}
function installPatches() {
  const response = express && express.response;
  if (response && !response.__rodaPublicHtmlPatched && typeof response.sendFile === 'function') {
    const originalSendFile = response.sendFile;
    Object.defineProperty(response, '__rodaPublicHtmlPatched', { value: true, enumerable: false });
    response.sendFile = function patchedSendFile(filePath, options, callback) {
      const name = path.basename(String(filePath || '')).toLowerCase();
      if (!['index.html', 'clan.html', 'streamer.html', 'admin.html'].includes(name)) return originalSendFile.apply(this, arguments);
      try { const html = fs.readFileSync(filePath, 'utf8'); const patched = patchPublicHtml(html, filePath); this.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate'); this.setHeader('Pragma', 'no-cache'); this.setHeader('Expires', '0'); this.type('html'); return this.send(patched); }
      catch (error) { console.error('[public-html-patch]', error.message); return originalSendFile.apply(this, arguments); }
    };
  }
  const proto = express && express.application;
  if (proto && !proto.__rodaTeamSlotListenPatched && typeof proto.listen === 'function') {
    const originalListen = proto.listen;
    Object.defineProperty(proto, '__rodaTeamSlotListenPatched', { value: true, enumerable: false });
    proto.listen = function patchedListen(...args) { try { installTeamSlotRoute(this); } catch (error) { console.error('[team-slot-route]', error.message); } return originalListen.apply(this, args); };
  }
}
installPatches();
async function generateLoadoutGraphic(build) { const result = await graphics.generateLoadoutGraphic(build); return { fileName: result.fileName || '', outputPath: result.outputPath || '', url: result.url || result.imageUrl || '' }; }
module.exports = { generateLoadoutGraphic };
