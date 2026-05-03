const path = require('path');
const fs = require('fs');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');
const { client } = require('./client');
const state = require('./state');
const {
  refreshStateFromDisk,
  ensureDataStructures,
  saveState,
  saveEverything,
  logAudit,
  getProjectSettings,
  areRegistrationsOpen,
  getRegistrationLimit,
  isTournamentFull,
  getNextAvailableSlot,
  getTeamBySlot,
  canSubmitResult,
  PLAYERS_PER_TEAM
} = require('./lifecycle');
const { sanitizeText, FIXED_TOURNAMENT_NAME } = require('./helpers');
const { GUILD_ID } = require('./config');
const { UPLOADS_DIR, addReport } = require('../storage');
const {
  updateSavedRegisterPanelIfExists,
  maybeAnnounceTournamentFull,
  handleRegistrationStateChange,
  updateLeaderboard,
  refreshTeamResultPanels
} = require('./panels');
const {
  createPendingSubmission,
  approvePending,
  rejectPending,
  createResultEmbed,
  saveDiscordAttachmentLocally
} = require('./submissions');
const { startAutomaticReminderScheduler } = require('./reminders');
const { updateReportProofUrl } = require('../storage');

function getAttachmentFallbackUrl(attachment) {
  const candidates = [attachment?.url, attachment?.proxyURL, attachment?.attachment, attachment?.href];
  for (const value of candidates) {
    const clean = String(value || '').trim();
    if (/^https?:\/\//i.test(clean)) return clean;
  }
  return '';
}

function parseStrictInteger(value, label, min = 0, max = 999) {
  const raw = String(value || '').trim();
  if (!/^\d+$/.test(raw)) {
    throw new Error(`${label} deve essere un numero intero valido. Non usare lettere, simboli o spazi.`);
  }
  const num = Number(raw);
  if (!Number.isSafeInteger(num) || num < min || num > max) {
    throw new Error(`${label} deve essere compreso tra ${min} e ${max}.`);
  }
  return num;
}

function parseResultButtonCustomId(customId) {
  const match = String(customId || '').match(/^result_submit_slot_(\d+)(?:_match_(\d+))?$/);
  if (!match) return null;
  return {
    slot: Number(match[1]),
    matchNumber: match[2] ? Number(match[2]) : null
  };
}

function parseResultModalCustomId(customId) {
  const match = String(customId || '').match(/^modal_slot_(\d+)(?:_match_(\d+))?$/);
  if (!match) return null;
  return {
    slot: Number(match[1]),
    matchNumber: match[2] ? Number(match[2]) : null
  };
}

function getPanelMatchNumberFromMessage(message) {
  const embed = message?.embeds?.[0];
  const text = [embed?.title, embed?.description, embed?.footer?.text].filter(Boolean).join('\n');
  const match = String(text || '').match(/Match\s+(\d+)/i);
  return match ? Number(match[1]) : null;
}

async function saveResultAttachmentWithFallback(attachment) {
  const fallbackUrl = getAttachmentFallbackUrl(attachment);
  try {
    const savedUrl = await saveDiscordAttachmentLocally(attachment);
    if (String(savedUrl || '').trim()) return savedUrl;
  } catch (error) {
    console.error('[result-photo] salvataggio locale fallito, uso URL Discord:', error.message || error);
  }
  if (fallbackUrl) return fallbackUrl;
  throw new Error('Foto non valida. Invia lo screenshot come allegato Discord, non come link o immagine incollata male.');
}

function ensureResultPhotoAttachment(message) {
  const attachment = message.attachments.first();
  if (!attachment) throw new Error('Devi allegare lo screenshot del risultato.');
  const contentType = String(attachment.contentType || '').toLowerCase();
  const name = String(attachment.name || attachment.filename || '').toLowerCase();
  const isImageOrVideo =
    contentType.startsWith('image/') ||
    contentType.startsWith('video/') ||
    /\.(jpg|jpeg|png|webp|gif|mp4|mov|webm)$/i.test(name);
  if (!isImageOrVideo) {
    throw new Error('Il file allegato non sembra una foto/video valido. Invia screenshot PNG/JPG/WEBP o video MP4/MOV/WEBM.');
  }
  return attachment;
}

function registerEvents() {
  client.once('ready', async () => {
    console.log('ONLINE');
    const { readyResolver } = require('./client');
    const resolver = readyResolver();
    if (resolver) resolver(client);
    refreshStateFromDisk();
    logAudit('bot', 'discord', 'bot_online', { guildId: GUILD_ID });
    await handleRegistrationStateChange();
    await updateLeaderboard({ allowCreate: true }).catch(err => console.error('Errore aggiornamento classifica al ready:', err));
    startAutomaticReminderScheduler();
  });

  client.on('interactionCreate', async interaction => {
    try {
      if (interaction.isButton() && interaction.customId.startsWith('result_without_photo_')) {
        return interaction.reply({
          content: '❌ Invio senza foto disattivato. Per validare il risultato devi allegare lo screenshot nella stanza del team.',
          ephemeral: true
        });
      }

      if (interaction.isButton() && interaction.customId === 'register_btn') {
        refreshStateFromDisk();
        const project = getProjectSettings();
        if (!areRegistrationsOpen()) {
          await updateSavedRegisterPanelIfExists().catch(() => {});
          return interaction.reply({ content: `🚫 Le iscrizioni non sono aperte. Attendi che lo staff apra ufficialmente le registrazioni per **${project.tournamentName}**.`, ephemeral: true });
        }
        if (isTournamentFull()) {
          await maybeAnnounceTournamentFull();
          await updateSavedRegisterPanelIfExists().catch(() => {});
          return interaction.reply({ content: `🚫 Le registrazioni sono chiuse. **${project.tournamentName}** ha già raggiunto ${getRegistrationLimit()} team.`, ephemeral: true });
        }
        const modal = new ModalBuilder().setCustomId('register_modal').setTitle(`Registrazione Team • ${project.brandName}`);
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('team').setLabel('Nome team').setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('p1').setLabel('Giocatore 1').setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('p2').setLabel('Giocatore 2').setStyle(TextInputStyle.Short).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('p3').setLabel('Giocatore 3').setStyle(TextInputStyle.Short).setRequired(true))
        );
        return interaction.showModal(modal);
      }

      if (interaction.isButton() && interaction.customId.startsWith('result_submit_slot_')) {
        refreshStateFromDisk();
        const parsed = parseResultButtonCustomId(interaction.customId);
        if (!parsed) return interaction.reply({ content: '❌ Pannello risultato non valido. Chiedi allo staff di rigenerare i pannelli.', ephemeral: true });
        const slot = parsed.slot;
        const currentMatch = Number(state.data.currentMatch || 1);
        const panelMatch = parsed.matchNumber || getPanelMatchNumberFromMessage(interaction.message);
        if (panelMatch && panelMatch !== currentMatch) {
          await refreshTeamResultPanels().catch(() => {});
          return interaction.reply({ content: `❌ Questo pannello è del Match ${panelMatch}, ma il match corrente è il Match ${currentMatch}. Ho provato ad aggiornare i pannelli: usa quello nuovo.`, ephemeral: true });
        }
        const teamInfo = getTeamBySlot(slot);
        if (!teamInfo) return interaction.reply({ content: '❌ Team non trovato per questo pannello.', ephemeral: true });
        const { teamName, teamData } = teamInfo;
        const check = canSubmitResult(teamName, currentMatch);
        if (!check.allowed) return interaction.reply({ content: check.message, ephemeral: true });
        const players = Array.isArray(teamData?.players) ? teamData.players : ['Giocatore 1', 'Giocatore 2', 'Giocatore 3'];
        const project = getProjectSettings();
        const modal = new ModalBuilder().setCustomId(`modal_slot_${slot}_match_${currentMatch}`).setTitle(`${project.tournamentName} • ${teamName}`.slice(0, 45));
        for (let i = 0; i < PLAYERS_PER_TEAM; i++) {
          modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(`k${i}`).setLabel(`Kill ${players[i] || `Giocatore ${i + 1}`}`.slice(0, 45)).setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Solo numeri, esempio: 7')));
        }
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('pos').setLabel('Posizione finale').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Solo numero, esempio: 3')));
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
        if (!areRegistrationsOpen()) {
          await updateSavedRegisterPanelIfExists().catch(() => {});
          return interaction.editReply({ content: `🚫 Le iscrizioni non sono aperte. Attendi che lo staff apra ufficialmente le registrazioni per **${project.tournamentName}**.` });
        }
        if (!team || !p1 || !p2 || !p3) return interaction.editReply({ content: '❌ Compila tutti i campi.' });
        if (state.teams[team]) return interaction.editReply({ content: '❌ Esiste già un team con questo nome.' });
        if (isTournamentFull()) {
          await maybeAnnounceTournamentFull();
          await updateSavedRegisterPanelIfExists().catch(() => {});
          return interaction.editReply({ content: `🚫 Le registrazioni sono chiuse. **${project.tournamentName}** ha già raggiunto ${getRegistrationLimit()} team.` });
        }
        const slot = getNextAvailableSlot();
        if (!slot) {
          await maybeAnnounceTournamentFull();
          await updateSavedRegisterPanelIfExists().catch(() => {});
          return interaction.editReply({ content: '🚫 Nessuno slot disponibile. Registrazioni chiuse.' });
        }
        state.teams[team] = { slot, players: [p1, p2, p3] };
        saveEverything();
        refreshStateFromDisk();
        await handleRegistrationStateChange();
        logAudit(interaction.user.tag, 'discord', 'team_registrato_discord', { team, slot, players: [p1, p2, p3] });
        return interaction.editReply({ content: `✅ Team registrato con successo nello **slot #${slot}** di **${project.tournamentName}**.` });
      }

      if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_slot_')) {
        refreshStateFromDisk();
        const parsed = parseResultModalCustomId(interaction.customId);
        if (!parsed) return interaction.reply({ content: '❌ Modulo risultato non valido. Apri di nuovo il pannello del team.', ephemeral: true });
        const slot = parsed.slot;
        const currentMatch = Number(state.data.currentMatch || 1);
        const matchNumber = parsed.matchNumber || currentMatch;
        if (matchNumber !== currentMatch) {
          return interaction.reply({ content: `❌ Questo modulo era per il Match ${matchNumber}, ma ora il match corrente è il Match ${currentMatch}. Apri il pannello aggiornato.`, ephemeral: true });
        }
        const teamInfo = getTeamBySlot(slot);
        if (!teamInfo) return interaction.reply({ content: '❌ Team non trovato.', ephemeral: true });
        const { teamName } = teamInfo;
        const check = canSubmitResult(teamName, matchNumber);
        if (!check.allowed) return interaction.reply({ content: check.message, ephemeral: true });
        const kills = [];
        let total = 0;
        for (let i = 0; i < PLAYERS_PER_TEAM; i++) {
          const k = parseStrictInteger(interaction.fields.getTextInputValue(`k${i}`), `Kill giocatore ${i + 1}`, 0, 80);
          kills.push(k);
          total += k;
        }
        const pos = parseStrictInteger(interaction.fields.getTextInputValue('pos'), 'Posizione finale', 1, 150);
        state.data.tempSubmit[interaction.user.id] = { team: teamName, slot, kills, total, pos, matchNumber, teamResultChannelId: interaction.channelId || null, createdAt: Date.now() };
        saveState();
        logAudit(interaction.user.tag, 'discord', 'modulo_risultato_compilato', { team: teamName, slot, total, pos, matchNumber, channelId: interaction.channelId || null });
        return interaction.reply({
          content: '📸 Ora invia **qui nella stanza del team** lo screenshot/foto del risultato come allegato Discord. Il risultato verrà mandato allo staff solo dopo la foto. L’invio senza foto è disattivato.',
          ephemeral: true
        });
      }

      if (interaction.isButton() && interaction.customId.startsWith('report_slot_')) {
        const slot = Number(interaction.customId.replace('report_slot_', ''));
        const matchNumber = Number(state.data.currentMatch || 1);
        const modal = new ModalBuilder().setCustomId(`report_modal_${slot}`).setTitle(`⚠️ Segnalazione • Match ${matchNumber}`.slice(0, 45));
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('player_name').setLabel('Giocatore da segnalare (opzionale)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(60).setPlaceholder('Lascia vuoto per problema generale')),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('description').setLabel('Cosa è successo?').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(900).setPlaceholder('Descrivi il problema o l\'irregolarità nel dettaglio…'))
        );
        return interaction.showModal(modal);
      }

      if (interaction.isModalSubmit() && interaction.customId.startsWith('report_modal_')) {
        refreshStateFromDisk();
        const slot = Number(interaction.customId.replace('report_modal_', ''));
        const teamInfo = getTeamBySlot(slot);
        const matchNumber = Number(state.data.currentMatch || 1);
        const playerName = (interaction.fields.getTextInputValue('player_name') || '').trim();
        const description = (interaction.fields.getTextInputValue('description') || '').trim();
        if (!description) return interaction.reply({ content: '❌ La descrizione non può essere vuota.', ephemeral: true });
        const report = addReport({ teamName: teamInfo?.teamName || `Slot #${slot}`, slot, matchNumber, reporterDiscordId: interaction.user.id, reporterDiscordTag: interaction.user.tag, playerName, description, proofUrl: '', timestamp: Date.now() });
        logAudit(interaction.user.tag, 'discord', 'segnalazione_inviata', { reportId: report.id, team: teamInfo?.teamName, slot, matchNumber, playerName });
        const proofBtn = new ButtonBuilder().setCustomId(`reportproof_${report.id}`).setLabel('📎 Allega foto/video come prova').setStyle(ButtonStyle.Secondary);
        return interaction.reply({ content: `✅ **Segnalazione ricevuta!** (ID: \`${report.id}\`)\n\nLo staff esaminerà quanto segnalato al più presto.\n\nVuoi allegare uno screenshot o video come prova? Clicca il bottone qui sotto.`, components: [new ActionRowBuilder().addComponents(proofBtn)], ephemeral: true });
      }

      if (interaction.isButton() && interaction.customId.startsWith('reportproof_')) {
        const reportId = interaction.customId.replace('reportproof_', '');
        state.pendingReportProof.set(interaction.user.id, { reportId, channelId: interaction.channelId, expiresAt: Date.now() + 5 * 60 * 1000, interaction });
        return interaction.update({ content: `✅ **Segnalazione salvata!**\n\n📎 **Ora invia il file qui nella chat di questa stanza** (trascina la foto o il video nel campo messaggi).\nIl bot lo rileverà automaticamente e lo allegherà alla tua segnalazione.\n\n⏰ Hai **5 minuti** per farlo.`, components: [] });
      }

      if (interaction.isButton()) {
        const [action, id] = interaction.customId.split('_');
        if (!id) return;
        if (action === 'ok') {
          refreshStateFromDisk();
          const entry = state.data.pending[id];
          if (!entry) return interaction.reply({ content: '❌ Risultato non trovato. Aggiorna il pannello staff o controlla dal sito admin.', ephemeral: true });
          await interaction.deferUpdate().catch(() => {});
          await approvePending(id, interaction.user.tag, 'discord');
          const embed = createResultEmbed(entry, '✅ APPROVATO');
          return interaction.editReply({ embeds: [embed], components: [] }).catch(() => null);
        }
        if (action === 'no') {
          refreshStateFromDisk();
          const entry = state.data.pending[id];
          if (!entry) return interaction.reply({ content: '❌ Risultato non trovato. Aggiorna il pannello staff o controlla dal sito admin.', ephemeral: true });
          await interaction.deferUpdate().catch(() => {});
          await rejectPending(id, interaction.user.tag, 'discord');
          const embed = createResultEmbed(entry, '❌ RIFIUTATO');
          return interaction.editReply({ embeds: [embed], components: [] }).catch(() => null);
        }
      }
    } catch (err) {
      console.error(err);
      try {
        if (interaction.isRepliable()) {
          const message = err.message || "Si è verificato un errore durante l'operazione.";
          if (interaction.deferred || interaction.replied) {
            await interaction.editReply({ content: `❌ ${message}` });
          } else {
            await interaction.reply({ content: `❌ ${message}`, ephemeral: true });
          }
        }
      } catch {}
    }
  });

  client.on('messageCreate', async message => {
    try {
      if (message.author.bot) return;
      if (!message.attachments.size) return;
      refreshStateFromDisk();
      const pendingProof = state.pendingReportProof.get(message.author.id);
      if (pendingProof) {
        state.pendingReportProof.delete(message.author.id);
        if (Date.now() > pendingProof.expiresAt) {
          await message.delete().catch(() => {});
          if (pendingProof.interaction) pendingProof.interaction.deleteReply().catch(() => {});
          const expiredMsg = await message.channel.send({ content: '⏰ Il tempo per allegare la prova è scaduto (5 min). La segnalazione è stata salvata senza allegato.' }).catch(() => null);
          if (expiredMsg) setTimeout(() => expiredMsg.delete().catch(() => {}), 3000);
          return;
        }
        const attachment = message.attachments.first();
        const discordUrl = attachment.url || attachment.proxyURL || '';
        let proofUrl = discordUrl;
        try {
          const origName = attachment.name || 'proof';
          const rawExt = origName.includes('.') ? origName.split('.').pop() : 'jpg';
          const ext = rawExt.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'jpg';
          const fileName = `proof_${pendingProof.reportId}_${Date.now()}.${ext}`;
          const filePath = path.join(UPLOADS_DIR, fileName);
          const resp = await fetch(discordUrl);
          if (resp.ok) {
            const buf = await resp.arrayBuffer();
            fs.writeFileSync(filePath, Buffer.from(buf));
            proofUrl = `/uploads/${fileName}`;
            console.log('[proof] salvato localmente:', filePath);
          } else {
            console.warn('[proof] download fallito status', resp.status, '— uso URL Discord');
          }
        } catch (dlErr) { console.error('[proof] errore download:', dlErr.message, '— uso URL Discord come fallback'); }
        updateReportProofUrl(pendingProof.reportId, proofUrl);
        await message.delete().catch(() => {});
        if (pendingProof.interaction) pendingProof.interaction.deleteReply().catch(() => {});
        const confirmMsg = await message.channel.send({ content: '✅ **Segnalazione inviata!** Lo staff la esaminerà al più presto.' }).catch(() => null);
        if (confirmMsg) setTimeout(() => confirmMsg.delete().catch(() => {}), 3000);
        return;
      }
      const temp = state.data.tempSubmit[message.author.id];
      if (!temp) return;
      const tempAge = Date.now() - Number(temp.createdAt || Date.now());
      if (tempAge > 10 * 60 * 1000) {
        delete state.data.tempSubmit[message.author.id];
        saveState();
        await message.reply({ content: '⏰ Il modulo risultato è scaduto. Premi di nuovo il bottone del pannello team e reinvia i dati.' }).catch(() => {});
        return;
      }
      const currentMatch = Number(state.data.currentMatch || 1);
      if (Number(temp.matchNumber || 1) !== currentMatch) {
        delete state.data.tempSubmit[message.author.id];
        saveState();
        await message.reply({ content: `❌ Questo invio era del Match ${Number(temp.matchNumber || 1)}, ma ora il match corrente è il Match ${currentMatch}. Apri il pannello aggiornato.` }).catch(() => {});
        return;
      }
      const check = canSubmitResult(temp.team, Number(temp.matchNumber || state.data.currentMatch || 1));
      if (!check.allowed) {
        delete state.data.tempSubmit[message.author.id];
        saveState();
        await message.reply({ content: check.message }).catch(() => {});
        return;
      }
      const attachment = ensureResultPhotoAttachment(message);
      const image = await saveResultAttachmentWithFallback(attachment);
      delete state.data.tempSubmit[message.author.id];
      saveState();
      await createPendingSubmission({ ...temp, image, source: 'discord', submittedBy: message.author.tag });
      await message.delete().catch(() => {});
      const confirmMsg = await message.channel.send({ content: `✅ Risultato del **${temp.team}** inviato allo staff con foto. Attendi approvazione.` }).catch(() => null);
      if (confirmMsg) setTimeout(() => confirmMsg.delete().catch(() => {}), 7000);
    } catch (err) {
      console.error('[messageCreate] errore inatteso:', err);
      try { await message.reply({ content: `❌ ${err.message || 'Errore inatteso nel registrare il tuo invio. Riprova fra qualche secondo.'}` }); } catch {}
    }
  });
}

module.exports = { registerEvents };
