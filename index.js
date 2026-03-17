const { Client, GatewayIntentBits, Partials, REST, Routes, SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder, EmbedBuilder } = require('discord.js');
const fs = require('fs');

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
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

// ===== DB =====
let teams = JSON.parse(fs.readFileSync('./teams.json', 'utf8'));
let data = JSON.parse(fs.readFileSync('./data.json', 'utf8'));

if (!data.currentMatch) data.currentMatch = 1;
if (!data.pending) data.pending = {};
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

  new SlashCommandBuilder().setName('reset_storico').setDescription('Reset tutto')
].map(c=>c.toJSON());

// ===== REGISTER =====
const rest = new REST({ version: '10' }).setToken(TOKEN);
(async () => {
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
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

// ===== EVENTS =====
client.on('interactionCreate', async interaction => {

  // REGISTER
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

  // CREA STANZE
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

  // DELETE ROOMS
  if (interaction.commandName === 'delete_rooms') {
    const channels = interaction.guild.channels.cache.filter(c => c.parentId === CATEGORY_ID && c.type === 2 && c.name.startsWith("🏆・"));
    for (let ch of channels.values()) await ch.delete();
    return interaction.reply("🗑️ Vocali eliminate");
  }

  // PANEL
  if (interaction.commandName === 'panel_results') {
    const menu = new StringSelectMenuBuilder()
      .setCustomId('team_select')
      .setPlaceholder('Scegli team')
      .addOptions(Object.keys(teams).map(t => ({ label: t, value: t })));

    return interaction.reply({
      content: `📊 MATCH ${data.currentMatch}`,
      components: [new ActionRowBuilder().addComponents(menu)]
    });
  }

  // SELECT TEAM
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
        )
      );
    });

    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("pos").setLabel("Posizione").setStyle(TextInputStyle.Short)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("screen").setLabel("Link Screenshot").setStyle(TextInputStyle.Short)
      )
    );

    return interaction.showModal(modal);
  }

  // SUBMIT
  if (interaction.isModalSubmit()) {
    const team = interaction.customId.split("_")[1];

    let kills = [];
    let total = 0;

    for (let i=0;i<3;i++) {
      let k = parseInt(interaction.fields.getTextInputValue(`k${i}`));
      kills.push(k);
      total += k;
    }

    let pos = parseInt(interaction.fields.getTextInputValue("pos"));
    let screen = interaction.fields.getTextInputValue("screen");

    const id = `${team}_${Date.now()}`;

    data.pending[id] = { team, kills, pos, total, screen };

    save();

    const embed = new EmbedBuilder()
      .setTitle(`📩 Nuovo risultato`)
      .setDescription(`Team: ${team}\nKill: ${total}\nPos: ${pos}`)
      .setImage(screen);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`ok_${id}`).setLabel("APPROVA").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`no_${id}`).setLabel("RIFIUTA").setStyle(ButtonStyle.Danger)
    );

    const staff = await client.channels.fetch(STAFF_CHANNEL);
    await staff.send({ embeds: [embed], components: [row] });

    await interaction.reply({ content: "📩 Inviato allo staff", ephemeral: true });

    // PULISCE CANALE CALCOLO
    const calc = await client.channels.fetch(CALCOLO_CHANNEL);
    const msgs = await calc.messages.fetch({ limit: 10 });
    msgs.forEach(m => m.delete());

  }

  // APPROVA / RIFIUTA
  if (interaction.isButton()) {
    const [action, id] = interaction.customId.split("_");
    const p = data.pending[id];

    if (!p) return;

    if (action === "ok") {
      if (!data.results[p.team]) data.results[p.team] = {};
      data.results[p.team][data.currentMatch] = p;

      data.scores[p.team] = (data.scores[p.team] || 0) + calcPoints(p.pos, p.total);

      delete data.pending[id];
      save();

      return interaction.reply("✅ APPROVATO");
    }

    if (action === "no") {
      delete data.pending[id];
      save();
      return interaction.reply("❌ RIFIUTATO");
    }
  }

});

client.login(TOKEN);
