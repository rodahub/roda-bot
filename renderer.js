const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { loadTeams } = require('./storage');

const PREVIEW_WIDTH = 1672;
const PREVIEW_HEIGHT = 941;

function clean(value) {
  return String(value || '').trim();
}

function isValidHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function normalizeBaseUrl(value) {
  const raw = clean(value).replace(/\/+$/g, '');
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return isValidHttpUrl(raw) ? raw : '';
  const withProtocol = `https://${raw.replace(/^\/+/, '')}`;
  return isValidHttpUrl(withProtocol) ? withProtocol : '';
}

function localBaseUrl() {
  return `http://127.0.0.1:${clean(process.env.PORT || '3000')}`;
}

function getBaseUrl() {
  const configured = [process.env.PUBLIC_BASE_URL, process.env.APP_BASE_URL, process.env.RAILWAY_PUBLIC_DOMAIN]
    .map(normalizeBaseUrl)
    .find(Boolean);
  return configured || localBaseUrl();
}

function buildPreviewUrl(pathname) {
  const suffix = String(pathname || '').startsWith('/') ? String(pathname) : `/${pathname || ''}`;
  const candidates = [getBaseUrl(), localBaseUrl()];
  for (const base of candidates) {
    const url = `${String(base).replace(/\/+$/g, '')}${suffix}`;
    if (isValidHttpUrl(url)) {
      console.log(`[renderer] preview url costruito: ${url}`);
      return url;
    }
  }
  throw new Error(`URL preview non valido per ${suffix}`);
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
}

async function launchBrowser() {
  return puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-zygote', '--single-process']
  });
}

async function waitForAssets(page) {
  await page.evaluate(async () => {
    try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch {}
    const images = Array.from(document.images || []);
    await Promise.all(images.map(img => img.complete ? Promise.resolve() : new Promise(resolve => {
      img.addEventListener('load', resolve, { once: true });
      img.addEventListener('error', resolve, { once: true });
    })));
  });
}

async function takeScreenshotFromUrl(url, selector) {
  if (!isValidHttpUrl(url)) throw new Error(`URL preview non valido: ${url}`);
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    page.on('console', msg => console.log(`[renderer:page] ${msg.type()}: ${msg.text()}`));
    page.on('pageerror', err => console.error(`[renderer:pageerror] ${err.message}`));
    await page.setViewport({ width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT, deviceScaleFactor: 1 });
    console.log(`[renderer] opening: ${url}`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    await waitForAssets(page);
    try { await page.waitForFunction(() => window.__RODA_RENDER_READY === true, { timeout: 8000 }); } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
    let target = selector ? await page.$(selector) : null;
    if (!target) target = (await page.$('.preview-wrapper')) || (await page.$('.preview')) || (await page.$('.canvas')) || (await page.$('body'));
    if (!target) throw new Error(`Nessun elemento screenshot trovato per ${url}`);
    const buffer = await target.screenshot({ type: 'png' });
    if (!buffer || !buffer.length) throw new Error(`Screenshot vuoto per ${url}`);
    console.log(`[renderer] screenshot ok: ${url} (${buffer.length} bytes)`);
    return buffer;
  } finally {
    await browser.close().catch(() => {});
  }
}

async function takeScreenshotFromHtml(html) {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 60000 });
    await waitForAssets(page);
    const target = (await page.$('.preview-wrapper')) || (await page.$('body'));
    const buffer = await target.screenshot({ type: 'png' });
    if (!buffer || !buffer.length) throw new Error('Screenshot team registrati vuoto');
    return buffer;
  } finally {
    await browser.close().catch(() => {});
  }
}

function buildRegisteredTeamsHtml() {
  const bgPath = path.join(__dirname, 'public', 'team-registrati-1672x941.png');
  const bg = fs.existsSync(bgPath) ? `data:image/png;base64,${fs.readFileSync(bgPath).toString('base64')}` : '';
  const teams = Object.entries(loadTeams() || {}).sort((a, b) => Number(a[1]?.slot || 999) - Number(b[1]?.slot || 999)).slice(0, 16);
  const rows = teams.map(([name, team]) => {
    const players = Array.isArray(team.players) ? team.players : [];
    return `<div class="r"><b>#${escapeHtml(team.slot || '-')}</b><span>${escapeHtml(name)}</span><span>${escapeHtml(players[0] || '-')}</span><span>${escapeHtml(players[1] || '-')}</span><span>${escapeHtml(players[2] || '-')}</span></div>`;
  }).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:${PREVIEW_WIDTH}px;height:${PREVIEW_HEIGHT}px;background:#12091f;font-family:Arial;color:#fff;overflow:hidden}.preview-wrapper{position:relative;width:${PREVIEW_WIDTH}px;height:${PREVIEW_HEIGHT}px}.bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}.table{position:absolute;z-index:2;left:86px;top:235px;width:1500px}.r{display:grid;grid-template-columns:130px 350px 1fr 1fr 1fr;gap:12px;margin:0 0 8px;padding:7px 14px;border:1px solid #bc93ff;border-radius:12px;background:rgba(74,28,146,.82);font-size:18px;font-weight:800;text-align:center;text-transform:uppercase}</style></head><body><div class="preview-wrapper">${bg ? `<img class="bg" src="${bg}">` : ''}<div class="table">${rows}</div></div></body></html>`;
}

async function generateLeaderboardGraphicBuffer() {
  return takeScreenshotFromUrl(buildPreviewUrl('/classifica-live-preview.html'), '.canvas');
}

async function generateTopFraggerGraphicBuffer() {
  return takeScreenshotFromUrl(buildPreviewUrl('/top-fragger-preview.html'), '.preview-wrapper');
}

async function generateRegisteredTeamsGraphicBuffer() {
  return takeScreenshotFromHtml(buildRegisteredTeamsHtml());
}

module.exports = {
  generateLeaderboardGraphicBuffer,
  generateTopFraggerGraphicBuffer,
  generateRegisteredTeamsGraphicBuffer
};
