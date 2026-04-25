const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const { loadTeams } = require('./storage');

const PREVIEW_WIDTH = 1672;
const PREVIEW_HEIGHT = 941;

function sanitizeText(value) {
  return String(value || '').trim();
}

function normalizeBaseUrl(value) {
  const clean = sanitizeText(value);
  if (!clean) return '';
  return clean.endsWith('/') ? clean.slice(0, -1) : clean;
}

function getPublicBaseUrl() {
  const explicit = normalizeBaseUrl(
    process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL
  );

  if (explicit) return explicit;

  const railwayDomain = sanitizeText(process.env.RAILWAY_PUBLIC_DOMAIN);
  if (railwayDomain) return `https://${railwayDomain}`;

  return '';
}

function buildPreviewUrl(pathname) {
  const baseUrl = getPublicBaseUrl();

  if (!baseUrl) {
    throw new Error(
      'Base URL non trovata. Imposta PUBLIC_BASE_URL oppure APP_BASE_URL oppure RAILWAY_PUBLIC_DOMAIN.'
    );
  }

  return `${baseUrl}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function toSafeUpper(value) {
  return sanitizeText(value || '-').toUpperCase();
}

function imageFileToDataUrl(filePath) {
  if (!fs.existsSync(filePath)) return '';

  const ext = path.extname(filePath).toLowerCase().replace('.', '') || 'png';
  const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;
  const base64 = fs.readFileSync(filePath).toString('base64');

  return `data:${mime};base64,${base64}`;
}

function getRegisteredTeamsRows() {
  const teams = loadTeams() || {};

  const rows = Object.entries(teams)
    .sort((a, b) => {
      const slotA = Number(a[1]?.slot || 999999);
      const slotB = Number(b[1]?.slot || 999999);

      if (slotA !== slotB) return slotA - slotB;

      return a[0].localeCompare(b[0], 'it');
    })
    .slice(0, 16)
    .map(([teamName, teamData], index) => {
      const numericSlot = Number(teamData?.slot);
      const slot = Number.isInteger(numericSlot) && numericSlot > 0 ? numericSlot : index + 1;
      const players = Array.isArray(teamData?.players) ? teamData.players : [];

      return {
        slot,
        team: toSafeUpper(teamName),
        players: [
          toSafeUpper(players[0] || '-'),
          toSafeUpper(players[1] || '-'),
          toSafeUpper(players[2] || '-')
        ],
        empty: false
      };
    });

  while (rows.length < 16) {
    rows.push({
      slot: '-',
      team: '-',
      players: ['-', '-', '-'],
      empty: true
    });
  }

  return rows.slice(0, 16);
}

function buildRegisteredTeamsHtml() {
  const backgroundPath = path.join(__dirname, 'public', 'team-registrati-1672x941.png');
  const backgroundDataUrl = imageFileToDataUrl(backgroundPath);
  const rows = getRegisteredTeamsRows();

  const rowsHtml = rows.map(row => {
    const slotText = row.slot === '-' ? '-' : `#${row.slot}`;

    return `
      <div class="table-row ${row.empty ? 'empty' : 'filled'}">
        <div class="cell slot">${escapeHtml(slotText)}</div>
        <div class="cell team">${escapeHtml(row.team)}</div>
        <div class="cell player">${escapeHtml(row.players[0] || '-')}</div>
        <div class="cell player">${escapeHtml(row.players[1] || '-')}</div>
        <div class="cell player">${escapeHtml(row.players[2] || '-')}</div>
      </div>
    `;
  }).join('');

  return `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8" />
  <title>Team Registrati Render</title>
  <style>
    * {
      box-sizing: border-box;
    }

    html,
    body {
      margin: 0;
      padding: 0;
      width: ${PREVIEW_WIDTH}px;
      height: ${PREVIEW_HEIGHT}px;
      background: #0b0614;
      font-family: Arial, Helvetica, sans-serif;
      overflow: hidden;
    }

    body {
      display: flex;
      justify-content: center;
      align-items: center;
    }

    .preview-wrapper {
      position: relative;
      width: 1672px;
      height: 941px;
      overflow: hidden;
      background: #12091f;
    }

    .background {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
      z-index: 1;
      user-select: none;
      pointer-events: none;
    }

    .fallback-bg {
      position: absolute;
      inset: 0;
      z-index: 1;
      background:
        radial-gradient(circle at top left, rgba(123, 44, 255, .35), transparent 32%),
        radial-gradient(circle at bottom right, rgba(156, 92, 255, .26), transparent 34%),
        linear-gradient(180deg, #160928 0%, #07030f 100%);
    }

    .table-overlay {
      position: absolute;
      z-index: 2;
      top: 235px;
      left: 86px;
      width: 1500px;
      height: 620px;
      display: flex;
      flex-direction: column;
    }

    .table-header {
      display: grid;
      grid-template-columns: 130px 350px 1fr 1fr 1fr;
      column-gap: 12px;
      align-items: center;
      width: 100%;
      height: 42px;
      margin-bottom: 10px;
      padding: 0 10px;
      border-radius: 14px;
      background: linear-gradient(
        180deg,
        rgba(109, 56, 204, 0.96) 0%,
        rgba(82, 32, 176, 0.96) 55%,
        rgba(62, 19, 145, 0.98) 100%
      );
      border: 1px solid rgba(222, 193, 255, 0.92);
      box-shadow:
        0 0 16px rgba(160, 95, 255, 0.62),
        0 0 28px rgba(160, 95, 255, 0.28),
        inset 0 0 16px rgba(224, 195, 255, 0.18);
    }

    .header-cell {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: #ffffff;
      font-size: 18px;
      font-weight: 900;
      letter-spacing: 1.2px;
      text-transform: uppercase;
      text-align: center;
      text-shadow:
        0 0 8px rgba(255, 255, 255, 0.34),
        0 0 16px rgba(191, 134, 255, 0.68),
        0 0 26px rgba(130, 58, 255, 0.48);
    }

    .table-body {
      display: flex;
      flex-direction: column;
      gap: 6px;
      flex: 1;
    }

    .table-row {
      display: grid;
      grid-template-columns: 130px 350px 1fr 1fr 1fr;
      column-gap: 12px;
      align-items: center;
      width: 100%;
      height: 31px;
      padding: 0 10px;
      border-radius: 12px;
      background: rgba(74, 28, 146, 0.82);
      border: 1px solid rgba(188, 147, 255, 0.76);
      box-shadow:
        0 0 14px rgba(145, 74, 255, 0.30),
        0 0 22px rgba(145, 74, 255, 0.10),
        inset 0 0 12px rgba(214, 179, 255, 0.10);
    }

    .table-row:nth-child(odd) {
      background: rgba(84, 34, 160, 0.86);
    }

    .table-row.filled {
      box-shadow:
        0 0 16px rgba(149, 79, 255, 0.34),
        0 0 26px rgba(149, 79, 255, 0.12),
        inset 0 0 12px rgba(221, 190, 255, 0.12);
    }

    .cell {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      min-width: 0;
      text-align: center;
      color: #fffaff;
      font-size: 17px;
      font-weight: 800;
      line-height: 1;
      letter-spacing: 0.6px;
      text-transform: uppercase;
      text-shadow:
        0 0 6px rgba(255, 255, 255, 0.22),
        0 0 12px rgba(181, 129, 255, 0.42),
        0 0 18px rgba(118, 46, 255, 0.20);
    }

    .cell.slot {
      font-size: 18px;
      font-weight: 900;
    }

    .cell.team {
      font-size: 18px;
      font-weight: 900;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      padding: 0 8px;
    }

    .cell.player {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      padding: 0 8px;
    }

    .table-row.empty {
      background: rgba(63, 24, 124, 0.68);
      border: 1px solid rgba(162, 118, 235, 0.54);
      box-shadow:
        0 0 10px rgba(128, 64, 220, 0.16),
        inset 0 0 8px rgba(196, 158, 255, 0.06);
    }

    .table-row.empty .cell {
      color: rgba(245, 236, 255, 0.62);
      text-shadow:
        0 0 4px rgba(255, 255, 255, 0.08);
    }
  </style>
</head>
<body>
  <div class="preview-wrapper">
    ${backgroundDataUrl
      ? `<img class="background" src="${backgroundDataUrl}" alt="Team Registrati Background" />`
      : `<div class="fallback-bg"></div>`
    }

    <div class="table-overlay">
      <div class="table-header">
        <div class="header-cell">Slot</div>
        <div class="header-cell">Team</div>
        <div class="header-cell">Player 1</div>
        <div class="header-cell">Player 2</div>
        <div class="header-cell">Player 3</div>
      </div>

      <div class="table-body">
        ${rowsHtml}
      </div>
    </div>
  </div>

  <script>
    window.__RODA_RENDER_READY = true;
  </script>
</body>
</html>`;
}

async function launchBrowser() {
  return puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-software-rasterizer',
      '--no-zygote',
      '--single-process'
    ]
  });
}

async function waitForAssets(page) {
  await page.evaluate(async () => {
    try {
      if (document.fonts && document.fonts.ready) {
        await document.fonts.ready;
      }
    } catch {}

    const images = Array.from(document.images || []);

    await Promise.all(
      images.map(img => {
        if (img.complete) return Promise.resolve();

        return new Promise(resolve => {
          img.addEventListener('load', resolve, { once: true });
          img.addEventListener('error', resolve, { once: true });
        });
      })
    );
  });
}

async function waitForPreviewReady(page) {
  try {
    await page.waitForFunction(
      () => window.__RODA_RENDER_READY === true,
      {
        timeout: 15000
      }
    );
  } catch {
    console.log('[renderer] ready flag non trovato, continuo comunque');
  }
}

async function takePreviewScreenshot(url, selector) {
  const browser = await launchBrowser();

  try {
    const page = await browser.newPage();

    await page.setViewport({
      width: PREVIEW_WIDTH,
      height: PREVIEW_HEIGHT,
      deviceScaleFactor: 1
    });

    console.log(`[renderer] opening: ${url}`);

    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    await waitForAssets(page);
    await waitForPreviewReady(page);
    await new Promise(resolve => setTimeout(resolve, 800));

    let target = null;

    if (selector) {
      target = await page.$(selector);
    }

    if (!target) {
      target =
        (await page.$('.preview-wrapper')) ||
        (await page.$('.preview')) ||
        (await page.$('.canvas')) ||
        (await page.$('body'));
    }

    if (!target) {
      throw new Error(`Nessun elemento screenshot trovato per ${url}`);
    }

    const buffer = await target.screenshot({
      type: 'png'
    });

    if (!buffer || !buffer.length) {
      throw new Error(`Screenshot vuoto generato per ${url}`);
    }

    console.log(`[renderer] screenshot ok: ${url} (${buffer.length} bytes)`);

    return buffer;
  } finally {
    await browser.close().catch(() => {});
  }
}

async function takeHtmlScreenshot(html, selector) {
  const browser = await launchBrowser();

  try {
    const page = await browser.newPage();

    await page.setViewport({
      width: PREVIEW_WIDTH,
      height: PREVIEW_HEIGHT,
      deviceScaleFactor: 1
    });

    await page.setContent(html, {
      waitUntil: 'networkidle0',
      timeout: 60000
    });

    await waitForAssets(page);
    await waitForPreviewReady(page);
    await new Promise(resolve => setTimeout(resolve, 300));

    let target = null;

    if (selector) {
      target = await page.$(selector);
    }

    if (!target) {
      target =
        (await page.$('.preview-wrapper')) ||
        (await page.$('.preview')) ||
        (await page.$('.canvas')) ||
        (await page.$('body'));
    }

    if (!target) {
      throw new Error('Nessun elemento screenshot trovato per HTML locale');
    }

    const buffer = await target.screenshot({
      type: 'png'
    });

    if (!buffer || !buffer.length) {
      throw new Error('Screenshot vuoto generato da HTML locale');
    }

    console.log(`[renderer] screenshot team registrati locale ok (${buffer.length} bytes)`);

    return buffer;
  } finally {
    await browser.close().catch(() => {});
  }
}

async function generateLeaderboardGraphicBuffer() {
  const url = buildPreviewUrl('/classifica-live-preview.html');
  return takePreviewScreenshot(url, '.canvas');
}

async function generateTopFraggerGraphicBuffer() {
  const url = buildPreviewUrl('/top-fragger-preview.html');
  return takePreviewScreenshot(url, '.preview-wrapper');
}

async function generateRegisteredTeamsGraphicBuffer() {
  const html = buildRegisteredTeamsHtml();
  return takeHtmlScreenshot(html, '.preview-wrapper');
}

module.exports = {
  generateLeaderboardGraphicBuffer,
  generateTopFraggerGraphicBuffer,
  generateRegisteredTeamsGraphicBuffer
};
