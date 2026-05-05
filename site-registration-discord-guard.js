'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');

const ROOT_DIR = __dirname;
const STORAGE_DIR = process.env.STORAGE_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(ROOT_DIR, 'storage-data');
const TEAMS_FILE = path.join(STORAGE_DIR, 'teams.json');

function clean(v) { return String(v || '').trim(); }
function lower(v) { return clean(v).toLowerCase(); }
function readJson(filePath, fallback) { try { if (!fs.existsSync(filePath)) return fallback; const raw = fs.readFileSync(filePath, 'utf8'); return raw.trim() ? JSON.parse(raw) : fallback; } catch (e) { console.error('[site-registration-discord] read json failed:', e.message); return fallback; } }
function writeJson(filePath, value) { fs.mkdirSync(path.dirname(filePath), { recursive: true }); fs.writeFileSync(filePath, JSON.stringify(value || {}, null, 2), 'utf8'); }
function getTeamNameFromBody(body) { return clean(body?.team || body?.teamName || body?.nomeTeam || body?.nome || body?.name || body?.squadra); }
function getDiscordReference(body) { return clean(body?.captainDiscord || body?.discordCaptain || body?.discordReference || body?.discordRef || body?.discord || body?.discordName || body?.discordTag || body?.capitanoDiscord || body?.contattoDiscord || body?.ticketDiscord || body?.registeredByTag || body?.discordUsername || body?.discordUser); }
function extractDiscordId(ref) { const v = clean(ref); const mention = v.match(/^<@!?([0-9]{15,25})>$/); if (mention) return mention[1]; const raw = v.match(/^[0-9]{15,25}$/); return raw ? raw[0] : ''; }

function getPlayersFromBody(body) {
  const arr = Array.isArray(body?.players) ? body.players.filter(Boolean) : [];
  const fields = [body?.p1, body?.p2, body?.p3, body?.player1, body?.player2, body?.player3, body?.g1, body?.g2, body?.g3, body?.giocatore1, body?.giocatore2, body?.giocatore3].filter(Boolean);
  return arr.length ? arr : fields;
}

function looksLikePublicRegistration(req) {
  const method = String(req.method || '').toUpperCase();
  if (method !== 'POST') return false;
  const url = lower(req.originalUrl || req.url || '');
  const body = req.body || {};
  const team = getTeamNameFromBody(body);
  const hasPlayers = getPlayersFromBody(body).length >= 3;
  const route = /register|registr|iscrizion|team/.test(url) && !/admin|dashboard|login|auth|result|loadout|slot|settings|score|fragger/.test(url);
  return Boolean(team && hasPlayers && route);
}

function attachDiscordFields(req, reference) {
  req.body = req.body || {};
  req.body.captainDiscord = reference;
  req.body.discordReference = reference;
  req.body.discordRef = reference;
  req.body.discord = reference;
  req.body.discordUsername = reference;
  req.body.registeredByTag = reference;
  const id = extractDiscordId(reference);
  if (id) {
    req.body.registeredById = id;
    req.body.ownerDiscordId = id;
    req.body.captainDiscordId = id;
    req.body.discordUserId = id;
  }
}

function saveDiscordReferenceOnTeam(teamName, reference) {
  const team = clean(teamName), ref = clean(reference);
  if (!team || !ref) return false;
  const teams = readJson(TEAMS_FILE, {});
  const key = Object.keys(teams || {}).find(n => n.toLowerCase() === team.toLowerCase()) || team;
  if (!teams[key]) return false;
  const id = extractDiscordId(ref);
  teams[key] = { ...(teams[key] || {}), captainDiscord: ref, discordReference: ref, registeredByTag: teams[key].registeredByTag || ref, updatedAt: new Date().toISOString() };
  if (id) {
    teams[key].registeredById = id;
    teams[key].ownerDiscordId = id;
    teams[key].captainDiscordId = id;
    teams[key].discordUserId = id;
  }
  writeJson(TEAMS_FILE, teams);
  console.log(`[site-registration-discord] riferimento Discord salvato per ${key}: ${ref}`);
  return true;
}

function requireDiscordReference(req, res, next) {
  if (!looksLikePublicRegistration(req)) return next();
  const ref = getDiscordReference(req.body);
  if (!ref || ref.length < 2) return res.status(400).json({ ok: false, error: 'DISCORD_REFERENCE_REQUIRED', message: 'Inserisci il nome Discord del capitano o un Discord di riferimento per il ticket.' });
  attachDiscordFields(req, ref);
  const team = getTeamNameFromBody(req.body);
  const originalJson = res.json;
  res.json = function patchedJson(payload) {
    try { const ok = !(payload && payload.ok === false) && res.statusCode < 400; if (ok) setTimeout(() => saveDiscordReferenceOnTeam(team, ref), 80); }
    catch (e) { console.error('[site-registration-discord] post-save json failed:', e.message); }
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

const DISCORD_FIELD_SNIPPET = `
<style id="rodaDiscordReferenceStyle">
.discord-reference-field{display:grid!important;gap:8px!important;margin:12px 0!important;clear:both!important}.discord-reference-field label{font-size:13px!important;color:#ddd7f2!important;font-weight:900!important}.discord-reference-field input{display:block!important;width:100%!important;border-radius:14px!important;border:1px solid rgba(160,110,255,.42)!important;background:rgba(255,255,255,.06)!important;color:#fff!important;padding:13px 14px!important;outline:none!important;font-size:15px!important;min-height:48px!important;box-shadow:0 0 18px rgba(123,44,255,.10)!important}.discord-reference-field small{color:var(--muted,#aaa6c5)!important;line-height:1.35!important;display:block!important}.roda-discord-floating{position:fixed!important;left:12px!important;right:12px!important;bottom:82px!important;z-index:999999!important;background:linear-gradient(180deg,rgba(18,18,31,.98),rgba(8,8,14,.99))!important;border:1px solid rgba(160,110,255,.36)!important;border-radius:18px!important;padding:12px!important;box-shadow:0 0 36px rgba(123,44,255,.24)!important}.roda-discord-floating.hidden{display:none!important}@media(min-width:800px){.roda-discord-floating{left:auto!important;right:18px!important;width:360px!important;bottom:18px!important}}
</style>
<script id="rodaDiscordReferenceGuard">
(function(){
function clean(v){return String(v||'').trim();}
function text(el){return clean(el&&el.textContent);}
function visible(el){return !!(el&&el.offsetParent!==null);}
function looksLikeRegisterUrl(url){url=String(url||'').toLowerCase();return /(register|registr|iscrizion|team)/.test(url)&&!/(admin|dashboard|login|auth|result|loadout|slot|settings|score|fragger)/.test(url);}
function looksLikeRegistrationArea(root){var t=clean((root||document.body).textContent).toLowerCase();return /(registra team|iscrivi|iscrizione|nome team|giocatore 1|giocatore 2|giocatore 3)/.test(t);}
function getField(){return document.querySelector('#captainDiscord,#discordReference,[name="captainDiscord"],[name="discordReference"],[name="discord"],[name="discordUsername"],[data-roda-discord-reference="1"]');}
function getValue(){var f=getField();return f?clean(f.value):'';}
function inputName(i){return clean((i.getAttribute('name')||i.id||i.placeholder||'')).toLowerCase();}
function findTeamInput(){var inputs=[].slice.call(document.querySelectorAll('input')).filter(visible);return inputs.find(function(i){var n=inputName(i);return /team|squadra/.test(n)&&!/giocatore|player|discord|password|email|kill|search/.test(n);})||inputs.find(function(i){return /nome del team|nome team/.test(inputName(i));})||null;}
function findRegisterButton(){return [].slice.call(document.querySelectorAll('button,.btn,[role="button"],input[type="submit"]')).filter(visible).find(function(b){return /(registra|iscrivi|aggiungi team)/.test(text(b).toLowerCase()||inputName(b));})||null;}
function findContainer(){var ti=findTeamInput();if(ti)return ti.closest('.card,.glow-card,form,.section,.page,main,.hero,.quick-card')||ti.parentElement||document.body;var btn=findRegisterButton();if(btn)return btn.closest('.card,.glow-card,form,.section,.page,main,.hero,.quick-card')||btn.parentElement||document.body;var h=[].slice.call(document.querySelectorAll('h1,h2,h3')).find(function(x){return /(iscrivi|registr|team)/.test(text(x).toLowerCase());});return (h&&h.closest('.card,.glow-card,.section,.page,main'))||document.body;}
function fieldHtml(){return '<label for="captainDiscord">Discord capitano / riferimento ticket *</label><input id="captainDiscord" name="captainDiscord" data-roda-discord-reference="1" type="text" autocomplete="off" required placeholder="Es. RooS / @RooS / ID Discord" /><small>Obbligatorio: serve allo staff per aprire o gestire il ticket del team.</small>';}
function ensureInlineField(){if(getField())return;var c=findContainer();if(!c||!looksLikeRegistrationArea(c))return;var wrap=document.createElement('div');wrap.className='field discord-reference-field';wrap.setAttribute('data-roda-discord-reference-wrap','1');wrap.innerHTML=fieldHtml();var ti=findTeamInput();var target=(ti&&ti.closest('.field'))||ti;if(target&&target.parentNode)target.parentNode.insertBefore(wrap,target.nextSibling);else{var btn=findRegisterButton();if(btn&&btn.parentNode)btn.parentNode.insertBefore(wrap,btn);else c.appendChild(wrap);}}
function ensureFloatingIfNeeded(){var f=getField();var btn=findRegisterButton();var exists=document.querySelector('#rodaDiscordFloating');if(f||!btn){if(exists)exists.classList.add('hidden');return;}if(!looksLikeRegistrationArea(document.body))return;if(!exists){exists=document.createElement('div');exists.id='rodaDiscordFloating';exists.className='roda-discord-floating discord-reference-field';exists.innerHTML=fieldHtml();document.body.appendChild(exists);}exists.classList.remove('hidden');}
function ensureField(){ensureInlineField();ensureFloatingIfNeeded();}
function validateAndGet(){ensureField();var v=getValue();if(!v){alert('Inserisci il nome Discord del capitano o un Discord di riferimento per il ticket.');var f=getField();if(f)f.focus();throw new Error('Discord riferimento mancante');}return v;}
var originalFetch=window.fetch;if(originalFetch&&!window.__rodaDiscordReferenceFetchPatched){window.__rodaDiscordReferenceFetchPatched=true;window.fetch=function(input,init){var url=typeof input==='string'?input:(input&&input.url)||'';var method=String((init&&init.method)||'GET').toUpperCase();if(method==='POST'&&looksLikeRegisterUrl(url)&&init&&init.body){var ref=validateAndGet();if(typeof init.body==='string'){try{var data=JSON.parse(init.body);data.captainDiscord=ref;data.discordReference=ref;data.discordRef=ref;data.discord=ref;data.discordUsername=ref;data.registeredByTag=ref;init=Object.assign({},init,{body:JSON.stringify(data)});}catch(e){}}else if(window.FormData&&init.body instanceof FormData){['captainDiscord','discordReference','discordRef','discord','discordUsername','registeredByTag'].forEach(function(k){init.body.set(k,ref);});}}return originalFetch.call(this,input,init);};}
document.addEventListener('click',function(ev){var b=ev.target&&ev.target.closest&&ev.target.closest('button,.btn,[role="button"],input[type="submit"]');if(!b)return;var t=(text(b)||inputName(b)).toLowerCase();if(/registra|iscrivi|aggiungi team/.test(t))validateAndGet();},true);
document.addEventListener('submit',function(ev){if(looksLikeRegistrationArea(ev.target))validateAndGet();},true);
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ensureField);else ensureField();try{new MutationObserver(function(){ensureField();}).observe(document.documentElement,{childList:true,subtree:true,characterData:true});}catch(e){}setInterval(ensureField,500);
})();
</script>`;

function patchIndexHtml(html) {
  const source = String(html || '');
  if (!/<\/body>/i.test(source) && !/<html/i.test(source)) return source;
  return injectBeforeBodyEnd(source, DISCORD_FIELD_SNIPPET, 'rodaDiscordReferenceGuard');
}

function shouldPatchHtmlResponse(req, body) {
  const url = lower(req?.originalUrl || req?.url || '');
  if (/admin|loadout|clan|streamer|api|uploads|assets/.test(url)) return false;
  const content = String(body || '');
  return /<html|<body|registra|iscrivi|nome team|giocatore/i.test(content);
}

function installEarlyMiddleware(app) {
  if (!app || app.__rodaDiscordRegistrationEarlyInstalled || typeof app.use !== 'function') return;
  Object.defineProperty(app, '__rodaDiscordRegistrationEarlyInstalled', { value: true, enumerable: false });
  app.use((req, res, next) => { requireDiscordReference(req, res, next); });
}

function patchExpress() {
  const appProto = express && express.application;

  if (appProto && !appProto.__rodaDiscordRegistrationListenPatched && typeof appProto.listen === 'function') {
    const originalListen = appProto.listen;
    Object.defineProperty(appProto, '__rodaDiscordRegistrationListenPatched', { value: true, enumerable: false });
    appProto.listen = function patchedListen(...args) { installEarlyMiddleware(this); return originalListen.apply(this, args); };
  }

  const originalStatic = express.static;
  if (originalStatic && !express.__rodaDiscordRegistrationStaticPatched) {
    express.static = function patchedStatic(root, options) {
      const staticMw = originalStatic.call(this, root, options);
      return function(req, res, next) {
        const url = String(req.path || req.url || '').split('?')[0].toLowerCase();
        if (req.method === 'GET' && (url === '/' || url === '/index.html' || url === '/home.html')) {
          try {
            const file = url === '/home.html' ? 'home.html' : 'index.html';
            const filePath = path.join(root, file);
            if (fs.existsSync(filePath)) { res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate'); res.type('html'); return res.send(patchIndexHtml(fs.readFileSync(filePath, 'utf8'))); }
          } catch (e) { console.error('[site-registration-discord] static patch failed:', e.message); }
        }
        return staticMw(req, res, next);
      };
    };
    express.__rodaDiscordRegistrationStaticPatched = true;
  }

  const response = express && express.response;
  if (response && !response.__rodaDiscordRegistrationPatched) {
    Object.defineProperty(response, '__rodaDiscordRegistrationPatched', { value: true, enumerable: false });

    if (typeof response.sendFile === 'function') {
      const originalSendFile = response.sendFile;
      response.sendFile = function patchedSendFile(filePath, options, callback) {
        const name = path.basename(String(filePath || '')).toLowerCase();
        if (name !== 'index.html' && name !== 'home.html') return originalSendFile.apply(this, arguments);
        try { this.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate'); this.type('html'); return this.send(patchIndexHtml(fs.readFileSync(filePath, 'utf8'))); }
        catch (e) { console.error('[site-registration-discord] sendFile patch failed:', e.message); return originalSendFile.apply(this, arguments); }
      };
    }

    if (typeof response.send === 'function') {
      const originalSend = response.send;
      response.send = function patchedSend(body) {
        try {
          const type = clean(this.getHeader && this.getHeader('Content-Type')).toLowerCase();
          const isHtml = type.includes('html') || (typeof body === 'string' && /<html|<body/i.test(body));
          if (isHtml && typeof body === 'string' && shouldPatchHtmlResponse(this.req, body)) {
            this.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
            body = patchIndexHtml(body);
          }
        } catch (e) { console.error('[site-registration-discord] send patch failed:', e.message); }
        return originalSend.call(this, body);
      };
    }
  }
}

patchExpress();
console.log('✅ Registrazioni sito: campo Discord capitano obbligatorio e forzato su ogni HTML pubblico.');
module.exports = { patchExpress, requireDiscordReference, saveDiscordReferenceOnTeam, patchIndexHtml };
