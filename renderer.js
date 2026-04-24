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
    console.warn('Impossibile registrare il font titolo:', error.message);
  }

  try {
    if (fs.existsSync(BODY_FONT_PATH)) {
      registerFont(BODY_FONT_PATH, { family: BODY_FONT_FAMILY });
    }
  } catch (error) {
    console.warn('Impossibile registrare il font body:', error.message);
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
    posizione: normalizeNumber(
      row.posizione ?? row.position ?? row.pos ?? index + 1,
      index + 1
    ),
    team: cleanText(
      row.team ?? row.teamName ?? row.nome ?? row.name ?? ''
    ),
    punti: normalizeNumber(
      row.punti ?? row.points ?? row.score ?? 0,
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
    posizione: normalizeNumber(
      row.posizione ?? row.position ?? row.pos ?? index + 1,
      index + 1
    ),
    nome: cleanText(
      row.nome ?? row.player ?? row.playerName ?? row.name ?? ''
    ),
    kills: normalizeNumber(
      row.kills ?? row.uccisioni ?? row.value ?? 0,
      0
    )
  }));
}

function setFont(ctx, size, family, weight = 'bold') {
  ctx.font = `${weight} ${size}px "${family}"`;
}

function fitFontSize(ctx, text, maxWidth, startSize, minSize, family, weight = 'bold') {
  let size = startSize;

  while (size >= minSize) {
    setFont(ctx, size, family, weight);
    if (ctx.measureText(text).width <= maxWidth) {
      return size;
    }
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
    fillStyle = '#4b2c77',
    paddingX = 12,
    shadowColor = 'rgba(171, 123, 255, 0.08)',
    shadowBlur = 0,
    yOffset = 0
  } = options;

  const familyToUse = fontsRegistered ? fontFamily : fallbackFamily;
  const maxWidth = Math.max(10, box.width - (paddingX * 2));

  const finalSize = fitFontSize(
    ctx,
    value,
    maxWidth,
    fontSize,
    minFontSize,
    familyToUse,
    fontWeight
  );

  ctx.save();
  setFont(ctx, finalSize, familyToUse, fontWeight);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = fillStyle;
  ctx.shadowColor = shadowColor;
  ctx.shadowBlur = shadowBlur;

  const centerX = box.x + (box.width / 2);
  const centerY = box.y + (box.height / 2) + yOffset;

  ctx.fillText(value, centerX, centerY);
  ctx.restore();
}

function drawCenteredNumber(ctx, value, box, options = {}) {
  drawCenteredText(ctx, String(normalizeNumber(value, 0)), box, options);
}

/*
  IMPORTANTE:
  NON disegniamo la colonna POSIZIONE.
  I numeri a sinistra esistono già dentro il template PNG.
  Se li ridisegniamo, escono doppi o sfalsati.
*/

const LEADERBOARD_LAYOUT = {
  rows: [
    { y: 266, h: 42 },
    { y: 315, h: 42 },
    { y: 364, h: 42 },
    { y: 413, h: 42 },
    { y: 462, h: 42 },
    { y: 511, h: 42 },
    { y: 560, h: 42 },
    { y: 609, h: 42 },
    { y: 658, h: 42 },
    { y: 707, h: 42 },
    { y: 756, h: 42 },
    { y: 805, h: 42 },
    { y: 854, h: 42 },
    { y: 903, h: 42 },
    { y: 952, h: 42 },
    { y: 1001, h: 42 }
  ],
  teamBox: { x: 451, width: 763 },
  pointsBox: { x: 1225, width: 244 }
};

const TOP_FRAGGER_LAYOUT = {
  rows: [
    { y: 286, h: 43 },
    { y: 338, h: 43 },
    { y: 390, h: 43 },
    { y: 442, h: 43 },
    { y: 494, h: 43 },
    { y: 546, h: 43 },
    { y: 598, h: 43 },
    { y: 650, h: 43 },
    { y: 702, h: 43 },
    { y: 754, h: 43 }
  ],
  playerBox: { x: 451, width: 763 },
  killsBox: { x: 1225, width: 244 }
};

function buildBox(x, y, width, height) {
  return { x, y, width, height };
}

function drawLeaderboardRows(ctx, rows) {
  const visibleRows = rows.slice(0, LEADERBOARD_LAYOUT.rows.length);

  for (let i = 0; i < visibleRows.length; i++) {
    const row = visibleRows[i];
    const rowLayout = LEADERBOARD_LAYOUT.rows[i];

    const teamBox = buildBox(
      LEADERBOARD_LAYOUT.teamBox.x,
      rowLayout.y,
      LEADERBOARD_LAYOUT.teamBox.width,
      rowLayout.h
    );

    const pointsBox = buildBox(
      LEADERBOARD_LAYOUT.pointsBox.x,
      rowLayout.y,
      LEADERBOARD_LAYOUT.pointsBox.width,
      rowLayout.h
    );

    drawCenteredText(ctx, row.team, teamBox, {
      fontSize: 30,
      minFontSize: 18,
      fillStyle: '#45276d',
      paddingX: 18,
      yOffset: 0
    });

    drawCenteredNumber(ctx, row.punti, pointsBox, {
      fontSize: 30,
      minFontSize: 18,
      fillStyle: '#45276d',
      paddingX: 16,
      yOffset: 0
    });
  }
}

function drawTopFraggerRows(ctx, rows) {
  const visibleRows = rows.slice(0, TOP_FRAGGER_LAYOUT.rows.length);

  for (let i = 0; i < visibleRows.length; i++) {
    const row = visibleRows[i];
    const rowLayout = TOP_FRAGGER_LAYOUT.rows[i];

    const playerBox = buildBox(
      TOP_FRAGGER_LAYOUT.playerBox.x,
      rowLayout.y,
      TOP_FRAGGER_LAYOUT.playerBox.width,
      rowLayout.h
    );

    const killsBox = buildBox(
      TOP_FRAGGER_LAYOUT.killsBox.x,
      rowLayout.y,
      TOP_FRAGGER_LAYOUT.killsBox.width,
      rowLayout.h
    );

    drawCenteredText(ctx, row.nome, playerBox, {
      fontSize: 30,
      minFontSize: 18,
      fillStyle: '#45276d',
      paddingX: 18,
      yOffset: 0
    });

    drawCenteredNumber(ctx, row.kills, killsBox, {
      fontSize: 30,
      minFontSize: 18,
      fillStyle: '#45276d',
      paddingX: 16,
      yOffset: 0
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
