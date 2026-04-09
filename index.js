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
  AttachmentBuilder,
  ChannelType
} = require('discord.js');

const Canvas = require('@napi-rs/canvas');
const fs = require('fs');
const path = require('path');

const {
  loadData,
  loadTeams,
  saveData,
  saveAll,
  appendAuditLog,
  getDefaultData,
  UPLOADS_DIR
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
const TOURNAMENT_FULL_CHANNEL = process.env.TOURNAMENT_FULL_CHANNEL || STAFF_CHANNEL;
const REGISTRATION_STATUS_CHANNEL = process.env.REGISTRATION_STATUS_CHANNEL || '1482050564375318579';

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

let teams = loadTeams();
let data = loadData();

let readyResolver;
const readyPromise = new Promise(resolve => {
  readyResolver = resolve;
});

let registrationStatusUpdateQueue = Promise.resolve();

function sanitizeText(value) {
  return String(value || '').trim();
}

function normalizeBaseUrl(value) {
  const clean = String(value || '').trim();
  if (!clean) return '';
  return clean.endsWith('/') ? clean.slice(0, -1) : clean;
}

function getPublicBaseUrl() {
  const explicit = normalizeBaseUrl(process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL);
  if (explicit) return explicit;

  const railwayDomain = sanitizeText(process.env.RAILWAY_PUBLIC_DOMAIN);
  if (railwayDomain) return `https://${railwayDomain}`;

  return '';
}

function buildPublicUploadUrl(fileName) {
  const baseUrl = getPublicBaseUrl();
  if (!baseUrl) return `/uploads/${fileName}`;
  return `${baseUrl}/uploads/${fileName}`;
}

function getProjectSettings() {
  const safe = data?.projectSettings || {};
  return {
    brandName: sanitizeText(safe.brandName) || 'RØDA',
    tournamentName: sanitizeText(safe.tournamentName) || 'RØDA CUP',
    supportContact: sanitizeText(safe.supportContact),
    premiumMode: Boolean(safe.premiumMode),
    setupCompleted: Boolean(safe.setupCompleted)
  };
}

function getBotSettings() {
  const safe = data?.botSettings || {};
  return {
    registerPanelMessageId: safe.registerPanelMessageId || null,
    registerPanelChannelId: sanitizeText(safe.registerPanelChannelId),
    resultsPanelMessageId: safe.resultsPanelMessageId || null,
    resultsPanelChannelId: sanitizeText(safe.resultsPanelChannelId),
    roomsCategoryId: sanitizeText(safe.roomsCategoryId)
  };
}

function ensureDataStructures() {
  if (!data || typeof data !== 'object') {
    data = getDefaultData();
  }

  if (!data.projectSettings || typeof data.projectSettings !== 'object') {
    data.projectSettings = getDefaultData().projectSettings;
  }

  if (!data.botSettings || typeof data.botSettings !== 'object') {
    data.botSettings = getDefaultData().botSettings;
  }
}

function saveState() {
  ensureDataStructures();
  data = saveData(data);
}

function saveEverything() {
  ensureDataStructures();
  const saved = saveAll(data, teams);
  data = saved.data;
  teams = saved.teams;
}

function setDataState(newData) {
  data = newData;
  ensureDataStructures();
}

function setTeamsState(newTeams) {
  teams = newTeams;
}

function getRegistrationLimit() {
  const limit = Number(data.registrationMaxTeams || 16);
  return Number.isInteger(limit) && limit > 0 ? limit : 16;
}

function getSortedTeamEntries() {
  return Object.entries(teams).sort((a, b) => {
    const slotA = Number(a[1]?.slot || 999999);
    const slotB = Number(b[1]?.slot || 999999);
    if (slotA !== slotB) return slotA - slotB;
    return a[0].localeCompare(b[0], 'it');
  });
}

function getDisplayTeams() {
  return getSortedTeamEntries().map(([teamName, teamData], index) => {
    const numericSlot = Number(teamData?.slot);
    const slot = Number.isInteger(numericSlot) && numericSlot > 0 ? numericSlot : index + 1;

    return {
      teamName,
      slot,
      players: Array.isArray(teamData?.players) ? teamData.players : []
    };
  });
}

function chunkArray(list, size) {
  const chunks = [];
  for (let i = 0; i < list.length; i += size) {
    chunks.push(list.slice(i, i + size));
  }
  return chunks;
}

function getNextAvailableSlot(limit = getRegistrationLimit()) {
  const used = new Set(
    Object.values(teams)
      .map(team => Number(team?.slot))
      .filter(slot => Number.isInteger(slot) && slot >= 1)
  );

  for (let i = 1; i <= limit; i++) {
    if (!used.has(i)) return i;
  }

  return null;
}

function isTournamentFull() {
  return Object.keys(teams).length >= getRegistrationLimit();
}

function sanitizeChannelNamePart(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildTeamVoiceChannelName(slot, teamName) {
  const safeSlot = Number.isInteger(Number(slot)) && Number(slot) > 0 ? Number(slot) : '-';
  const cleanTeam = sanitizeChannelNamePart(teamName) || 'TEAM';
  return `🏆・#${safeSlot} ${cleanTeam}`;
}

function getSavedRoomsCategoryId() {
  return getBotSettings().roomsCategoryId || CATEGORY_ID;
}

function logAudit(actor, source, action, details = {}) {
  try {
    appendAuditLog({ actor, source, action, details });
  } catch (error) {
    console.error('Errore audit log:', error);
  }
}

function createRegisterPanelPayload() {
  const project = getProjectSettings();

  const btn = new ButtonBuilder()
    .setCustomId('register_btn')
    .setLabel('📥 REGISTRA TEAM')
    .setStyle(ButtonStyle.Primary);

  return {
    content: `**${project.tournamentName}**\nClicca per registrare il team`,
    components: [new ActionRowBuilder().addComponents(btn)]
  };
}

function createResultsPanelPayload() {
  if (Object.keys(teams).length === 0) {
    throw new Error('Nessun team registrato');
  }

  const project = getProjectSettings();

  const menu = new StringSelectMenuBuilder()
    .setCustomId('team_select')
    .setPlaceholder('Scegli team')
    .addOptions(
      getSortedTeamEntries().map(([teamName, teamData]) => ({
        label: `#${teamData.slot || '-'} ${teamName}`.slice(0, 100),
        value: teamName
      }))
    );

  return {
    content: `**${project.tournamentName}** • 📊 MATCH ${data.currentMatch}`,
    components: [new ActionRowBuilder().addComponents(menu)]
  };
}

async function maybeAnnounceTournamentFull() {
  if (!isTournamentFull()) {
    if (data.registrationClosedAnnounced) {
      data.registrationClosedAnnounced = false;
      saveState();
    }
    return;
  }

  if (data.registrationClosedAnnounced) return;

  const project = getProjectSettings();

  try {
    const channel = await client.channels.fetch(TOURNAMENT_FULL_CHANNEL);
    const embed = new EmbedBuilder()
      .setColor(0x7b2cff)
      .setTitle('🚫 REGISTRAZIONI CHIUSE')
      .setDescription(
        `**${project.tournamentName}** ha raggiunto il limite massimo di **${getRegistrationLimit()} team registrati**.\n\n` +
        'Grazie a tutti per l’interesse. Le iscrizioni sono ora chiuse. 🔥'
      );

    await channel.send({ embeds: [embed] });
    data.registrationClosedAnnounced = true;
    saveState();

    logAudit('bot', 'discord', 'registration_closed_announced', {
      tournamentName: project.tournamentName,
      maxTeams: getRegistrationLimit()
    });
  } catch (error) {
    console.error('Errore annuncio torneo pieno:', error);
  }
}

function drawRoundedRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function fillRoundedRect(ctx, x, y, w, h, r, fillStyle) {
  ctx.save();
  ctx.fillStyle = fillStyle;
  drawRoundedRect(ctx, x, y, w, h, r);
  ctx.fill();
  ctx.restore();
}

function strokeRoundedRect(ctx, x, y, w, h, r, strokeStyle, lineWidth = 1) {
  ctx.save();
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = lineWidth;
  drawRoundedRect(ctx, x, y, w, h, r);
  ctx.stroke();
  ctx.restore();
}

function glowRoundedRect(ctx, x, y, w, h, r, glowColor, fillColor) {
  ctx.save();
  ctx.shadowColor = glowColor;
  ctx.shadowBlur = 36;
  fillRoundedRect(ctx, x, y, w, h, r, fillColor);
  ctx.restore();
  strokeRoundedRect(ctx, x, y, w, h, r, 'rgba(167, 116, 255, 0.35)', 2);
}

function measureFittedFont(ctx, text, maxWidth, startSize, weight = '700') {
  let size = startSize;
  while (size > 18) {
    ctx.font = `${weight} ${size}px sans-serif`;
    if (ctx.measureText(text).width <= maxWidth) {
      return ctx.font;
    }
    size -= 2;
  }
  ctx.font = `${weight} 18px sans-serif`;
  return ctx.font;
}

async function generateRegistrationStatusPanelBuffer() {
  const project = getProjectSettings();
  const displayTeams = getDisplayTeams();
  const title = sanitizeText(data.registrationStatusTitle) || 'Slot Team Registrati';
  const intro = sanitizeText(data.registrationStatusText);
  const limit = getRegistrationLimit();
  const registered = displayTeams.length;
  const freeSpots = Math.max(limit - registered, 0);
  const isFull = registered >= limit;

  const width = 1600;
  const leftPad = 64;
  const topPad = 56;
  const rowHeight = 58;
  const listTop = 320;
  const bottomPad = 56;
  const rows = Math.max(displayTeams.length, 1);
  const height = Math.max(900, listTop + rows * rowHeight + bottomPad);

  const canvas = Canvas.createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  const bg = ctx.createLinearGradient(0, 0, 0, height);
  bg.addColorStop(0, '#06060b');
  bg.addColorStop(1, '#0d0b14');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.shadowColor = 'rgba(123, 44, 255, 0.35)';
  ctx.shadowBlur = 120;
  ctx.fillStyle = 'rgba(123, 44, 255, 0.18)';
  ctx.beginPath();
  ctx.arc(240, 160, 120, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(width - 220, 180, 130, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(width / 2, height - 120, 180, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  glowRoundedRect(ctx, 34, 34, width - 68, height - 68, 34, 'rgba(123, 44, 255, 0.50)', 'rgba(16, 16, 26, 0.92)');

  fillRoundedRect(ctx, 56, 56, width - 112, 170, 28, 'rgba(255,255,255,0.025)');
  strokeRoundedRect(ctx, 56, 56, width - 112, 170, 28, 'rgba(168, 124, 255, 0.22)', 2);

  const logoPath = path.join(__dirname, 'public', 'roda-logo.png');
  const logoExists = fs.existsSync(logoPath);

  if (logoExists) {
    try {
      const logo = await Canvas.loadImage(logoPath);
      ctx.save();
      ctx.shadowColor = 'rgba(123, 44, 255, 0.70)';
      ctx.shadowBlur = 40;
      fillRoundedRect(ctx, 82, 82, 124, 124, 30, 'rgba(123,44,255,0.12)');
      ctx.restore();
      ctx.drawImage(logo, 92, 92, 104, 104);
    } catch (error) {
      console.error('Errore caricamento logo RØDA:', error);
    }
  }

  ctx.fillStyle = '#ffffff';
  ctx.font = '700 26px sans-serif';
  ctx.fillText(project.brandName, 230, 102);

  ctx.fillStyle = '#e9dcff';
  ctx.font = measureFittedFont(ctx, project.tournamentName, width - 420, 52, '800');
  ctx.fillText(project.tournamentName, 230, 154);

  ctx.fillStyle = '#b5b0cf';
  ctx.font = '500 22px sans-serif';
  ctx.fillText(title, 230, 194);

  const cardsY = 244;
  const cardGap = 20;
  const cardW = (width - leftPad * 2 - cardGap * 2) / 3;
  const cardH = 110;

  const summaryCards = [
    { label: 'TEAM REGISTRATI', value: `${registered}/${limit}` },
    { label: 'POSTI DISPONIBILI', value: `${freeSpots}` },
    { label: 'STATO', value: isFull ? 'TORNEO PIENO' : 'ISCRIZIONI APERTE' }
  ];

  summaryCards.forEach((card, index) => {
    const x = leftPad + index * (cardW + cardGap);
    glowRoundedRect(ctx, x, cardsY, cardW, cardH, 24, 'rgba(123,44,255,0.35)', 'rgba(255,255,255,0.03)');
    ctx.fillStyle = '#a8a2c8';
    ctx.font = '700 18px sans-serif';
    ctx.fillText(card.label, x + 24, cardsY + 34);

    ctx.fillStyle = '#ffffff';
    ctx.font = measureFittedFont(ctx, card.value, cardW - 48, 38, '800');
    ctx.fillText(card.value, x + 24, cardsY + 78);
  });

  const listCardY = listTop - 20;
  const listCardH = height - listCardY - 44;
  glowRoundedRect(ctx, leftPad, listCardY, width - leftPad * 2, listCardH, 28, 'rgba(123,44,255,0.35)', 'rgba(255,255,255,0.025)');

  ctx.fillStyle = '#f5efff';
  ctx.font = '800 30px sans-serif';
  ctx.fillText('SLOT TEAM REGISTRATI', leftPad + 28, listCardY + 48);

  if (intro) {
    ctx.fillStyle = '#b7b0d2';
    ctx.font = '500 18px sans-serif';
    ctx.fillText(intro, leftPad + 28, listCardY + 78);
  }

  const lineStartY = listCardY + (intro ? 108 : 90);

  ctx.strokeStyle = 'rgba(170, 120, 255, 0.18)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(leftPad + 28, lineStartY);
  ctx.lineTo(width - leftPad - 28, lineStartY);
  ctx.stroke();

  if (!displayTeams.length) {
    ctx.fillStyle = '#c9c3e3';
    ctx.font = '700 28px sans-serif';
    ctx.fillText('Nessun team registrato al momento.', leftPad + 34, lineStartY + 80);
  } else {
    const columns = 2;
    const columnGap = 26;
    const columnWidth = (width - leftPad * 2 - 56 - columnGap) / columns;
    const rowsPerColumn = Math.ceil(displayTeams.length / columns);

    const groups = chunkArray(displayTeams, rowsPerColumn);

    groups.forEach((group, colIndex) => {
      const baseX = leftPad + 28 + colIndex * (columnWidth + columnGap);

      group.forEach((team, rowIndex) => {
        const y = lineStartY + 26 + rowIndex * rowHeight;
        const rowBoxH = 42;

        fillRoundedRect(ctx, baseX, y, columnWidth, rowBoxH, 16, 'rgba(255,255,255,0.03)');
        strokeRoundedRect(ctx, baseX, y, columnWidth, rowBoxH, 16, 'rgba(170,120,255,0.12)', 1);

        ctx.fillStyle = '#ffffff';
        ctx.font = '800 22px sans-serif';
        ctx.fillText(`#${team.slot}`, baseX + 18, y + 28);

        ctx.fillStyle = '#efe9ff';
        ctx.font = measureFittedFont(ctx, team.teamName, columnWidth - 120, 24, '700');
        ctx.fillText(team.teamName, baseX + 90, y + 28);
      });
    });
  }

  ctx.fillStyle = '#9e97bf';
  ctx.font = '500 16px sans-serif';
  ctx.fillText(`${project.brandName} • pannello slot sincronizzato`, leftPad + 30, height - 26);

  return await canvas.encode('png');
}

function buildRegistrationFallbackText() {
  const project = getProjectSettings();
  const displayTeams = getDisplayTeams();
  const limit = getRegistrationLimit();
  const freeSpots = Math.max(limit - displayTeams.length, 0);

  const lines = [
    `**${project.tournamentName}**`,
    `Team registrati: **${displayTeams.length}/${limit}**`,
    `Posti disponibili: **${freeSpots}**`,
    ''
  ];

  if (!displayTeams.length) {
    lines.push('Nessun team registrato al momento.');
  } else {
    displayTeams.forEach(team => {
      lines.push(`• **#${team.slot}** ${team.teamName}`);
    });
  }

  const joined = lines.join('\n');
  return joined.length > 1900 ? `${joined.slice(0, 1850)}\n...` : joined;
}

async function buildRegistrationStatusMessagePayload() {
  const imageBuffer = await generateRegistrationStatusPanelBuffer();
  const uniqueName = `registration-led-panel-${Date.now()}.png`;
  const attachment = new AttachmentBuilder(imageBuffer, { name: uniqueName });

  const project = getProjectSettings();
  const displayTeams = getDisplayTeams();
  const limit = getRegistrationLimit();
  const freeSpots = Math.max(limit - displayTeams.length, 0);

  const embed = new EmbedBuilder()
    .setColor(0x7b2cff)
    .setTitle(`🏆 ${project.tournamentName}`)
    .setDescription(
      `Pannello slot team registrati aggiornato in tempo reale.\n\n` +
      `**Team registrati:** ${displayTeams.length}/${limit}\n` +
      `**Posti disponibili:** ${freeSpots}`
    )
    .setImage(`attachment://${uniqueName}`);

  return {
    content: buildRegistrationFallbackText(),
    embeds: [embed],
    files: [attachment]
  };
}

async function refreshSavedPanels() {
  const settings = getBotSettings();
  const results = {
    registerPanel: null,
    resultsPanel: null
  };

  if (settings.registerPanelChannelId) {
    try {
      results.registerPanel = await spawnRegisterPanel(settings.registerPanelChannelId);
    } catch (error) {
      console.error('Errore refresh pannello registrazione:', error);
    }
  }

  if (settings.resultsPanelChannelId) {
    try {
      results.resultsPanel = await spawnResultsPanel(settings.resultsPanelChannelId);
    } catch (error) {
      console.error('Errore refresh pannello risultati:', error);
    }
  }

  return results;
}

async function updateSavedResultsPanelIfExists() {
  const settings = getBotSettings();
  if (!settings.resultsPanelChannelId) return { skipped: true };

  return spawnResultsPanel(settings.resultsPanelChannelId);
}

async function updateSavedRegisterPanelIfExists() {
  const settings = getBotSettings();
  if (!settings.registerPanelChannelId) return { skipped: true };

  return spawnRegisterPanel(settings.registerPanelChannelId);
}

function queueRegistrationStatusUpdate() {
  registrationStatusUpdateQueue = registrationStatusUpdateQueue
    .then(async () => {
      await waitReady();

      const channel = await client.channels.fetch(REGISTRATION_STATUS_CHANNEL);
      const payload = await buildRegistrationStatusMessagePayload();

      if (data.registrationStatusMessageId) {
        try {
          const msg = await channel.messages.fetch(data.registrationStatusMessageId);
          await msg.edit(payload);
          return true;
        } catch {}
      }

      const msg = await channel.send(payload);
      data.registrationStatusMessageId = msg.id;
      saveState();
      return true;
    })
    .catch(error => {
      console.error('Errore update messaggio slot team:', error);
    });

  return registrationStatusUpdateQueue;
}

async function updateRegistrationStatusMessage() {
  return queueRegistrationStatusUpdate();
}

async function handleRegistrationStateChange() {
  await updateRegistrationStatusMessage();
  await updateSavedRegisterPanelIfExists().catch(() => {});
  await updateSavedResultsPanelIfExists().catch(() => {});
  await maybeAnnounceTournamentFull();
}

function calcPoints(pos, kills) {
  const table = { 1: 15, 2: 12, 3: 10, 4: 8, 5: 6, 6: 4, 7: 2 };
  return (table[pos] || 0) + kills;
}

async function waitReady() {
  await readyPromise;
  return client;
}

function createResultEmbed(entry, footerText) {
  const project = getProjectSettings();
  const players = teams[entry.team]?.players || ['Player 1', 'Player 2', 'Player 3'];

  const embed = new EmbedBuilder()
    .setColor(0x7b2cff)
    .setTitle(`📸 NUOVO RISULTATO • ${project.tournamentName}`)
    .setDescription(
      `🏷️ Team: ${entry.team}
🎯 Slot: ${teams[entry.team]?.slot || '-'}
👤 ${players[0] || 'Player 1'}: ${Number(entry.kills?.[0] || 0)} kill
👤 ${players[1] || 'Player 2'}: ${Number(entry.kills?.[1] || 0)} kill
👤 ${players[2] || 'Player 3'}: ${Number(entry.kills?.[2] || 0)} kill

🔥 Totale: ${Number(entry.total || 0)}
🏆 Posizione: ${Number(entry.pos || 0)}
🧾 Inviato da: ${entry.submittedBy || 'Sconosciuto'}`
    )
    .setFooter({ text: footerText || '⏳ In attesa approvazione staff' });

  if (entry.image) {
    embed.setImage(entry.image);
  }

  return embed;
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
  const project = getProjectSettings();

  const sorted = Object.entries(data.scores || {}).sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0));
  const desc = sorted.map((t, i) => `#${i + 1} ${t[0]} - ${t[1]} pts`).join('\n') || 'Nessun dato';

  const frag = Object.entries(data.fragger || {})
    .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))
    .slice(0, 5)
    .map(f => `${f[0]} (${f[1]})`)
    .join('\n') || 'Nessuno';

  const embed = new EmbedBuilder()
    .setColor(0x7b2cff)
    .setTitle(`🏆 ${project.tournamentName} • CLASSIFICA MATCH ${data.currentMatch}`)
    .setDescription(desc)
    .addFields({ name: '🔥 Top Fragger', value: frag });

  if (data.leaderboardMessageId) {
    try {
      const msg = await channel.messages.fetch(data.leaderboardMessageId);
      await msg.edit({ embeds: [embed] });
      logAudit('bot', 'discord', 'leaderboard_updated', {
        currentMatch: data.currentMatch,
        updated: true
      });
      return { ok: true, updated: true };
    } catch {}
  }

  const msg = await channel.send({ embeds: [embed] });
  data.leaderboardMessageId = msg.id;
  saveState();

  logAudit('bot', 'discord', 'leaderboard_created', {
    currentMatch: data.currentMatch,
    created: true
  });

  return { ok: true, created: true };
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
  if (!entry.staffMessageId) return null;

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

async function approvePending(id, actor = 'system', source = 'system') {
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

  let storicoEmbed = await editStaffMessage(entry, true);
  if (!storicoEmbed) {
    storicoEmbed = createResultEmbed(entry, '✅ APPROVATO');
  }

  await sendResultToStorico(storicoEmbed);

  logAudit(actor, source, 'pending_approved', {
    pendingId: id,
    team: entry.team,
    total: Number(entry.total || 0),
    pos: Number(entry.pos || 0)
  });

  return { ok: true };
}

async function rejectPending(id, actor = 'system', source = 'system') {
  const entry = data.pending[id];
  if (!entry) return { already: true };

  delete data.pending[id];
  saveState();

  await editStaffMessage(entry, false);

  logAudit(actor, source, 'pending_rejected', {
    pendingId: id,
    team: entry.team,
    total: Number(entry.total || 0),
    pos: Number(entry.pos || 0)
  });

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

  logAudit(entry.submittedBy || 'unknown', entry.source || 'system', 'pending_created', {
    pendingId: id,
    team: entry.team,
    total: Number(entry.total || 0),
    pos: Number(entry.pos || 0)
  });

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

  const botSettings = getBotSettings();
  const targetChannelId = sanitizeText(channelId) || botSettings.registerPanelChannelId;
  if (!targetChannelId) {
    throw new Error('Channel ID pannello registrazione non valido');
  }

  const channel = await client.channels.fetch(targetChannelId);
  const payload = createRegisterPanelPayload();

  let created = false;
  let updated = false;

  if (botSettings.registerPanelMessageId && botSettings.registerPanelChannelId === targetChannelId) {
    try {
      const msg = await channel.messages.fetch(botSettings.registerPanelMessageId);
      await msg.edit(payload);
      updated = true;
    } catch {}
  }

  if (!updated) {
    const msg = await channel.send(payload);
    data.botSettings.registerPanelMessageId = msg.id;
    created = true;
  }

  data.botSettings.registerPanelChannelId = targetChannelId;
  saveState();

  logAudit('dashboard', 'web', 'register_panel_sent', {
    channelId: targetChannelId,
    created,
    updated
  });

  return { ok: true, created, updated };
}

async function spawnResultsPanel(channelId) {
  await waitReady();

  const botSettings = getBotSettings();
  const targetChannelId = sanitizeText(channelId) || botSettings.resultsPanelChannelId;
  if (!targetChannelId) {
    throw new Error('Channel ID pannello risultati non valido');
  }

  const channel = await client.channels.fetch(targetChannelId);
  const payload = createResultsPanelPayload();

  let created = false;
  let updated = false;

  if (botSettings.resultsPanelMessageId && botSettings.resultsPanelChannelId === targetChannelId) {
    try {
      const msg = await channel.messages.fetch(botSettings.resultsPanelMessageId);
      await msg.edit(payload);
      updated = true;
    } catch {}
  }

  if (!updated) {
    const msg = await channel.send(payload);
    data.botSettings.resultsPanelMessageId = msg.id;
    created = true;
  }

  data.botSettings.resultsPanelChannelId = targetChannelId;
  saveState();

  logAudit('dashboard', 'web', 'results_panel_sent', {
    channelId: targetChannelId,
    created,
    updated
  });

  return { ok: true, created, updated };
}

async function createTeamRooms(customCategoryId) {
  await waitReady();
  const guild = await client.guilds.fetch(GUILD_ID);
  const categoryIdToUse = sanitizeText(customCategoryId) || getSavedRoomsCategoryId();

  if (!categoryIdToUse) {
    throw new Error('Categoria non valida');
  }

  const categoryChannel = await guild.channels.fetch(categoryIdToUse).catch(() => null);
  if (!categoryChannel) {
    throw new Error('Categoria non trovata');
  }

  if (categoryChannel.type !== ChannelType.GuildCategory) {
    throw new Error('Il channel selezionato non è una categoria');
  }

  const sortedTeams = getSortedTeamEntries();
  if (!sortedTeams.length) {
    throw new Error('Nessun team registrato');
  }

  const existingNames = new Set(
    guild.channels.cache
      .filter(c => c.parentId === categoryIdToUse && c.type === ChannelType.GuildVoice)
      .map(c => c.name)
  );

  let created = 0;
  let skipped = 0;

  for (const [teamName, teamData] of sortedTeams) {
    const channelName = buildTeamVoiceChannelName(teamData.slot, teamName);

    if (existingNames.has(channelName)) {
      skipped++;
      continue;
    }

    await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildVoice,
      parent: categoryIdToUse
    });

    existingNames.add(channelName);
    created++;
  }

  data.botSettings.roomsCategoryId = categoryIdToUse;
  saveState();

  logAudit('dashboard', 'web', 'team_rooms_created', {
    categoryId: categoryIdToUse,
    created,
    skipped
  });

  return { ok: true, created, skipped };
}

async function deleteTeamRooms(customCategoryId) {
  await waitReady();
  const guild = await client.guilds.fetch(GUILD_ID);
  const categoryIdToUse = sanitizeText(customCategoryId) || getSavedRoomsCategoryId();

  const channels = guild.channels.cache.filter(c =>
    c.parentId === categoryIdToUse &&
    c.type === ChannelType.GuildVoice &&
    c.name.startsWith('🏆・#')
  );

  let deleted = 0;

  for (const ch of channels.values()) {
    try {
      await ch.delete();
      deleted++;
    } catch {}
  }

  data.botSettings.roomsCategoryId = categoryIdToUse;
  saveState();

  logAudit('dashboard', 'web', 'team_rooms_deleted', {
    categoryId: categoryIdToUse,
    deleted
  });

  return { ok: true, deleted };
}

async function saveDiscordAttachmentLocally(attachment) {
  const tryUrls = [attachment.url, attachment.proxyURL].filter(Boolean);

  for (const target of tryUrls) {
    try {
      const response = await fetch(target);
      if (!response.ok) continue;

      const contentType = response.headers.get('content-type') || '';
      let ext = 'jpg';

      if (contentType.includes('png')) ext = 'png';
      else if (contentType.includes('webp')) ext = 'webp';
      else if (contentType.includes('gif')) ext = 'gif';
      else if (contentType.includes('jpeg') || contentType.includes('jpg')) ext = 'jpg';
      else if (attachment.name && attachment.name.includes('.')) {
        ext = attachment.name.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
      }

      const fileName = `discord-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
      const filePath = path.join(UPLOADS_DIR, fileName);
      const arrayBuffer = await response.arrayBuffer();

      fs.writeFileSync(filePath, Buffer.from(arrayBuffer));
      return buildPublicUploadUrl(fileName);
    } catch {}
  }

  return attachment.url;
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

function resetAllState() {
  data = getDefaultData();
  saveState();
}

function saveBotPanelSettings(settings = {}) {
  ensureDataStructures();

  data.botSettings.registerPanelChannelId = sanitizeText(
    settings.registerPanelChannelId || data.botSettings.registerPanelChannelId
  );

  data.botSettings.resultsPanelChannelId = sanitizeText(
    settings.resultsPanelChannelId || data.botSettings.resultsPanelChannelId
  );

  data.botSettings.roomsCategoryId = sanitizeText(
    settings.roomsCategoryId || data.botSettings.roomsCategoryId
  );

  saveState();

  logAudit('dashboard', 'web', 'bot_settings_saved', {
    registerPanelChannelId: data.botSettings.registerPanelChannelId,
    resultsPanelChannelId: data.botSettings.resultsPanelChannelId,
    roomsCategoryId: data.botSettings.roomsCategoryId
  });

  return {
    registerPanelChannelId: data.botSettings.registerPanelChannelId,
    resultsPanelChannelId: data.botSettings.resultsPanelChannelId,
    roomsCategoryId: data.botSettings.roomsCategoryId
  };
}

function getBotConfig() {
  const botSettings = getBotSettings();
  const project = getProjectSettings();

  return {
    guildId: GUILD_ID,
    staffChannel: STAFF_CHANNEL,
    classificaChannel: CLASSIFICA_CHANNEL,
    categoryId: getSavedRoomsCategoryId(),
    storicoChannel: STORICO_CHANNEL,
    tournamentFullChannel: TOURNAMENT_FULL_CHANNEL,
    registrationStatusChannel: REGISTRATION_STATUS_CHANNEL,
    registerPanelChannelId: botSettings.registerPanelChannelId,
    resultsPanelChannelId: botSettings.resultsPanelChannelId,
    roomsCategoryId: botSettings.roomsCategoryId,
    brandName: project.brandName,
    tournamentName: project.tournamentName,
    premiumMode: project.premiumMode
  };
}

client.once('ready', async () => {
  console.log('ONLINE');
  if (readyResolver) readyResolver(client);

  teams = loadTeams();
  data = loadData();

  logAudit('bot', 'discord', 'bot_ready', {
    guildId: GUILD_ID
  });

  await handleRegistrationStateChange();
});

client.on('interactionCreate', async interaction => {
  try {
    if (interaction.isButton() && interaction.customId === 'register_btn') {
      const project = getProjectSettings();

      if (isTournamentFull()) {
        await maybeAnnounceTournamentFull();
        return interaction.reply({
          content: `🚫 Le registrazioni sono chiuse. **${project.tournamentName}** ha già raggiunto ${getRegistrationLimit()} team.`,
          ephemeral: true
        });
      }

      const modal = new ModalBuilder()
        .setCustomId('register_modal')
        .setTitle(`Registrazione Team • ${project.brandName}`);

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
      const project = getProjectSettings();
      const team = interaction.values[0];
      const players = teams[team]?.players || ['Player 1', 'Player 2', 'Player 3'];

      const modal = new ModalBuilder()
        .setCustomId(`modal_${team}`)
        .setTitle(`${project.tournamentName} • ${team}`.slice(0, 45));

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
      const project = getProjectSettings();

      if (!team || !p1 || !p2 || !p3) {
        return interaction.reply({ content: '❌ Compila tutti i campi', ephemeral: true });
      }

      if (teams[team]) {
        return interaction.reply({ content: '❌ Esiste già un team con questo nome', ephemeral: true });
      }

      if (isTournamentFull()) {
        await maybeAnnounceTournamentFull();
        return interaction.reply({
          content: `🚫 Le registrazioni sono chiuse. **${project.tournamentName}** ha già raggiunto ${getRegistrationLimit()} team.`,
          ephemeral: true
        });
      }

      const slot = getNextAvailableSlot();
      if (!slot) {
        await maybeAnnounceTournamentFull();
        return interaction.reply({
          content: '🚫 Nessuno slot disponibile. Registrazioni chiuse.',
          ephemeral: true
        });
      }

      teams[team] = {
        slot,
        players: [p1, p2, p3]
      };

      saveEverything();
      await handleRegistrationStateChange();

      logAudit(interaction.user.tag, 'discord', 'team_registered_discord', {
        team,
        slot,
        players: [p1, p2, p3]
      });

      return interaction.reply({
        content: `✅ Team registrato con successo nello **slot #${slot}** di **${project.tournamentName}**`,
        ephemeral: true
      });
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

      logAudit(interaction.user.tag, 'discord', 'result_modal_submitted', {
        team,
        total,
        pos
      });

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

        await approvePending(id, interaction.user.tag, 'discord');
        const embed = createResultEmbed(entry, '✅ APPROVATO');
        return interaction.update({ embeds: [embed], components: [] });
      }

      if (action === 'no') {
        const entry = data.pending[id];
        if (!entry) {
          return interaction.reply({ content: '❌ Risultato non trovato', ephemeral: true });
        }

        await rejectPending(id, interaction.user.tag, 'discord');
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

    const attachment = message.attachments.first();
    const image = await saveDiscordAttachmentLocally(attachment);

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
  updateRegistrationStatusMessage,
  handleRegistrationStateChange,
  approvePending,
  rejectPending,
  spawnRegisterPanel,
  spawnResultsPanel,
  refreshSavedPanels,
  updateSavedResultsPanelIfExists,
  updateSavedRegisterPanelIfExists,
  createTeamRooms,
  deleteTeamRooms,
  nextMatch,
  setCurrentMatch,
  submitWebResult,
  getBotConfig,
  resetAllState,
  saveBotPanelSettings
};
