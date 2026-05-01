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

function escapeHtml(value) {
  return clean(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fitText(value, max = 34) {
  const text = clean(value);
  if (!text) return '';
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
      const label = clean(item.slot || item.tipo || item.label || '');
      const value = clean(
        item.nome ||
        item.name ||
        item.accessorioNome ||
        item.accessorioId ||
        item.attachmentId ||
        ''
      );

      if (!label && !value) return null;

      return {
        label: fitText(label, 16),
        value: fitText(value, 30)
      };
    })
    .filter(Boolean)
    .slice(0, 5);

  while (rows.length < 5) rows.push({ label: '', value: '' });
  return rows;
}

function templateDataUrl(templatePath) {
  const ext = path.extname(templatePath).toLowerCase();
  const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
  const buffer = fs.readFileSync(templatePath);
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

function buildRenderHtml({ build, width, height, backgroundDataUrl }) {
  const weapon = fitText(build.armaNome || build.weaponName || build.arma || 'LOADOUT', 24).toUpperCase();
  const creator = fitText(build.creatorName || build.creator || build.firma || 'Creator RØDA', 24);
  const rows = getRows(build);

  const rowHtml = rows.map((row, index) => `
    <div class="att-row row-${index + 1}">
      <div class="att-label">${escapeHtml(row.label)}</div>
      <div class="att-value">${escapeHtml(row.value)}</div>
    </div>
  `).join('');

  return `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  html, body {
    width: ${width}px;
    height: ${height}px;
    margin: 0;
    padding: 0;
    overflow: hidden;
    background: transparent;
  }
  body {
    font-family: Arial, Helvetica, sans-serif;
  }
  .canvas {
    position: relative;
    width: ${width}px;
    height: ${height}px;
    overflow: hidden;
    background: #fff;
  }
  .bg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
    object-position: center;
    display: block;
    z-index: 0;
  }
  .panel {
    position: absolute;
    z-index: 2;
    border: 2px solid rgba(150, 72, 255, .62);
    background:
      linear-gradient(135deg, rgba(255,255,255,.72), rgba(212,190,255,.48)),
      radial-gradient(circle at 50% 0%, rgba(148,78,255,.20), transparent 58%);
    border-radius: 34px;
    box-shadow:
      0 0 22px rgba(112, 44, 255, .30),
      inset 0 0 24px rgba(255,255,255,.52),
      inset 0 0 18px rgba(126,63,255,.20);
    backdrop-filter: blur(1px);
  }
  .weapon-panel {
    left: 12.6%;
    top: 22.2%;
    width: 74.8%;
    height: 7.1%;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 44px;
    border-color: rgba(136, 55, 255, .88);
    background:
      linear-gradient(90deg, rgba(12,2,38,.92), rgba(88,33,190,.88), rgba(13,2,40,.92));
    box-shadow:
      0 0 30px rgba(125, 52, 255, .70),
      0 0 74px rgba(125, 52, 255, .30),
      inset 0 0 22px rgba(255,255,255,.18);
  }
  .weapon-name {
    color: #fff;
    font-family: Arial Black, Arial, sans-serif;
    font-size: ${Math.round(width * (weapon.length > 14 ? 0.066 : 0.078))}px;
    font-weight: 900;
    letter-spacing: 3px;
    line-height: 1;
    text-align: center;
    transform: translateY(-1px);
    text-shadow:
      0 0 5px #fff,
      0 0 18px rgba(178, 105, 255, .95),
      0 5px 8px rgba(0,0,0,.75);
    white-space: nowrap;
    max-width: 88%;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .attachments {
    position: absolute;
    z-index: 2;
    left: 11.2%;
    top: 32.4%;
    width: 77.6%;
    height: 37.6%;
    display: flex;
    flex-direction: column;
    gap: 3.5%;
  }
  .att-row {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: 31% 1fr;
    align-items: center;
    column-gap: 3.5%;
    padding: 0 6.2%;
    border: 2px solid rgba(142, 62, 255, .40);
    border-radius: 34px;
    background:
      linear-gradient(90deg, rgba(255,255,255,.76), rgba(226,210,255,.62), rgba(255,255,255,.76));
    box-shadow:
      0 0 20px rgba(122, 44, 255, .24),
      inset 0 0 18px rgba(255,255,255,.60),
      inset 0 0 12px rgba(132,63,255,.14);
  }
  .att-label,
  .att-value {
    font-family: Arial Black, Arial, sans-serif;
    line-height: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    text-align: left;
    text-shadow:
      0 0 6px rgba(255,255,255,.75),
      0 0 10px rgba(149,74,255,.42),
      0 2px 3px rgba(0,0,0,.20);
  }
  .att-label {
    font-size: ${Math.round(width * 0.034)}px;
    font-weight: 900;
    color: #21074e;
    letter-spacing: .5px;
    text-transform: uppercase;
  }
  .att-value {
    font-size: ${Math.round(width * 0.038)}px;
    font-weight: 900;
    color: #36107a;
    letter-spacing: .2px;
  }
  .creator-panel {
    left: 19.8%;
    top: 78.5%;
    width: 60.4%;
    height: 6.7%;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 38px;
    border-color: rgba(141, 61, 255, .72);
    background:
      linear-gradient(90deg, rgba(22,4,60,.86), rgba(109,51,206,.76), rgba(22,4,60,.86));
    box-shadow:
      0 0 30px rgba(125, 52, 255, .48),
      inset 0 0 18px rgba(255,255,255,.18);
  }
  .creator-name {
    color: #fff;
    font-family: Arial Black, Arial, sans-serif;
    font-size: ${Math.round(width * (creator.length > 16 ? 0.048 : 0.059))}px;
    font-weight: 900;
    line-height: 1;
    letter-spacing: 1.8px;
    text-align: center;
    transform: translateY(-1px);
    text-shadow:
      0 0 4px #fff,
      0 0 16px rgba(178, 105, 255, .95),
      0 4px 7px rgba(0,0,0,.78);
    white-space: nowrap;
    max-width: 88%;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
</head>
<body>
  <div class="canvas">
    <img class="bg" src="${backgroundDataUrl}" alt="">
    <div class="weapon-panel panel"><div class="weapon-name">${escapeHtml(weapon)}</div></div>
    <div class="attachments">${rowHtml}</div>
    <div class="creator-panel panel"><div class="creator-name">${escapeHtml(creator)}</div></div>
  </div>
</body>
</html>`;
}

async function renderWithPuppeteer({ html, outputPath, width, height }) {
  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.screenshot({ path: outputPath, type: 'png', omitBackground: false });
  } finally {
    await browser.close();
  }
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
  const backgroundDataUrl = templateDataUrl(templatePath);
  const html = buildRenderHtml({ build, width, height, backgroundDataUrl });

  await renderWithPuppeteer({ html, outputPath, width, height });

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
