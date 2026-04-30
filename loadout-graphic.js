'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const OUTPUT_DIR = path.join(__dirname, 'data', 'loadout-graphics');
const TEMPLATE_PATH = path.join(__dirname, 'public', 'assets', 'loadout-template-base.png');

function clean(value) {
  return String(value || '').trim();
}

function escapeXml(value) {
  return clean(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function slugify(value) {
  return clean(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'loadout';
}

function fitText(value, max) {
  const str = clean(value).replace(/\s+/g, ' ');
  if (str.length <= max) return str;
  return str.slice(0, max - 1).trim() + '…';
}

function getWeaponName(build) {
  return clean(build.armaNome || build.weaponName || build.arma || build.weapon || 'LOADOUT');
}

function getCreatorName(build) {
  return clean(build.creatorName || build.creator || build.firma || 'Creator RØDA');
}

function getAccessories(build) {
  const list = Array.isArray(build.accessori) ? build.accessori : [];
  return list
    .filter(item => clean(item.nome || item.name || item.accessorio || item.attachment))
    .map(item => {
      const slot = clean(item.slot || item.tipo || '');
      const name = clean(item.nome || item.name || item.accessorio || item.attachment || '');
      return {
        slot,
        text: slot ? `${slot}: ${name}` : name
      };
    });
}

function buildOverlaySvg({ width, height, build }) {
  const weapon = fitText(getWeaponName(build).toUpperCase(), 26);
  const creator = fitText(getCreatorName(build), 34);

  const accessories = getAccessories(build).slice(0, 11);

  const slotsY = [
    720, 885, 1050, 1215, 1380,
    1545, 1710, 1875, 2040, 2205, 2370
  ];

  const slotTitleSize = 30;
  const slotValueSize = 33;

  const weaponFontSize = weapon.length > 18 ? 58 : 66;

  const accessoryBlocks = accessories.map((item, index) => {
    const y = slotsY[index];
    const slotLabel = fitText(item.slot, 18);
    const value = fitText(item.text, 42);

    return `
      <g>
        <text
          x="${width / 2}"
          y="${y}"
          text-anchor="middle"
          font-family="Arial Black, Arial, sans-serif"
          font-size="${slotValueSize}"
          font-weight="900"
          fill="#24104f"
          stroke="#ffffff"
          stroke-width="1.6"
          paint-order="stroke fill"
        >${escapeXml(value)}</text>
      </g>
    `;
  }).join('');

  return `
  <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <filter id="softGlow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="6" result="blur"/>
        <feMerge>
          <feMergeNode in="blur"/>
          <feMergeNode in="SourceGraphic"/>
        </feMerge>
      </filter>

      <filter id="titleGlow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="4" result="blur"/>
        <feMerge>
          <feMergeNode in="blur"/>
          <feMergeNode in="SourceGraphic"/>
        </feMerge>
      </filter>
    </defs>

    <!-- Nome arma -->
    <text
      x="${width / 2}"
      y="555"
      text-anchor="middle"
      font-family="Arial Black, Arial, sans-serif"
      font-size="${weaponFontSize}"
      font-weight="900"
      fill="#f7f2ff"
      stroke="#2b0d66"
      stroke-width="3"
      paint-order="stroke fill"
      filter="url(#titleGlow)"
    >${escapeXml(weapon)}</text>

    ${accessoryBlocks}

    <!-- Firma creator -->
    <text
      x="${width * 0.62}"
      y="${height - 128}"
      text-anchor="middle"
      font-family="Arial Black, Arial, sans-serif"
      font-size="40"
      font-weight="900"
      fill="#ffffff"
      stroke="#24104f"
      stroke-width="2.2"
      paint-order="stroke fill"
      filter="url(#softGlow)"
    >${escapeXml(creator)}</text>
  </svg>
  `;
}

async function generateLoadoutGraphic(build) {
  if (!fs.existsSync(TEMPLATE_PATH)) {
    throw new Error(`Template non trovato: ${TEMPLATE_PATH}`);
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const baseImage = sharp(TEMPLATE_PATH);
  const metadata = await baseImage.metadata();

  const width = metadata.width || 941;
  const height = metadata.height || 1672;

  const fileName = `${slugify(build.id || build.armaNome || Date.now())}.png`;
  const outputPath = path.join(OUTPUT_DIR, fileName);

  const overlaySvg = buildOverlaySvg({ width, height, build });

  await baseImage
    .composite([
      {
        input: Buffer.from(overlaySvg),
        top: 0,
        left: 0
      }
    ])
    .png()
    .toFile(outputPath);

  return {
    fileName,
    outputPath,
    url: `/loadout-graphics/${fileName}`
  };
}

module.exports = {
  generateLoadoutGraphic
};
