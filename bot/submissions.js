const path = require('path');
const fs = require('fs');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { client, waitReady } = require('./client');
const state = require('./state');
const {
  ensureDataStructures,
  saveState,
  logAudit,
  getProjectSettings,
  canSubmitResult,
  markSubmission,
  getSubmissionRecord
} = require('./lifecycle');
const { sanitizeText, calcPoints, buildPublicUploadUrl, PLAYERS_PER_TEAM } = require('./helpers');
const { STAFF_CHANNEL, STORICO_CHANNEL } = require('./config');
const { UPLOADS_DIR } = require('../storage');
const { refreshTeamResultPanels, updateLeaderboard } = require('./panels');

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'webm', 'mkv']);
const MAX_KILLS_PER_PLAYER = 80;

function safeExt(value, fallback = 'jpg') {
  const ext = String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
  return ext || fallback;
}

function getExtFromName(name, fallback = 'jpg') {
  const clean = String(name || '');
  if (!clean.includes('.')) return fallback;
  return safeExt(clean.split('.').pop(), fallback);
}

function getExtFromContentType(contentType, fallback = 'jpg') {
  const type = String(contentType || '').toLowerCase();
  if (type.includes('png')) return 'png';
  if (type.includes('webp')) return 'webp';
  if (type.includes('gif')) return 'gif';
  if (type.includes('jpeg') || type.includes('jpg')) return 'jpg';
  if (type.includes('heic')) return 'heic';
  if (type.includes('heif')) return 'heif';
  if (type.includes('mp4')) return 'mp4';
  if (type.includes('quicktime')) return 'mov';
  if (type.includes('webm')) return 'webm';
  return fallback;
}

function parseSafeKill(value, index) {
  const raw = String(value ?? 0).trim();
  if (!/^\d+$/.test(raw)) {
    throw new Error(`Kill giocatore ${index + 1} non valida.`);
  }
  const num = Number(raw);
  if (!Number.isSafeInteger(num) || num < 0 || num > MAX_KILLS_PER_PLAYER) {
    throw new Error(`Kill giocatore ${index + 1} deve essere tra 0 e ${MAX_KILLS_PER_PLAYER}.`);
  }
  return num;
}

function getTeamPlayersSnapshot(teamName) {
  const players = Array.isArray(state.teams?.[teamName]?.players) ? state.teams[teamName].players : [];
  return Array.from({ length: PLAYERS_PER_TEAM }, (_, index) => sanitizeText(players[index]) || `Giocatore ${index + 1}`);
}

function normalizeResultEntryForScoring(entry) {
  const safeEntry = entry && typeof entry === 'object' ? { ...entry } : {};
  const kills = Array.from({ length: PLAYERS_PER_TEAM }, (_, index) => parseSafeKill(Array.isArray(safeEntry.kills) ? safeEntry.kills[index] : 0, index));
  const total = kills.reduce((sum, value) => sum + value, 0);
  const playerNames = Array.isArray(safeEntry.playerNames) && safeEntry.playerNames.length >= PLAYERS_PER_TEAM
    ? safeEntry.playerNames.slice(0, PLAYERS_PER_TEAM).map((name, index) => sanitizeText(name) || `Giocatore ${index + 1}`)
    : getTeamPlayersSnapshot(safeEntry.team);

  return {
    ...safeEntry,
    kills,
    total,
    playerNames,
    points: calcPoints(Number(safeEntry.pos || 0), total)
  };
}

function uploadUrlToLocalPath(imageUrl) {
  const value = String(imageUrl || '').trim();
  if (!value) return null;
  let pathname = value;
  try {
    pathname = new URL(value).pathname;
  } catch {}
  if (!pathname.startsWith('/uploads/')) return null;
  const fileName = path.basename(pathname);
  if (!fileName) return null;
  const filePath = path.join(UPLOADS_DIR, fileName);
  return fs.existsSync(filePath) ? filePath : null;
}

function getFileNameFromImageUrl(imageUrl) {
  const local = uploadUrlToLocalPath(imageUrl);
  if (local) return path.basename(local);
  try { return path.basename(new URL(String(imageUrl || '')).pathname); } catch {}
  return path.basename(String(imageUrl || ''));
}

function isEmbedDisplayableImage(imageUrl) {
  const ext = getExtFromName(getFileNameFromImageUrl(imageUrl), '').toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
}

function createResultEmbed(entry, footerText) {
  const project = getProjectSettings();
  const normalizedEntry = normalizeResultEntryForScoring(entry);
  const players = normalizedEntry.playerNames || getTeamPlayersSnapshot(normalizedEntry.team);
  const points = calcPoints(Number(normalizedEntry.pos || 0), Number(normalizedEntry.total || 0));
  const embed = new EmbedBuilder()
    .setColor(0x7b2cff)
    .setTitle(`📸 NUOVO RISULTATO • ${project.tournamentName}`)
    .setDescription(
      `🏷️ **Team:** ${normalizedEntry.team}\n🎯 **Slot:** ${normalizedEntry.slot || state.teams[normalizedEntry.team]?.slot || '-'}\n🎮 **Match:** ${Number(normalizedEntry.matchNumber || state.data.currentMatch || 1)}\n\n` +
      `👤 **${players[0] || 'Giocatore 1'}:** ${Number(normalizedEntry.kills?.[0] || 0)} kill\n` +
      `👤 **${players[1] || 'Giocatore 2'}:** ${Number(normalizedEntry.kills?.[1] || 0)} kill\n` +
      `👤 **${players[2] || 'Giocatore 3'}:** ${Number(normalizedEntry.kills?.[2] || 0)} kill\n\n` +
      `🔥 **Totale kill:** ${Number(normalizedEntry.total || 0)}\n🏆 **Posizione:** ${Number(normalizedEntry.pos || 0)}\n📊 **Punti calcolati:** ${points}\n🧾 **Inviato da:** ${normalizedEntry.submittedBy || 'Sconosciuto'}`
    )
    .setFooter({ text: footerText || '⏳ In attesa approvazione staff' });
  if (normalizedEntry.image && isEmbedDisplayableImage(normalizedEntry.image)) embed.setImage(normalizedEntry.image);
  return embed;
}

function createStaffActionRow(id) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ok_${id}`).setLabel('APPROVA').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`no_${id}`).setLabel('RIFIUTA').setStyle(ButtonStyle.Danger)
  );
}

function buildAttachmentPayloadForStaff(entry, embed) {
  const image = String(entry && entry.image || '').trim();
  const filePath = uploadUrlToLocalPath(image);
  if (!filePath) return { embeds: [embed], files: [] };

  const fileName = path.basename(filePath);
  const ext = getExtFromName(fileName, '').toLowerCase();
  const files = [{ attachment: filePath, name: fileName }];

  if (IMAGE_EXTENSIONS.has(ext)) {
    embed.setImage(`attachment://${fileName}`);
  }

  return { embeds: [embed], files };
}

async function saveDiscordAttachmentLocally(attachment) {
  if (!attachment) throw new Error('Nessun file ricevuto. Invia una foto o un video come allegato.');
  const tryUrls = [attachment.url, attachment.proxyURL].filter(Boolean);
  const errors = [];
  for (const target of tryUrls) {
    try {
      const response = await fetch(target);
      if (!response.ok) { errors.push(`HTTP ${response.status} su ${target}`); continue; }
      const contentType = response.headers.get('content-type') || '';
      const nameExt = getExtFromName(attachment.name || attachment.filename || '', '');
      const ext = safeExt(nameExt || getExtFromContentType(contentType, 'jpg'), 'jpg');
      const fileName = `discord-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
      const filePath = path.join(UPLOADS_DIR, fileName);
      fs.mkdirSync(UPLOADS_DIR, { recursive: true });
      const arrayBuffer = await response.arrayBuffer();
      fs.writeFileSync(filePath, Buffer.from(arrayBuffer));
      return buildPublicUploadUrl(fileName);
    } catch (err) { errors.push(err.message || String(err)); }
  }
  console.error('[saveDiscordAttachmentLocally] impossibile scaricare lo screenshot:', errors);
  throw new Error('Non sono riuscito a salvare il tuo screenshot. Riprova fra qualche secondo o invia un altro file.');
}

function saveDataUrlLocally(dataUrl) {
  const raw = String(dataUrl || '').trim();
  const match = raw.match(/^data:([^;]+);base64,(.+)$/i);
  if (!match) return raw;
  const mime = match[1] || 'image/jpeg';
  const base64 = match[2] || '';
  const ext = safeExt(getExtFromContentType(mime, 'jpg'), 'jpg');
  const fileName = `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
  const filePath = path.join(UPLOADS_DIR, fileName);
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
  return buildPublicUploadUrl(fileName);
}

async function sendResultToStorico(embed, entry = null) {
  try {
    const storico = await client.channels.fetch(STORICO_CHANNEL);
    if (entry) {
      const payload = buildAttachmentPayloadForStaff(entry, embed);
      await storico.send(payload);
    } else {
      await storico.send({ embeds: [embed] });
    }
  } catch (err) { console.error('Errore invio storico:', err); }
}

async function sendTeamResultStatus(entry, approved) {
  const channelId = sanitizeText(entry?.teamResultChannelId);
  if (!channelId) return;
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel) return;
    const project = getProjectSettings();
    const normalizedEntry = normalizeResultEntryForScoring(entry);
    const embed = new EmbedBuilder()
      .setColor(approved ? 0x18c964 : 0xff4d6d)
      .setTitle(approved ? '✅ RISULTATO APPROVATO' : '❌ RISULTATO RIFIUTATO')
      .setDescription(`**Team:** ${normalizedEntry.team}\n**Match:** ${Number(normalizedEntry.matchNumber || state.data.currentMatch || 1)}\n**Posizione:** ${Number(normalizedEntry.pos || 0)}\n**Uccisioni totali:** ${Number(normalizedEntry.total || 0)}\n\n${approved ? 'Lo staff ha approvato il risultato inviato.' : 'Lo staff ha rifiutato il risultato inviato. Se richiesto dallo staff, il team potrà reinviarlo.'}`)
      .setFooter({ text: project.tournamentName });
    const msg = await channel.send({ embeds: [embed] });
    setTimeout(() => msg.delete().catch(() => {}), 30000);
  } catch (err) { console.error('Errore invio esito risultato al team:', err); }
}

async function editStaffMessage(entry, approved) {
  if (!entry.staffMessageId) return null;
  try {
    const staff = await client.channels.fetch(STAFF_CHANNEL);
    const msg = await staff.messages.fetch(entry.staffMessageId);
    const embed = EmbedBuilder.from(msg.embeds[0]).setFooter({ text: approved ? '✅ APPROVATO' : '❌ RIFIUTATO' });
    await msg.edit({ embeds: [embed], components: [] });
    return embed;
  } catch (err) { console.error('Errore update messaggio staff:', err); return null; }
}

async function approvePending(id, actor = 'system', source = 'system') {
  ensureDataStructures();
  const rawEntry = state.data.pending[id];
  if (!rawEntry) return { already: true };

  const entry = normalizeResultEntryForScoring(rawEntry);
  state.data.pending[id] = entry;

  const duplicateCheck = getSubmissionRecord(entry.team, Number(entry.matchNumber || 1));
  if (duplicateCheck.status === 'approvato' || duplicateCheck.status === 'inserito_manualmente') {
    delete state.data.pending[id];
    saveState();
    return { ok: false, message: 'Questo risultato risulta già registrato.' };
  }

  const pointsToAdd = calcPoints(Number(entry.pos || 0), Number(entry.total || 0));
  state.data.scores[entry.team] = Number(state.data.scores[entry.team] || 0) + pointsToAdd;

  const players = entry.playerNames || getTeamPlayersSnapshot(entry.team);
  entry.kills.forEach((k, i) => {
    const playerName = sanitizeText(players[i]) || `Giocatore ${i + 1}`;
    state.data.fragger[playerName] = Number(state.data.fragger[playerName] || 0) + Number(k || 0);
  });

  markSubmission(entry.team, Number(entry.matchNumber || 1), 'approvato', { pendingId: null, updatedBy: actor, source });
  delete state.data.pending[id];
  saveState();
  let storicoEmbed = await editStaffMessage(entry, true);
  if (!storicoEmbed) storicoEmbed = createResultEmbed(entry, '✅ APPROVATO');
  await sendResultToStorico(storicoEmbed, entry);
  await sendTeamResultStatus(entry, true);
  await updateLeaderboard({ allowCreate: true });
  await refreshTeamResultPanels().catch(() => {});
  logAudit(actor, source, 'risultato_approvato', { pendingId: id, team: entry.team, total: Number(entry.total || 0), kills: entry.kills, players: entry.playerNames, pos: Number(entry.pos || 0), puntiAggiunti: pointsToAdd, matchNumber: Number(entry.matchNumber || 0) });
  return { ok: true };
}

async function rejectPending(id, actor = 'system', source = 'system') {
  ensureDataStructures();
  const rawEntry = state.data.pending[id];
  if (!rawEntry) return { already: true };
  const entry = normalizeResultEntryForScoring(rawEntry);
  markSubmission(entry.team, Number(entry.matchNumber || 1), 'rifiutato', { pendingId: null, updatedBy: actor, source });
  delete state.data.pending[id];
  saveState();
  await editStaffMessage(entry, false);
  await sendTeamResultStatus(entry, false);
  await refreshTeamResultPanels().catch(() => {});
  logAudit(actor, source, 'risultato_rifiutato', { pendingId: id, team: entry.team, total: Number(entry.total || 0), kills: entry.kills, players: entry.playerNames, pos: Number(entry.pos || 0), matchNumber: Number(entry.matchNumber || 0) });
  return { ok: true };
}

async function createPendingSubmission(entry) {
  await waitReady();
  ensureDataStructures();
  const teamName = sanitizeText(entry.team);
  const matchNumber = Number(entry.matchNumber || state.data.currentMatch || 1);
  const check = canSubmitResult(teamName, matchNumber);
  if (!check.allowed) throw new Error(check.message.replace(/\*\*/g, ''));
  const id = String(Date.now());
  const normalizedEntry = normalizeResultEntryForScoring({
    ...entry,
    team: teamName,
    matchNumber,
    slot: entry.slot || state.teams[teamName]?.slot || null,
    playerNames: entry.playerNames || getTeamPlayersSnapshot(teamName)
  });
  state.data.pending[id] = normalizedEntry;
  markSubmission(teamName, matchNumber, 'in_attesa', { pendingId: id, updatedBy: entry.submittedBy || 'unknown', source: entry.source || 'system' });
  saveState();
  const staff = await client.channels.fetch(STAFF_CHANNEL);
  const embed = createResultEmbed(state.data.pending[id], '⏳ In attesa approvazione staff');
  const row = createStaffActionRow(id);
  const payload = buildAttachmentPayloadForStaff(state.data.pending[id], embed);
  payload.components = [row];
  const msg = await staff.send(payload);
  state.data.pending[id].staffMessageId = msg.id;
  markSubmission(teamName, matchNumber, 'in_attesa', { pendingId: id, updatedBy: entry.submittedBy || 'unknown', source: entry.source || 'system' });
  saveState();
  logAudit(entry.submittedBy || 'unknown', entry.source || 'system', 'risultato_in_attesa_creato', { pendingId: id, team: teamName, total: Number(normalizedEntry.total || 0), kills: normalizedEntry.kills, players: normalizedEntry.playerNames, pos: Number(normalizedEntry.pos || 0), matchNumber, image: state.data.pending[id].image || '' });
  await refreshTeamResultPanels().catch(() => {});
  return { id };
}

async function submitWebResult(payload) {
  ensureDataStructures();
  const teamName = sanitizeText(payload.team);
  if (!state.teams[teamName]) throw new Error('Team non trovato');
  const entry = normalizeResultEntryForScoring({
    team: teamName,
    kills: [payload.k1 ?? 0, payload.k2 ?? 0, payload.k3 ?? 0],
    pos: Number(payload.pos || 0),
    image: saveDataUrlLocally(payload.image || ''),
    source: 'web',
    submittedBy: sanitizeText(payload.submittedBy || 'Dashboard'),
    matchNumber: Number(state.data.currentMatch || 1),
    slot: state.teams[teamName]?.slot || null,
    playerNames: getTeamPlayersSnapshot(teamName)
  });
  const check = canSubmitResult(entry.team, entry.matchNumber);
  if (!check.allowed) throw new Error(check.message.replace(/\*\*/g, ''));
  return createPendingSubmission(entry);
}

module.exports = {
  createResultEmbed,
  createStaffActionRow,
  saveDiscordAttachmentLocally,
  createPendingSubmission,
  approvePending,
  rejectPending,
  submitWebResult,
  sendResultToStorico,
  sendTeamResultStatus,
  editStaffMessage
};
