const { Client, GatewayIntentBits } = require('discord.js');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

client.once('ready', () => {
  console.log('RØDA BOT ONLINE');
});

client.on('messageCreate', message => {
  if (message.content === "!ping") {
    message.reply("🏓 Pong! Il bot funziona.");
  }
});

client.login(process.env.TOKEN);
