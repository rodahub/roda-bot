const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage, registerFont } = require('canvas');

const ROOT_DIR = __dirname;

const LEADERBOARD_TEMPLATE_PATH = path.join(ROOT_DIR, 'classifica-live.png');
const TOP_FRAGGER_TEMPLATE_PATH = path.join(ROOT_DIR, 'top-fragger.png');

const TITLE_FONT_PATH = path.join(ROOT_DIR, 'NeltridetrialRegular-q2nmr.otf');
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
    if (ctx.measureText(text).width <= maxWidth) return size;
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
    fillStyle = '#4a2b75',
    shadowColor = 'rgba(170, 118, 255, 0.16)',
    shadowBlur = 1
  } = options;

  const familyToUse = fontsRegistered ? fontFamily : fallbackFamily;
  const fittedSize = fitFontSize(
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

  setFont(ctx, fittedSize, familyToUse, fontWeight);
  ctx.fillText(value, centerX, centerY);

  ctx.restore();
}

/*
  IMPORTANTE:
  Non disegniamo MAI la colonna posizione a sinistra,
  perché i numeri sono già dentro i template PNG.
*/

const CLASSIFICA_LAYOUT = {
  teamCenterX: 824,
  pointsCenterX: 1342,
  rowY: [
    316, 364, 412, 460, 508, 556, 604, 652,
    700, 748, 796, 844, 892, 940, 988, 1036
  ],
  teamMaxWidth: 660,
  pointsMaxWidth: 150
};

const FRAGGER_LAYOUT = {
  playerCenterX: 826,
  killsCenterX: 1340,
  rowY: [
    304, 356, 408, 460, 512, 564, 616, 668, 720, 772
  ],
  playerMaxWidth: 660,
  killsMaxWidth: 150
};

function drawLeaderboardRows(ctx, rows) {
  const visibleRows = rows.slice(0, CLASSIFICA_LAYOUT.rowY.length);

  for (let i = 0; i < visibleRows.length; i++) {
    const row = visibleRows[i];
    const y = CLASSIFICA_LAYOUT.rowY[i];

    drawCenteredText(ctx, row.team, CLASSIFICA_LAYOUT.teamCenterX, y, {
      maxWidth: CLASSIFICA_LAYOUT.teamMaxWidth,
      fontSize: 29,
      minFontSize: 17,
      fillStyle: '#47286f',
      shadowColor: 'rgba(170, 118, 255, 0.12)',
      shadowBlur: 1
    });

    drawCenteredText(ctx, String(Number(row.punti || 0)), CLASSIFICA_LAYOUT.pointsCenterX, y, {
      maxWidth: CLASSIFICA_LAYOUT.pointsMaxWidth,
      fontSize: 28,
      minFontSize: 18,
      fillStyle: '#47286f',
      shadowColor: 'rgba(170, 118, 255, 0.12)',
      shadowBlur: 1
    });
  }
}

function drawFraggerRows(ctx, rows) {
  const visibleRows = rows.slice(0, FRAGGER_LAYOUT.rowY.length);

  for (let i = 0; i < visibleRows.length; i++) {
    const row = visibleRows[i];
    const y = FRAGGER_LAYOUT.rowY[i];

    drawCenteredText(ctx, row.nome, FRAGGER_LAYOUT.playerCenterX, y, {
      maxWidth: FRAGGER_LAYOUT.playerMaxWidth,
      fontSize: 29,
      minFontSize: 17,
      fillStyle: '#47286f',
      shadowColor: 'rgba(170, 118, 255, 0.12)',
      shadowBlur: 1
    });

    drawCenteredText(ctx, String(Number(row.kills || 0)), FRAGGER_LAYOUT.killsCenterX, y, {
      maxWidth: FRAGGER_LAYOUT.killsMaxWidth,
      fontSize: 28,
      minFontSize: 18,
      fillStyle: '#47286f',
      shadowColor: 'rgba(170, 118, 255, 0.12)',
      shadowBlur: 1
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
