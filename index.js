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

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const jimp = require('jimp');
const fonts = require('jimp/fonts');

const {
  loadData,
  loadTeams,
  saveData,
  saveAll,
  appendAuditLog,
  getDefaultData,
  UPLOADS_DIR
} = require('./storage');

const { Jimp, loadFont } = jimp;

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
let cachedFonts = null;

async function getBitmapFonts() {
  if (cachedFonts) return cachedFonts;

  cachedFonts = {
    title: await loadFont(fonts.SANS_64_WHITE),
    large: await loadFont(fonts.SANS_32_WHITE),
    medium: await loadFont(fonts.SANS_16_WHITE),
    small: await loadFont(fonts.SANS_16_WHITE)
  };

  return cachedFonts;
}

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

function refreshStateFromDisk() {
  data = loadData();
  teams = loadTeams();
  ensureDataStructures();
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

function getLogoDataUri() {
  try {
    const logoPath = path.join(__dirname, 'public', 'roda-logo.png');
    if (!fs.existsSync(logoPath)) return '';
    const buffer = fs.readFileSync(logoPath);
    return `data:image/png;base64,${buffer.toString('base64')}`;
  } catch {
    return '';
  }
}

function safeString(value) {
  return String(value || '').trim();
}

function truncateForBitmap(value, maxLength = 42) {
  const text = safeString(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

async function printBitmapText(image, font, x, y, text, maxWidth = null, maxHeight = null) {
  const normalized = safeString(text);
  if (!normalized) return;

  try {
    await image.print({
      font,
      x,
      y,
      text: normalized,
      maxWidth: maxWidth || undefined,
      maxHeight: maxHeight || undefined
    });
    return;
  } catch {}

  try {
    await image.print(font, x, y, normalized, maxWidth || undefined, maxHeight || undefined);
  } catch (error) {
    console.error('Errore print bitmap text:', error);
  }
}

async function compositeSvgBox(image, svgString, x, y) {
  const buffer = await sharp(Buffer.from(svgString)).png().toBuffer();
  const layer = await Jimp.read(buffer);
  image.composite(layer, x, y);
}

function buildPosterBaseSvg() {
  const displayTeams = getDisplayTeams();
  const limit = getRegistrationLimit();
  const isFull = displayTeams.length >= limit;
  const logoDataUri = getLogoDataUri();

  const width = 2400;
  const height = 3200;

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#11041b"/>
          <stop offset="35%" stop-color="#170624"/>
          <stop offset="70%" stop-color="#0c0d1d"/>
          <stop offset="100%" stop-color="#090a16"/>
        </linearGradient>

        <linearGradient id="titlePink" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#ff62ff"/>
          <stop offset="100%" stop-color="#bb4dff"/>
        </linearGradient>

        <linearGradient id="tableHead" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#ff55f7"/>
          <stop offset="100%" stop-color="#cf58ff"/>
        </linearGradient>

        <linearGradient id="tableBody" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#f2f5fb"/>
          <stop offset="100%" stop-color="#dde3ee"/>
        </linearGradient>

        <filter id="heavyGlow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="52" result="blur"/>
          <feMerge>
            <feMergeNode in="blur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>

        <filter id="softGlow" x="-25%" y="-25%" width="150%" height="150%">
          <feGaussianBlur stdDeviation="14" result="blur"/>
          <feMerge>
            <feMergeNode in="blur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
      </defs>

      <rect width="${width}" height="${height}" fill="url(#bg)"/>

      <polygon points="0,0 380,0 0,860" fill="rgba(214,70,255,0.20)" filter="url(#heavyGlow)"/>
      <polygon points="${width},0 ${width},820 ${width - 420},0" fill="rgba(122,68,255,0.18)" filter="url(#heavyGlow)"/>

      <rect x="56" y="1020" width="${width - 112}" height="100" rx="0" fill="url(#tableHead)" filter="url(#softGlow)"/>

      ${logoDataUri ? `<image href="${logoDataUri}" x="1680" y="160" width="260" height="260"/>` : ''}

      <rect x="720" y="760" width="960" height="84" fill="rgba(0,0,0,0.75)"/>

      <rect x="56" y="1120" width="${width - 112}" height="1850" fill="rgba(255,255,255,0.02)" stroke="rgba(255,255,255,0.14)" stroke-width="3"/>
      <line x1="250" y1="1020" x2="250" y2="2970" stroke="#35203f" stroke-width="5"/>
      <line x1="940" y1="1020" x2="940" y2="2970" stroke="#35203f" stroke-width="5"/>
      <line x1="1428" y1="1020" x2="1428" y2="2970" stroke="#35203f" stroke-width="5"/>
      <line x1="1719" y1="1020" x2="1719" y2="2970" stroke="#35203f" stroke-width="5"/>
      <line x1="2010" y1="1020" x2="2010" y2="2970" stroke="#35203f" stroke-width="5"/>

      <line x1="56" y1="1274" x2="${width - 56}" y2="1274" stroke="#35203f" stroke-width="5"/>
      <line x1="56" y1="1428" x2="${width - 56}" y2="1428" stroke="#35203f" stroke-width="5"/>
      <line x1="56" y1="1582" x2="${width - 56}" y2="1582" stroke="#35203f" stroke-width="5"/>
      <line x1="56" y1="1736" x2="${width - 56}" y2="1736" stroke="#35203f" stroke-width="5"/>
      <line x1="56" y1="1890" x2="${width - 56}" y2="1890" stroke="#35203f" stroke-width="5"/>
      <line x1="56" y1="2044" x2="${width - 56}" y2="2044" stroke="#35203f" stroke-width="5"/>
      <line x1="56" y1="2198" x2="${width - 56}" y2="2198" stroke="#35203f" stroke-width="5"/>
      <line x1="56" y1="2352" x2="${width - 56}" y2="2352" stroke="#35203f" stroke-width="5"/>
      <line x1="56" y1="2506" x2="${width - 56}" y2="2506" stroke="#35203f" stroke-width="5"/>
      <line x1="56" y1="2660" x2="${width - 56}" y2="2660" stroke="#35203f" stroke-width="5"/>
      <line x1="56" y1="2814" x2="${width - 56}" y2="2814" stroke="#35203f" stroke-width="5"/>
      <line x1="56" y1="2968" x2="${width - 56}" y2="2968" stroke="#35203f" stroke-width="5"/>

      <rect x="1650" y="68" rx="26" ry="26" width="560" height="90"
        fill="${isFull ? 'rgba(255,77,109,0.18)' : 'rgba(177,88,255,0.20)'}"
        stroke="rgba(255,255,255,0.18)"
        stroke-width="2"
        filter="url(#softGlow)"/>
    </svg>
  `;
}

async function createBasePosterImage() {
  const svg = buildPosterBaseSvg();
  const baseBuffer = await sharp(Buffer.from(svg)).png().toBuffer();
  return Jimp.read(baseBuffer);
}

function getRowY(index) {
  return 1120 + index * 154;
}

async function generateRegistrationBannerBuffer() {
  refreshStateFromDisk();

  const fontsLoaded = await getBitmapFonts();
  const image = await createBasePosterImage();

  const project = getProjectSettings();
  const displayTeams = getDisplayTeams();
  const limit = getRegistrationLimit();
  const freeSpots = Math.max(limit - displayTeams.length, 0);
  const title = sanitizeText(data.registrationStatusTitle) || 'TEAM REGISTRATI';
  const intro = sanitizeText(data.registrationStatusText) || 'Elenco completo dei team con slot assegnato e players registrati.';
  const isFull = displayTeams.length >= limit;
  const pageTeams = displayTeams.slice(0, 12);

  await printBitmapText(image, fontsLoaded.title, 620, 180, 'TEAM', 520, 90);
  await printBitmapText(image, fontsLoaded.title, 620, 285, 'REGISTRATI', 780, 90);

  await printBitmapText(image, fontsLoaded.medium, 820, 790, truncateForBitmap(project.tournamentName, 42), 760, 30);

  await printBitmapText(image, fontsLoaded.medium, 96, 905, truncateForBitmap(title, 48), 800, 34);
  await printBitmapText(image, fontsLoaded.medium, 96, 952, truncateForBitmap(intro, 130), 1600, 30);

  await printBitmapText(image, fontsLoaded.medium, 1790, 100, isFull ? 'ISCRIZIONI CHIUSE' : 'ISCRIZIONI APERTE', 320, 32);

  await printBitmapText(image, fontsLoaded.medium, 88, 1052, 'SLOT', 120, 26);
  await printBitmapText(image, fontsLoaded.medium, 430, 1052, 'TEAM', 200, 26);
  await printBitmapText(image, fontsLoaded.medium, 1030, 1052, 'PLAYER 1', 220, 26);
  await printBitmapText(image, fontsLoaded.medium, 1490, 1052, 'PLAYER 2', 220, 26);
  await printBitmapText(image, fontsLoaded.medium, 1780, 1052, 'PLAYER 3', 220, 26);
  await printBitmapText(image, fontsLoaded.medium, 2080, 1052, 'TOT', 100, 26);

  if (!pageTeams.length) {
    await printBitmapText(image, fontsLoaded.large, 760, 1450, 'NESSUN TEAM REGISTRATO', 1000, 40);
  } else {
    for (let i = 0; i < pageTeams.length; i++) {
      const team = pageTeams[i];
      const rowY = getRowY(i) + 42;

      await printBitmapText(image, fontsLoaded.large, 118, rowY, String(team.slot), 80, 36);
      await printBitmapText(image, fontsLoaded.large, 292, rowY, truncateForBitmap(team.teamName, 20), 560, 36);
      await printBitmapText(image, fontsLoaded.large, 980, rowY, truncateForBitmap(team.players?.[0] || '-', 12), 370, 36);
      await printBitmapText(image, fontsLoaded.large, 1450, rowY, truncateForBitmap(team.players?.[1] || '-', 12), 220, 36);
      await printBitmapText(image, fontsLoaded.large, 1740, rowY, truncateForBitmap(team.players?.[2] || '-', 12), 220, 36);
      await printBitmapText(image, fontsLoaded.large, 2140, rowY, '3', 60, 36);
    }
  }

  await printBitmapText(image, fontsLoaded.medium, 88, 3060, `TEAM: ${displayTeams.length}/${limit}`, 260, 28);
  await printBitmapText(image, fontsLoaded.medium, 420, 3060, `POSTI DISPONIBILI: ${freeSpots}`, 420, 28);
  await printBitmapText(image, fontsLoaded.medium, 980, 3060, `${project.brandName} • grafica premium sincronizzata`, 760, 28);

  return image.getBuffer('image/png');
}

async function saveRegistrationDebugFile(panelBuffer) {
  try {
    const debugFileName = 'registration-debug.png';
    const debugFilePath = path.join(UPLOADS_DIR, debugFileName);
    fs.writeFileSync(debugFilePath, panelBuffer);

    const debugUrl = buildPublicUploadUrl(debugFileName);
    console.log(`DEBUG registration panel salvato: ${debugFilePath}`);
    console.log(`DEBUG registration panel URL: ${debugUrl}`);

    return { ok: true, filePath: debugFilePath, url: debugUrl };
  } catch (error) {
    console.error('Errore salvataggio debug pannello:', error);
    return { ok: false, filePath: '', url: '' };
  }
}

async function buildRegistrationStatusMessagePayload() {
  refreshStateFromDisk();

  const panelBuffer = await generateRegistrationBannerBuffer();
  const panelName = `registration-panel-${Date.now()}.png`;
  const panelAttachment = new AttachmentBuilder(panelBuffer, { name: panelName });

  await saveRegistrationDebugFile(panelBuffer);

  return {
    content: '',
    files: [panelAttachment]
  };
}

function queueRegistrationStatusUpdate() {
  registrationStatusUpdateQueue = registrationStatusUpdateQueue
    .then(async () => {
      await waitReady();
      refreshStateFromDisk();

      const channel = await client.channels.fetch(REGISTRATION_STATUS_CHANNEL);
      const payload = await buildRegistrationStatusMessagePayload();

      if (data.registrationStatusMessageId) {
        try {
          const msg = await channel.messages.fetch(data.registrationStatusMessageId);
          await msg.edit({
            content: payload.content,
            files: payload.files,
            attachments: []
          });
          return true;
        } catch (error) {
          console.error('Errore edit pannello slot, invio nuovo messaggio:', error);
        }
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
  refreshStateFromDisk();
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

  refreshStateFromDisk();

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
      await interaction.deferReply({ ephemeral: true });

      refreshStateFromDisk();

      const team = sanitizeText(interaction.fields.getTextInputValue('team'));
      const p1 = sanitizeText(interaction.fields.getTextInputValue('p1'));
      const p2 = sanitizeText(interaction.fields.getTextInputValue('p2'));
      const p3 = sanitizeText(interaction.fields.getTextInputValue('p3'));
      const project = getProjectSettings();

      if (!team || !p1 || !p2 || !p3) {
        return interaction.editReply({ content: '❌ Compila tutti i campi' });
      }

      if (teams[team]) {
        return interaction.editReply({ content: '❌ Esiste già un team con questo nome' });
      }

      if (isTournamentFull()) {
        await maybeAnnounceTournamentFull();
        return interaction.editReply({
          content: `🚫 Le registrazioni sono chiuse. **${project.tournamentName}** ha già raggiunto ${getRegistrationLimit()} team.`
        });
      }

      const slot = getNextAvailableSlot();
      if (!slot) {
        await maybeAnnounceTournamentFull();
        return interaction.editReply({
          content: '🚫 Nessuno slot disponibile. Registrazioni chiuse.'
        });
      }

      teams[team] = {
        slot,
        players: [p1, p2, p3]
      };

      saveEverything();
      refreshStateFromDisk();
      await handleRegistrationStateChange();

      logAudit(interaction.user.tag, 'discord', 'team_registered_discord', {
        team,
        slot,
        players: [p1, p2, p3]
      });

      return interaction.editReply({
        content: `✅ Team registrato con successo nello **slot #${slot}** di **${project.tournamentName}**`
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

    try {
      if (interaction.isRepliable()) {
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply({ content: '❌ Si è verificato un errore durante l’operazione.' });
        } else {
          await interaction.reply({ content: '❌ Si è verificato un errore durante l’operazione.', ephemeral: true });
        }
      }
    } catch {}
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
