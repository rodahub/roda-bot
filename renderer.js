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
      'Base URL non trovata. Imposta PUBLIC_BASE_URL oppure APP_BASE_URL.'
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
    await new Promise(resolve => setTimeout(resolve, 1200));

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

async function generateLeaderboardGraphicBuffer() {
  const url = buildPreviewUrl('/classifica-live-preview.html');
  return takePreviewScreenshot(url, '.canvas');
}

async function generateTopFraggerGraphicBuffer() {
  const url = buildPreviewUrl('/top-fragger-preview.html');
  return takePreviewScreenshot(url, '.preview-wrapper');
}

module.exports = {
  generateLeaderboardGraphicBuffer,
  generateTopFraggerGraphicBuffer
};
