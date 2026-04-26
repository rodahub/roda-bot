const {
  Client,
  GatewayIntentBits,
  Partials
} = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates
  ],
  partials: [Partials.Channel]
});

let readyResolver;
const readyPromise = new Promise(resolve => {
  readyResolver = resolve;
});

async function waitReady() {
  await readyPromise;
  return client;
}

module.exports = { client, readyPromise, readyResolver: () => readyResolver, waitReady };
