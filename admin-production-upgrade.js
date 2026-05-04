'use strict';

/**
 * Injects the professional tournament-control UI layer into public/admin.html
 * without rewriting the large dashboard file.
 */

try {
  require('./registration-panel-sync.js');
  console.log('✅ Sync pannello iscrizioni caricato da admin-production-upgrade.');
} catch (error) {
  console.error('[admin-ui] Impossibile caricare sync pannello iscrizioni:', error.message);
}

const fs = require('fs');
const path = require('path');

function injectOnce(content, marker, injection, beforeTag) {
  if (content.includes(marker)) return content;
  const index = content.toLowerCase().lastIndexOf(beforeTag.toLowerCase());
  if (index === -1) return content + '\n' + injection;
  return content.slice(0, index) + injection + '\n' + content.slice(index);
}

function installAdminProductionUpgrade() {
  try {
    const adminPath = path.join(__dirname, 'public', 'admin.html');
    if (!fs.existsSync(adminPath)) {
      console.warn('[admin-ui] admin.html non trovato, upgrade non applicato.');
      return;
    }

    let html = fs.readFileSync(adminPath, 'utf8');
    const original = html;

    html = injectOnce(
      html,
      'admin-production.css',
      '    <link rel="stylesheet" href="/admin-production.css" data-roda-admin-production="true" />',
      '</head>'
    );

    html = injectOnce(
      html,
      'admin-production.js',
      '    <script src="/admin-production.js" defer data-roda-admin-production="true"></script>',
      '</body>'
    );

    if (html !== original) {
      fs.writeFileSync(adminPath, html);
      console.log('✅ Admin production UI collegata a public/admin.html.');
    } else {
      console.log('✅ Admin production UI già collegata.');
    }
  } catch (error) {
    console.error('[admin-ui] Errore installazione admin production UI:', error.message);
  }
}

installAdminProductionUpgrade();

module.exports = { installAdminProductionUpgrade };
