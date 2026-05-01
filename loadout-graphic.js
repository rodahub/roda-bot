'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const graphics = require('./loadout-graphics');

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
    out = out.replace(/<button([^>]*data-page=["']loadout["'][\s\S]*?<\/button>/gi, '');
    out = out.replace(/<a([^>]*href=["']\/loadout["'][\s\S]*?<\/a>/gi, '');
    out = out.replace(/<a([^>]*href=["']\/loadout\.html["'][\s\S]*?<\/a>/gi, '');
    out = out.replace(/<div class=["']tab-btn["'][^>]*>\s*<span>[^<]*<\/span>\s*<strong>LOADOUT<\/strong>\s*<\/div>/gi, '');
    out = out.replace(/<button[^>]*>\s*<span[^>]*>[^<]*<\/span>\s*<span[^>]*>LOADOUT<\/span>\s*<\/button>/gi, '');
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
