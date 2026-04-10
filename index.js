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

function glowRoundedRect(ctx, x, y, w, h, r, glowColor, fillColor, blur = 36) {
  ctx.save();
  ctx.shadowColor = glowColor;
  ctx.shadowBlur = blur;
  fillRoundedRect(ctx, x, y, w, h, r, fillColor);
  ctx.restore();
  strokeRoundedRect(ctx, x, y, w, h, r, 'rgba(167,116,255,0.35)', 2);
}

function escapeXml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function svgToDataUri(svg) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

async function drawSvgText(ctx, text, x, y, options = {}) {
  const {
    size = 28,
    weight = 700,
    color = '#ffffff',
    maxWidth = 800,
    align = 'left',
    baseline = 'alphabetic'
  } = options;

  const safeText = escapeXml(text);
  const anchor = align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start';
  const dominantBaseline = baseline === 'middle' ? 'middle' : 'alphabetic';

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${Math.max(32, Math.ceil(maxWidth + 20))}" height="${Math.max(32, Math.ceil(size * 2.2))}">
      <text
        x="${align === 'center' ? Math.max(16, Math.ceil(maxWidth / 2)) : align === 'right' ? Math.max(16, Math.ceil(maxWidth)) : 0}"
        y="${baseline === 'middle' ? Math.ceil(size) : Math.ceil(size * 1.2)}"
        font-family="Arial, Helvetica, sans-serif"
        font-size="${size}"
        font-weight="${weight}"
        fill="${color}"
        text-anchor="${anchor}"
        dominant-baseline="${dominantBaseline}"
      >${safeText}</text>
    </svg>
  `;

  const image = await Canvas.loadImage(svgToDataUri(svg));
  const drawX = align === 'center' ? x - image.width / 2 : align === 'right' ? x - image.width : x;
  const drawY = baseline === 'middle' ? y - image.height / 2 : y - image.height + size * 1.2;
  ctx.drawImage(image, drawX, drawY);
}

async function drawSvgMultilineText(ctx, lines, x, y, options = {}) {
  const {
    size = 22,
    weight = 500,
    color = '#d7cff0',
    lineHeight = 30,
    maxWidth = 760
  } = options;

  for (let i = 0; i < lines.length; i++) {
    await drawSvgText(ctx, lines[i], x, y + i * lineHeight, {
      size,
      weight,
      color,
      maxWidth,
      align: 'left',
      baseline: 'alphabetic'
    });
  }
}

async function generateRegistrationBannerBuffer() {
  const project = getProjectSettings();
  const displayTeams = getDisplayTeams();
  const limit = getRegistrationLimit();
  const freeSpots = Math.max(limit - displayTeams.length, 0);
  const title = sanitizeText(data.registrationStatusTitle) || 'Slot Team Registrati';
  const intro = sanitizeText(data.registrationStatusText) || 'Pannello premium sincronizzato con sito e Discord.';
  const isFull = displayTeams.length >= limit;

  const width = 2400;
  const height = 1600;
  const columns = 2;
  const rows = 4;
  const visibleCards = columns * rows;
  const visibleTeams = displayTeams.slice(0, visibleCards);

  const canvas = Canvas.createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, '#05050a');
  bg.addColorStop(0.38, '#0a0813');
  bg.addColorStop(0.72, '#130b1d');
  bg.addColorStop(1, '#1b1128');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.shadowColor = 'rgba(123,44,255,0.35)';
  ctx.shadowBlur = 220;
  ctx.fillStyle = 'rgba(123,44,255,0.15)';
  ctx.beginPath();
  ctx.arc(130, 120, 180, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(width - 140, 120, 180, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(width / 2, height - 10, 330, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  glowRoundedRect(
    ctx,
    22,
    22,
    width - 44,
    height - 44,
    42,
    'rgba(123,44,255,0.55)',
    'rgba(11,11,19,0.96)',
    74
  );

  glowRoundedRect(
    ctx,
    56,
    52,
    width - 112,
    220,
    34,
    'rgba(123,44,255,0.22)',
    'rgba(255,255,255,0.024)',
    34
  );

  const logoPath = path.join(__dirname, 'public', 'roda-logo.png');
  if (fs.existsSync(logoPath)) {
    try {
      const logo = await Canvas.loadImage(logoPath);
      glowRoundedRect(
        ctx,
        92,
        88,
        136,
        136,
        32,
        'rgba(123,44,255,0.60)',
        'rgba(123,44,255,0.12)',
        38
      );
      ctx.drawImage(logo, 110, 106, 100, 100);
    } catch (error) {
      console.error('Errore caricamento logo RØDA:', error);
    }
  }

  await drawSvgText(ctx, project.brandName, 270, 118, {
    size: 30,
    weight: 700,
    color: '#ffffff',
    maxWidth: 500
  });

  await drawSvgText(ctx, project.tournamentName, 270, 198, {
    size: 76,
    weight: 800,
    color: '#f4ecff',
    maxWidth: 1100
  });

  await drawSvgText(ctx, title, 270, 240, {
    size: 28,
    weight: 600,
    color: '#bbb4d7',
    maxWidth: 1000
  });

  const pillX = width - 460;
  const pillY = 104;
  const pillW = 300;
  const pillH = 64;

  glowRoundedRect(
    ctx,
    pillX,
    pillY,
    pillW,
    pillH,
    22,
    'rgba(123,44,255,0.28)',
    isFull ? 'rgba(255,77,109,0.13)' : 'rgba(123,44,255,0.12)',
    26
  );

  const pillText = isFull ? 'TORNEO PIENO' : 'ISCRIZIONI APERTE';
  await drawSvgText(ctx, pillText, pillX + pillW / 2, pillY + pillH / 2, {
    size: 28,
    weight: 800,
    color: isFull ? '#ffd4dc' : '#f7f0ff',
    maxWidth: pillW - 20,
    align: 'center',
    baseline: 'middle'
  });

  const statY = 326;
  const statGap = 28;
  const statW = (width - 112 - statGap * 2) / 3;
  const statH = 132;

  const statCards = [
    { label: 'TEAM REGISTRATI', value: `${displayTeams.length}/${limit}` },
    { label: 'POSTI DISPONIBILI', value: `${freeSpots}` },
    { label: 'STATO', value: isFull ? 'CHIUSO' : 'APERTO' }
  ];

  for (let index = 0; index < statCards.length; index++) {
    const card = statCards[index];
    const x = 56 + index * (statW + statGap);

    glowRoundedRect(
      ctx,
      x,
      statY,
      statW,
      statH,
      28,
      'rgba(123,44,255,0.24)',
      'rgba(255,255,255,0.028)',
      28
    );

    await drawSvgText(ctx, card.label, x + 30, statY + 42, {
      size: 24,
      weight: 700,
      color: '#ab9fd1',
      maxWidth: statW - 60
    });

    await drawSvgText(ctx, card.value, x + 30, statY + 98, {
      size: 52,
      weight: 800,
      color: '#ffffff',
      maxWidth: statW - 60
    });
  }

  glowRoundedRect(
    ctx,
    56,
    506,
    width - 112,
    1030,
    32,
    'rgba(123,44,255,0.22)',
    'rgba(255,255,255,0.022)',
    28
  );

  await drawSvgText(ctx, 'PANNELLO SLOT TEAM', 92, 564, {
    size: 40,
    weight: 800,
    color: '#f5eeff',
    maxWidth: 800
  });

  await drawSvgText(ctx, intro, 92, 610, {
    size: 24,
    weight: 600,
    color: '#c3bcde',
    maxWidth: 1800
  });

  ctx.strokeStyle = 'rgba(170,120,255,0.18)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(92, 636);
  ctx.lineTo(width - 92, 636);
  ctx.stroke();

  if (!visibleTeams.length) {
    await drawSvgText(ctx, 'Nessun team registrato al momento.', 120, 760, {
      size: 40,
      weight: 700,
      color: '#f0e9ff',
      maxWidth: 900
    });
  } else {
    const cardWidth = 1088;
    const cardHeight = 190;
    const gapX = 48;
    const gapY = 28;
    const startX = 88;
    const startY = 700;

    for (let index = 0; index < visibleTeams.length; index++) {
      const team = visibleTeams[index];
      const col = index % columns;
      const row = Math.floor(index / columns);
      const x = startX + col * (cardWidth + gapX);
      const y = startY + row * (cardHeight + gapY);

      glowRoundedRect(
        ctx,
        x,
        y,
        cardWidth,
        cardHeight,
        26,
        'rgba(123,44,255,0.22)',
        'rgba(255,255,255,0.035)',
        20
      );

      fillRoundedRect(ctx, x + 22, y + 24, 120, 56, 18, 'rgba(123,44,255,0.18)');
      strokeRoundedRect(ctx, x + 22, y + 24, 120, 56, 18, 'rgba(170,120,255,0.45)', 1.5);

      await drawSvgText(ctx, `#${team.slot}`, x + 82, y + 58, {
        size: 28,
        weight: 800,
        color: '#ffffff',
        maxWidth: 90,
        align: 'center',
        baseline: 'middle'
      });

      await drawSvgText(ctx, sanitizeText(team.teamName) || 'TEAM', x + 166, y + 56, {
        size: 34,
        weight: 800,
        color: '#f4ecff',
        maxWidth: 850
      });

      const safePlayers = [
        `👤 ${sanitizeText(team.players?.[0]) || 'Player 1'}`,
        `👤 ${sanitizeText(team.players?.[1]) || 'Player 2'}`,
        `👤 ${sanitizeText(team.players?.[2]) || 'Player 3'}`
      ];

      await drawSvgMultilineText(ctx, safePlayers, x + 166, y + 98, {
        size: 22,
        weight: 500,
        color: '#d7cff0',
        lineHeight: 30,
        maxWidth: 840
      });
    }
  }

  if (displayTeams.length > visibleCards) {
    await drawSvgText(
      ctx,
      `Altri team non visibili in questa schermata: ${displayTeams.length - visibleCards}`,
      120,
      1500,
      {
        size: 24,
        weight: 600,
        color: '#bcaed9',
        maxWidth: 900
      }
    );
  }

  await drawSvgText(ctx, `${project.brandName} • grafica premium sincronizzata`, 92, 1560, {
    size: 20,
    weight: 500,
    color: '#8f86b5',
    maxWidth: 900
  });

  return await canvas.encode('png');
}

function getLogoUrl() {
  const baseUrl = getPublicBaseUrl();
  if (!baseUrl) return null;
  return `${baseUrl}/roda-logo.png`;
}

function formatTeamPlayers(players = []) {
  const safePlayers = [
    sanitizeText(players[0]) || 'Player 1',
    sanitizeText(players[1]) || 'Player 2',
    sanitizeText(players[2]) || 'Player 3'
  ];

  return [
    `👤 ${safePlayers[0]}`,
    `👤 ${safePlayers[1]}`,
    `👤 ${safePlayers[2]}`
  ].join('\n');
}

async function buildRegistrationStatusMessagePayload() {
  const panelBuffer = await generateRegistrationBannerBuffer();
  const panelName = `registration-panel-${Date.now()}.png`;
  const panelAttachment = new AttachmentBuilder(panelBuffer, { name: panelName });

  return {
    content: '',
    files: [panelAttachment]
  };
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
