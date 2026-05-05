'use strict';

const Module = require('module');
const { AttachmentBuilder, ChannelType } = require('discord.js');

function clean(value) {
  return String(value || '').trim();
}

function now() {
  return Date.now();
}

function markSpawnStarted(reason) {
  const current = now();
  if (global.__rodaLeaderboardSpawnRunning) {
    console.log(`[classifica] spawn saltato (${reason}): uno spawn è già in corso`);
    return false;
  }
  if (global.__rodaLeaderboardLastSpawnAt && current - global.__rodaLeaderboardLastSpawnAt < 30000) {
    console.log(`[classifica] spawn saltato (${reason}): già eseguito da meno di 30s`);
    return false;
  }
  global.__rodaLeaderboardSpawnRunning = true;
  global.__rodaLeaderboardLastSpawnAt = current;
  return true;
}

function markSpawnFinished() {
  global.__rodaLeaderboardSpawnRunning = false;
}

function isClientModuleRequest(request) {
  return typeof request === 'string' && (
    request === './bot/client' ||
    request === './client' ||
    request.endsWith('/bot/client') ||
    request.endsWith('bot/client.js')
  );
}

async function fetchMessagesDeep(channel, maxMessages = 600) {
  const collected = [];
  let before;
  while (collected.length < maxMessages) {
    const limit = Math.min(100, maxMessages - collected.length);
    const batch = await channel.messages.fetch(before ? { limit, before } : { limit }).catch(error => {
      console.warn(`[classifica] fetch messaggi fallito: ${error.message}`);
      return null;
    });
    if (!batch || batch.size === 0) break;
    const values = [...batch.values()];
    collected.push(...values);
    before = values[values.length - 1]?.id;
    if (!before || batch.size < limit) break;
  }
  return collected;
}

function newestFirst(messages) {
  return messages.sort((a, b) => {
    try {
      const aa = BigInt(a.id);
      const bb = BigInt(b.id);
      return aa === bb ? 0 : aa > bb ? -1 : 1;
    } catch {
      return String(b.id).localeCompare(String(a.id));
    }
  });
}

function officialGraphicTypeFromMessage(message) {
  const content = clean(message?.content).toLowerCase();
  const embedText = (message?.embeds || []).map(embed => [embed.title, embed.description, embed.footer?.text].filter(Boolean).join(' ')).join(' ').toLowerCase();
  const fileText = [...(message?.attachments?.values?.() || [])].map(att => clean(att.name || att.url).toLowerCase()).join(' ');
  const all = `${content}\n${embedText}\n${fileText}`;
  if (all.includes('classifica live') || all.includes('classifica-live') || all.includes('leaderboard')) return 'leaderboard';
  if (all.includes('top fragger') || all.includes('top-fragger')) return 'fragger';
  return '';
}

async function findOfficialGraphicMessages(channel, type) {
  const messages = await fetchMessagesDeep(channel, 800);
  return newestFirst(messages.filter(message => {
    if (!message?.author?.bot) return false;
    return officialGraphicTypeFromMessage(message) === type;
  }));
}

async function deleteDuplicateOfficialMessages(messages, keepId, type) {
  for (const message of messages) {
    if (!message || message.id === keepId) continue;
    try {
      await message.delete();
      console.log(`[classifica] duplicato ${type} eliminato: ${message.id}`);
    } catch (error) {
      console.warn(`[classifica] non posso eliminare duplicato ${type} (${message.id}): ${error.message}`);
    }
  }
}

async function findWritableLeaderboardChannel(client) {
  const state = require('./bot/state');
  const config = require('./bot/config');

  const candidates = [
    clean(state?.data?.botSettings?.leaderboardChannelId),
    clean(config.CLASSIFICA_CHANNEL),
    clean(process.env.CLASSIFICA_CHANNEL),
    clean(process.env.LEADERBOARD_CHANNEL_ID)
  ].filter(Boolean);

  for (const id of candidates) {
    try {
      const channel = await client.channels.fetch(id);
      if (channel && typeof channel.send === 'function') {
        console.log(`[classifica] canale trovato da ID: ${channel.name || channel.id} (${channel.id})`);
        return channel;
      }
      console.warn(`[classifica] ID canale non testuale/non inviabile: ${id}`);
    } catch (error) {
      console.warn(`[classifica] ID canale non valido/non accessibile: ${id} (${error.message})`);
    }
  }

  const guildId = clean(config.GUILD_ID || process.env.GUILD_ID);
  const guild = guildId ? await client.guilds.fetch(guildId).catch(() => null) : client.guilds.cache.first();
  if (!guild) throw new Error('Guild Discord non trovata per cercare il canale classifica.');

  const channels = await guild.channels.fetch();
  const textChannels = [...channels.values()].filter(channel => {
    if (!channel) return false;
    const isText = channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement;
    return isText && typeof channel.send === 'function';
  });

  const preferred = textChannels.find(channel => /classifica|leaderboard|risultati|fragger|score|torneo/i.test(channel.name || ''));
  if (preferred) {
    console.log(`[classifica] canale trovato per nome: ${preferred.name} (${preferred.id})`);
    try {
      state.data.botSettings = state.data.botSettings || {};
      state.data.botSettings.leaderboardChannelId = preferred.id;
      const lifecycle = require('./bot/lifecycle');
      if (typeof lifecycle.saveState === 'function') lifecycle.saveState();
    } catch {}
    return preferred;
  }

  const names = textChannels.map(channel => `${channel.name}(${channel.id})`).slice(0, 30).join(', ');
  throw new Error(`Canale classifica non trovato. Canali testuali visibili: ${names}`);
}

async function sendOrEdit(channel, messageId, content, fileName, buffer, type) {
  const attachment = new AttachmentBuilder(buffer, { name: fileName });
  let targetMessage = null;
  let matchingMessages = [];

  if (messageId) {
    try {
      targetMessage = await channel.messages.fetch(messageId);
    } catch (error) {
      console.warn(`[classifica] messaggio salvato non valido (${messageId}), cerco nel canale: ${error.message}`);
    }
  }

  matchingMessages = await findOfficialGraphicMessages(channel, type);

  if (!targetMessage && matchingMessages.length) {
    targetMessage = matchingMessages[0];
    console.log(`[classifica] messaggio ${type} recuperato nel canale: ${targetMessage.id}`);
  }

  if (targetMessage) {
    await targetMessage.edit({ content, embeds: [], components: [], files: [attachment] });
    await deleteDuplicateOfficialMessages(matchingMessages, targetMessage.id, type);
    console.log(`[classifica] messaggio aggiornato: ${content} (${targetMessage.id})`);
    return targetMessage.id;
  }

  const sent = await channel.send({ content, files: [attachment] });
  console.log(`[classifica] messaggio creato: ${content} (${sent.id})`);
  return sent.id;
}

async function directSpawnOfficialGraphics(client, reason = 'manual') {
  if (!markSpawnStarted(reason)) return { ok: true, skipped: true, reason: 'spawn_already_running_or_recent' };

  try {
    const state = require('./bot/state');
    const lifecycle = require('./bot/lifecycle');
    const renderer = require('./renderer');

    if (!client) throw new Error('Client Discord mancante.');
    if (typeof client.isReady === 'function' && !client.isReady()) throw new Error('Client Discord non pronto per spawnare le grafiche.');

    if (typeof lifecycle.refreshStateFromDisk === 'function') lifecycle.refreshStateFromDisk();
    if (typeof lifecycle.ensureDataStructures === 'function') lifecycle.ensureDataStructures();

    console.log(`[classifica] direct spawn avviato: ${reason}`);

    const channel = await findWritableLeaderboardChannel(client);
    const matchNumber = Number(state?.data?.currentMatch || 1);
    const stamp = Date.now();

    console.log('[classifica] genero immagine classifica ufficiale...');
    const leaderboardBuffer = await renderer.generateLeaderboardGraphicBuffer();
    console.log(`[classifica] classifica generata: ${leaderboardBuffer?.length || 0} bytes`);

    console.log('[classifica] genero immagine top fragger ufficiale...');
    const fraggerBuffer = await renderer.generateTopFraggerGraphicBuffer();
    console.log(`[classifica] top fragger generata: ${fraggerBuffer?.length || 0} bytes`);

    if (!leaderboardBuffer || !leaderboardBuffer.length) throw new Error('Buffer classifica vuoto.');
    if (!fraggerBuffer || !fraggerBuffer.length) throw new Error('Buffer top fragger vuoto.');

    state.data.leaderboardGraphicMessageId = await sendOrEdit(
      channel,
      state.data.leaderboardGraphicMessageId,
      `🏆 **CLASSIFICA LIVE** • Match ${matchNumber}`,
      `classifica-live-output-match-${matchNumber}-${stamp}.png`,
      leaderboardBuffer,
      'leaderboard'
    );

    state.data.topFraggerGraphicMessageId = await sendOrEdit(
      channel,
      state.data.topFraggerGraphicMessageId,
      `🔥 **TOP FRAGGER** • Match ${matchNumber}`,
      `top-fragger-output-match-${matchNumber}-${stamp}.png`,
      fraggerBuffer,
      'fragger'
    );

    state.data.leaderboardMessageId = null;
    state.data.botSettings = state.data.botSettings || {};
    state.data.botSettings.leaderboardChannelId = channel.id;
    if (typeof lifecycle.saveState === 'function') lifecycle.saveState();

    console.log('[classifica] direct spawn completato con successo');
    return {
      ok: true,
      channelId: channel.id,
      leaderboardGraphicMessageId: state.data.leaderboardGraphicMessageId,
      topFraggerGraphicMessageId: state.data.topFraggerGraphicMessageId
    };
  } finally {
    markSpawnFinished();
  }
}

function attachReadySpawn(client, source) {
  if (!client || client.__rodaLeaderboardSpawnAttached) return;
  Object.defineProperty(client, '__rodaLeaderboardSpawnAttached', { value: true, enumerable: false });
  console.log(`[classifica] hook client Discord agganciato da ${source}`);

  const run = reason => {
    setTimeout(() => {
      directSpawnOfficialGraphics(client, reason).catch(error => {
        console.error('[classifica] direct spawn fallito:', error && error.stack ? error.stack : error);
      });
    }, 5000);
  };

  if (typeof client.isReady === 'function' && client.isReady()) {
    run(`${source}_already_ready`);
    return;
  }

  if (typeof client.once === 'function') client.once('ready', () => run(`${source}_ready`));
}

function installClientModuleHook() {
  if (global.__rodaLeaderboardClientModuleHookInstalled) return;
  global.__rodaLeaderboardClientModuleHookInstalled = true;
  const originalLoad = Module._load;

  Module._load = function rodaLeaderboardClientLoad(request, parent, isMain) {
    const loaded = originalLoad.apply(this, arguments);
    if (isClientModuleRequest(request)) {
      try { attachReadySpawn(loaded?.client, `module:${request}`); }
      catch (error) { console.error('[classifica] errore hook bot/client:', error.message); }
    }
    return loaded;
  };

  console.log('✅ Hook diretto bot/client per classifiche installato.');
}

function installDiscordEmitPatch() {
  try {
    const discord = require('discord.js');
    const Client = discord.Client;
    if (!Client || !Client.prototype || Client.prototype.__rodaLeaderboardAutoSpawnPatched) return;

    const originalEmit = Client.prototype.emit;
    Client.prototype.emit = function rodaLeaderboardAutoSpawnEmit(eventName, ...args) {
      const result = originalEmit.call(this, eventName, ...args);
      if (eventName === 'ready') attachReadySpawn(this, 'discord_emit_patch');
      return result;
    };

    Object.defineProperty(Client.prototype, '__rodaLeaderboardAutoSpawnPatched', { value: true, enumerable: false });
    console.log('✅ Direct auto-spawn classifiche Discord installato.');
  } catch (error) {
    console.error('[classifica] impossibile installare direct auto-spawn:', error.message);
  }
}

installClientModuleHook();
installDiscordEmitPatch();

module.exports = {
  directSpawnOfficialGraphics,
  attachReadySpawn,
  installClientModuleHook,
  installDiscordEmitPatch
};
