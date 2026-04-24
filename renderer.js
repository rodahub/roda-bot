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

function getVerticalBaseline(ctx, centerY, text) {
  const metrics = ctx.measureText(text);
  const ascent = metrics.actualBoundingBoxAscent || 0;
  const descent = metrics.actualBoundingBoxDescent || 0;

  if (!ascent && !descent) {
    return centerY;
  }

  return centerY + (ascent - descent) / 2;
}

function drawCenteredTextInBox(ctx, text, box, options = {}) {
  const value = cleanText(text);
  if (!value) return;

  const {
    fontFamily = BODY_FONT_FAMILY,
    fallbackFamily = 'sans-serif',
    fontSize = 28,
    minFontSize = 16,
    fontWeight = 'bold',
    fillStyle = '#4d2d78',
    shadowColor = 'rgba(171, 123, 255, 0.10)',
    shadowBlur = 0,
    paddingX = 10
  } = options;

  const familyToUse = fontsRegistered ? fontFamily : fallbackFamily;
  const maxWidth = Math.max(10, box.width - paddingX * 2);

  const size = fitFontSize(
    ctx,
    value,
    maxWidth,
    fontSize,
    minFontSize,
    familyToUse,
    fontWeight
  );

  ctx.save();

  setFont(ctx, size, familyToUse, fontWeight);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = fillStyle;
  ctx.shadowColor = shadowColor;
  ctx.shadowBlur = shadowBlur;

  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  const baselineY = getVerticalBaseline(ctx, centerY, value);

  ctx.fillText(value, centerX, baselineY);

  ctx.restore();
}

function drawNumberInBox(ctx, value, box, options = {}) {
  drawCenteredTextInBox(ctx, String(normalizeNumber(value, 0)), box, options);
}

/*
  IMPORTANTE:
  NON disegniamo la colonna POSIZIONE.
  I numeri a sinistra sono già presenti nel PNG template.
  Se li ridisegni, escono doppi o sfasati.
*/

const LEADERBOARD_LAYOUT = {
  rowHeight: 44,
  rowTops: [
    267, 316, 365, 414,
    463, 512, 561, 610,
    659, 708, 757, 806,
    855, 904, 953, 1002
  ],
  teamBox: { x: 435, width: 785 },
  pointsBox: { x: 1227, width: 241 }
};

const TOP_FRAGGER_LAYOUT = {
  rowHeight: 45,
  rowTops: [
    287, 339, 391, 443, 495,
    547, 599, 651, 703, 755
  ],
  playerBox: { x: 454, width: 759 },
  killsBox: { x: 1226, width: 242 }
};

function buildBox(x, y, width, height) {
  return { x, y, width, height };
}

function drawLeaderboardRows(ctx, rows) {
  const visibleRows = rows.slice(0, LEADERBOARD_LAYOUT.rowTops.length);

  for (let i = 0; i < visibleRows.length; i++) {
    const row = visibleRows[i];
    const top = LEADERBOARD_LAYOUT.rowTops[i];
    const height = LEADERBOARD_LAYOUT.rowHeight;

    const teamBox = buildBox(
      LEADERBOARD_LAYOUT.teamBox.x,
      top,
      LEADERBOARD_LAYOUT.teamBox.width,
      height
    );

    const pointsBox = buildBox(
      LEADERBOARD_LAYOUT.pointsBox.x,
      top,
      LEADERBOARD_LAYOUT.pointsBox.width,
      height
    );

    drawCenteredTextInBox(ctx, row.team, teamBox, {
      fontSize: 29,
      minFontSize: 17,
      fillStyle: '#45276d',
      shadowColor: 'rgba(171, 123, 255, 0.08)',
      shadowBlur: 0,
      paddingX: 18
    });

    drawNumberInBox(ctx, row.punti, pointsBox, {
      fontSize: 28,
      minFontSize: 18,
      fillStyle: '#45276d',
      shadowColor: 'rgba(171, 123, 255, 0.08)',
      shadowBlur: 0,
      paddingX: 14
    });
  }
}

function drawTopFraggerRows(ctx, rows) {
  const visibleRows = rows.slice(0, TOP_FRAGGER_LAYOUT.rowTops.length);

  for (let i = 0; i < visibleRows.length; i++) {
    const row = visibleRows[i];
    const top = TOP_FRAGGER_LAYOUT.rowTops[i];
    const height = TOP_FRAGGER_LAYOUT.rowHeight;

    const playerBox = buildBox(
      TOP_FRAGGER_LAYOUT.playerBox.x,
      top,
      TOP_FRAGGER_LAYOUT.playerBox.width,
      height
    );

    const killsBox = buildBox(
      TOP_FRAGGER_LAYOUT.killsBox.x,
      top,
      TOP_FRAGGER_LAYOUT.killsBox.width,
      height
    );

    drawCenteredTextInBox(ctx, row.nome, playerBox, {
      fontSize: 29,
      minFontSize: 17,
      fillStyle: '#45276d',
      shadowColor: 'rgba(171, 123, 255, 0.08)',
      shadowBlur: 0,
      paddingX: 18
    });

    drawNumberInBox(ctx, row.kills, killsBox, {
      fontSize: 28,
      minFontSize: 18,
      fillStyle: '#45276d',
      shadowColor: 'rgba(171, 123, 255, 0.08)',
      shadowBlur: 0,
      paddingX: 14
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
