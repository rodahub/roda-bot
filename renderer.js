const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const ROOT = __dirname;

const LEADERBOARD_TEMPLATE_PATH = path.join(ROOT, 'classifica-live.png');
const TOP_FRAGGER_TEMPLATE_PATH = path.join(ROOT, 'top-fragger.png');
const RAJDHANI_FONT_PATH = path.join(ROOT, 'rajdhani.bold.ttf');

const WIDTH = 1920;
const HEIGHT = 1080;

const CLASSIFICA_ROW_Y = [
  286, 335, 384, 433, 482, 531, 580, 629,
  678, 727, 776, 825, 874, 923, 972, 1021
];

const FRAGGER_ROW_Y = [
  302, 361, 420, 479, 538, 597, 656, 715, 774, 833
];

function ensureFile(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} non trovato: ${filePath}`);
  }
}

function readFileAsDataUrl(filePath, mimeType) {
  const buffer = fs.readFileSync(filePath);
  return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function sanitizeGraphicText(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/[^\p{L}\p{N}\s._\-&+@#()'’]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeGraphicNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '0';
  return String(Math.trunc(numeric)).replace(/[^\d\-]/g, '') || '0';
}

function buildLeaderboardHtml(rows, assets) {
  const rowHtml = rows.slice(0, 16).map((row, index) => {
    const y = CLASSIFICA_ROW_Y[index];
    const isTop3 = index < 3;

    return `
      <div class="row" style="top:${y - 23}px;">
        <div class="team ${isTop3 ? 'top3' : ''}">${escapeHtml(sanitizeGraphicText(row.teamName))}</div>
        <div class="points ${isTop3 ? 'top3' : ''}">${escapeHtml(sanitizeGraphicNumber(row.points))}</div>
      </div>
    `;
  }).join('');

  return `
<!doctype html>
<html lang="it">
<head>
  <meta charset="UTF-8" />
  <style>
    @font-face {
      font-family: 'RajdhaniBold';
      src: url('${assets.fontDataUrl}') format('truetype');
      font-weight: 700;
      font-style: normal;
    }

    html, body {
      width: ${WIDTH}px;
      height: ${HEIGHT}px;
      margin: 0;
      padding: 0;
      overflow: hidden;
      background: transparent;
    }

    body {
      position: relative;
      font-family: 'RajdhaniBold', sans-serif;
      -webkit-font-smoothing: antialiased;
      text-rendering: geometricPrecision;
    }

    .bg {
      position: absolute;
      inset: 0;
      width: ${WIDTH}px;
      height: ${HEIGHT}px;
      object-fit: cover;
      user-select: none;
      pointer-events: none;
    }

    .row {
      position: absolute;
      left: 0;
      width: ${WIDTH}px;
      height: 46px;
    }

    .team {
      position: absolute;
      left: 464px;
      width: 720px;
      height: 46px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #4a2d80;
      font-size: 28px;
      font-weight: 700;
      line-height: 1;
      white-space: nowrap;
      text-shadow: 0 0 4px rgba(157,92,255,0.14);
    }

    .points {
      position: absolute;
      left: 1259px;
      width: 170px;
      height: 46px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #3b1d71;
      font-size: 28px;
      font-weight: 700;
      line-height: 1;
      white-space: nowrap;
      text-shadow: 0 0 3px rgba(176,109,255,0.10);
    }

    .team.top3 {
      color: #331b63;
      font-size: 31px;
      text-shadow: 0 0 6px rgba(176,109,255,0.18);
    }

    .points.top3 {
      color: #331b63;
      font-size: 31px;
      text-shadow: 0 0 5px rgba(176,109,255,0.16);
    }
  </style>
</head>
<body>
  <img class="bg" src="${assets.leaderboardBgDataUrl}" alt="" />
  ${rowHtml}
</body>
</html>
  `;
}

function buildTopFraggerHtml(rows, assets) {
  const rowHtml = rows.slice(0, 10).map((row, index) => {
    const y = FRAGGER_ROW_Y[index];
    const isTop3 = index < 3;

    return `
      <div class="row" style="top:${y - 23}px;">
        <div class="player ${isTop3 ? 'top3' : ''}">${escapeHtml(sanitizeGraphicText(row.playerName))}</div>
        <div class="kills ${isTop3 ? 'top3' : ''}">${escapeHtml(sanitizeGraphicNumber(row.kills))}</div>
      </div>
    `;
  }).join('');

  return `
<!doctype html>
<html lang="it">
<head>
  <meta charset="UTF-8" />
  <style>
    @font-face {
      font-family: 'RajdhaniBold';
      src: url('${assets.fontDataUrl}') format('truetype');
      font-weight: 700;
      font-style: normal;
    }

    html, body {
      width: ${WIDTH}px;
      height: ${HEIGHT}px;
      margin: 0;
      padding: 0;
      overflow: hidden;
      background: transparent;
    }

    body {
      position: relative;
      font-family: 'RajdhaniBold', sans-serif;
      -webkit-font-smoothing: antialiased;
      text-rendering: geometricPrecision;
    }

    .bg {
      position: absolute;
      inset: 0;
      width: ${WIDTH}px;
      height: ${HEIGHT}px;
      object-fit: cover;
      user-select: none;
      pointer-events: none;
    }

    .row {
      position: absolute;
      left: 0;
      width: ${WIDTH}px;
      height: 46px;
    }

    .player {
      position: absolute;
      left: 464px;
      width: 720px;
      height: 46px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #4a2d80;
      font-size: 28px;
      font-weight: 700;
      line-height: 1;
      white-space: nowrap;
      text-shadow: 0 0 4px rgba(157,92,255,0.14);
    }

    .kills {
      position: absolute;
      left: 1259px;
      width: 170px;
      height: 46px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #3b1d71;
      font-size: 28px;
      font-weight: 700;
      line-height: 1;
      white-space: nowrap;
      text-shadow: 0 0 3px rgba(176,109,255,0.10);
    }

    .player.top3 {
      color: #331b63;
      font-size: 31px;
      text-shadow: 0 0 6px rgba(176,109,255,0.18);
    }

    .kills.top3 {
      color: #331b63;
      font-size: 31px;
      text-shadow: 0 0 5px rgba(176,109,255,0.16);
    }
  </style>
</head>
<body>
  <img class="bg" src="${assets.topFraggerBgDataUrl}" alt="" />
  ${rowHtml}
</body>
</html>
  `;
}

async function renderHtmlToPngBuffer(html) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({
      width: WIDTH,
      height: HEIGHT,
      deviceScaleFactor: 1
    });

    await page.setContent(html, { waitUntil: 'networkidle0' });

    return await page.screenshot({
      type: 'png'
    });
  } finally {
    await browser.close();
  }
}

function getAssets() {
  ensureFile(LEADERBOARD_TEMPLATE_PATH, 'Template classifica-live.png');
  ensureFile(TOP_FRAGGER_TEMPLATE_PATH, 'Template top-fragger.png');
  ensureFile(RAJDHANI_FONT_PATH, 'Font rajdhani.bold.ttf');

  return {
    leaderboardBgDataUrl: readFileAsDataUrl(LEADERBOARD_TEMPLATE_PATH, 'image/png'),
    topFraggerBgDataUrl: readFileAsDataUrl(TOP_FRAGGER_TEMPLATE_PATH, 'image/png'),
    fontDataUrl: readFileAsDataUrl(RAJDHANI_FONT_PATH, 'font/ttf')
  };
}

async function generateLeaderboardGraphicBuffer(rows) {
  const assets = getAssets();
  const html = buildLeaderboardHtml(rows, assets);
  return await renderHtmlToPngBuffer(html);
}

async function generateTopFraggerGraphicBuffer(rows) {
  const assets = getAssets();
  const html = buildTopFraggerHtml(rows, assets);
  return await renderHtmlToPngBuffer(html);
}

module.exports = {
  generateLeaderboardGraphicBuffer,
  generateTopFraggerGraphicBuffer
};
