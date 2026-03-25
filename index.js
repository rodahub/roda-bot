const {
  Client,
  GatewayIntentBits,
  Partials,
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

const {
  loadData,
  loadTeams,
  saveData,
  saveTeams,
  saveAll,
  getDefaultData
} = require('./storage');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates
  ],
  partials: [Partials.Channel]
});

const TOKEN = process.env.TOKEN;
const GUILD_ID = process.env.GUILD_ID || '1442509991109066765';
const STAFF_CHANNEL = process.env.STAFF_CHANNEL || '1483201939712774145';
const CLASSIFICA_CHANNEL = process.env.CLASSIFICA_CHANNEL || '1478304828592623777';
const CATEGORY_ID = process.env.CATEGORY_ID || '1478303649586348165';
const STORICO_CHANNEL = process.env.STORICO_CHANNEL || '1483594392819204126';

let teams = loadTeams();
let data = loadData();
let readyResolver;
const readyPromise = new Promise(resolve => {
  readyResolver = resolve;
});

function saveState() {
  data = saveData(data);
  teams = saveTeams(teams);
}

function saveEverything() {
  const saved = saveAll(data, teams);
  data = saved.data;
  teams = saved.teams;
}

function sanitizeText(value) {
  return String(value || '').trim();
}

function calcPoints(pos, kills) {
  const table = { 1: 15, 2: 12, 3: 10, 4: 8, 5: 6, 6: 4, 7: 2 };
  return (table[pos] || 0) + kills;
}

async function waitReady() {
  await readyPromise;
  return client;
}

async function fetchChannel(channelId) {
  await waitReady();
  return client.channels.fetch(channelId);
}

function createResultEmbed(entry, footerText) {
  const players = teams[entry.team]?.players || ['Player 1', 'Player 2', 'Player 3'];

  return new EmbedBuilder()
    .setTitle('📸 NUOVO RISULTATO')
    .setDescription(
      `🏷️ Team: ${entry.team}
👤 ${players[0] || 'Player 1'}: ${Number(entry.kills?.[0] || 0)} kill
👤 ${players[1] || 'Player 2'}: ${Number(entry.kills?.[1] || 0)} kill
👤 ${players[2] || 'Player 3'}: ${Number(entry.kills?.[2] || 0)} kill

🔥 Totale: ${Number(entry.total || 0)}
🏆 Posizione: ${Number(entry.pos || 0)}`
    )
    .setImage(entry.image || null)
    .setFooter({ text: footerText || '⏳ In attesa approvazione staff' });
}

function createStaffActionRow(id) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ok_${id}`).setLabel('APPROVA').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`no_${id}`).setLabel('RIFIUTA').setStyle(ButtonStyle.Danger)
  );
}

async function updateLeaderboard() {
  await waitReady();
  const channel = await client.channels.fetch(CLASSIFICA_CHANNEL);

  const sorted = Object.entries(data.scores || {}).sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0));
  const desc = sorted.map((t, i) => `#${i + 1} ${t[0]} - ${t[1]} pts`).join('\n') || 'Nessun dato';

  const frag = Object.entries(data.fragger || {})
    .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))
    .slice(0, 5)
    .map(f => `${f[0]} (${f[1]})`)
    .join('\n') || 'Nessuno';

  const embed = new EmbedBuilder()
    .setTitle(`🏆 CLASSIFICA MATCH ${data.currentMatch}`)
    .setDescription(desc)
    .addFields({ name: '🔥 Top Fragger', value: frag });

  if (data.leaderboardMessageId) {
    try {
      const msg = await channel.messages.fetch(data.leaderboardMessageId);
      await msg.edit({ embeds: [embed] });
      return true;
    } catch {}
  }

  const msg = await channel.send({ embeds: [embed] });
  data.leaderboardMessageId = msg.id;
  saveState();
  return true;
}

async function sendResultToStorico(embed) {
  try {
    const storico = await client.channels.fetch(STORICO_CHANNEL);
    await storico.send({ embeds: [embed] });
  } catch (error) {
    console.error('Errore invio storico:', error);
  }
}

async function editStaffMessage(entry, approved) {
  if (!entry.staffMessageId) return;
  try {
    const staff = await client.channels.fetch(STAFF_CHANNEL);
    const msg = await staff.messages.fetch(entry.staffMessageId);
    const footerText = approved ? '✅ APPROVATO' : '❌ RIFIUTATO';
    const embed = EmbedBuilder.from(msg.embeds[0]).setFooter({ text: footerText });
    await msg.edit({ embeds: [embed], components: [] });
    return embed;
  } catch (error) {
    console.error('Errore update messaggio staff:', error);
    return null;
  }
}

async function approvePending(id) {
  const entry = data.pending[id];
  if (!entry) return { already: true };

  const players = teams[entry.team]?.players || ['Player 1', 'Player 2', 'Player 3'];

  data.scores[entry.team] = (data.scores[entry.team] || 0) + calcPoints(Number(entry.pos || 0), Number(entry.total || 0));

  (entry.kills || []).forEach((k, i) => {
    const playerName = players[i] || `Player ${i + 1}`;
    data.fragger[playerName] = (data.fragger[playerName] || 0) + Number(k || 0);
  });

  delete data.pending[id];
  saveState();

  await updateLeaderboard();

  let storicoEmbed = await editStaffMessage(entry, true);
  if (!storicoEmbed) {
    storicoEmbed = createResultEmbed(entry, '✅ APPROVATO');
  }

  await sendResultToStorico(storicoEmbed);
  return { ok: true };
}

async function rejectPending(id) {
  const entry = data.pending[id];
  if (!entry) return { already: true };

  delete data.pending[id];
  saveState();

  await editStaffMessage(entry, false);
  return { ok: true };
}

async function createPendingSubmission(entry) {
  await waitReady();

  const id = String(Date.now());
  data.pending[id] = entry;
  saveState();

  const staff = await client.channels.fetch(STAFF_CHANNEL);
  const embed = createResultEmbed(entry, '⏳ In attesa approvazione staff');
  const row = createStaffActionRow(id);
  const msg = await staff.send({ embeds: [embed], components: [row] });

  data.pending[id].staffMessageId = msg.id;
  saveState();

  return { id };
}

async function submitWebResult(payload) {
  const entry = {
    team: sanitizeText(payload.team),
    kills: [
      Number(payload.k1 || 0),
      Number(payload.k2 || 0),
      Number(payload.k3 || 0)
    ],
    total: Number(payload.k1 || 0) + Number(payload.k2 || 0) + Number(payload.k3 || 0),
    pos: Number(payload.pos || 0),
    image: payload.image || '',
    source: 'web',
    submittedBy: sanitizeText(payload.submittedBy || 'Dashboard')
  };

  if (!teams[entry.team]) {
    throw new Error('Team non trovato');
  }

  return createPendingSubmission(entry);
}

async function spawnRegisterPanel(channelId) {
  await waitReady();
  const channel = await client.channels.fetch(channelId);
  const btn = new ButtonBuilder()
    .setCustomId('register_btn')
    .setLabel('📥 REGISTRA TEAM')
    .setStyle(ButtonStyle.Primary);

  await channel.send({
    content: 'Clicca per registrare il team',
    components: [new ActionRowBuilder().addComponents(btn)]
  });

  return true;
}

async function spawnResultsPanel(channelId) {
  await waitReady();
  if (Object.keys(teams).length === 0) {
    throw new Error('Nessun team registrato');
  }

  const channel = await client.channels.fetch(channelId);

  const menu = new StringSelectMenuBuilder()
    .setCustomId('team_select')
    .setPlaceholder('Scegli team')
    .addOptions(
      Object.keys(teams).map(t => ({
        label: t,
        value: t
      }))
    );

  await channel.send({
    content: `📊 MATCH ${data.currentMatch}`,
    components: [new ActionRowBuilder().addComponents(menu)]
  });

  return true;
}

async function createTeamRooms() {
  await waitReady();
  const guild = await client.guilds.fetch(GUILD_ID);
  let i = 1;

  for (const teamName of Object.keys(teams)) {
    await guild.channels.create({
      name: `🏆・${i} ${teamName}`,
      type: ChannelType.GuildVoice,
      parent: CATEGORY_ID
    });
    i++;
  }

  return true;
}

async function deleteTeamRooms() {
  await waitReady();
  const guild = await client.guilds.fetch(GUILD_ID);
  const channels = guild.channels.cache.filter(c =>
    c.parentId === CATEGORY_ID &&
    c.type === ChannelType.GuildVoice &&
    c.name.startsWith('🏆・')
  );

  for (const ch of channels.values()) {
    try { await ch.delete(); } catch {}
  }

  return true;
}

function setCurrentMatch(match) {
  data.currentMatch = Number(match || 1);
  saveState();
}

function nextMatch() {
  data.currentMatch = Number(data.currentMatch || 1) + 1;
  saveState();
  return data.currentMatch;
}

function setTeamsState(newTeams) {
  teams = newTeams;
  saveEverything();
}

function setDataState(newData) {
  data = newData;
  saveEverything();
}

function resetAllState() {
  data = getDefaultData();
  saveState();
}

function getBotConfig() {
  return {
    guildId: GUILD_ID,
    staffChannel: STAFF_CHANNEL,
    classificaChannel: CLASSIFICA_CHANNEL,
    categoryId: CATEGORY_ID,
    storicoChannel: STORICO_CHANNEL
  };
}

client.once('ready', () => {
  console.log('ONLINE');
  if (readyResolver) readyResolver(client);
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
              .setLabel(`Kill ${players[i] || `Player ${i + 1}`}`)
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
      const team = sanitizeText(interaction.fields.getTextInputValue('team'));
      const p1 = sanitizeText(interaction.fields.getTextInputValue('p1'));
      const p2 = sanitizeText(interaction.fields.getTextInputValue('p2'));
      const p3 = sanitizeText(interaction.fields.getTextInputValue('p3'));

      teams[team] = { players: [p1, p2, p3] };
      saveEverything();

      return interaction.reply({ content: '✅ Team registrato', ephemeral: true });
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_')) {
      const team = interaction.customId.replace('modal_', '');

      if (!teams[team]) {
        return interaction.reply({ content: '❌ Team non trovato', ephemeral: true });
      }

      const kills = [];
      let total = 0;

      for (let i = 0; i < 3; i++) {
        const k = parseInt(interaction.fields.getTextInputValue(`k${i}`), 10) || 0;
        kills.push(k);
        total += k;
      }

      const pos = parseInt(interaction.fields.getTextInputValue('pos'), 10) || 0;

      data.tempSubmit[interaction.user.id] = { team, kills, total, pos };
      saveState();

      return interaction.reply({
        content: '📸 Invia QUI sotto lo screenshot della partita (obbligatorio)',
        ephemeral: true
      });
    }

    if (interaction.isButton()) {
      const [action, id] = interaction.customId.split('_');
      if (!id) return;

      if (action === 'ok') {
        const entry = data.pending[id];
        if (!entry) {
          return interaction.reply({ content: '❌ Risultato non trovato', ephemeral: true });
        }

        await approvePending(id);
        const embed = createResultEmbed(entry, '✅ APPROVATO');
        return interaction.update({ embeds: [embed], components: [] });
      }

      if (action === 'no') {
        const entry = data.pending[id];
        if (!entry) {
          return interaction.reply({ content: '❌ Risultato non trovato', ephemeral: true });
        }

        await rejectPending(id);
        const embed = createResultEmbed(entry, '❌ RIFIUTATO');
        return interaction.update({ embeds: [embed], components: [] });
      }
    }
  } catch (error) {
    console.error(error);
  }
});

client.on('messageCreate', async message => {
  try {
    if (message.author.bot) return;
    if (!message.attachments.size) return;

    const temp = data.tempSubmit[message.author.id];
    if (!temp) return;

    const image = message.attachments.first().url;
    delete data.tempSubmit[message.author.id];
    saveState();

    await createPendingSubmission({
      ...temp,
      image,
      source: 'discord',
      submittedBy: message.author.tag
    });

    await message.delete().catch(() => {});
  } catch (error) {
    console.error(error);
  }
});

client.login(TOKEN);

module.exports = {
  client,
  waitReady,
  getData: () => data,
  getTeams: () => teams,
  setDataState,
  setTeamsState,
  saveState,
  saveEverything,
  updateLeaderboard,
  approvePending,
  rejectPending,
  spawnRegisterPanel,
  spawnResultsPanel,
  createTeamRooms,
  deleteTeamRooms,
  nextMatch,
  setCurrentMatch,
  submitWebResult,
  getBotConfig,
  resetAllState
};
