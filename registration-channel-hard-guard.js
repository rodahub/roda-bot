'use strict';

/**
 * Emergency hard guard: registration panel can never be sent in #team/private channels.
 * If any code tries to send the register_btn panel outside a real iscrizioni channel,
 * this guard reroutes it to the channel whose name contains "iscrizioni" and removes
 * the wrong copy.
 */

const { TextChannel, NewsChannel, ThreadChannel } = require('discord.js');

function clean(value) { return String(value || '').trim(); }
function lower(value) { return clean(value).toLowerCase(); }

function payloadHasRegisterButton(payload) {
  const rows = Array.isArray(payload?.components) ? payload.components : [];
  return rows.some(row => {
    const components = Array.isArray(row?.components) ? row.components : [];
    return components.some(component => clean(component?.data?.custom_id || component?.customId || component?.custom_id) === 'register_btn');
  });
}

function messageLooksLikeRegistrationPanel(message) {
  if (!message?.author?.bot) return false;
  const hasButton = (message.components || []).some(row =>
    (row.components || []).some(component => clean(component.customId || component.custom_id) === 'register_btn')
  );
  if (hasButton) return true;
  const text = [
    clean(message.content),
    ...(message.embeds || []).map(embed => [embed.title, embed.description, embed.footer?.text].filter(Boolean).join(' '))
  ].join(' ').toLowerCase();
  return text.includes('pannello iscrizioni') || (text.includes('røda cup') && text.includes('iscrizioni'));
}

function isOfficialIscrizioniChannel(channel) {
  const name = lower(channel?.name);
  return Boolean(channel && typeof channel.send === 'function' && name.includes('iscrizion'));
}

function isWrongForRegistrationPanel(channel) {
  if (!channel) return true;
  if (isOfficialIscrizioniChannel(channel)) return false;
  const name = lower(channel.name);
  return name.includes('team') || name.includes('privat') || name.includes('operativ') || name.includes('risultat') || !name.includes('iscrizion');
}

async function fetchOfficialChannel(guild, currentChannel) {
  if (isOfficialIscrizioniChannel(currentChannel)) return currentChannel;

  await guild.channels.fetch().catch(() => null);
  const channels = [...guild.channels.cache.values()].filter(channel => isOfficialIscrizioniChannel(channel));
  const exact = channels.find(channel => lower(channel.name) === '📝・iscrizioni' || lower(channel.name) === 'iscrizioni');
  return exact || channels[0] || null;
}

async function findExistingRegistrationPanel(channel) {
  const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  if (!messages) return null;
  for (const message of messages.values()) {
    if (messageLooksLikeRegistrationPanel(message)) return message;
  }
  return null;
}

async function cleanupWrongRegistrationPanels(channel) {
  if (!channel || typeof channel.messages?.fetch !== 'function') return 0;
  const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  if (!messages) return 0;
  let deleted = 0;
  for (const message of messages.values()) {
    if (!messageLooksLikeRegistrationPanel(message)) continue;
    await message.delete().then(() => { deleted += 1; }).catch(() => null);
  }
  if (deleted) console.log(`[registration-hard-guard] rimossi ${deleted} pannelli iscrizioni da #${channel.name}`);
  return deleted;
}

async function rerouteRegistrationPayload(sourceChannel, payload, originalSend) {
  const guild = sourceChannel?.guild;
  if (!guild) return originalSend.call(sourceChannel, payload);

  const target = await fetchOfficialChannel(guild, sourceChannel);
  if (!target) {
    console.error(`[registration-hard-guard] canale iscrizioni ufficiale non trovato. Blocco invio in #${sourceChannel?.name || sourceChannel?.id}`);
    return { id: 'blocked-registration-panel', edit: async () => null, delete: async () => null };
  }

  if (sourceChannel.id !== target.id) {
    await cleanupWrongRegistrationPanels(sourceChannel).catch(() => null);
    console.log(`[registration-hard-guard] pannello iscrizioni reindirizzato da #${sourceChannel.name} a #${target.name}`);
  }

  const existing = await findExistingRegistrationPanel(target).catch(() => null);
  if (existing) return existing.edit(payload);
  return originalSend.call(target, payload);
}

function patchSend(proto, label) {
  if (!proto || proto.__rodaRegistrationHardGuardPatched || typeof proto.send !== 'function') return;
  const originalSend = proto.send;
  proto.send = function guardedSend(payload, ...rest) {
    if (payloadHasRegisterButton(payload) && isWrongForRegistrationPanel(this)) {
      return rerouteRegistrationPayload(this, payload, originalSend);
    }
    return originalSend.call(this, payload, ...rest);
  };
  Object.defineProperty(proto, '__rodaRegistrationHardGuardPatched', { value: true, enumerable: false });
  console.log(`✅ Hard guard pannello iscrizioni installato su ${label}.`);
}

function installReadyCleanup() {
  try {
    const discord = require('discord.js');
    const Client = discord.Client;
    if (!Client?.prototype || Client.prototype.__rodaRegistrationHardGuardReadyPatched) return;
    const originalEmit = Client.prototype.emit;
    Client.prototype.emit = function guardedEmit(eventName, ...args) {
      const result = originalEmit.call(this, eventName, ...args);
      if (eventName === 'ready') {
        setTimeout(async () => {
          try {
            for (const guild of this.guilds.cache.values()) {
              await guild.channels.fetch().catch(() => null);
              for (const channel of guild.channels.cache.values()) {
                if (isWrongForRegistrationPanel(channel)) await cleanupWrongRegistrationPanels(channel).catch(() => null);
              }
            }
          } catch (error) {
            console.error('[registration-hard-guard] cleanup ready fallito:', error.message);
          }
        }, 8000);
      }
      return result;
    };
    Object.defineProperty(Client.prototype, '__rodaRegistrationHardGuardReadyPatched', { value: true, enumerable: false });
  } catch (error) {
    console.error('[registration-hard-guard] ready patch fallita:', error.message);
  }
}

function install() {
  patchSend(TextChannel?.prototype, 'TextChannel');
  patchSend(NewsChannel?.prototype, 'NewsChannel');
  patchSend(ThreadChannel?.prototype, 'ThreadChannel');
  installReadyCleanup();
  console.log('✅ Hard guard canale iscrizioni attivo: il pannello non può più spawnare in #team.');
}

install();

module.exports = { install };
