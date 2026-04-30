'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const express = require('express');

const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, 'data');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const ASSETS_DIR = path.join(PUBLIC_DIR, 'assets');
const BUILDS_FILE = path.join(DATA_DIR, 'loadout-builds.json');
const OUT_DIR = path.join(PUBLIC_DIR, 'generated', 'loadout-graphics');
const PUBLIC_URL_PREFIX = '/generated/loadout-graphics';

let processing = false;
let queued = false;
let internalWrite = false;

function clean(value) { return String(value || '').replace(/\s+/g, ' ').trim(); }
function getId(build) { return clean(build && (build.id || build._id)); }
function safeFileName(value) { return clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || `loadout-${Date.now()}`; }
function escapeXml(value) { return clean(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;'); }
function fitText(value, max = 34) { const text = clean(value); return text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1)).trim()}…`; }

function readBuilds() {
  try { if (!fs.existsSync(BUILDS_FILE)) return []; const raw = fs.readFileSync(BUILDS_FILE, 'utf8'); return raw.trim() ? JSON.parse(raw) : []; }
  catch (error) { console.error('[loadout-graphics] Errore lettura builds:', error.message); return []; }
}
function writeBuilds(builds) { internalWrite = true; try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(BUILDS_FILE, JSON.stringify(builds, null, 2), 'utf8'); } finally { internalWrite = false; } }

function findTemplatePath() {
  const names = ['loadout-template-base.png', 'loadout-template.png', 'roda-loadout-template.png', 'loadout-template-base.jpg', 'loadout-template-base.jpeg', 'loadout-template-base.webp'];
  for (const name of names) { const p = path.join(ASSETS_DIR, name); if (fs.existsSync(p)) return p; }
  const files = fs.existsSync(ASSETS_DIR) ? fs.readdirSync(ASSETS_DIR) : [];
  const match = files.find(f => /loadout|template|grafica/i.test(f) && /\.(png|jpe?g|webp)$/i.test(f));
  if (match) return path.join(ASSETS_DIR, match);
  throw new Error('Template PNG non trovato. Caricalo in public/assets/loadout-template-base.png');
}

function attachmentLines(build) {
  const items = Array.isArray(build.accessori) ? build.accessori : [];
  return items.filter(item => clean(item.nome || item.name || item.accessorioNome || item.accessorioId || item.attachmentId)).slice(0, 5).map((item) => {
    const slot = clean(item.slot || item.tipo);
    const name = clean(item.nome || item.name || item.accessorioNome || item.accessorioId || item.attachmentId);
    return slot && name ? `${slot}: ${name}` : (name || slot || '—');
  });
}

function overlaySvg(build, width, height) {
  const weapon = fitText(build.armaNome || build.weaponName || build.arma || 'LOADOUT', 26).toUpperCase();
  const creator = fitText(build.creatorName || build.creator || build.firma || 'Creator RØDA', 30);
  const lines = attachmentLines(build);
  while (lines.length < 5) lines.push('—');
  const slotY = [0.455, 0.55, 0.645, 0.74, 0.835];
  const slotText = lines.map((line, idx) => `<text x="${width / 2}" y="${height * slotY[idx]}" text-anchor="middle" class="slot">${escapeXml(fitText(line, 42))}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs><filter id="shadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="4" stdDeviation="5" flood-color="#000000" flood-opacity="0.75"/></filter>
    <style>.weapon{font-family:Arial Black,Arial,sans-serif;font-size:${Math.round(width * 0.058)}px;font-weight:900;fill:#fff;letter-spacing:2px;filter:url(#shadow)}.slot{font-family:Arial Black,Arial,sans-serif;font-size:${Math.round(width * 0.034)}px;font-weight:900;fill:#1d0648;letter-spacing:.2px;filter:url(#shadow)}.creator{font-family:Arial Black,Arial,sans-serif;font-size:${Math.round(width * 0.038)}px;font-weight:900;fill:#fff;letter-spacing:1.5px;filter:url(#shadow)}</style></defs>
    <text x="${width / 2}" y="${height * 0.366}" text-anchor="middle" class="weapon">${escapeXml(weapon)}</text>${slotText}<text x="${width * 0.59}" y="${height * 0.956}" text-anchor="middle" class="creator">${escapeXml(creator)}</text>
  </svg>`;
}

async function generateLoadoutGraphic(build) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const templatePath = findTemplatePath();
  const id = getId(build) || safeFileName(build.armaNome || build.weaponName || 'loadout');
  const fileName = `${safeFileName(id)}.png`;
  const outputPath = path.join(OUT_DIR, fileName);
  const imageUrl = `${PUBLIC_URL_PREFIX}/${fileName}`;
  const meta = await sharp(templatePath).metadata();
  const width = meta.width || 941;
  const height = meta.height || 1672;
  await sharp(templatePath).composite([{ input: Buffer.from(overlaySvg(build, width, height)), top: 0, left: 0 }]).png().toFile(outputPath);
  return { imageUrl, outputPath };
}

function scheduleProcess(delay = 300) { if (processing) { queued = true; return; } setTimeout(() => processBuildGraphics().catch((error) => console.error('[loadout-graphics] Errore generazione:', error.message)), delay); }

async function processBuildGraphics() {
  if (processing) { queued = true; return; }
  processing = true; queued = false;
  try {
    const builds = readBuilds(); let changed = false;
    for (const build of builds) {
      const id = getId(build);
      const hasRequiredData = id && clean(build.armaNome || build.weaponName || build.arma) && clean(build.creatorName || build.creator || build.firma);
      const hasAttachment = Array.isArray(build.accessori) && build.accessori.length > 0;
      if (!hasRequiredData || !hasAttachment) continue;
      const expectedUrl = `${PUBLIC_URL_PREFIX}/${safeFileName(id)}.png`;
      const result = await generateLoadoutGraphic(build);
      if (build.graphicUrl !== expectedUrl || build.imageUrl !== expectedUrl) changed = true;
      build.graphicUrl = result.imageUrl; build.imageUrl = result.imageUrl; build.graphicGeneratedAt = new Date().toISOString();
    }
    if (changed) writeBuilds(builds);
  } finally { processing = false; if (queued) scheduleProcess(50); }
}

async function sendGraphic(req, res) {
  try {
    const id = clean(req.params.id);
    const builds = readBuilds();
    const build = builds.find((item) => getId(item) === id);
    if (!build) return res.status(404).send('Build non trovata');
    const result = await generateLoadoutGraphic(build);
    build.graphicUrl = result.imageUrl;
    build.imageUrl = result.imageUrl;
    build.graphicGeneratedAt = new Date().toISOString();
    writeBuilds(builds);
    if (req.query.download === '1') {
      return res.download(result.outputPath, `${safeFileName(build.armaNome || id)}-roda-loadout.png`);
    }
    return res.sendFile(result.outputPath);
  } catch (error) {
    console.error('[loadout-graphics] Errore endpoint grafica:', error.message);
    return res.status(500).send(error.message || 'Errore generazione grafica');
  }
}

function patchGraphicRoutes() {
  const proto = express && express.application;
  if (!proto || proto.__rodaGraphicRoutePatch) return;
  Object.defineProperty(proto, '__rodaGraphicRoutePatch', { value: true, enumerable: false });
  const originalListen = proto.listen;
  proto.listen = function patchedListen(...args) {
    try {
      if (!this.__rodaGraphicRoutesRegistered) {
        Object.defineProperty(this, '__rodaGraphicRoutesRegistered', { value: true, enumerable: false });
        this.get('/api/loadout/builds/:id/graphic', sendGraphic);
      }
    } catch (error) {
      console.error('[loadout-graphics] Errore registrazione endpoint:', error.message);
    }
    return originalListen.apply(this, args);
  };
}

function patchBuildWrites() { const originalWriteFileSync = fs.writeFileSync; fs.writeFileSync = function patchedWriteFileSync(file, ...args) { const result = originalWriteFileSync.call(this, file, ...args); try { if (!internalWrite && path.resolve(String(file)) === path.resolve(BUILDS_FILE)) scheduleProcess(); } catch {} return result; }; }
function patchJsonResponses() { if (!express || !express.response || express.response.__rodaGraphicJsonPatch) return; const originalJson = express.response.json; Object.defineProperty(express.response, '__rodaGraphicJsonPatch', { value: true, enumerable: false }); express.response.json = function patchedJson(body) { try { const builds = readBuilds(); const byId = new Map(builds.map((b) => [getId(b), b])); if (body && Array.isArray(body.builds)) body.builds = body.builds.map((b) => ({ ...b, graphicUrl: (byId.get(getId(b)) || {}).graphicUrl || b.graphicUrl || '', imageUrl: (byId.get(getId(b)) || {}).imageUrl || b.imageUrl || '' })); if (body && body.build) { const raw = byId.get(getId(body.build)); if (raw && raw.graphicUrl) body.build = { ...body.build, graphicUrl: raw.graphicUrl, imageUrl: raw.imageUrl || raw.graphicUrl }; } } catch {} return originalJson.call(this, body); }; }

patchBuildWrites(); patchJsonResponses(); patchGraphicRoutes(); scheduleProcess(1500);
module.exports = { generateLoadoutGraphic, processBuildGraphics };
