'use strict';

/**
 * Public website registration guard.
 * Website registrations must include a Discord captain/reference so staff can
 * create/contact the correct ticket. The value is saved on the team object.
 */

const fs = require('fs');
const path = require('path');
const express = require('express');

const ROOT_DIR = __dirname;
const STORAGE_DIR = process.env.STORAGE_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(ROOT_DIR, 'storage-data');
const TEAMS_FILE = path.join(STORAGE_DIR, 'teams.json');

function clean(value) { return String(value || '').trim(); }
function lower(value) { return clean(value).toLowerCase(); }
function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf8');
    return raw.trim() ? JSON.parse(raw) : fallback;
  } catch (error) {
    console.error('[site-registration-discord] read json failed:', error.message);
    return fallback;
  }
}
function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value || {}, null, 2), 'utf8');
}

function getTeamNameFromBody(body) {
  return clean(body?.team || body?.teamName || body?.nomeTeam || body?.nome || body?.name);
}

function getDiscordReference(body) {
  return clean(
    body?.captainDiscord ||
    body?.discordCaptain ||
    body?.discordReference ||
    body?.discordRef ||
    body?.discord ||
    body?.discordName ||
    body?.discordTag ||
    body?.capitanoDiscord ||
    body?.contattoDiscord ||
    body?.ticketDiscord ||
    body?.registeredByTag
  );
}

function extractDiscordId(reference) {
  const value = clean(reference);
  const mention = value.match(/^<@!?([0-9]{15,25})>$/);
  if (mention) return mention[1];
  const raw = value.match(/^[0-9]{15,25}$/);
  return raw ? raw[0] : '';
}

function looksLikePublicRegistration(req) {
  const method = String(req.method || '').toUpperCase();
  if (method !== 'POST') return false;
  const url = lower(req.originalUrl || req.url || '');
  const body = req.body || {};
  const team = getTeamNameFromBody(body);
  const playersArray = Array.isArray(body.players) ? body.players.filter(Boolean) : [];
  const hasPlayers = playersArray.length >= 3 || (body.p1 && body.p2 && body.p3) || (body.player1 && body.player2 && body.player3) || (body.g1 && body.g2 && body.g3);
  const routeLooksPublic = /register|registr|iscrizion|team/.test(url) && !/admin|dashboard|login|auth|result|loadout|slot|settings/.test(url);
  return Boolean(team && hasPlayers && routeLooksPublic);
}

function attachDiscordFields(req, reference) {
  req.body = req.body || {};
  req.body.captainDiscord = reference;
  req.body.discordReference = reference;
  req.body.discordRef = reference;
  req.body.registeredByTag = reference;
  const discordId = extractDiscordId(reference);
  if (discordId) {
    req.body.registeredById = discordId;
    req.body.ownerDiscordId = discordId;
    req.body.captainDiscordId = discordId;
    req.body.discordUserId = discordId;
  }
}

function saveDiscordReferenceOnTeam(teamName, reference) {
  const cleanTeam = clean(teamName);
  const cleanRef = clean(reference);
  if (!cleanTeam || !cleanRef) return false;
  const teams = readJson(TEAMS_FILE, {});
  const key = Object.keys(teams || {}).find(name => name.toLowerCase() === cleanTeam.toLowerCase()) || cleanTeam;
  if (!teams[key]) return false;
  const discordId = extractDiscordId(cleanRef);
  teams[key] = {
    ...(teams[key] || {}),
    captainDiscord: cleanRef,
    discordReference: cleanRef,
    registeredByTag: teams[key].registeredByTag || cleanRef,
    updatedAt: new Date().toISOString()
  };
  if (discordId) {
    teams[key].registeredById = discordId;
    teams[key].ownerDiscordId = discordId;
    teams[key].captainDiscordId = discordId;
    teams[key].discordUserId = discordId;
  }
  writeJson(TEAMS_FILE, teams);
  console.log(`[site-registration-discord] riferimento Discord salvato per ${key}: ${cleanRef}`);
  return true;
}

function requireDiscordReference(req, res, next) {
  if (!looksLikePublicRegistration(req)) return next();
  const reference = getDiscordReference(req.body);
  if (!reference || reference.length < 2) {
    return res.status(400).json({
      ok: false,
      error: 'DISCORD_REFERENCE_REQUIRED',
      message: 'Inserisci il nome Discord del capitano o un Discord di riferimento per il ticket.'
    });
  }
  attachDiscordFields(req, reference);

  const teamName = getTeamNameFromBody(req.body);
  const originalJson = res.json;
  res.json = function patchedJson(payload) {
    try {
      const ok = !(payload && payload.ok === false) && res.statusCode < 400;
      if (ok) setTimeout(() => saveDiscordReferenceOnTeam(teamName, reference), 80);
    } catch (error) {
      console.error('[site-registration-discord] post-save json failed:', error.message);
    }
    return originalJson.call(this, payload);
  };
  next();
}

function injectBeforeBodyEnd(html, snippet, marker) {
  const source = String(html || '');
  if (marker && source.includes(marker)) return source;
  const idx = source.toLowerCase().lastIndexOf('</body>');
  if (idx === -1) return source + snippet;
  return source.slice(0, idx) + snippet + source.slice(idx);
}

function patchIndexHtml(html) {
  const snippet = `
<script id="rodaDiscordReferenceGuard">
(function(){
  function clean(v){return String(v||'').trim();}
  function looksLikeRegisterUrl(url){url=String(url||'').toLowerCase();return /(register|registr|iscrizion|team)/.test(url)&&!/(admin|dashboard|login|auth|result|loadout|slot|settings)/.test(url);}
  function getField(){return document.querySelector('#captainDiscord,#discordReference,[name="captainDiscord"],[name="discordReference"],[name="discord"]');}
  function getValue(){var f=getField();return f?clean(f.value):'';}
  function findRegistrationForm(){
    var forms=[].slice.call(document.querySelectorAll('form'));
    return forms.find(function(form){var t=(form.textContent||'').toLowerCase();return t.includes('team')&&(t.includes('giocatore')||t.includes('player'));})||document.querySelector('#registerForm,.register-form,[data-register-form]')||null;
  }
  function ensureField(){
    if(getField()) return;
    var form=findRegistrationForm();
    if(!form) return;
    var wrap=document.createElement('div');
    wrap.className='field discord-reference-field';
    wrap.innerHTML='<label for="captainDiscord">Discord capitano / riferimento ticket *</label><input id="captainDiscord" name="captainDiscord" type="text" autocomplete="off" required placeholder="Es. RooS oppure @RooS oppure ID Discord" /><small style="color:var(--muted);line-height:1.35">Obbligatorio: serve allo staff per aprire o gestire il ticket del team.</small>';
    var teamInput=form.querySelector('[name="team"],[name="teamName"],#team,#teamName');
    var target=(teamInput&&teamInput.closest('.field'))||teamInput;
    if(target&&target.parentNode) target.parentNode.insertBefore(wrap,target.nextSibling); else form.insertBefore(wrap,form.firstChild);
  }
  function validateAndGet(){
    ensureField();
    var value=getValue();
    if(!value){alert('Inserisci il nome Discord del capitano o un Discord di riferimento per il ticket.');var f=getField();if(f)f.focus();throw new Error('Discord riferimento mancante');}
    return value;
  }
  var originalFetch=window.fetch;
  if(originalFetch&&!window.__rodaDiscordReferenceFetchPatched){
    window.__rodaDiscordReferenceFetchPatched=true;
    window.fetch=function(input,init){
      var url=typeof input==='string'?input:(input&&input.url)||'';
      var method=String((init&&init.method)||'GET').toUpperCase();
      if(method==='POST'&&looksLikeRegisterUrl(url)&&init&&init.body){
        var ref=validateAndGet();
        if(typeof init.body==='string'){
          try{var data=JSON.parse(init.body);data.captainDiscord=ref;data.discordReference=ref;data.discordRef=ref;data.registeredByTag=ref;init=Object.assign({},init,{body:JSON.stringify(data)});}catch(e){}
        }else if(window.FormData&&init.body instanceof FormData){
          init.body.set('captainDiscord',ref);init.body.set('discordReference',ref);init.body.set('discordRef',ref);init.body.set('registeredByTag',ref);
        }
      }
      return originalFetch.call(this,input,init);
    };
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ensureField);else ensureField();
  setInterval(ensureField,1200);
})();
</script>`;
  return injectBeforeBodyEnd(html, snippet, 'rodaDiscordReferenceGuard');
}

function patchExpress() {
  const appProto = express && express.application;
  if (appProto && !appProto.__rodaDiscordRegistrationPostPatched && typeof appProto.post === 'function') {
    const originalPost = appProto.post;
    Object.defineProperty(appProto, '__rodaDiscordRegistrationPostPatched', { value: true, enumerable: false });
    appProto.post = function patchedPost(pathOrFn, ...handlers) {
      const route = String(pathOrFn || '').toLowerCase();
      if (/(register|registr|iscrizion|team)/.test(route) && !/(admin|dashboard|login|auth|result|loadout|slot|settings)/.test(route)) {
        return originalPost.call(this, pathOrFn, requireDiscordReference, ...handlers);
      }
      return originalPost.call(this, pathOrFn, ...handlers);
    };
  }

  const response = express && express.response;
  if (response && !response.__rodaDiscordRegistrationHtmlPatched && typeof response.sendFile === 'function') {
    const originalSendFile = response.sendFile;
    Object.defineProperty(response, '__rodaDiscordRegistrationHtmlPatched', { value: true, enumerable: false });
    response.sendFile = function patchedSendFile(filePath, options, callback) {
      const name = path.basename(String(filePath || '')).toLowerCase();
      if (name !== 'index.html' && name !== 'home.html') return originalSendFile.apply(this, arguments);
      try {
        const html = fs.readFileSync(filePath, 'utf8');
        this.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        this.type('html');
        return this.send(patchIndexHtml(html));
      } catch (error) {
        console.error('[site-registration-discord] html patch failed:', error.message);
        return originalSendFile.apply(this, arguments);
      }
    };
  }
}

patchExpress();
console.log('✅ Registrazioni sito: riferimento Discord obbligatorio attivo.');

module.exports = { patchExpress, requireDiscordReference, saveDiscordReferenceOnTeam };
