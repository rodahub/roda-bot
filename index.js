const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes } = require('discord.js');

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const commands = [
  new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Crea il pannello di registrazione RØDA CUP')
].map(command => command.toJSON());

client.once('ready', async () => {
  console.log('RØDA BOT ONLINE');

  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

  try {

    // registra il comando SOLO nel tuo server
    await rest.put(
      Routes.applicationGuildCommands(client.user.id, "1442509991109066765"),
      { body: commands },
    );

    // cancella eventuali comandi globali duplicati
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: [] },
    );

    console.log('Slash command registrato');

  } catch (error) {
    console.error(error);
  }
});

client.on('interactionCreate', async interaction => {

  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'setup') {
    await interaction.reply("🏆 Pannello registrazione RØDA CUP creato!");
  }

});

client.login(process.env.TOKEN);
