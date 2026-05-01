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

  // Non tocchiamo più clan.html e streamer.html: il patch runtime poteva rompere pagine minificate.
  // Manteniamo solo il fix sicuro sulla home: togliere Loadout dalla barra sotto,
  // senza rimuoverlo dal menu sospeso.
  if (name === 'index.html') {
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
    if (name !== 'index.html') {
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
