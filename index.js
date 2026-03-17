const { Client, GatewayIntentBits, Partials, REST, Routes, SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder } = require('discord.js');
const fs = require('fs');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
  partials: [Partials.Channel]
});

// ===== CONFIG =====
const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = "1442509991109066765";

const STAFF_CHANNEL = "1483201939712774145";
const CALCOLO_CHANNEL = "1478305525111193725";
const CLASSIFICA_CHANNEL = "1478304828592623777";
const CATEGORY_ID = "1478303649586348165";

const MAX_TEAMS = 16;
const MAX_MATCH = 3;

// ===== DATABASE =====
let teams = JSON.parse(fs.readFileSync('./teams.json', 'utf8'));
let data = JSON.parse(fs.readFileSync('./data.json', 'utf8'));

if (!data.currentMatch) data.currentMatch = 1;
if (!data.results) data.results = {};
if (!data.scores) data.scores = {};
if (!data.fragger) data.fragger = {};

// ===== COMMANDS =====
const commands = [
  new SlashCommandBuilder().setName('register_team').setDescription('Registra team')
    .addStringOption(o=>o.setName('team').setRequired(true))
    .addStringOption(o=>o.setName('p1').setRequired(true))
    .addStringOption(o=>o.setName('p2').setRequired(true))
    .addStringOption(o=>o.setName('p3').setRequired(true)),

  new SlashCommandBuilder().setName('crea_stanze').setDescription('Crea vocali'),

  new SlashCommandBuilder().setName('delete_rooms').setDescription('Cancella vocali'),

  new SlashCommandBuilder().setName('panel_results').setDescription('Pannello risultati'),

  new SlashCommandBuilder().setName('next_match').setDescription('Forza match'),

  new SlashCommandBuilder().setName('annulla_risultato')
    .addStringOption(o=>o.setName('team').setRequired(true)),

  new SlashCommandBuilder().setName('aggiungi_calcolo')
    .addStringOption(o=>o.setName('team').setRequired(true))
    .addIntegerOption(o=>o.setName('kills').setRequired(true))
    .addIntegerOption(o=>o.setName('pos').setRequired(true)),

  new SlashCommandBuilder().setName('reset_storico').setDescription('Reset totale')
].map(c=>c.toJSON());

// ===== REGISTER COMMANDS =====
const rest = new REST({ version: '10' }).setToken(TOKEN);
(async () => {
  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: commands }
  );
})();

// ===== UTILS =====
function save() {
  fs.writeFileSync('./teams.json', JSON.stringify(teams, null, 2));
  fs.writeFileSync('./data.json', JSON.stringify(data, null, 2));
}

function calcPoints(pos, kills) {
  const table = {1:15,2:12,3:10,4:8,5:6,6:4,7:2};
  return (table[pos] || 0) + kills;
}

// ===== READY =====
client.once('ready', () => {
  console.log(`ONLINE ${client.user.tag}`);
});

// ===== INTERACTIONS =====
client.on('interactionCreate', async interaction => {

  // ===== REGISTER TEAM =====
  if (interaction.isChatInputCommand() && interaction.commandName === 'register_team') {
    const team = interaction.options.getString('team');
    teams[team] = {
      players: [
        interaction.options.getString('p1'),
        interaction.options.getString('p2'),
        interaction.options.getString('p3')
      ]
    };
    save();
    return interaction.reply({ content: "✅ Team registrato", ephemeral: true });
  }

  // ===== CREA STANZE =====
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
    return interaction.reply("✅ Stanze create");
  }

  // ===== DELETE ROOMS =====
  if (interaction.commandName === 'delete_rooms') {
    const channels = interaction.guild.channels.cache.filter(c => c.parentId === CATEGORY_ID && c.type === 2 && c.name.startsWith("🏆・"));
    for (let ch of channels.values()) await ch.delete();
    return interaction.reply("🗑️ Vocali eliminate");
  }

  // ===== PANEL =====
  if (interaction.commandName === 'panel_results') {
    const menu = new StringSelectMenuBuilder()
      .setCustomId('select_team')
      .setPlaceholder('Scegli team')
      .addOptions(Object.keys(teams).map(t => ({ label: t, value: t })));

    return interaction.reply({
      content: `📊 MATCH ${data.currentMatch}`,
      components: [new ActionRowBuilder().addComponents(menu)]
    });
  }

  // ===== SELECT TEAM =====
  if (interaction.isStringSelectMenu() && interaction.customId === 'select_team') {
    const team = interaction.values[0];

    if (data.results[team]?.[data.currentMatch]) {
      return interaction.reply({ content: "❌ Già inviato", ephemeral: true });
    }

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
        )
      );
    });

    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("pos").setLabel("Posizione").setStyle(TextInputStyle.Short)
      )
    );

    return interaction.showModal(modal);
  }

  // ===== SUBMIT RESULT =====
  if (interaction.isModalSubmit()) {
    const team = interaction.customId.split("_")[1];

    let kills = [];
    let total = 0;

    for (let i=0;i<3;i++) {
      let k = parseInt(interaction.fields.getTextInputValue(`k${i}`));
      kills.push(k);
      total += k;
      data.fragger[teams[team].players[i]] = (data.fragger[teams[team].players[i]] || 0) + k;
    }

    let pos = parseInt(interaction.fields.getTextInputValue("pos"));

    if (!data.results[team]) data.results[team] = {};
    data.results[team][data.currentMatch] = { kills, pos };

    let pts = calcPoints(pos, total);
    data.scores[team] = (data.scores[team] || 0) + pts;

    save();

    // AUTO NEXT MATCH
    const count = Object.values(data.results).filter(r => r[data.currentMatch]).length;
    if (count >= MAX_TEAMS && data.currentMatch < MAX_MATCH) {
      data.currentMatch++;
      save();
    }

    return interaction.reply({ content: "✅ Inviato allo staff", ephemeral: true });
  }

  // ===== NEXT MATCH =====
  if (interaction.commandName === 'next_match') {
    if (data.currentMatch < MAX_MATCH) {
      data.currentMatch++;
      save();
      return interaction.reply(`➡️ MATCH ${data.currentMatch}`);
    }
  }

  // ===== RESET =====
  if (interaction.commandName === 'reset_storico') {
    data = { currentMatch:1, results:{}, scores:{}, fragger:{} };
    save();
    return interaction.reply("♻️ Reset fatto");
  }

});

// ===== LOGIN =====
client.login(TOKEN);
