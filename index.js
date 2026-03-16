const { 
Client,
GatewayIntentBits,
SlashCommandBuilder,
REST,
Routes,
ActionRowBuilder,
ButtonBuilder,
ButtonStyle,
ModalBuilder,
TextInputBuilder,
TextInputStyle
} = require('discord.js');

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

// lista team registrati
let teams = [];

const MAX_TEAMS = 16;

const commands = [
  new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Crea il pannello registrazione RØDA CUP')
].map(command => command.toJSON());

client.once('ready', async () => {

  console.log("RØDA BOT ONLINE");

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

    console.log("Slash command registrato");

  } catch (error) {
    console.error(error);
  }

});

client.on('interactionCreate', async interaction => {

  if (interaction.isChatInputCommand()) {

    if (interaction.commandName === "setup") {

      const button = new ButtonBuilder()
        .setCustomId("register_team")
        .setLabel("REGISTRA TEAM")
        .setStyle(ButtonStyle.Success);

      const row = new ActionRowBuilder().addComponents(button);

      await interaction.reply({
        content: "🏆 **RØDA CUP**\n\nPremi il bottone per registrare il tuo team.",
        components: [row]
      });

    }

  }

  if (interaction.isButton()) {

    if (interaction.customId === "register_team") {

      if (teams.length >= MAX_TEAMS) {

        await interaction.reply({
          content: "❌ Gli slot del torneo sono pieni.",
          ephemeral: true
        });

        return;
      }

      const modal = new ModalBuilder()
        .setCustomId("team_registration")
        .setTitle("Registrazione Team");

      const teamName = new TextInputBuilder()
        .setCustomId("team_name")
        .setLabel("Nome Team")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const player1 = new TextInputBuilder()
        .setCustomId("player1")
        .setLabel("Player 1 (Capitano)")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const player2 = new TextInputBuilder()
        .setCustomId("player2")
        .setLabel("Player 2")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const player3 = new TextInputBuilder()
        .setCustomId("player3")
        .setLabel("Player 3")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const row1 = new ActionRowBuilder().addComponents(teamName);
      const row2 = new ActionRowBuilder().addComponents(player1);
      const row3 = new ActionRowBuilder().addComponents(player2);
      const row4 = new ActionRowBuilder().addComponents(player3);

      modal.addComponents(row1,row2,row3,row4);

      await interaction.showModal(modal);

    }

  }

  if (interaction.isModalSubmit()) {

    if (interaction.customId === "team_registration") {

      const teamName = interaction.fields.getTextInputValue("team_name");
      const player1 = interaction.fields.getTextInputValue("player1");
      const player2 = interaction.fields.getTextInputValue("player2");
      const player3 = interaction.fields.getTextInputValue("player3");

      const slot = teams.length + 1;

      teams.push({
        slot,
        teamName,
        player1,
        player2,
        player3
      });

      await interaction.reply({
        content: `✅ Team registrato!\n\n🏷 Team: **${teamName}**\n🎯 Slot: **${slot}**\n\n👤 ${player1}\n👤 ${player2}\n👤 ${player3}`,
        ephemeral: true
      });

    }

  }

});

client.login(process.env.TOKEN);
