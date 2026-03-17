const {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  EmbedBuilder
} = require('discord.js');

const fs = require('fs');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates
  ],
  partials: [Partials.Channel]
});

// CONFIG
const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = "1442509991109066765";

const STAFF_CHANNEL = "1483201939712774145";
const CLASSIFICA_CHANNEL = "1478304828592623777";
const CATEGORY_ID = "1478303649586348165";

const MAX_TEAMS = 16;
const MAX_MATCH = 3;

// LOAD
let teams = {};
let data = {};

try { teams = JSON.parse(fs.readFileSync('./teams.json')); } catch { teams = {}; }
try { data = JSON.parse(fs.readFileSync('./data.json')); } catch { data = {}; }

data.currentMatch ??= 1;
data.results ??= {};
data.pending ??= {};
data.tempSubmit ??= {};
data.scores ??= {};
data.fragger ??= {};

// SAVE
function save() {
  fs.writeFileSync('./teams.json', JSON.stringify(teams, null, 2));
  fs.writeFileSync('./data.json', JSON.stringify(data, null, 2));
}

// POINTS
function calcPoints(pos, kills) {
  const table = {1:15,2:12,3:10,4:8,5:6,6:4,7:2};
  return (table[pos] || 0) + kills;
}

// LEADERBOARD
async function updateLeaderboard() {
  try {
    const channel = await client.channels.fetch(CLASSIFICA_CHANNEL);

    const sorted = Object.entries(data.scores).sort((a,b)=>b[1]-a[1]);
    let desc = sorted.map((t,i)=>`#${i+1} ${t[0]} - ${t[1]} pts`).join("\n");

    const frag = Object.entries(data.fragger)
      .sort((a,b)=>b[1]-a[1])
      .slice(0,5)
      .map(f=>`${f[0]} (${f[1]})`)
      .join("\n");

    const embed = new EmbedBuilder()
      .setTitle(`🏆 CLASSIFICA MATCH ${data.currentMatch}`)
      .setDescription(desc || "Nessun dato")
      .addFields({ name: "🔥 Top Fragger", value: frag || "Nessuno" });

    const msgs = await channel.messages.fetch({ limit: 5 });
    for (let m of msgs.values()) {
      try { await m.delete(); } catch {}
    }

    await channel.send({ embeds: [embed] });

  } catch (e) {
    console.log(e);
  }
}

// COMMANDS
const commands = [
  new SlashCommandBuilder()
    .setName('register_team')
    .setDescription('Registra team')
    .addStringOption(o=>o.setName('team').setDescription('Nome team').setRequired(true))
    .addStringOption(o=>o.setName('p1').setDescription('Player 1').setRequired(true))
    .addStringOption(o=>o.setName('p2').setDescription('Player 2').setRequired(true))
    .addStringOption(o=>o.setName('p3').setDescription('Player 3').setRequired(true)),

  new SlashCommandBuilder()
    .setName('panel_results')
    .setDescription('Invia risultati'),

  new SlashCommandBuilder()
    .setName('crea_stanze')
    .setDescription('Crea vocali'),

  new SlashCommandBuilder()
    .setName('delete_rooms')
    .setDescription('Elimina vocali'),

  new SlashCommandBuilder()
    .setName('next_match')
    .setDescription('Prossimo match'),

  new SlashCommandBuilder()
    .setName('reset_storico')
    .setDescription('Reset torneo')
].map(c => c.toJSON());

// REGISTER
const rest = new REST({ version: '10' }).setToken(TOKEN);
(async () => {
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
})();

// READY
client.once('ready', () => {
  console.log(`ONLINE ${client.user.tag}`);
});

// INTERACTIONS
client.on('interactionCreate', async interaction => {
  try {

    if (interaction.isChatInputCommand()) {

      await interaction.deferReply();

      if (interaction.commandName === 'panel_results') {

        if (Object.keys(teams).length === 0) {
          return interaction.editReply("❌ Nessun team registrato");
        }

        const menu = new StringSelectMenuBuilder()
          .setCustomId('team_select')
          .setPlaceholder('Scegli team')
          .addOptions(
            Object.keys(teams).map(t => ({
              label: t,
              value: t
            }))
          );

        return interaction.editReply({
          content: `📊 MATCH ${data.currentMatch}`,
          components: [new ActionRowBuilder().addComponents(menu)]
        });
      }

      if (interaction.commandName === 'register_team') {
        const team = interaction.options.getString('team');

        teams[team] = {
          players: [
            interaction.options.getString('p1'),
            interaction.options.getString('p2'),
            interaction.options.getString('p3')
          ]
        };

        save();
        return interaction.editReply("✅ Team registrato");
      }

      if (interaction.commandName === 'crea_stanze') {
        let i = 1;
        for (let t in teams) {
          await interaction.guild.channels.create({
            name: `🏆・${i} ${t}`,
            type: 2,
            parent: CATEGORY_ID
          });
          i++;
        }
        return interaction.editReply("✅ Stanze create");
      }

      if (interaction.commandName === 'delete_rooms') {
        const channels = interaction.guild.channels.cache.filter(c =>
          c.parentId === CATEGORY_ID &&
          c.type === 2 &&
          c.name.startsWith("🏆・")
        );

        for (let ch of channels.values()) {
          try { await ch.delete(); } catch {}
        }

        return interaction.editReply("🗑️ Vocali eliminate");
      }

      if (interaction.commandName === 'next_match') {
        data.currentMatch++;
        save();
        return interaction.editReply(`➡️ MATCH ${data.currentMatch}`);
      }

      if (interaction.commandName === 'reset_storico') {
        data = { currentMatch:1, results:{}, pending:{}, tempSubmit:{}, scores:{}, fragger:{} };
        save();
        return interaction.editReply("♻️ RESET COMPLETO");
      }
    }

    if (interaction.isStringSelectMenu()) {
      const team = interaction.values[0];

      const modal = new ModalBuilder()
        .setCustomId(`modal_${team}`)
        .setTitle(`Risultato ${team}`);

      teams[team].players.forEach((p,i)=>{
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId(`k${i}`)
              .setLabel(`${p} kills`)
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
          )
        );
      });

      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("pos")
            .setLabel("Posizione")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
        )
      );

      return interaction.showModal(modal);
    }

    if (interaction.isModalSubmit()) {
      const team = interaction.customId.split("_")[1];

      let kills = [];
      let total = 0;

      for (let i=0;i<3;i++) {
        let k = parseInt(interaction.fields.getTextInputValue(`k${i}`)) || 0;
        kills.push(k);
        total += k;
      }

      let pos = parseInt(interaction.fields.getTextInputValue("pos")) || 0;

      data.tempSubmit[interaction.user.id] = { team, kills, total, pos };
      save();

      return interaction.reply({
        content: "📸 Invia lo screenshot",
        ephemeral: true
      });
    }

  } catch (err) {
    console.log("ERRORE:", err);
  }
});

client.login(TOKEN);
