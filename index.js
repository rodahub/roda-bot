const {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  EmbedBuilder,
  ChannelType
} = require('discord.js');

const { loadData, saveData, loadTeams, saveTeams } = require('./store');

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID || '1442509991109066765';

const STAFF_CHANNEL = process.env.STAFF_CHANNEL || '1483201939712774145';
const CLASSIFICA_CHANNEL = process.env.CLASSIFICA_CHANNEL || '1478304828592623777';
const CATEGORY_ID = process.env.CATEGORY_ID || '1478303649586348165';
const STORICO_CHANNEL = process.env.STORICO_CHANNEL || '1483594392819204126';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates
  ],
  partials: [Partials.Channel]
});

function calcPoints(pos, kills) {
  const table = { 1: 15, 2: 12, 3: 10, 4: 8, 5: 6, 6: 4, 7: 2 };
  return (table[pos] || 0) + kills;
}

function getPlayersForTeam(teamName) {
  const teams = loadTeams();
  return teams[teamName]?.players || ['Player 1', 'Player 2', 'Player 3'];
}

function buildLeaderboardEmbed() {
  const data = loadData();
  const sorted = Object.entries(data.scores || {}).sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0));
  const desc = sorted.map((t, i) => `#${i + 1} ${t[0]} - ${t[1]} pts`).join('\n') || 'Nessun dato';

  const frag = Object.entries(data.fragger || {})
    .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))
    .slice(0, 5)
    .map(f => `${f[0]} (${f[1]})`)
    .join('\n') || 'Nessuno';

  return new EmbedBuilder()
    .setTitle(`🏆 CLASSIFICA MATCH ${data.currentMatch}`)
    .setDescription(desc)
    .addFields({ name: '🔥 Top Fragger', value: frag });
}

async function clearGuildCommands() {
  if (!TOKEN || !CLIENT_ID || !GUILD_ID) return;
  try {
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: [] });
    console.log('✅ Slash commands rimossi dal server');
  } catch (error) {
    console.log('⚠️ Errore rimozione slash commands:', error.message);
  }
}

async function updateLeaderboard() {
  const data = loadData();
  const channel = await client.channels.fetch(CLASSIFICA_CHANNEL);
  const embed = buildLeaderboardEmbed();

  if (data.leaderboardMessageId) {
    try {
      const msg = await channel.messages.fetch(data.leaderboardMessageId);
      await msg.edit({ embeds: [embed] });
      return { ok: true, reused: true };
    } catch (error) {}
  }

  const msg = await channel.send({ embeds: [embed] });
  data.leaderboardMessageId = msg.id;
  saveData(data);
  return { ok: true, reused: false };
}

async function spawnRegisterPanel() {
  const channel = await client.channels.fetch(STAFF_CHANNEL);
  const btn = new ButtonBuilder()
    .setCustomId('register_btn')
    .setLabel('📥 REGISTRA TEAM')
    .setStyle(ButtonStyle.Primary);

  await channel.send({
    content: 'Clicca per registrare il team',
    components: [new ActionRowBuilder().addComponents(btn)]
  });

  return { ok: true };
}

async function spawnResultsPanel() {
  const teams = loadTeams();

  if (Object.keys(teams).length === 0) {
    throw new Error('Nessun team registrato');
  }

  const channel = await client.channels.fetch(STAFF_CHANNEL);

  const menu = new StringSelectMenuBuilder()
    .setCustomId('team_select')
    .setPlaceholder('Scegli team')
    .addOptions(
      Object.keys(teams).map(team => ({
        label: team.slice(0, 100),
        value: team
      }))
    );

  const data = loadData();

  await channel.send({
    content: `📊 MATCH ${data.currentMatch}`,
    components: [new ActionRowBuilder().addComponents(menu)]
  });

  return { ok: true };
}

async function createRooms() {
  const guild = await client.guilds.fetch(GUILD_ID);
  const teams = loadTeams();

  let i = 1;
  for (const teamName of Object.keys(teams)) {
    await guild.channels.create({
      name: `🏆・${i} ${teamName}`,
      type: ChannelType.GuildVoice,
      parent: CATEGORY_ID
    });
    i++;
  }

  return { ok: true };
}

async function deleteRooms() {
  const guild = await client.guilds.fetch(GUILD_ID);
  const channels = guild.channels.cache.filter(c =>
    c.parentId === CATEGORY_ID &&
    c.type === ChannelType.GuildVoice &&
    c.name.startsWith('🏆・')
  );

  for (const ch of channels.values()) {
    try {
      await ch.delete();
    } catch (error) {}
  }

  return { ok: true, deleted: channels.size };
}

async function nextMatchAndSync() {
  const data = loadData();
  data.currentMatch = Number(data.currentMatch || 1) + 1;
  saveData(data);
  await updateLeaderboard().catch(() => {});
  return { ok: true, currentMatch: data.currentMatch };
}

function buildPendingEmbed(pendingEntry) {
  const players = getPlayersForTeam(pendingEntry.team);

  return new EmbedBuilder()
    .setTitle('📸 NUOVO RISULTATO')
    .setDescription(
      `🏷️ Team: ${pendingEntry.team}
👤 ${players[0]}: ${pendingEntry.kills[0]} kill
👤 ${players[1]}: ${pendingEntry.kills[1]} kill
👤 ${players[2]}: ${pendingEntry.kills[2]} kill

🔥 Totale: ${pendingEntry.total}
🏆 Posizione: ${pendingEntry.pos}`
    )
    .setImage(pendingEntry.image || null)
    .setFooter({ text: '⏳ In attesa approvazione staff' });
}

async function sendPendingToStaff(pendingId) {
  const data = loadData();
  const pendingEntry = data.pending[pendingId];
  if (!pendingEntry) throw new Error('Risultato pending non trovato');

  const embed = buildPendingEmbed(pendingEntry);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ok_${pendingId}`).setLabel('APPROVA').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`no_${pendingId}`).setLabel('RIFIUTA').setStyle(ButtonStyle.Danger)
  );

  const staff = await client.channels.fetch(STAFF_CHANNEL);
  await staff.send({ embeds: [embed], components: [row] });
  return { ok: true };
}

async function createPendingFromWeb({ team, kills, pos, image }) {
  const teams = loadTeams();
  if (!teams[team]) throw new Error('Team non trovato');

  const safeKills = Array.isArray(kills) ? kills.map(v => Number(v || 0)) : [0, 0, 0];
  const total = safeKills.reduce((sum, v) => sum + Number(v || 0), 0);
  const pendingId = String(Date.now());

  const data = loadData();
  data.pending[pendingId] = {
    team,
    kills: safeKills,
    total,
    pos: Number(pos || 0),
    image: image || ''
  };
  saveData(data);

  await sendPendingToStaff(pendingId);

  return { ok: true, pendingId };
}

async function approvePending(pendingId, source = 'dashboard') {
  const data = loadData();
  const teams = loadTeams();
  const p = data.pending[pendingId];
  if (!p) return { ok: false, already: true };

  const players = teams[p.team]?.players || ['Player 1', 'Player 2', 'Player 3'];

  data.scores[p.team] = (data.scores[p.team] || 0) + calcPoints(Number(p.pos || 0), Number(p.total || 0));

  (p.kills || []).forEach((k, i) => {
    const name = players[i] || `Player ${i + 1}`;
    data.fragger[name] = (data.fragger[name] || 0) + Number(k || 0);
  });

  data.resultHistory.unshift({
    id: pendingId,
    status: 'APPROVED',
    team: p.team,
    total: Number(p.total || 0),
    pos: Number(p.pos || 0),
    kills: (p.kills || []).map(v => Number(v || 0)),
    image: p.image || '',
    approvedAt: new Date().toISOString(),
    source
  });

  data.resultHistory = data.resultHistory.slice(0, 300);
  delete data.pending[pendingId];
  saveData(data);

  await updateLeaderboard().catch(() => {});

  const embed = buildPendingEmbed(p).setFooter({ text: '✅ APPROVATO' });
  const storico = await client.channels.fetch(STORICO_CHANNEL);
  await storico.send({ embeds: [embed] }).catch(() => {});

  return { ok: true };
}

async function rejectPending(pendingId, source = 'dashboard') {
  const data = loadData();
  const p = data.pending[pendingId];
  if (!p) return { ok: false, already: true };

  data.resultHistory.unshift({
    id: pendingId,
    status: 'REJECTED',
    team: p.team,
    total: Number(p.total || 0),
    pos: Number(p.pos || 0),
    kills: (p.kills || []).map(v => Number(v || 0)),
    image: p.image || '',
    rejectedAt: new Date().toISOString(),
    source
  });

  data.resultHistory = data.resultHistory.slice(0, 300);
  delete data.pending[pendingId];
  saveData(data);

  return { ok: true };
}

client.once('ready', async () => {
  console.log('ONLINE');
  await clearGuildCommands();
  await updateLeaderboard().catch(() => {});
});

client.on('interactionCreate', async interaction => {
  try {
    if (interaction.isButton() && interaction.customId === 'register_btn') {
      const modal = new ModalBuilder()
        .setCustomId('register_modal')
        .setTitle('Registrazione Team');

      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('team').setLabel('Nome Team').setStyle(TextInputStyle.Short).setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('p1').setLabel('Player 1').setStyle(TextInputStyle.Short).setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('p2').setLabel('Player 2').setStyle(TextInputStyle.Short).setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('p3').setLabel('Player 3').setStyle(TextInputStyle.Short).setRequired(true)
        )
      );

      return interaction.showModal(modal);
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'team_select') {
      const teams = loadTeams();
      const team = interaction.values[0];
      const players = teams[team]?.players || ['Player 1', 'Player 2', 'Player 3'];

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
            .setCustomId('pos')
            .setLabel('Posizione')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
        )
      );

      return interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId === 'register_modal') {
      const teams = loadTeams();
      const team = interaction.fields.getTextInputValue('team').trim();

      teams[team] = {
        players: [
          interaction.fields.getTextInputValue('p1').trim(),
          interaction.fields.getTextInputValue('p2').trim(),
          interaction.fields.getTextInputValue('p3').trim()
        ]
      };

      saveTeams(teams);
      return interaction.reply({ content: '✅ Team registrato', ephemeral: true });
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_')) {
      const team = interaction.customId.slice('modal_'.length);

      const kills = [];
      let total = 0;

      for (let i = 0; i < 3; i++) {
        const k = parseInt(interaction.fields.getTextInputValue(`k${i}`), 10) || 0;
        kills.push(k);
        total += k;
      }

      const pos = parseInt(interaction.fields.getTextInputValue('pos'), 10) || 0;

      const data = loadData();
      data.tempSubmit[interaction.user.id] = { team, kills, total, pos };
      saveData(data);

      return interaction.reply({
        content: '📸 Invia QUI sotto lo screenshot della partita (obbligatorio)',
        ephemeral: true
      });
    }

    if (interaction.isButton()) {
      const [action, pendingId] = interaction.customId.split('_');
      const data = loadData();
      const p = data.pending[pendingId];
      if (!p) return interaction.reply({ content: 'Risultato già gestito', ephemeral: true }).catch(() => {});

      if (action === 'ok') {
        await approvePending(pendingId, 'discord_button');

        const embed = buildPendingEmbed(p).setFooter({ text: '✅ APPROVATO' });
        return interaction.update({ embeds: [embed], components: [] });
      }

      if (action === 'no') {
        await rejectPending(pendingId, 'discord_button');

        const embed = buildPendingEmbed(p).setFooter({ text: '❌ RIFIUTATO' });
        return interaction.update({ embeds: [embed], components: [] });
      }
    }
  } catch (error) {
    console.log(error);
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: 'Errore interno', ephemeral: true }).catch(() => {});
    }
  }
});

client.on('messageCreate', async message => {
  try {
    if (message.author.bot) return;
    if (!message.attachments.size) return;

    const data = loadData();
    const temp = data.tempSubmit[message.author.id];
    if (!temp) return;

    const image = message.attachments.first().url;
    const id = String(Date.now());

    data.pending[id] = { ...temp, image };
    delete data.tempSubmit[message.author.id];
    saveData(data);

    await sendPendingToStaff(id);
    await message.delete().catch(() => {});
  } catch (error) {
    console.log(error);
  }
});

client.login(TOKEN);

module.exports = {
  client,
  updateLeaderboard,
  spawnRegisterPanel,
  spawnResultsPanel,
  createRooms,
  deleteRooms,
  nextMatchAndSync,
  sendPendingToStaff,
  createPendingFromWeb,
  approvePending,
  rejectPending
};
