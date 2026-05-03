'use strict';

const fs = require('fs');
const path = require('path');

const isProduction = process.env.NODE_ENV === 'production';

const required = [
  'TOKEN',
  'GUILD_ID',
  'SESSION_SECRET'
];

const recommended = [
  'PUBLIC_BASE_URL',
  'RAILWAY_VOLUME_MOUNT_PATH',
  'STAFF_CHANNEL',
  'CLASSIFICA_CHANNEL',
  'CATEGORY_ID',
  'REGISTRATION_STATUS_CHANNEL'
];

const forbiddenValues = new Set([
  'password',
  'admin',
  'admin123',
  'changeme',
  'change-this-secret-now',
  '1234567890'
]);

function clean(name) {
  return String(process.env[name] || '').trim();
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function warn(message) {
  console.warn(message);
}

function getStorageDir() {
  return clean('STORAGE_DIR') || clean('RAILWAY_VOLUME_MOUNT_PATH') || path.join(__dirname, '..', 'storage-data');
}

function hasExistingAdminUsers() {
  try {
    const adminUsersFile = path.join(getStorageDir(), 'admin-users.json');
    if (!fs.existsSync(adminUsersFile)) return false;
    const raw = fs.readFileSync(adminUsersFile, 'utf8');
    const users = JSON.parse(raw);
    return Array.isArray(users) && users.some(user => user && user.active !== false && user.password && user.password.hash);
  } catch {
    return false;
  }
}

const adminPassword = clean('ADMIN_PASSWORD');
const sessionSecret = clean('SESSION_SECRET');
const existingAdminUsers = hasExistingAdminUsers();

const missingRequired = required.filter(name => !clean(name));
if (!adminPassword && !existingAdminUsers) missingRequired.push('ADMIN_PASSWORD');

const missingRecommended = recommended.filter(name => !clean(name));

if (missingRequired.length) {
  console.error('Configurazione incompleta. Mancano variabili obbligatorie:');
  for (const name of missingRequired) {
    console.error(`- ${name}`);
  }
  process.exit(1);
}

if (adminPassword) {
  if (adminPassword.length < 10) {
    warn('ATTENZIONE: ADMIN_PASSWORD è corta. Il deploy viene lasciato partire per non bloccare il torneo, ma cambiala appena possibile dal pannello o da Railway.');
  }

  if (forbiddenValues.has(adminPassword.toLowerCase())) {
    warn('ATTENZIONE: ADMIN_PASSWORD usa un valore prevedibile. Il deploy viene lasciato partire, ma cambiala subito.');
  }
} else if (existingAdminUsers) {
  console.warn('ADMIN_PASSWORD non impostata: uso gli account admin già salvati nel volume persistente.');
}

if (sessionSecret.length < 32) {
  fail('SESSION_SECRET troppo corto. Usa una stringa casuale lunga almeno 32 caratteri.');
}

if (forbiddenValues.has(sessionSecret.toLowerCase())) {
  fail('SESSION_SECRET usa un valore vietato o troppo prevedibile. Cambialo.');
}

if (clean('DASHBOARD_PASSWORD') && forbiddenValues.has(clean('DASHBOARD_PASSWORD').toLowerCase())) {
  warn('ATTENZIONE: DASHBOARD_PASSWORD legacy usa un valore prevedibile. Cambiala o rimuovila.');
}

if (clean('DASHBOARD_COOKIE_SECRET') && clean('DASHBOARD_COOKIE_SECRET').length < 32) {
  warn('ATTENZIONE: DASHBOARD_COOKIE_SECRET legacy è corto. Usa almeno 32 caratteri o rimuovilo.');
}

if (isProduction && !clean('RAILWAY_VOLUME_MOUNT_PATH') && !clean('STORAGE_DIR')) {
  fail('Storage persistente mancante. In produzione imposta RAILWAY_VOLUME_MOUNT_PATH o STORAGE_DIR.');
}

if (missingRecommended.length) {
  console.warn('Configurazione valida, ma mancano variabili consigliate:');
  for (const name of missingRecommended) {
    console.warn(`- ${name}`);
  }
}

console.log('Configurazione RODA CUP valida.');
