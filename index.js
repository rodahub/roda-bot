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

// LOAD
let teams = {};
let data = {};

try { teams = JSON.parse(fs.readFileSync('./teams.json')); } catch {}
try { data = JSON.parse(fs.readFileSync('./data.json')); } catch {}

data.currentMatch ??= 1;
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

// CLASSIFICA
async function updateLeaderboard() {
  const channel = await client.channels.fetch(CLASSIFICA_CHANNEL);

  const sorted = Object.entries(data.scores).sort((a,b)=>b[1]-a[1]);
  const desc = sorted.map((t,i)=>`#${i+1} ${t[0]} - ${t[1]} pts`).join("\n") || "Nessun dato";

  const frag = Object.entries(data.fragger)
    .sort((a,b)=>b[1]-a[1])
    .slice(0,5)
    .map(f=>`${f[0]} (${f[1]})`)
    .join("\n") || "Nessuno";

  const embed = new EmbedBuilder()
    .setTitle(`🏆 CLASSIFICA MATCH ${data.currentMatch}`)
    .setDescription(desc)
    .addFields({ name: "🔥 Top Fragger", value: frag });

  await channel.send({ embeds: [embed] });
}

// COMMANDS
const commands = [
  new SlashCommandBuilder().setName('panel_register').setDescription('Pannello registrazione'),
  new SlashCommandBuilder().setName('panel_results').setDescription('Pannello risultati'),
  new SlashCommandBuilder().setName('crea_stanze').setDescription('Crea vocali'),
  new SlashCommandBuilder().setName('delete_rooms').setDescription('Elimina vocali create dal bot'),
  new SlashCommandBuilder().setName('next_match').setDescription('Prossimo match'),
  new SlashCommandBuilder().setName('annulla_risultato')
    .setDescription('Rimuovi punti team')
    .addStringOption(o=>o.setName('team').setDescription('Nome team').setRequired(true)),
  new SlashCommandBuilder().setName('aggiungi_calcolo')
    .setDescription('Aggiungi punti manuali')
    .addStringOption(o=>o.setName('team').setDescription('Nome team').setRequired(true))
    .addIntegerOption(o=>o.setName('punti').setDescription('Punti').setRequired(true)),
  new SlashCommandBuilder().setName('reset_all').setDescription('Reset totale')
].map(c => c.toJSON());

// REGISTER COMMANDS
const rest = new REST({ version: '10' }).setToken(TOKEN);
(async () => {
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
})();

client.once('ready', () => console.log("ONLINE"));

// INTERACTIONS
client.on('interactionCreate', async interaction => {
  try {

    if (interaction.isChatInputCommand()) {

      if (interaction.commandName === 'panel_register') {
        const btn = new ButtonBuilder()
          .setCustomId("register_btn")
          .setLabel("📥 REGISTRA TEAM")
          .setStyle(ButtonStyle.Primary);

        return interaction.reply({
          content: "Clicca per registrare il team",
          components: [new ActionRowBuilder().addComponents(btn)]
        });
      }

      if (interaction.commandName === 'panel_results') {

        if (Object.keys(teams).length === 0) {
          return interaction.reply({ content: "❌ Nessun team", ephemeral: true });
        }

        const menu = new StringSelectMenuBuilder()
          .setCustomId('team_select')
          .setPlaceholder('Scegli team')
          .addOptions(Object.keys(teams).map(t => ({
            label: t,
            value: t
          })));

        return interaction.reply({
          content: `📊 MATCH ${data.currentMatch}`,
          components: [new ActionRowBuilder().addComponents(menu)]
        });
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
        return interaction.reply("✅ Stanze create");
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

        return interaction.reply("🗑️ Vocali eliminate");
      }

      if (interaction.commandName === 'next_match') {
        data.currentMatch++;
        save();
        return interaction.reply(`➡️ MATCH ${data.currentMatch}`);
      }

      if (interaction.commandName === 'annulla_risultato') {
        const team = interaction.options.getString('team');
        data.scores[team] = 0;
        save();
        return interaction.reply(`❌ Reset punti ${team}`);
      }

      if (interaction.commandName === 'aggiungi_calcolo') {
        const team = interaction.options.getString('team');
        const punti = interaction.options.getInteger('punti');

        data.scores[team] = (data.scores[team] || 0) + punti;
        save();

        return interaction.reply(`➕ ${punti} punti a ${team}`);
      }

      if (interaction.commandName === 'reset_all') {
        data = {
          currentMatch: 1,
          pending: {},
          tempSubmit: {},
          scores: {},
          fragger: {}
        };
        save();
        return interaction.reply("💥 RESET COMPLETO");
      }
    }

    // REGISTER BUTTON
    if (interaction.isButton() && interaction.customId === "register_btn") {

      const modal = new ModalBuilder()
        .setCustomId("register_modal")
        .setTitle("Registrazione Team");

      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId("team").setLabel("Nome Team").setStyle(TextInputStyle.Short)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId("p1").setLabel("Player 1").setStyle(TextInputStyle.Short)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId("p2").setLabel("Player 2").setStyle(TextInputStyle.Short)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId("p3").setLabel("Player 3").setStyle(TextInputStyle.Short)
        )
      );

      return interaction.showModal(modal);
    }

    // SELECT TEAM
    if (interaction.isStringSelectMenu()) {

      const team = interaction.values[0];
      const players = teams[team].players;

      const modal = new ModalBuilder()
        .setCustomId(`modal_${team}`)
        .setTitle(`Risultato ${team}`);

      for (let i = 0; i < 3; i++) {
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId(`k${i}`)
              .setLabel(`Kill ${players[i]}`)
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
          )
        );
      }

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

    // MODAL
    if (interaction.isModalSubmit()) {

      if (interaction.customId === "register_modal") {

        const team = interaction.fields.getTextInputValue("team");

        teams[team] = {
          players: [
            interaction.fields.getTextInputValue("p1"),
            interaction.fields.getTextInputValue("p2"),
            interaction.fields.getTextInputValue("p3")
          ]
        };

        save();

        return interaction.reply({ content: "✅ Team registrato", ephemeral: true });
      }

      if (interaction.customId.startsWith("modal_")) {

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
          content: "📸 Invia QUI sotto lo screenshot della partita (obbligatorio)",
          ephemeral: true
        });
      }
    }

  } catch (err) {
    console.log(err);
  }
});

// SCREENSHOT
client.on('messageCreate', async message => {
  if (!message.attachments.size) return;

  const temp = data.tempSubmit[message.author.id];
  if (!temp) return;

  const image = message.attachments.first().url;
  const id = Date.now();

  data.pending[id] = { ...temp, image };
  delete data.tempSubmit[message.author.id];
  save();

  const embed = new EmbedBuilder()
    .setTitle("NUOVO RISULTATO")
    .setDescription(`${temp.team} | ${temp.total} kill | pos ${temp.pos}`)
    .setImage(image);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ok_${id}`).setLabel("APPROVA").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`no_${id}`).setLabel("RIFIUTA").setStyle(ButtonStyle.Danger)
  );

  const staff = await client.channels.fetch(STAFF_CHANNEL);
  await staff.send({ embeds: [embed], components: [row] });

  await message.delete().catch(()=>{});
});

// APPROVA
client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;

  const [action, id] = interaction.customId.split("_");
  const p = data.pending[id];
  if (!p) return;

  if (action === "ok") {

    data.scores[p.team] = (data.scores[p.team] || 0) + calcPoints(p.pos, p.total);

    p.kills.forEach((k,i)=>{
      const name = teams[p.team].players[i];
      data.fragger[name] = (data.fragger[name] || 0) + k;
    });

    delete data.pending[id];
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

client.login(TOKEN);
