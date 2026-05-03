'use strict';

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

const missingRequired = required.filter(name => !String(process.env[name] || '').trim());
const missingRecommended = recommended.filter(name => !String(process.env[name] || '').trim());

if (missingRequired.length) {
  console.error('Configurazione incompleta. Mancano variabili obbligatorie:');
  for (const name of missingRequired) {
    console.error(`- ${name}`);
  }
  process.exit(1);
}

if (String(process.env.ADMIN_PASSWORD || '').length < 10) {
  console.error('ADMIN_PASSWORD troppo corta. Usa una password forte.');
  process.exit(1);
}

if (String(process.env.SESSION_SECRET || '').length < 32) {
  console.error('SESSION_SECRET troppo corto. Usa una stringa casuale lunga almeno 32 caratteri.');
  process.exit(1);
}

if (missingRecommended.length) {
  console.warn('Configurazione valida, ma mancano variabili consigliate:');
  for (const name of missingRecommended) {
    console.warn(`- ${name}`);
  }
}

console.log('Configurazione RODA CUP valida.');
