const { 
Client, 
GatewayIntentBits, 
SlashCommandBuilder, 
REST, 
Routes,
ActionRowBuilder,
ButtonBuilder,
ButtonStyle
} = require('discord.js');

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

    await rest.put(
      Routes.applicationGuildCommands(client.user.id, "1442509991109066765"),
      { body: commands },
    );

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

  // comando slash
  if (interaction.isChatInputCommand()) {

    if (interaction.commandName === 'setup') {

      const button = new ButtonBuilder()
        .setCustomId('register_team')
        .setLabel('REGISTRA TEAM')
        .setStyle(ButtonStyle.Primary);

      const row = new ActionRowBuilder()
        .addComponents(button);

      await interaction.reply({
        content: "🏆 **RØDA CUP**\n\nPremi il bottone qui sotto per registrare il tuo team.",
        components: [row]
      });

    }

  }

  // bottone registrazione
  if (interaction.isButton()) {

    if (interaction.customId === "register_team") {

      await interaction.reply({
        content: "📋 Sistema registrazione in arrivo...",
        ephemeral: true
      });

    }

  }

});

client.login(process.env.TOKEN);
