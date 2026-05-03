'use strict';

const isProduction = process.env.NODE_ENV === 'production';

const required = [
  'TOKEN',
  'GUILD_ID',
  'ADMIN_PASSWORD',
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

const missingRequired = required.filter(name => !clean(name));
const missingRecommended = recommended.filter(name => !clean(name));

if (missingRequired.length) {
  console.error('Configurazione incompleta. Mancano variabili obbligatorie:');
  for (const name of missingRequired) {
    console.error(`- ${name}`);
  }
  process.exit(1);
}

const adminPassword = clean('ADMIN_PASSWORD');
const sessionSecret = clean('SESSION_SECRET');

if (adminPassword.length < 10) {
  fail('ADMIN_PASSWORD troppo corta. Usa una password forte.');
}

if (sessionSecret.length < 32) {
  fail('SESSION_SECRET troppo corto. Usa una stringa casuale lunga almeno 32 caratteri.');
}

if (forbiddenValues.has(adminPassword.toLowerCase())) {
  fail('ADMIN_PASSWORD usa un valore vietato o troppo prevedibile. Cambiala.');
}

if (forbiddenValues.has(sessionSecret.toLowerCase())) {
  fail('SESSION_SECRET usa un valore vietato o troppo prevedibile. Cambialo.');
}

if (clean('DASHBOARD_PASSWORD') && forbiddenValues.has(clean('DASHBOARD_PASSWORD').toLowerCase())) {
  fail('DASHBOARD_PASSWORD legacy usa un valore vietato. Cambiala o rimuovila.');
}

if (clean('DASHBOARD_COOKIE_SECRET') && clean('DASHBOARD_COOKIE_SECRET').length < 32) {
  fail('DASHBOARD_COOKIE_SECRET legacy troppo corto. Usa almeno 32 caratteri o rimuovilo.');
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
