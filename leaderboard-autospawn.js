'use strict';

/**
 * Forces the official CLASSIFICA LIVE and TOP FRAGGER graphics to spawn after
 * the Discord client is ready, independently from slower panel refresh flows.
 */

try {
  const discord = require('discord.js');
  const Client = discord.Client;

  if (Client && Client.prototype && !Client.prototype.__rodaLeaderboardAutoSpawnPatched) {
    const originalEmit = Client.prototype.emit;

    Client.prototype.emit = function rodaLeaderboardAutoSpawnEmit(eventName, ...args) {
      const result = originalEmit.call(this, eventName, ...args);

      if (eventName === 'ready' && !this.__rodaLeaderboardAutoSpawnStarted) {
        Object.defineProperty(this, '__rodaLeaderboardAutoSpawnStarted', {
          value: true,
          enumerable: false
        });

        setTimeout(async () => {
          try {
            console.log('[classifica] auto-spawn grafiche ufficiali avviato');
            const panels = require('./bot/panels');

            if (!panels || typeof panels.updateLeaderboard !== 'function') {
              console.error('[classifica] updateLeaderboard non disponibile');
              return;
            }

            const output = await panels.updateLeaderboard({ allowCreate: true, force: true });
            console.log('[classifica] auto-spawn grafiche ufficiali completato:', JSON.stringify(output));
          } catch (error) {
            console.error('[classifica] auto-spawn grafiche ufficiali fallito:', error && error.stack ? error.stack : error);
          }
        }, 3500);
      }

      return result;
    };

    Object.defineProperty(Client.prototype, '__rodaLeaderboardAutoSpawnPatched', {
      value: true,
      enumerable: false
    });

    console.log('✅ Auto-spawn classifiche Discord installato.');
  }
} catch (error) {
  console.error('[classifica] impossibile installare auto-spawn:', error.message);
}
