'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const graphics = require('./loadout-graphics');

let storage = null;
try {
  storage = require('./storage');
} catch {
  storage = null;
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
    const chunk = out.slice(start, endWithClose);
    const chunkLower = chunk.toLowerCase();
    if (items.every(n => chunkLower.includes(n))) {
      out = out.slice(0, start) + out.slice(endWithClose);
      searchFrom = Math.max(0, start - 1);
    } else {
      searchFrom = endWithClose;
    }
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
  out = out.replace(/Torna al sito/g, 'Indietro');
  out = out.replace(/←\s*Indietro/g, 'Indietro');
  return out;
}

function patchAdminHtml(html) {
  const style = `
<style id="roda-team-slot-editor-style">
.roda-slot-pencil{width:30px;height:30px;display:inline-flex;align-items:center;justify-content:center;border-radius:999px;border:1px solid rgba(170,120,255,.34);background:rgba(123,44,255,.18);color:#f7f1ff;font-weight:950;margin-left:7px;box-shadow:0 0 18px rgba(123,44,255,.22);vertical-align:middle;cursor:pointer!important}.roda-slot-pencil:hover{background:rgba(123,44,255,.32);transform:translateY(-1px)}
.roda-recalibrate-btn{margin-top:10px;min-height:42px;border:1px solid rgba(170,120,255,.34);border-radius:14px;background:linear-gradient(135deg,rgba(123,44,255,.22),rgba(169,99,255,.12));color:#f7f1ff;font-weight:950;padding:10px 14px;box-shadow:0 0 18px rgba(123,44,255,.18);cursor:pointer!important}
</style>`;
  const script = `
<script id="rodaTeamSlotEditor">
(function(){
  function text(v){return String(v||'').trim();}
  function cleanTeamFromRow(row){
    if(!row) return '';
    var title=row.querySelector('.item-title,.team-name,[data-team],td:nth-child(2),td:first-child,strong,b');
    var raw=title?(title.getAttribute('data-team')||title.textContent):'';
    raw=text(raw).replace(/^#?\\d+\\s*/,'').replace(/^Slot\\s*\\d+\\s*/i,'').replace(/✏️|✎|📝/g,'').trim();
    if(raw && !/^slot$/i.test(raw)) return raw;
    var cells=Array.from(row.querySelectorAll('td')).map(function(td){return text(td.textContent);}).filter(Boolean);
    for(var i=0;i<cells.length;i++){ if(!/^\\d+$/.test(cells[i]) && !/slot/i.test(cells[i]) && !/azioni/i.test(cells[i])) return cells[i]; }
    return '';
  }
  async function normalizeSlots(silent){
    try{
      var res=await fetch('/api/dashboard/team-slots/recalibrate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({})});
      var data=await res.json().catch(function(){return {};});
      if(!res.ok||data.ok===false) throw new Error(data.message||data.error||'Errore ricalibrazione slot');
      if(!silent) alert('Slot ricalibrati: ora sono consecutivi.');
      return true;
    }catch(err){ if(!silent) alert(err.message||'Errore ricalibrazione slot'); return false; }
  }
  async function saveSlot(teamName,currentSlot){
    var team=text(teamName)||prompt('Nome team da modificare:','');
    if(!team) return;
    var raw=prompt('Nuovo slot per '+team+':', currentSlot||'');
    if(raw===null) return;
    var slot=Number(raw);
    if(!Number.isInteger(slot)||slot<1||slot>16){ alert('Slot non valido. Inserisci un numero da 1 a 16.'); return; }
    try{
      var res=await fetch('/api/dashboard/team-slot',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({team:team,slot:slot})});
      var data=await res.json().catch(function(){return {};});
      if(!res.ok||data.ok===false){ throw new Error(data.message||data.error||'Errore salvataggio slot'); }
      alert('Slot aggiornato.');
      location.reload();
    }catch(err){ alert(err.message||'Errore salvataggio slot'); }
  }
  function addRecalibrateButton(){
    var teamsPage=[].slice.call(document.querySelectorAll('h1,h2,h3,.card-title,.page-title')).find(function(el){return /team iscritti|team registrati|team/i.test(text(el.textContent));});
    if(!teamsPage) return;
    var host=teamsPage.closest('.card,.hero,.page')||teamsPage.parentElement;
    if(!host||host.querySelector('.roda-recalibrate-btn')) return;
    var btn=document.createElement('button');
    btn.type='button';
    btn.className='roda-recalibrate-btn';
    btn.textContent='Ricalibra slot';
    btn.addEventListener('click',async function(ev){ev.preventDefault();ev.stopPropagation();var ok=await normalizeSlots(false);if(ok) location.reload();});
    teamsPage.insertAdjacentElement('afterend',btn);
  }
  function enhance(){
    document.querySelectorAll('.slot').forEach(function(slotEl){
      if(slotEl.dataset.rodaSlotEditor==='1') return;
      var value=text(slotEl.textContent).replace(/[^0-9]/g,'');
      if(!value) return;
      var scope=slotEl.closest('tr,.item,.mini-row,.slot-card,.card')||slotEl.parentElement;
      var team=cleanTeamFromRow(scope);
      var btn=document.createElement('button');
      btn.type='button';
      btn.className='roda-slot-pencil';
      btn.title='Modifica slot team';
      btn.textContent='✏️';
      btn.addEventListener('click',function(ev){ev.preventDefault();ev.stopPropagation();saveSlot(team,value);});
      slotEl.dataset.rodaSlotEditor='1';
      slotEl.insertAdjacentElement('afterend',btn);
    });
    addRecalibrateButton();
  }
  var originalFetch=window.fetch;
  if(originalFetch&&!window.__rodaSlotFetchPatched){
    window.__rodaSlotFetchPatched=true;
    window.fetch=async function(input,init){
      var method=String((init&&init.method)||'GET').toUpperCase();
      var url=String(typeof input==='string'?input:(input&&input.url)||'');
      var res=await originalFetch.apply(this,arguments);
      try{
        if(method==='DELETE' && /team/i.test(url) && res.ok){
          await normalizeSlots(true);
        }
      }catch(e){}
      return res;
    };
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',enhance); else enhance();
  setInterval(enhance,1500);
})();
</script>`;
  let out = String(html || '');
  if (!out.includes('roda-team-slot-editor-style')) out = out.replace('</head>', style + '</head>');
  out = injectBeforeBodyEnd(out, script, 'rodaTeamSlotEditor');
  return out;
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
    out = stripHtmlTagContainingAll(out, 'button', ['showpage(\'loadout\')']);
    out = stripHtmlTagContainingAll(out, 'button', ['showpage("loadout")']);
    return out;
  }

  if (name === 'clan.html' || name === 'streamer.html') {
    return patchBackButtonStyle(out);
  }

  if (name === 'admin.html') {
    return patchAdminHtml(out);
  }

  return out;
}

function sortTeamEntries(teams) {
  return Object.entries(teams || {}).sort((a, b) => {
    const sa = Number(a[1] && a[1].slot) || 999999;
    const sb = Number(b[1] && b[1].slot) || 999999;
    if (sa !== sb) return sa - sb;
    return String(a[0]).localeCompare(String(b[0]), 'it');
  });
}

function recalibrateTeamSlots() {
  if (!storage || typeof storage.loadTeams !== 'function' || typeof storage.saveTeams !== 'function') {
    throw new Error('Storage team non disponibile.');
  }
  const teams = storage.loadTeams() || {};
  const ordered = sortTeamEntries(teams);
  const next = {};
  ordered.forEach(([name, team], index) => {
    next[name] = { ...team, slot: index + 1, updatedAt: new Date().toISOString() };
  });
  storage.saveTeams(next);
  return next;
}

function installTeamSlotRoute(app) {
  if (!app || app.__rodaTeamSlotRouteInstalled) return;
  Object.defineProperty(app, '__rodaTeamSlotRouteInstalled', { value: true, enumerable: false });

  app.post('/api/dashboard/team-slot', (req, res) => {
    try {
      if (!storage || typeof storage.loadTeams !== 'function' || typeof storage.saveTeams !== 'function') {
        return res.status(500).json({ ok: false, message: 'Storage team non disponibile.' });
      }
      const teamName = String((req.body && (req.body.team || req.body.teamName || req.body.nome)) || '').trim();
      const slot = Number(req.body && req.body.slot);
      if (!teamName) return res.status(400).json({ ok: false, message: 'Nome team mancante.' });
      if (!Number.isInteger(slot) || slot < 1 || slot > 16) return res.status(400).json({ ok: false, message: 'Slot non valido. Usa un numero da 1 a 16.' });

      const teams = storage.loadTeams() || {};
      const key = Object.keys(teams).find(k => k.toLowerCase() === teamName.toLowerCase()) || teamName;
      if (!teams[key]) return res.status(404).json({ ok: false, message: 'Team non trovato.' });

      const usedBy = Object.entries(teams).find(([name, team]) => name !== key && Number(team && team.slot) === slot);
      if (usedBy) return res.status(409).json({ ok: false, message: `Lo slot ${slot} è già occupato da ${usedBy[0]}.` });

      teams[key] = { ...teams[key], slot, updatedAt: new Date().toISOString() };
      storage.saveTeams(teams);
      return res.json({ ok: true, team: key, slot });
    } catch (error) {
      return res.status(500).json({ ok: false, message: error.message || 'Errore aggiornamento slot.' });
    }
  });

  app.post('/api/dashboard/team-slots/recalibrate', (req, res) => {
    try {
      const teams = recalibrateTeamSlots();
      return res.json({ ok: true, teams, count: Object.keys(teams || {}).length });
    } catch (error) {
      return res.status(500).json({ ok: false, message: error.message || 'Errore ricalibrazione slot.' });
    }
  });
}

function installPatches() {
  const response = express && express.response;
  if (response && !response.__rodaPublicHtmlPatched && typeof response.sendFile === 'function') {
    const originalSendFile = response.sendFile;
    Object.defineProperty(response, '__rodaPublicHtmlPatched', { value: true, enumerable: false });
    response.sendFile = function patchedSendFile(filePath, options, callback) {
      const name = path.basename(String(filePath || '')).toLowerCase();
      if (!['index.html', 'clan.html', 'streamer.html', 'admin.html'].includes(name)) {
        return originalSendFile.apply(this, arguments);
      }
      try {
        const html = fs.readFileSync(filePath, 'utf8');
        const patched = patchPublicHtml(html, filePath);
        this.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        this.setHeader('Pragma', 'no-cache');
        this.setHeader('Expires', '0');
        this.type('html');
        return this.send(patched);
      } catch (error) {
        console.error('[public-html-patch]', error.message);
        return originalSendFile.apply(this, arguments);
      }
    };
  }

  const proto = express && express.application;
  if (proto && !proto.__rodaTeamSlotListenPatched && typeof proto.listen === 'function') {
    const originalListen = proto.listen;
    Object.defineProperty(proto, '__rodaTeamSlotListenPatched', { value: true, enumerable: false });
    proto.listen = function patchedListen(...args) {
      try { installTeamSlotRoute(this); } catch (error) { console.error('[team-slot-route]', error.message); }
      return originalListen.apply(this, args);
    };
  }
}

installPatches();

async function generateLoadoutGraphic(build) {
  const result = await graphics.generateLoadoutGraphic(build);
  return {
    fileName: result.fileName || '',
    outputPath: result.outputPath || '',
    url: result.url || result.imageUrl || ''
  };
}

module.exports = { generateLoadoutGraphic };
