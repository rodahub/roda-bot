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
    'loadout-template-base.webp'
  ];

  for (const name of names) {
    const filePath = path.join(ASSETS_DIR, name);
    if (fs.existsSync(filePath)) return filePath;
  }

  const files = fs.existsSync(ASSETS_DIR) ? fs.readdirSync(ASSETS_DIR) : [];
  const match = files.find(file => /loadout|template|grafica/i.test(file) && /\.(png|jpe?g|webp)$/i.test(file));
  if (match) return path.join(ASSETS_DIR, match);

  throw new Error('Template PNG non trovato: public/assets/loadout-template-base.png');
}

function attachmentLines(build) {
  const items = Array.isArray(build.accessori) ? build.accessori : [];
  return items
    .filter(item => clean(item.nome || item.name || item.accessorioNome || item.accessorioId || item.attachmentId))
    .slice(0, 5)
    .map((item) => {
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
  const slotText = lines.map((line, idx) => (
    `<text x="${width / 2}" y="${height * slotY[idx]}" text-anchor="middle" class="slot">${escapeXml(fitText(line, 42))}</text>`
  )).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%">
        <feDropShadow dx="0" dy="4" stdDeviation="5" flood-color="#000000" flood-opacity="0.75"/>
      </filter>
      <style>
        .weapon{font-family:Arial Black,Arial,sans-serif;font-size:${Math.round(width * 0.058)}px;font-weight:900;fill:#fff;letter-spacing:2px;filter:url(#shadow)}
        .slot{font-family:Arial Black,Arial,sans-serif;font-size:${Math.round(width * 0.034)}px;font-weight:900;fill:#1d0648;letter-spacing:.2px;filter:url(#shadow)}
        .creator{font-family:Arial Black,Arial,sans-serif;font-size:${Math.round(width * 0.038)}px;font-weight:900;fill:#fff;letter-spacing:1.5px;filter:url(#shadow)}
      </style>
    </defs>
    <text x="${width / 2}" y="${height * 0.366}" text-anchor="middle" class="weapon">${escapeXml(weapon)}</text>
    ${slotText}
    <text x="${width * 0.59}" y="${height * 0.956}" text-anchor="middle" class="creator">${escapeXml(creator)}</text>
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

  await sharp(templatePath)
    .composite([{ input: Buffer.from(overlaySvg(build, width, height)), top: 0, left: 0 }])
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
