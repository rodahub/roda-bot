'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, 'data');
const ASSETS_DIR = path.join(ROOT_DIR, 'public', 'assets');
const BUILDS_FILE = path.join(DATA_DIR, 'loadout-builds.json');
const OUT_DIR = path.join(DATA_DIR, 'loadout-graphics');
const PUBLIC_URL_PREFIX = '/loadout-graphics';

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function getId(build) {
  return clean(build && (build.id || build._id));
}

function safeFileName(value) {
  return clean(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || `loadout-${Date.now()}`;
}

function xml(value) {
  return clean(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function fit(value, max) {
  const text = clean(value);
  return text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1)).trim()}…`;
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
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(BUILDS_FILE, JSON.stringify(builds, null, 2), 'utf8');
}

function findTemplatePath() {
  const names = [
    'loadout-template-base.png',
    'loadout-template.png',
    'roda-loadout-template.png',
    'loadout-template-base.jpg',
    'loadout-template-base.jpeg',
    'loadout-template-base.webp',
    'loadout-template.webp'
  ];

  for (const name of names) {
    const filePath = path.join(ASSETS_DIR, name);
    if (fs.existsSync(filePath)) return filePath;
  }

  throw new Error('Template PNG non trovato: public/assets/loadout-template-base.png');
}

function getRows(build) {
  const items = Array.isArray(build.accessori) ? build.accessori : [];
  const rows = items
    .map((item) => {
      const label = clean(item.slot || item.tipo || item.label || '').toUpperCase();
      const value = clean(item.nome || item.name || item.accessorioNome || item.accessorioId || item.attachmentId || '');
      if (!label && !value) return null;
      return { label: fit(label, 18), value: fit(value, 28) };
    })
    .filter(Boolean)
    .slice(0, 5);

  while (rows.length < 5) rows.push({ label: '', value: '' });
  return rows;
}

function makeOverlay(build, width, height) {
  const weapon = fit(build.armaNome || build.weaponName || build.arma || 'LOADOUT', 22).toUpperCase();
  const creator = fit(build.creatorName || build.creator || build.firma || 'Creator RØDA', 24);
  const rows = getRows(build);

  const weaponFont = Math.round(width * (weapon.length > 12 ? 0.070 : 0.080));
  const creatorFont = Math.round(width * (creator.length > 15 ? 0.052 : 0.062));
  const labelFont = Math.round(width * 0.033);
  const valueFont = Math.round(width * 0.038);

  // Layout compatto: tutto vicino, ma separato, come post grafico unico.
  const weaponX = width * 0.102;
  const weaponY = height * 0.235;
  const weaponW = width * 0.796;
  const weaponH = height * 0.070;

  const rowX = width * 0.097;
  const rowY = height * 0.328;
  const rowW = width * 0.806;
  const rowH = height * 0.066;
  const rowGap = height * 0.019;

  const creatorX = width * 0.201;
  const creatorY = height * 0.766;
  const creatorW = width * 0.598;
  const creatorH = height * 0.066;

  const panelRadius = width * 0.026;
  const creatorRadius = width * 0.024;

  const rowSvg = rows.map((row, index) => {
    const y = rowY + index * (rowH + rowGap);
    const cy = y + rowH / 2;
    return `<g>
      <rect x="${rowX}" y="${y}" width="${rowW}" height="${rowH}" rx="${width * 0.024}" fill="#fbf8ff" opacity="0.95" stroke="#cdb0ff" stroke-width="${Math.max(2, width * 0.0018)}"/>
      <text x="${rowX + rowW * 0.06}" y="${cy}" class="label">${xml(row.label)}</text>
      <text x="${rowX + rowW * 0.56}" y="${cy}" class="value">${xml(row.value)}</text>
    </g>`;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <linearGradient id="purplePanel" x1="0" x2="1" y1="0" y2="1">
        <stop offset="0" stop-color="#1f0048"/>
        <stop offset="0.50" stop-color="#3d0a91"/>
        <stop offset="1" stop-color="#24004f"/>
      </linearGradient>
      <linearGradient id="panelShine" x1="0" x2="1" y1="0" y2="1">
        <stop offset="0" stop-color="#ffffff" stop-opacity="0.18"/>
        <stop offset="0.45" stop-color="#ffffff" stop-opacity="0.05"/>
        <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
      </linearGradient>
      <filter id="panelGlow" x="-55%" y="-55%" width="210%" height="210%">
        <feDropShadow dx="0" dy="0" stdDeviation="${width * 0.010}" flood-color="#6f2cff" flood-opacity="0.62"/>
        <feDropShadow dx="0" dy="0" stdDeviation="${width * 0.004}" flood-color="#d8c3ff" flood-opacity="0.20"/>
        <feDropShadow dx="0" dy="${width * 0.004}" stdDeviation="${width * 0.004}" flood-color="#000000" flood-opacity="0.45"/>
      </filter>
      <filter id="textGlow" x="-45%" y="-45%" width="190%" height="190%">
        <feDropShadow dx="0" dy="0" stdDeviation="${width * 0.004}" flood-color="#ffffff" flood-opacity="0.82"/>
        <feDropShadow dx="0" dy="0" stdDeviation="${width * 0.006}" flood-color="#9c70ff" flood-opacity="0.56"/>
      </filter>
      <style>
        text{dominant-baseline:middle}
        .weapon,.creator{font-family:'Trebuchet MS','Segoe UI',Arial,sans-serif;font-weight:900;fill:#fff;text-anchor:middle;filter:url(#textGlow)}
        .weapon{font-size:${weaponFont}px;letter-spacing:${width * 0.00045}px}
        .creator{font-size:${creatorFont}px;letter-spacing:${width * 0.00035}px}
        .label{font-family:'Trebuchet MS','Segoe UI',Arial,sans-serif;font-size:${labelFont}px;font-weight:900;fill:#351071;text-anchor:start}
        .value{font-family:'Trebuchet MS','Segoe UI',Arial,sans-serif;font-size:${valueFont}px;font-weight:800;fill:#4b22a3;text-anchor:start}
      </style>
    </defs>

    <rect x="${weaponX}" y="${weaponY}" width="${weaponW}" height="${weaponH}" rx="${panelRadius}" fill="url(#purplePanel)" stroke="#8450ff" stroke-width="${Math.max(2, width * 0.002)}" filter="url(#panelGlow)"/>
    <rect x="${weaponX + width * 0.018}" y="${weaponY + height * 0.005}" width="${weaponW - width * 0.036}" height="${weaponH * 0.34}" rx="${panelRadius * 0.72}" fill="url(#panelShine)" opacity="0.40"/>
    <text x="${weaponX + weaponW / 2}" y="${weaponY + weaponH / 2 + weaponFont * 0.23}" class="weapon">${xml(weapon)}</text>

    ${rowSvg}

    <rect x="${creatorX}" y="${creatorY}" width="${creatorW}" height="${creatorH}" rx="${creatorRadius}" fill="url(#purplePanel)" stroke="#8450ff" stroke-width="${Math.max(2, width * 0.002)}" filter="url(#panelGlow)"/>
    <rect x="${creatorX + width * 0.018}" y="${creatorY + height * 0.005}" width="${creatorW - width * 0.036}" height="${creatorH * 0.34}" rx="${creatorRadius * 0.72}" fill="url(#panelShine)" opacity="0.40"/>
    <text x="${creatorX + creatorW / 2}" y="${creatorY + creatorH / 2 + creatorFont * 0.20}" class="creator">${xml(creator)}</text>
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
  const width = meta.width || 1152;
  const height = meta.height || 2048;

  await sharp(templatePath)
    .composite([{ input: Buffer.from(makeOverlay(build, width, height)), top: 0, left: 0 }])
    .png()
    .toFile(outputPath);

  return { imageUrl, outputPath, url: imageUrl, fileName };
}

async function processBuildGraphics() {
  const builds = readBuilds();
  let changed = false;

  for (const build of builds) {
    const id = getId(build);
    const hasRequiredData = id && clean(build.armaNome || build.weaponName || build.arma) && clean(build.creatorName || build.creator || build.firma);
    const hasAttachment = Array.isArray(build.accessori) && build.accessori.length > 0;
    if (!hasRequiredData || !hasAttachment) continue;

    const result = await generateLoadoutGraphic(build);
    if (build.graphicUrl !== result.imageUrl || build.imageUrl !== result.imageUrl) changed = true;
    build.graphicUrl = result.imageUrl;
    build.imageUrl = result.imageUrl;
    build.graphicGeneratedAt = new Date().toISOString();
  }

  if (changed) writeBuilds(builds);
}

module.exports = { generateLoadoutGraphic, processBuildGraphics };
