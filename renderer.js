const puppeteer = require('puppeteer');

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
    process.env.PUBLIC_BASE_URL ||
    process.env.APP_BASE_URL
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
      'PUBLIC_BASE_URL / APP_BASE_URL / RAILWAY_PUBLIC_DOMAIN non impostato: impossibile aprire le preview HTML'
    );
  }
  return `${baseUrl}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
}

async function launchBrowser() {
  return puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-zygote',
      '--single-process'
    ]
  });
}

async function waitForPageReady(page) {
  await page.evaluate(async () => {
    if (document.fonts && document.fonts.ready) {
      try {
        await document.fonts.ready;
      } catch {}
    }
  });

  await page.waitForTimeout(700);
}

async function screenshotPreview(url) {
  const browser = await launchBrowser();

  try {
    const page = await browser.newPage();

    await page.setViewport({
      width: 1760,
      height: 1080,
      deviceScaleFactor: 1
    });

    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    await waitForPageReady(page);

    const preview = await page.$('.preview-wrapper, .preview, .canvas');
    if (!preview) {
      throw new Error(`Elemento preview non trovato nella pagina: ${url}`);
    }

    const buffer = await preview.screenshot({
      type: 'png'
    });

    return buffer;
  } finally {
    await browser.close().catch(() => {});
  }
}

async function generateLeaderboardGraphicBuffer() {
  const url = buildPreviewUrl('/classifica-live-preview.html');
  return screenshotPreview(url);
}

async function generateTopFraggerGraphicBuffer() {
  const url = buildPreviewUrl('/top-fragger-preview.html');
  return screenshotPreview(url);
}

module.exports = {
  generateLeaderboardGraphicBuffer,
  generateTopFraggerGraphicBuffer
};
