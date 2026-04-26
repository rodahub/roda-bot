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

function createResultEmbed(entry, footerText) {
  const project = getProjectSettings();
  const players = state.teams[entry.team]?.players || ['Giocatore 1', 'Giocatore 2', 'Giocatore 3'];
  const points = calcPoints(Number(entry.pos || 0), Number(entry.total || 0));
  const embed = new EmbedBuilder()
    .setColor(0x7b2cff)
    .setTitle(`📸 NUOVO RISULTATO • ${project.tournamentName}`)
    .setDescription(
      `🏷️ **Team:** ${entry.team}\n🎯 **Slot:** ${entry.slot || state.teams[entry.team]?.slot || '-'}\n🎮 **Match:** ${Number(entry.matchNumber || state.data.currentMatch || 1)}\n\n` +
      `👤 **${players[0] || 'Giocatore 1'}:** ${Number(entry.kills?.[0] || 0)} kill\n` +
      `👤 **${players[1] || 'Giocatore 2'}:** ${Number(entry.kills?.[1] || 0)} kill\n` +
      `👤 **${players[2] || 'Giocatore 3'}:** ${Number(entry.kills?.[2] || 0)} kill\n\n` +
      `🔥 **Totale kill:** ${Number(entry.total || 0)}\n🏆 **Posizione:** ${Number(entry.pos || 0)}\n📊 **Punti calcolati:** ${points}\n🧾 **Inviato da:** ${entry.submittedBy || 'Sconosciuto'}`
    )
    .setFooter({ text: footerText || '⏳ In attesa approvazione staff' });
  if (entry.image) embed.setImage(entry.image);
  return embed;
}

function createStaffActionRow(id) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ok_${id}`).setLabel('APPROVA').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`no_${id}`).setLabel('RIFIUTA').setStyle(ButtonStyle.Danger)
  );
}

async function saveDiscordAttachmentLocally(attachment) {
  const tryUrls = [attachment.url, attachment.proxyURL].filter(Boolean);
  const errors = [];
  for (const target of tryUrls) {
    try {
      const response = await fetch(target);
      if (!response.ok) { errors.push(`HTTP ${response.status} su ${target}`); continue; }
      const contentType = response.headers.get('content-type') || '';
      let ext = 'jpg';
      if (contentType.includes('png')) ext = 'png';
      else if (contentType.includes('webp')) ext = 'webp';
      else if (contentType.includes('gif')) ext = 'gif';
      else if (contentType.includes('jpeg') || contentType.includes('jpg')) ext = 'jpg';
      else if (attachment.name && attachment.name.includes('.')) ext = attachment.name.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
      const fileName = `discord-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
      const filePath = path.join(UPLOADS_DIR, fileName);
      const arrayBuffer = await response.arrayBuffer();
      fs.writeFileSync(filePath, Buffer.from(arrayBuffer));
      return buildPublicUploadUrl(fileName);
    } catch (err) { errors.push(err.message || String(err)); }
  }
  console.error('[saveDiscordAttachmentLocally] impossibile scaricare lo screenshot:', errors);
  throw new Error('Non sono riuscito a salvare il tuo screenshot. Riprova fra qualche secondo o invia un altro file.');
}

async function sendResultToStorico(embed) {
  try {
    const storico = await client.channels.fetch(STORICO_CHANNEL);
    await storico.send({ embeds: [embed] });
  } catch (err) { console.error('Errore invio storico:', err); }
}

async function sendTeamResultStatus(entry, approved) {
  const channelId = sanitizeText(entry?.teamResultChannelId);
  if (!channelId) return;
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel) return;
    const project = getProjectSettings();
    const embed = new EmbedBuilder()
      .setColor(approved ? 0x18c964 : 0xff4d6d)
      .setTitle(approved ? '✅ RISULTATO APPROVATO' : '❌ RISULTATO RIFIUTATO')
      .setDescription(`**Team:** ${entry.team}\n**Match:** ${Number(entry.matchNumber || state.data.currentMatch || 1)}\n**Posizione:** ${Number(entry.pos || 0)}\n**Uccisioni totali:** ${Number(entry.total || 0)}\n\n${approved ? 'Lo staff ha approvato il risultato inviato.' : 'Lo staff ha rifiutato il risultato inviato. Se richiesto dallo staff, il team potrà reinviarlo.'}`)
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
  const entry = state.data.pending[id];
  if (!entry) return { already: true };
  const duplicateCheck = getSubmissionRecord(entry.team, Number(entry.matchNumber || 1));
  if (duplicateCheck.status === 'approvato' || duplicateCheck.status === 'inserito_manualmente') {
    delete state.data.pending[id];
    saveState();
    return { ok: false, message: 'Questo risultato risulta già registrato.' };
  }
  const players = state.teams[entry.team]?.players || ['Giocatore 1', 'Giocatore 2', 'Giocatore 3'];
  const pointsToAdd = calcPoints(Number(entry.pos || 0), Number(entry.total || 0));
  state.data.scores[entry.team] = Number(state.data.scores[entry.team] || 0) + pointsToAdd;
  (entry.kills || []).forEach((k, i) => {
    const playerName = players[i] || `Giocatore ${i + 1}`;
    state.data.fragger[playerName] = Number(state.data.fragger[playerName] || 0) + Number(k || 0);
  });
  markSubmission(entry.team, Number(entry.matchNumber || 1), 'approvato', { pendingId: null, updatedBy: actor, source });
  delete state.data.pending[id];
  saveState();
  let storicoEmbed = await editStaffMessage(entry, true);
  if (!storicoEmbed) storicoEmbed = createResultEmbed(entry, '✅ APPROVATO');
  await sendResultToStorico(storicoEmbed);
  await sendTeamResultStatus(entry, true);
  await updateLeaderboard({ allowCreate: true });
  await refreshTeamResultPanels().catch(() => {});
  logAudit(actor, source, 'risultato_approvato', { pendingId: id, team: entry.team, total: Number(entry.total || 0), pos: Number(entry.pos || 0), puntiAggiunti: pointsToAdd, matchNumber: Number(entry.matchNumber || 0) });
  return { ok: true };
}

async function rejectPending(id, actor = 'system', source = 'system') {
  ensureDataStructures();
  const entry = state.data.pending[id];
  if (!entry) return { already: true };
  markSubmission(entry.team, Number(entry.matchNumber || 1), 'rifiutato', { pendingId: null, updatedBy: actor, source });
  delete state.data.pending[id];
  saveState();
  await editStaffMessage(entry, false);
  await sendTeamResultStatus(entry, false);
  await refreshTeamResultPanels().catch(() => {});
  logAudit(actor, source, 'risultato_rifiutato', { pendingId: id, team: entry.team, total: Number(entry.total || 0), pos: Number(entry.pos || 0), matchNumber: Number(entry.matchNumber || 0) });
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
  state.data.pending[id] = { ...entry, team: teamName, matchNumber, slot: entry.slot || state.teams[teamName]?.slot || null };
  markSubmission(teamName, matchNumber, 'in_attesa', { pendingId: id, updatedBy: entry.submittedBy || 'unknown', source: entry.source || 'system' });
  saveState();
  const staff = await client.channels.fetch(STAFF_CHANNEL);
  const embed = createResultEmbed(state.data.pending[id], '⏳ In attesa approvazione staff');
  const row = createStaffActionRow(id);
  const msg = await staff.send({ embeds: [embed], components: [row] });
  state.data.pending[id].staffMessageId = msg.id;
  markSubmission(teamName, matchNumber, 'in_attesa', { pendingId: id, updatedBy: entry.submittedBy || 'unknown', source: entry.source || 'system' });
  saveState();
  logAudit(entry.submittedBy || 'unknown', entry.source || 'system', 'risultato_in_attesa_creato', { pendingId: id, team: teamName, total: Number(entry.total || 0), pos: Number(entry.pos || 0), matchNumber });
  await refreshTeamResultPanels().catch(() => {});
  return { id };
}

async function submitWebResult(payload) {
  ensureDataStructures();
  const teamName = sanitizeText(payload.team);
  const entry = {
    team: teamName,
    kills: [Number(payload.k1 || 0), Number(payload.k2 || 0), Number(payload.k3 || 0)],
    total: Number(payload.k1 || 0) + Number(payload.k2 || 0) + Number(payload.k3 || 0),
    pos: Number(payload.pos || 0),
    image: payload.image || '',
    source: 'web',
    submittedBy: sanitizeText(payload.submittedBy || 'Dashboard'),
    matchNumber: Number(state.data.currentMatch || 1),
    slot: state.teams[teamName]?.slot || null
  };
  if (!state.teams[entry.team]) throw new Error('Team non trovato');
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
