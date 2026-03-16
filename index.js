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
TextInputStyle,
ChannelType
} = require('discord.js');

const fs = require("fs");

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const MAX_TEAMS = 16;

const CATEGORY_ID = "1478303649586348165";

let teams = [];

function loadTeams() {
  if (fs.existsSync("teams.json")) {
    teams = JSON.parse(fs.readFileSync("teams.json"));
  }
}

function saveTeams() {
  fs.writeFileSync("teams.json", JSON.stringify(teams, null, 2));
}

const commands = [

  new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Crea il pannello registrazione RØDA CUP'),

  new SlashCommandBuilder()
    .setName('create_rooms')
    .setDescription('Crea le stanze vocali dei team'),

  new SlashCommandBuilder()
    .setName('lobbycode')
    .setDescription('Invia il codice lobby a tutti i team')
    .addStringOption(option =>
      option.setName('codice')
      .setDescription('Codice lobby Warzone')
      .setRequired(true)
    )

].map(command => command.toJSON());

client.once('ready', async () => {

  console.log("RØDA BOT ONLINE");

  loadTeams();

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

    if (interaction.commandName === "create_rooms") {

      const guild = interaction.guild;

      for (const team of teams) {

        const roomName = `🏆・${team.slot}・${team.teamName}`;

        await guild.channels.create({
          name: roomName,
          type: ChannelType.GuildVoice,
          parent: CATEGORY_ID,
          userLimit: 3
        });

      }

      await interaction.reply({
        content: "✅ Stanze vocali create!",
        ephemeral: true
      });

    }

    if (interaction.commandName === "lobbycode") {

      const code = interaction.options.getString("codice");

      const guild = interaction.guild;

      const category = guild.channels.cache.get(CATEGORY_ID);

      const channels = guild.channels.cache.filter(
        c => c.parentId === CATEGORY_ID && c.type === ChannelType.GuildVoice
      );

      for (const channel of channels.values()) {

        await channel.send(
`🏆 **RØDA CUP**

🎮 **CODICE LOBBY**

\`${code}\`

Entrate subito nella partita.`
        );

      }

      await interaction.reply({
        content: "✅ Codice lobby inviato a tutti i team.",
        ephemeral: true
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

      const team = {
        slot,
        teamName,
        player1,
        player2,
        player3
      };

      teams.push(team);

      saveTeams();

      await interaction.reply({
        content: `✅ Team registrato!\n\n🏷 Team: **${teamName}**\n🎯 Slot: **${slot}**`,
        ephemeral: true
      });

    }

  }

});

client.login(process.env.TOKEN);
