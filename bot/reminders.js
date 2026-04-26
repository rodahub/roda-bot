const { client, waitReady } = require('./client');
const state = require('./state');
const { refreshStateFromDisk, areRegistrationsOpen, getBotSettings } = require('./lifecycle');
const { sanitizeText } = require('./helpers');
const { REMINDER_TYPES, markReminderSent } = require('../storage');

const REMINDER_STATE_RULES = {
  iscrizioni: ['iscrizioni_aperte'],
  regolamento: ['iscrizioni_aperte', 'iscrizioni_chiuse', 'torneo_in_corso'],
  risultati: ['torneo_in_corso']
};

function resolveReminderPlaceholders(text, ctx = {}) {
  if (!text) return '';
  const channelTag = (id) => (id ? `<#${id}>` : '`(canale non configurato)`');
  const teamCount = Number(ctx.teamCount || 0);
  const maxTeams = Number(ctx.maxTeams || 16);
  const replacements = {
    '{canale_iscrizioni}': channelTag(ctx.registerPanelChannelId),
    '{canale_regolamento}': channelTag(ctx.rulesChannelId),
    '{canale_risultati}': channelTag(ctx.resultsPanelChannelId),
    '{canale_generale}': channelTag(ctx.generalChannelId),
    '{team_iscritti}': `${teamCount}/${maxTeams}`,
    '{slot_liberi}': String(Math.max(0, maxTeams - teamCount)),
    '{match_corrente}': String(ctx.currentMatch || 1),
    '{match_totali}': String(ctx.totalMatches || 3)
  };
  let out = String(text);
  for (const [key, val] of Object.entries(replacements)) {
    out = out.split(key).join(val);
  }
  return out;
}

function buildReminderContext(currentData, currentTeams) {
  const bot = currentData?.botSettings || {};
  return {
    registerPanelChannelId: bot.registerPanelChannelId || '',
    rulesChannelId: bot.rulesChannelId || '',
    resultsPanelChannelId: bot.resultsPanelChannelId || '',
    generalChannelId: bot.generalChannelId || '',
    teamCount: Object.keys(currentTeams || {}).length,
    maxTeams: Number(currentData?.registrationMaxTeams || 16),
    currentMatch: Number(currentData?.currentMatch || 1),
    totalMatches: Number(currentData?.tournamentSettings?.totalMatches || 3)
  };
}

async function sendAutomaticReminder(type, options = {}) {
  if (!REMINDER_TYPES.includes(type)) {
    throw new Error(`Tipo promemoria non valido: ${type}`);
  }

  refreshStateFromDisk();

  const reminder = state.data.automaticReminders?.reminders?.[type];
  if (!reminder) throw new Error(`Promemoria "${type}" non trovato in configurazione.`);

  const generalChannelId = state.data.botSettings?.generalChannelId || '';
  if (!generalChannelId) throw new Error('Canale generale Discord non configurato. Vai in Discord → seleziona "# Canale generale".');

  const ctx = buildReminderContext(state.data, state.teams);
  let finalMessage = resolveReminderPlaceholders(reminder.message, ctx);

  if (!/@everyone\b/i.test(finalMessage)) {
    finalMessage = `@everyone\n\n${finalMessage}`;
  }

  if (!finalMessage.trim()) throw new Error(`Il testo del promemoria "${type}" è vuoto.`);

  await waitReady();
  const channel = await client.channels.fetch(generalChannelId);
  if (!channel || typeof channel.send !== 'function') throw new Error('Canale generale Discord non valido o non scrivibile');

  const sent = await channel.send({ content: finalMessage, allowedMentions: { parse: ['everyone'] } });

  if (!options.skipMark) {
    state.data = markReminderSent(state.data, type);
  }

  return { ok: true, type, channelId: generalChannelId, messageId: sent.id };
}

function isReminderDueNow(reminder, currentState) {
  if (!reminder.enabled) return false;
  const allowedStates = REMINDER_STATE_RULES[reminder._type] || [];
  if (!allowedStates.includes(currentState)) return false;
  if (!reminder.lastSentAt) return true;
  const last = Date.parse(reminder.lastSentAt);
  if (!Number.isFinite(last)) return true;
  const intervalMs = Math.max(1, Number(reminder.intervalHours || 12)) * 60 * 60 * 1000;
  return (Date.now() - last) >= intervalMs;
}

let reminderTickInProgress = false;
let reminderTickHandle = null;

async function automaticReminderTick() {
  if (reminderTickInProgress) return;
  reminderTickInProgress = true;
  try {
    refreshStateFromDisk();
    const config = state.data.automaticReminders;
    if (!config || !config.masterEnabled) return;
    const currentState = state.data.tournamentLifecycle?.state || 'bozza';
    const generalChannelId = state.data.botSettings?.generalChannelId || '';
    if (!generalChannelId) return;
    for (const type of REMINDER_TYPES) {
      const reminder = config.reminders[type];
      if (!reminder) continue;
      reminder._type = type;
      if (!isReminderDueNow(reminder, currentState)) continue;
      try {
        await sendAutomaticReminder(type);
        console.log(`[reminders] inviato promemoria "${type}" su Discord`);
      } catch (err) {
        console.error(`[reminders] errore invio "${type}":`, err.message || err);
      }
    }
  } catch (err) {
    console.error('[reminders] tick error:', err);
  } finally {
    reminderTickInProgress = false;
  }
}

function startAutomaticReminderScheduler() {
  if (reminderTickHandle) return;
  setTimeout(() => {
    automaticReminderTick().catch(err => console.error('[reminders] first tick error:', err));
  }, 30 * 1000);
  reminderTickHandle = setInterval(() => {
    automaticReminderTick().catch(err => console.error('[reminders] tick error:', err));
  }, 60 * 1000);
  console.log('[reminders] scheduler avviato (tick ogni 60s)');
}

async function sendMessageToChannel(channelId, message) {
  await waitReady();
  const cleanChannelId = sanitizeText(channelId);
  const cleanMessage = sanitizeText(message);
  if (!cleanChannelId) throw new Error('ID canale non valido');
  if (!cleanMessage) throw new Error('Messaggio vuoto');
  const channel = await client.channels.fetch(cleanChannelId);
  if (!channel || typeof channel.send !== 'function') throw new Error('Canale non valido o non scrivibile');
  const sent = await channel.send({ content: cleanMessage });
  return { ok: true, messageId: sent.id, channelId: cleanChannelId };
}

async function sendGeneralAnnouncement(channelId, message) {
  return sendMessageToChannel(channelId, message);
}

module.exports = {
  resolveReminderPlaceholders,
  buildReminderContext,
  sendAutomaticReminder,
  isReminderDueNow,
  automaticReminderTick,
  startAutomaticReminderScheduler,
  sendMessageToChannel,
  sendGeneralAnnouncement
};
