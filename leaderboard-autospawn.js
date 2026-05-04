'use strict';

const { AttachmentBuilder, ChannelType } = require('discord.js');

function clean(value) {
  return String(value || '').trim();
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

  const preferred = textChannels.find(channel => /classifica|leaderboard|risultati|fragger|score/i.test(channel.name || ''));
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

async function sendOrEdit(channel, messageId, content, fileName, buffer) {
  const attachment = new AttachmentBuilder(buffer, { name: fileName });

  if (messageId) {
    try {
      const existing = await channel.messages.fetch(messageId);
      await existing.edit({ content, embeds: [], components: [], files: [attachment] });
      console.log(`[classifica] messaggio aggiornato: ${content} (${existing.id})`);
      return existing.id;
    } catch (error) {
      console.warn(`[classifica] non riesco ad aggiornare messaggio ${messageId}, ne creo uno nuovo: ${error.message}`);
    }
  }

  const sent = await channel.send({ content, files: [attachment] });
  console.log(`[classifica] messaggio creato: ${content} (${sent.id})`);
  return sent.id;
}

async function directSpawnOfficialGraphics(client, reason = 'manual') {
  const state = require('./bot/state');
  const lifecycle = require('./bot/lifecycle');
  const renderer = require('./renderer');

  if (!client || !client.isReady || !client.isReady()) {
    throw new Error('Client Discord non pronto per spawnare le grafiche.');
  }

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
    leaderboardBuffer
  );

  state.data.topFraggerGraphicMessageId = await sendOrEdit(
    channel,
    state.data.topFraggerGraphicMessageId,
    `🔥 **TOP FRAGGER** • Match ${matchNumber}`,
    `top-fragger-output-match-${matchNumber}-${stamp}.png`,
    fraggerBuffer
  );

  state.data.leaderboardMessageId = null;
  if (typeof lifecycle.saveState === 'function') lifecycle.saveState();

  console.log('[classifica] direct spawn completato con successo');
  return {
    ok: true,
    channelId: channel.id,
    leaderboardGraphicMessageId: state.data.leaderboardGraphicMessageId,
    topFraggerGraphicMessageId: state.data.topFraggerGraphicMessageId
  };
}

function installAutoSpawnPatch() {
  try {
    const discord = require('discord.js');
    const Client = discord.Client;

    if (!Client || !Client.prototype || Client.prototype.__rodaLeaderboardAutoSpawnPatched) return;

    const originalEmit = Client.prototype.emit;
    Client.prototype.emit = function rodaLeaderboardAutoSpawnEmit(eventName, ...args) {
      const result = originalEmit.call(this, eventName, ...args);

      if (eventName === 'ready' && !this.__rodaLeaderboardAutoSpawnStarted) {
        Object.defineProperty(this, '__rodaLeaderboardAutoSpawnStarted', { value: true, enumerable: false });
        setTimeout(() => {
          directSpawnOfficialGraphics(this, 'bot_ready_patch').catch(error => {
            console.error('[classifica] direct spawn fallito:', error && error.stack ? error.stack : error);
          });
        }, 3500);
      }

      return result;
    };

    Object.defineProperty(Client.prototype, '__rodaLeaderboardAutoSpawnPatched', { value: true, enumerable: false });
    console.log('✅ Direct auto-spawn classifiche Discord installato.');
  } catch (error) {
    console.error('[classifica] impossibile installare direct auto-spawn:', error.message);
  }
}

installAutoSpawnPatch();

module.exports = {
  directSpawnOfficialGraphics,
  installAutoSpawnPatch
};
