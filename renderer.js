const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage, registerFont } = require('canvas');

const ROOT_DIR = __dirname;

const LEADERBOARD_TEMPLATE_PATH = path.join(ROOT_DIR, 'classifica-live.png');
const TOP_FRAGGER_TEMPLATE_PATH = path.join(ROOT_DIR, 'top-fragger.png');

const TITLE_FONT_PATH = path.join(ROOT_DIR, 'NetlridettrialRegular-q2nmr.otf');
const BODY_FONT_PATH = path.join(ROOT_DIR, 'rajdhani.bold.ttf');

const TITLE_FONT_FAMILY = 'RodaTitleFont';
const BODY_FONT_FAMILY = 'RodaBodyFont';

let fontsRegistered = false;
let cachedAssets = null;

function ensureFile(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} non trovato: ${filePath}`);
  }
}

function registerFontsOnce() {
  if (fontsRegistered) return;

  try {
    if (fs.existsSync(TITLE_FONT_PATH)) {
      registerFont(TITLE_FONT_PATH, { family: TITLE_FONT_FAMILY });
    }
  } catch (error) {
    console.warn('Impossibile caricare font titolo:', error.message);
  }

  try {
    if (fs.existsSync(BODY_FONT_PATH)) {
      registerFont(BODY_FONT_PATH, { family: BODY_FONT_FAMILY });
    }
  } catch (error) {
    console.warn('Impossibile caricare font body:', error.message);
  }

  fontsRegistered = true;
}

async function getAssets() {
  if (cachedAssets) return cachedAssets;

  ensureFile(LEADERBOARD_TEMPLATE_PATH, 'Template classifica-live.png');
  ensureFile(TOP_FRAGGER_TEMPLATE_PATH, 'Template top-fragger.png');

  registerFontsOnce();

  const [leaderboardTemplate, topFraggerTemplate] = await Promise.all([
    loadImage(LEADERBOARD_TEMPLATE_PATH),
    loadImage(TOP_FRAGGER_TEMPLATE_PATH)
  ]);

  cachedAssets = {
    leaderboardTemplate,
    topFraggerTemplate
  };

  return cachedAssets;
}

function formatOrdinal(position) {
  const n = Number(position || 0);
  if (!n || n < 1) return '';
  return `${n}°`;
}

function cleanText(value) {
  return String(value ?? '').trim();
}

function normalizeLeaderboardRows(input) {
  let rows = [];

  if (Array.isArray(input)) {
    rows = input;
  } else if (input && typeof input === 'object') {
    rows = Object.entries(input).map(([team, points]) => ({
      team,
      points
    }));
  }

  return rows.map((row, index) => ({
    posizione: Number(
      row.posizione ??
      row.position ??
      row.pos ??
      index + 1
    ),
    team: cleanText(
      row.team ??
      row.teamName ??
      row.name ??
      row.nome ??
      ''
    ),
    punti: Number(
      row.punti ??
      row.points ??
      row.score ??
      0
    )
  }));
}

function normalizeFraggerRows(input) {
  let rows = [];

  if (Array.isArray(input)) {
    rows = input;
  } else if (input && typeof input === 'object') {
    rows = Object.entries(input).map(([nome, kills]) => ({
      nome,
      kills
    }));
  }

  return rows.map((row, index) => ({
    posizione: Number(
      row.posizione ??
      row.position ??
      row.pos ??
      index + 1
    ),
    nome: cleanText(
      row.nome ??
      row.player ??
      row.playerName ??
      row.name ??
      ''
    ),
    kills: Number(
      row.kills ??
      row.uccisioni ??
      row.value ??
      0
    )
  }));
}

function setFont(ctx, size, family, weight = 'bold') {
  ctx.font = `${weight} ${size}px "${family}"`;
}

function fitFontSize(ctx, text, maxWidth, startSize, minSize, family, weight = 'bold') {
  let size = startSize;

  while (size > minSize) {
    setFont(ctx, size, family, weight);
    const width = ctx.measureText(text).width;
    if (width <= maxWidth) return size;
    size -= 1;
  }

  return minSize;
}

function drawCenteredText(ctx, text, centerX, centerY, options = {}) {
  const value = cleanText(text);
  if (!value) return;

  const {
    maxWidth = 300,
    fontFamily = BODY_FONT_FAMILY,
    fallbackFamily = 'sans-serif',
    fontSize = 28,
    minFontSize = 16,
    fontWeight = 'bold',
    fillStyle = '#4c2782',
    shadowColor = 'rgba(162, 116, 255, 0.22)',
    shadowBlur = 4,
    strokeStyle = null,
    strokeWidth = 0,
    yOffset = 0
  } = options;

  const familyToUse = fontsRegistered ? fontFamily : fallbackFamily;
  const fitted = fitFontSize(
    ctx,
    value,
    maxWidth,
    fontSize,
    minFontSize,
    familyToUse,
    fontWeight
  );

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = fillStyle;
  ctx.shadowColor = shadowColor;
  ctx.shadowBlur = shadowBlur;

  setFont(ctx, fitted, familyToUse, fontWeight);

  if (strokeStyle && strokeWidth > 0) {
    ctx.lineWidth = strokeWidth;
    ctx.strokeStyle = strokeStyle;
    ctx.strokeText(value, centerX, centerY + yOffset);
  }

  ctx.fillText(value, centerX, centerY + yOffset);
  ctx.restore();
}

function drawLeaderboardRows(ctx, rows) {
  const layout = {
    posCenterX: 308,
    teamCenterX: 824,
    pointsCenterX: 1346,
    firstRowCenterY: 306,
    rowGap: 48.8,
    maxRows: 16
  };

  const visibleRows = rows.slice(0, layout.maxRows);

  for (let i = 0; i < visibleRows.length; i++) {
    const row = visibleRows[i];
    const y = layout.firstRowCenterY + i * layout.rowGap;

    drawCenteredText(ctx, formatOrdinal(row.posizione || i + 1), layout.posCenterX, y, {
      maxWidth: 180,
      fontSize: 28,
      minFontSize: 20,
      fillStyle: '#7a4af0',
      shadowColor: 'rgba(166, 111, 255, 0.15)',
      shadowBlur: 2
    });

    drawCenteredText(ctx, row.team, layout.teamCenterX, y, {
      maxWidth: 650,
      fontSize: 31,
      minFontSize: 18,
      fillStyle: '#44236f',
      shadowColor: 'rgba(166, 111, 255, 0.12)',
      shadowBlur: 2
    });

    drawCenteredText(ctx, String(Number(row.punti || 0)), layout.pointsCenterX, y, {
      maxWidth: 150,
      fontSize: 30,
      minFontSize: 18,
      fillStyle: '#44236f',
      shadowColor: 'rgba(166, 111, 255, 0.12)',
      shadowBlur: 2
    });
  }
}

function drawFraggerRows(ctx, rows) {
  const layout = {
    posCenterX: 308,
    playerCenterX: 824,
    killsCenterX: 1346,
    firstRowCenterY: 311,
    rowGap: 52.5,
    maxRows: 10
  };

  const visibleRows = rows.slice(0, layout.maxRows);

  for (let i = 0; i < visibleRows.length; i++) {
    const row = visibleRows[i];
    const y = layout.firstRowCenterY + i * layout.rowGap;

    drawCenteredText(ctx, formatOrdinal(row.posizione || i + 1), layout.posCenterX, y, {
      maxWidth: 180,
      fontSize: 29,
      minFontSize: 20,
      fillStyle: '#7a4af0',
      shadowColor: 'rgba(166, 111, 255, 0.15)',
      shadowBlur: 2
    });

    drawCenteredText(ctx, row.nome, layout.playerCenterX, y, {
      maxWidth: 650,
      fontSize: 31,
      minFontSize: 18,
      fillStyle: '#44236f',
      shadowColor: 'rgba(166, 111, 255, 0.12)',
      shadowBlur: 2
    });

    drawCenteredText(ctx, String(Number(row.kills || 0)), layout.killsCenterX, y, {
      maxWidth: 150,
      fontSize: 30,
      minFontSize: 18,
      fillStyle: '#44236f',
      shadowColor: 'rgba(166, 111, 255, 0.12)',
      shadowBlur: 2
    });
  }
}

async function generateLeaderboardGraphicBuffer(leaderboardInput) {
  const assets = await getAssets();
  const template = assets.leaderboardTemplate;
  const rows = normalizeLeaderboardRows(leaderboardInput);

  const canvas = createCanvas(template.width, template.height);
  const ctx = canvas.getContext('2d');

  ctx.drawImage(template, 0, 0, template.width, template.height);
  drawLeaderboardRows(ctx, rows);

  return canvas.toBuffer('image/png');
}

async function generateTopFraggerGraphicBuffer(fraggerInput) {
  const assets = await getAssets();
  const template = assets.topFraggerTemplate;
  const rows = normalizeFraggerRows(fraggerInput);

  const canvas = createCanvas(template.width, template.height);
  const ctx = canvas.getContext('2d');

  ctx.drawImage(template, 0, 0, template.width, template.height);
  drawFraggerRows(ctx, rows);

  return canvas.toBuffer('image/png');
}

async function generateLeaderboardGraphic(leaderboardInput, outputPath) {
  const buffer = await generateLeaderboardGraphicBuffer(leaderboardInput);
  if (outputPath) {
    fs.writeFileSync(outputPath, buffer);
  }
  return buffer;
}

async function generateTopFraggerGraphic(fraggerInput, outputPath) {
  const buffer = await generateTopFraggerGraphicBuffer(fraggerInput);
  if (outputPath) {
    fs.writeFileSync(outputPath, buffer);
  }
  return buffer;
}

module.exports = {
  generateLeaderboardGraphicBuffer,
  generateTopFraggerGraphicBuffer,
  generateLeaderboardGraphic,
  generateTopFraggerGraphic
};
