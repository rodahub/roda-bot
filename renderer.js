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
    fillStyle = '#4b2a76',
    shadowColor = 'rgba(173, 120, 255, 0.18)',
    shadowBlur = 2,
    strokeStyle = null,
    strokeWidth = 0
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

  if (strokeStyle && strokeWidth > 0) {
    ctx.lineWidth = strokeWidth;
    ctx.strokeStyle = strokeStyle;
    ctx.strokeText(value, centerX, centerY);
  }

  ctx.fillText(value, centerX, centerY);
  ctx.restore();
}

function drawLeaderboardRows(ctx, rows) {
  // IMPORTANTE:
  // NON ridisegniamo la colonna POSIZIONE
  // perché i numeri sono già presenti nel template.
  const layout = {
    teamCenterX: 824,
    pointsCenterX: 1342,
    firstRowCenterY: 301,
    rowGap: 47.9,
    maxRows: 16
  };

  const visibleRows = rows.slice(0, layout.maxRows);

  for (let i = 0; i < visibleRows.length; i++) {
    const row = visibleRows[i];
    const y = layout.firstRowCenterY + i * layout.rowGap;

    drawCenteredText(ctx, row.team, layout.teamCenterX, y, {
      maxWidth: 660,
      fontSize: 29,
      minFontSize: 17,
      fillStyle: '#47296f',
      shadowColor: 'rgba(173, 120, 255, 0.12)',
      shadowBlur: 1
    });

    drawCenteredText(ctx, String(Number(row.punti || 0)), layout.pointsCenterX, y, {
      maxWidth: 150,
      fontSize: 28,
      minFontSize: 18,
      fillStyle: '#47296f',
      shadowColor: 'rgba(173, 120, 255, 0.12)',
      shadowBlur: 1
    });
  }
}

function drawFraggerRows(ctx, rows) {
  // Anche qui NON ridisegniamo la colonna posizione
  // perché è già presente nel template.
  const layout = {
    playerCenterX: 826,
    killsCenterX: 1340,
    firstRowCenterY: 304,
    rowGap: 52.0,
    maxRows: 10
  };

  const visibleRows = rows.slice(0, layout.maxRows);

  for (let i = 0; i < visibleRows.length; i++) {
    const row = visibleRows[i];
    const y = layout.firstRowCenterY + i * layout.rowGap;

    drawCenteredText(ctx, row.nome, layout.playerCenterX, y, {
      maxWidth: 660,
      fontSize: 29,
      minFontSize: 17,
      fillStyle: '#47296f',
      shadowColor: 'rgba(173, 120, 255, 0.12)',
      shadowBlur: 1
    });

    drawCenteredText(ctx, String(Number(row.kills || 0)), layout.killsCenterX, y, {
      maxWidth: 150,
      fontSize: 28,
      minFontSize: 18,
      fillStyle: '#47296f',
      shadowColor: 'rgba(173, 120, 255, 0.12)',
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
