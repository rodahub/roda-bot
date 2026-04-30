'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const express = require('express');

const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, 'data');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const BUILDS_FILE = path.join(DATA_DIR, 'loadout-builds.json');
const TEMPLATE_B64_FILE = path.join(PUBLIC_DIR, 'assets', 'loadout-template-svg.base64.txt');
const TEMPLATE_SVG_FILE = path.join(PUBLIC_DIR, 'assets', 'loadout-template.svg');
const OUT_DIR = path.join(PUBLIC_DIR, 'generated', 'loadout-graphics');
const PUBLIC_URL_PREFIX = '/generated/loadout-graphics';

let processing = false;
let queued = false;
let internalWrite = false;

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function getId(build) {
  return clean(build && (build.id || build._id));
}

function safeFileName(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || `loadout-${Date.now()}`;
}

function escapeXml(value) {
  return clean(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function fitText(value, max = 34) {
  const text = clean(value);
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(1, max - 1)).trim()}…`;
}

function readBuilds() {
  try {
    if (!fs.existsSync(BUILDS_FILE)) return [];
    const raw = fs.readFileSync(BUILDS_FILE, 'utf8');
    return raw.trim() ? JSON.parse(raw) : [];
  } catch (error) {
    console.error('[loadout-graphics] Errore lettura builds:', error.message);
    return [];
  }
}

function writeBuilds(builds) {
  internalWrite = true;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(BUILDS_FILE, JSON.stringify(builds, null, 2), 'utf8');
  } finally {
    internalWrite = false;
  }
}

function ensureTemplateFile() {
  fs.mkdirSync(path.dirname(TEMPLATE_SVG_FILE), { recursive: true });
  if (fs.existsSync(TEMPLATE_SVG_FILE)) return;
  if (!fs.existsSync(TEMPLATE_B64_FILE)) throw new Error('Template grafica loadout mancante.');
  const b64 = fs.readFileSync(TEMPLATE_B64_FILE, 'utf8').replace(/\s+/g, '');
  fs.writeFileSync(TEMPLATE_SVG_FILE, Buffer.from(b64, 'base64'));
}

function attachmentLines(build) {
  const items = Array.isArray(build.accessori) ? build.accessori : [];
  return items.slice(0, 5).map((item) => {
    const slot = clean(item.slot || item.tipo);
    const name = clean(item.nome || item.name || item.accessorioNome || item.accessorioId || item.attachmentId);
    return slot && name ? `${slot}: ${name}` : (name || slot || '—');
  });
}

function overlaySvg(build) {
  const weapon = fitText(build.armaNome || build.weaponName || build.arma || 'LOADOUT', 26).toUpperCase();
  const creator = fitText(build.creatorName || build.creator || build.firma || 'Creator RØDA', 28);
  const lines = attachmentLines(build);
  while (lines.length < 5) lines.push('—');

  const slotY = [794, 954, 1114, 1274, 1434];
  const slotText = lines.map((line, idx) => {
    const y = slotY[idx];
    const fitted = escapeXml(fitText(line, 42));
    return `<text x="470" y="${y}" text-anchor="middle" class="slot">${fitted}</text>`;
  }).join('');

  return '<' + `svg xmlns="http://www.w3.org/2000/svg" width="941" height="1672" viewBox="0 0 941 1672">
    <defs>
      <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%">
        <feDropShadow dx="0" dy="4" stdDeviation="5" flood-color="#000000" flood-opacity="0.75"/>
      </filter>
      <style>
        .weapon { font-family: Arial Black, Arial, sans-serif; font-size: 54px; font-weight: 900; fill: #ffffff; letter-spacing: 2px; filter: url(#shadow); }
        .slot { font-family: Arial, sans-serif; font-size: 34px; font-weight: 900; fill: #190046; letter-spacing: .3px; filter: url(#shadow); }
        .creator { font-family: Arial Black, Arial, sans-serif; font-size: 36px; font-weight: 900; fill: #ffffff; letter-spacing: 1.5px; filter: url(#shadow); }
      </style>
    </defs>
    <text x="470" y="612" text-anchor="middle" class="weapon">${escapeXml(weapon)}</text>
    ${slotText}
    <text x="555" y="1598" text-anchor="middle" class="creator">${escapeXml(creator)}</text>
  </svg>`;
}

async function generateLoadoutGraphic(build) {
  ensureTemplateFile();
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const id = getId(build) || safeFileName(build.armaNome || build.weaponName || 'loadout');
  const fileName = `${safeFileName(id)}.png`;
  const outputPath = path.join(OUT_DIR, fileName);
  const imageUrl = `${PUBLIC_URL_PREFIX}/${fileName}`;

  const base = await sharp(TEMPLATE_SVG_FILE).resize(941, 1672).png().toBuffer();
  await sharp(base)
    .composite([{ input: Buffer.from(overlaySvg(build)), top: 0, left: 0 }])
    .png()
    .toFile(outputPath);

  return { imageUrl, outputPath };
}

function scheduleProcess(delay = 300) {
  if (processing) {
    queued = true;
    return;
  }
  setTimeout(() => processBuildGraphics().catch((error) => {
    console.error('[loadout-graphics] Errore generazione:', error.message);
  }), delay);
}

async function processBuildGraphics() {
  if (processing) {
    queued = true;
    return;
  }
  processing = true;
  queued = false;

  try {
    const builds = readBuilds();
    let changed = false;

    for (const build of builds) {
      const id = getId(build);
      const hasRequiredData = id && clean(build.armaNome || build.weaponName || build.arma) && clean(build.creatorName || build.creator || build.firma);
      const hasAttachment = Array.isArray(build.accessori) && build.accessori.length > 0;
      if (!hasRequiredData || !hasAttachment) continue;

      const expectedUrl = `${PUBLIC_URL_PREFIX}/${safeFileName(id)}.png`;
      const expectedPath = path.join(OUT_DIR, `${safeFileName(id)}.png`);
      if (build.graphicUrl === expectedUrl && fs.existsSync(expectedPath)) continue;

      const result = await generateLoadoutGraphic(build);
      build.graphicUrl = result.imageUrl;
      build.graphicGeneratedAt = new Date().toISOString();
      changed = true;
    }

    if (changed) writeBuilds(builds);
  } finally {
    processing = false;
    if (queued) scheduleProcess(50);
  }
}

function patchBuildWrites() {
  const originalWriteFileSync = fs.writeFileSync;
  fs.writeFileSync = function patchedWriteFileSync(file, ...args) {
    const result = originalWriteFileSync.call(this, file, ...args);
    try {
      if (!internalWrite && path.resolve(String(file)) === path.resolve(BUILDS_FILE)) scheduleProcess();
    } catch {}
    return result;
  };
}

function patchJsonResponses() {
  if (!express || !express.response || express.response.__rodaGraphicJsonPatch) return;
  const originalJson = express.response.json;
  Object.defineProperty(express.response, '__rodaGraphicJsonPatch', { value: true, enumerable: false });
  express.response.json = function patchedJson(body) {
    try {
      const builds = readBuilds();
      const byId = new Map(builds.map((b) => [getId(b), b]));
      if (body && Array.isArray(body.builds)) {
        body.builds = body.builds.map((b) => ({ ...b, graphicUrl: (byId.get(getId(b)) || {}).graphicUrl || b.graphicUrl || '' }));
      }
      if (body && body.build) {
        const raw = byId.get(getId(body.build));
        if (raw && raw.graphicUrl) body.build = { ...body.build, graphicUrl: raw.graphicUrl };
      }
    } catch {}
    return originalJson.call(this, body);
  };
}

patchBuildWrites();
patchJsonResponses();
scheduleProcess(1500);

module.exports = { generateLoadoutGraphic, processBuildGraphics };
