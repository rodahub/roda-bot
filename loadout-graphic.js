'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const graphics = require('./loadout-graphics');

function stripHtmlTagContaining(html, tagName, needles) {
  let out = String(html || '');
  const lowerTag = String(tagName || '').toLowerCase();
  const items = (Array.isArray(needles) ? needles : [needles]).map(x => String(x || '').toLowerCase()).filter(Boolean);
  if (!lowerTag || !items.length) return out;

  const openToken = '<' + lowerTag;
  const closeToken = '</' + lowerTag + '>';
  let searchFrom = 0;

  while (true) {
    const lower = out.toLowerCase();
    const start = lower.indexOf(openToken, searchFrom);
    if (start === -1) break;

    const end = lower.indexOf(closeToken, start);
    if (end === -1) break;

    const endWithClose = end + closeToken.length;
    const chunk = out.slice(start, endWithClose);
    const chunkLower = chunk.toLowerCase();

    if (items.some(n => chunkLower.includes(n))) {
      out = out.slice(0, start) + out.slice(endWithClose);
      searchFrom = Math.max(0, start - 1);
    } else {
      searchFrom = endWithClose;
    }
  }

  return out;
}

function patchPublicHtml(html, filePath) {
  const name = path.basename(String(filePath || '')).toLowerCase();
  let out = String(html || '');

  if (name === 'clan.html' || name === 'streamer.html') {
    out = out.replace(/\.back-btn\s*\{[\s\S]*?\}\s*\.back-btn:hover\s*\{[\s\S]*?\}\s*\.back-btn:active\s*\{[\s\S]*?\}/, `.back-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:12px 18px;border-radius:999px;font-size:15px;font-weight:950;color:var(--text);background:linear-gradient(135deg,rgba(123,44,255,.30),rgba(255,255,255,.04));border:1px solid rgba(160,110,255,.34);box-shadow:0 0 26px rgba(123,44,255,.26);white-space:nowrap;transition:.16s ease;touch-action:manipulation}.back-btn:hover{background:rgba(123,44,255,.22);border-color:rgba(160,110,255,.45);transform:translateY(-1px)}.back-btn:active{transform:translateY(1px);opacity:.82}`);
    out = out.replace(/>\s*Torna al sito\s*<\/a>/g, '>← Indietro</a>');
    out = out.replace(/<svg[\s\S]*?<\/svg>\s*← Indietro/g, '← Indietro');
    out = out.replace(/<svg[\s\S]*?<\/svg>\s*Torna al sito/g, '← Indietro');
  }

  if (name === 'index.html') {
    // Togli solo il pulsante Loadout della barra sotto/tab interni.
    // Non tocchiamo i link <a href="/loadout"> del menu sospeso.
    out = stripHtmlTagContaining(out, 'button', ['data-page="loadout"', "data-page='loadout'"]);
  }

  return out;
}

function installPublicHtmlPatch() {
  const response = express && express.response;
  if (!response || response.__rodaPublicHtmlPatched || typeof response.sendFile !== 'function') return;
  const originalSendFile = response.sendFile;
  Object.defineProperty(response, '__rodaPublicHtmlPatched', { value: true, enumerable: false });

  response.sendFile = function patchedSendFile(filePath, options, callback) {
    const name = path.basename(String(filePath || '')).toLowerCase();
    if (!['index.html', 'clan.html', 'streamer.html'].includes(name)) {
      return originalSendFile.apply(this, arguments);
    }

    try {
      const html = fs.readFileSync(filePath, 'utf8');
      const patched = patchPublicHtml(html, filePath);
      this.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      this.setHeader('Pragma', 'no-cache');
      this.setHeader('Expires', '0');
      this.type('html');
      return this.send(patched);
    } catch (error) {
      console.error('[public-html-patch]', error.message);
      return originalSendFile.apply(this, arguments);
    }
  };
}

installPublicHtmlPatch();

async function generateLoadoutGraphic(build) {
  const result = await graphics.generateLoadoutGraphic(build);
  return {
    fileName: result.fileName || '',
    outputPath: result.outputPath || '',
    url: result.url || result.imageUrl || ''
  };
}

module.exports = { generateLoadoutGraphic };
