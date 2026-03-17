const { Client, GatewayIntentBits, Partials, REST, Routes, SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder, EmbedBuilder } = require('discord.js');
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
if (!data.pending) data.pending = {};
if (!data.tempSubmit) data.tempSubmit = {};
if (!data.scores) data.scores = {};
if (!data.fragger) data.fragger = {};

// ===== SAVE =====
function save() {
  fs.writeFileSync('./teams.json', JSON.stringify(teams, null, 2));
  fs.writeFileSync('./data.json', JSON.stringify(data, null, 2));
}

// ===== PUNTI =====
function calcPoints(pos, kills) {
  const table = {1:15,2:12,3:10,4:8,5:6,6:4,7:2};
  return (table[pos] || 0) + kills;
}

// ===== CLASSIFICA =====
async function updateLeaderboard() {
  const channel = await client.channels.fetch(CLASSIFICA_CHANNEL);

  const sorted = Object.entries(data.scores)
    .sort((a,b)=>b[1]-a[1]);

  let desc = "";
  sorted.forEach((t,i)=>{
    desc += `#${i+1} ${t[0]} - ${t[1]} pts\n`;
  });

  const frag = Object.entries(data.fragger)
    .sort((a,b)=>b[1]-a[1])
    .slice(0,5);

  let fragText = frag.map(f=>`${f[0]} (${f[1]})`).join("\n");

  const embed = new EmbedBuilder()
    .setTitle(`🏆 CLASSIFICA MATCH ${data.currentMatch}`)
    .setDescription(desc || "Nessun dato")
    .addFields({ name: "🔥 Top Fragger", value: fragText || "Nessuno" });

  const msgs = await channel.messages.fetch({ limit: 5 });
  msgs.forEach(m => m.delete());

  await channel.send({ embeds: [embed] });
}

// ===== COMMANDS =====
const commands = [
  new SlashCommandBuilder().setName('register_team').setDescription('Registra team')
    .addStringOption(o=>o.setName('team').setRequired(true))
    .addStringOption(o=>o.setName('p1').setRequired(true))
    .addStringOption(o=>o.setName('p2').setRequired(true))
    .addStringOption(o=>o.setName('p3').setRequired(true)),

  new SlashCommandBuilder().setName('crea_stanze').setDescription('Crea vocali'),

  new SlashCommandBuilder().setName('delete_rooms').setDescription('Elimina vocali'),

  new SlashCommandBuilder().setName('panel_results').setDescription('Invia risultato'),

  new SlashCommandBuilder().setName('next_match').setDescription('Forza match'),

  new SlashCommandBuilder().setName('reset_storico').setDescription('Reset totale')
].map(c=>c.toJSON());

// ===== REGISTER COMMANDS =====
const rest = new REST({ version: '10' }).setToken(TOKEN);
(async () => {
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
})();

// ===== READY =====
client.once('ready', () => {
  console.log(`ONLINE ${client.user.tag}`);
});

// ===== INTERACTIONS =====
client.on('interactionCreate', async interaction => {

  // REGISTER TEAM
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

  // SUBMIT MODAL
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

    data.tempSubmit[interaction.user.id] = {
      team, kills, total, pos
    };

    save();

    return interaction.reply({
      content: "📸 Ora invia lo SCREENSHOT qui",
      ephemeral: true
    });
  }

});

// ===== SCREENSHOT =====
client.on('messageCreate', async message => {
  if (message.author.bot) return;
  if (!message.attachments.size) return;

  const temp = data.tempSubmit[message.author.id];
  if (!temp) return;

  const image = message.attachments.first().url;
  const id = `${temp.team}_${Date.now()}`;

  data.pending[id] = { ...temp, image };
  delete data.tempSubmit[message.author.id];
  save();

  const embed = new EmbedBuilder()
    .setTitle("📩 Nuovo risultato")
    .setDescription(`Team: ${temp.team}\nKill: ${temp.total}\nPos: ${temp.pos}`)
    .setImage(image);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ok_${id}`).setLabel("APPROVA").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`no_${id}`).setLabel("RIFIUTA").setStyle(ButtonStyle.Danger)
  );

  const staff = await client.channels.fetch(STAFF_CHANNEL);
  await staff.send({ embeds: [embed], components: [row] });

  await message.delete();
});

// ===== APPROVA =====
client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;

  const [action, id] = interaction.customId.split("_");
  const p = data.pending[id];
  if (!p) return;

  if (action === "ok") {

    if (!data.results[p.team]) data.results[p.team] = {};
    data.results[p.team][data.currentMatch] = p;

    data.scores[p.team] = (data.scores[p.team] || 0) + calcPoints(p.pos, p.total);

    p.kills.forEach((k,i)=>{
      const name = teams[p.team].players[i];
      data.fragger[name] = (data.fragger[name] || 0) + k;
    });

    delete data.pending[id];

    // AUTO MATCH
    const count = Object.values(data.results).filter(r => r[data.currentMatch]).length;
    if (count >= MAX_TEAMS && data.currentMatch < MAX_MATCH) {
      data.currentMatch++;
    }

    save();
    await updateLeaderboard();

    return interaction.reply("✅ APPROVATO");
  }

  if (action === "no") {
    delete data.pending[id];
    save();
    return interaction.reply("❌ RIFIUTATO");
  }
});

// ===== NEXT MATCH =====
client.on('interactionCreate', async interaction => {
  if (interaction.isChatInputCommand() && interaction.commandName === 'next_match') {
    data.currentMatch++;
    save();
    return interaction.reply(`➡️ MATCH ${data.currentMatch}`);
  }
});

// ===== RESET =====
client.on('interactionCreate', async interaction => {
  if (interaction.isChatInputCommand() && interaction.commandName === 'reset_storico') {
    data = { currentMatch:1, results:{}, pending:{}, tempSubmit:{}, scores:{}, fragger:{} };
    save();
    return interaction.reply("♻️ RESET COMPLETO");
  }
});

client.login(TOKEN);
