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
    console.warn('Impossibile registrare font titolo:', error.message);
  }

  try {
    if (fs.existsSync(BODY_FONT_PATH)) {
      registerFont(BODY_FONT_PATH, { family: BODY_FONT_FAMILY });
    }
  } catch (error) {
    console.warn('Impossibile registrare font body:', error.message);
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

function normalizeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeLeaderboardRows(input) {
  let rows = [];

  if (Array.isArray(input)) {
    rows = input;
  } else if (input && typeof input === 'object') {
    rows = Object.entries(input).map(([team, points]) => ({
      team,
      punti: points
    }));
  }

  return rows.map((row, index) => ({
    posizione: normalizeNumber(row.posizione ?? row.position ?? row.pos ?? index + 1, index + 1),
    team: cleanText(row.team ?? row.teamName ?? row.nome ?? row.name ?? ''),
    punti: normalizeNumber(row.punti ?? row.points ?? row.score ?? 0, 0)
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
    posizione: normalizeNumber(row.posizione ?? row.position ?? row.pos ?? index + 1, index + 1),
    nome: cleanText(row.nome ?? row.player ?? row.playerName ?? row.name ?? ''),
    kills: normalizeNumber(row.kills ?? row.uccisioni ?? row.value ?? 0, 0)
  }));
}

function setFont(ctx, size, family, weight = 'bold') {
  ctx.font = `${weight} ${size}px "${family}"`;
}

function fitFontSize(ctx, text, maxWidth, startSize, minSize, family, weight = 'bold') {
  let size = startSize;

  while (size >= minSize) {
    setFont(ctx, size, family, weight);
    if (ctx.measureText(text).width <= maxWidth) return size;
    size -= 1;
  }

  return minSize;
}

function drawCenteredText(ctx, text, box, options = {}) {
  const value = cleanText(text);
  if (!value) return;

  const {
    fontFamily = BODY_FONT_FAMILY,
    fallbackFamily = 'sans-serif',
    fontSize = 28,
    minFontSize = 16,
    fontWeight = 'bold',
    fillStyle = '#4A2A74',
    paddingX = 12,
    shadowColor = 'rgba(160, 110, 255, 0.08)',
    shadowBlur = 0,
    yOffset = 2
  } = options;

  const familyToUse = fontsRegistered ? fontFamily : fallbackFamily;
  const maxWidth = Math.max(10, box.width - paddingX * 2);

  const finalSize = fitFontSize(
    ctx,
    value,
    maxWidth,
    fontSize,
    minFontSize,
    familyToUse,
    fontWeight
  );

  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2 + yOffset;

  ctx.save();
  setFont(ctx, finalSize, familyToUse, fontWeight);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = fillStyle;
  ctx.shadowColor = shadowColor;
  ctx.shadowBlur = shadowBlur;
  ctx.fillText(value, centerX, centerY);
  ctx.restore();
}

function drawCenteredNumber(ctx, value, box, options = {}) {
  drawCenteredText(ctx, String(normalizeNumber(value, 0)), box, options);
}

/*
  IMPORTANTE:
  NON disegniamo la colonna POSIZIONE.
  I numeri a sinistra sono già stampati nei template.
*/

const LEADERBOARD_LAYOUT = {
  rowCount: 16,
  rowStartY: 265,
  rowStep: 49,
  rowHeight: 42,
  teamBoxX: 451,
  teamBoxWidth: 763,
  pointsBoxX: 1225,
  pointsBoxWidth: 244
};

const TOP_FRAGGER_LAYOUT = {
  rowCount: 10,
  rowStartY: 286,
  rowStep: 52,
  rowHeight: 43,
  playerBoxX: 451,
  playerBoxWidth: 763,
  killsBoxX: 1225,
  killsBoxWidth: 244
};

function buildRowBox(x, width, y, height) {
  return { x, y, width, height };
}

function drawLeaderboardRows(ctx, rows) {
  const visibleRows = rows.slice(0, LEADERBOARD_LAYOUT.rowCount);

  for (let i = 0; i < visibleRows.length; i++) {
    const row = visibleRows[i];
    const rowY = LEADERBOARD_LAYOUT.rowStartY + (i * LEADERBOARD_LAYOUT.rowStep);

    const teamBox = buildRowBox(
      LEADERBOARD_LAYOUT.teamBoxX,
      LEADERBOARD_LAYOUT.teamBoxWidth,
      rowY,
      LEADERBOARD_LAYOUT.rowHeight
    );

    const pointsBox = buildRowBox(
      LEADERBOARD_LAYOUT.pointsBoxX,
      LEADERBOARD_LAYOUT.pointsBoxWidth,
      rowY,
      LEADERBOARD_LAYOUT.rowHeight
    );

    drawCenteredText(ctx, row.team, teamBox, {
      fontSize: 30,
      minFontSize: 18,
      fillStyle: '#45276D',
      paddingX: 18,
      yOffset: 2
    });

    drawCenteredNumber(ctx, row.punti, pointsBox, {
      fontSize: 30,
      minFontSize: 18,
      fillStyle: '#45276D',
      paddingX: 16,
      yOffset: 2
    });
  }
}

function drawTopFraggerRows(ctx, rows) {
  const visibleRows = rows.slice(0, TOP_FRAGGER_LAYOUT.rowCount);

  for (let i = 0; i < visibleRows.length; i++) {
    const row = visibleRows[i];
    const rowY = TOP_FRAGGER_LAYOUT.rowStartY + (i * TOP_FRAGGER_LAYOUT.rowStep);

    const playerBox = buildRowBox(
      TOP_FRAGGER_LAYOUT.playerBoxX,
      TOP_FRAGGER_LAYOUT.playerBoxWidth,
      rowY,
      TOP_FRAGGER_LAYOUT.rowHeight
    );

    const killsBox = buildRowBox(
      TOP_FRAGGER_LAYOUT.killsBoxX,
      TOP_FRAGGER_LAYOUT.killsBoxWidth,
      rowY,
      TOP_FRAGGER_LAYOUT.rowHeight
    );

    drawCenteredText(ctx, row.nome, playerBox, {
      fontSize: 30,
      minFontSize: 18,
      fillStyle: '#45276D',
      paddingX: 18,
      yOffset: 2
    });

    drawCenteredNumber(ctx, row.kills, killsBox, {
      fontSize: 30,
      minFontSize: 18,
      fillStyle: '#45276D',
      paddingX: 16,
      yOffset: 2
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
  drawTopFraggerRows(ctx, rows);

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
