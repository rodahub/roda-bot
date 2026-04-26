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
  updateLeaderboard
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
        const slot = Number(interaction.customId.replace('result_submit_slot_', ''));
        const teamInfo = getTeamBySlot(slot);
        if (!teamInfo) return interaction.reply({ content: '❌ Team non trovato per questo pannello.', ephemeral: true });
        const { teamName, teamData } = teamInfo;
        const matchNumber = Number(state.data.currentMatch || 1);
        const check = canSubmitResult(teamName, matchNumber);
        if (!check.allowed) return interaction.reply({ content: check.message, ephemeral: true });
        const players = Array.isArray(teamData?.players) ? teamData.players : ['Giocatore 1', 'Giocatore 2', 'Giocatore 3'];
        const project = getProjectSettings();
        const modal = new ModalBuilder().setCustomId(`modal_slot_${slot}`).setTitle(`${project.tournamentName} • ${teamName}`.slice(0, 45));
        for (let i = 0; i < PLAYERS_PER_TEAM; i++) {
          modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(`k${i}`).setLabel(`Kill ${players[i] || `Giocatore ${i + 1}`}`.slice(0, 45)).setStyle(TextInputStyle.Short).setRequired(true)));
        }
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('pos').setLabel('Posizione finale').setStyle(TextInputStyle.Short).setRequired(true)));
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
        const slot = Number(interaction.customId.replace('modal_slot_', ''));
        const teamInfo = getTeamBySlot(slot);
        if (!teamInfo) return interaction.reply({ content: '❌ Team non trovato.', ephemeral: true });
        const { teamName } = teamInfo;
        const matchNumber = Number(state.data.currentMatch || 1);
        const check = canSubmitResult(teamName, matchNumber);
        if (!check.allowed) return interaction.reply({ content: check.message, ephemeral: true });
        const kills = [];
        let total = 0;
        for (let i = 0; i < PLAYERS_PER_TEAM; i++) {
          const k = parseInt(interaction.fields.getTextInputValue(`k${i}`), 10);
          if (!Number.isFinite(k) || k < 0) return interaction.reply({ content: '❌ Le kill devono essere numeri validi.', ephemeral: true });
          kills.push(k);
          total += k;
        }
        const pos = parseInt(interaction.fields.getTextInputValue('pos'), 10);
        if (!Number.isFinite(pos) || pos <= 0) return interaction.reply({ content: '❌ La posizione finale non è valida.', ephemeral: true });
        state.data.tempSubmit[interaction.user.id] = { team: teamName, slot, kills, total, pos, matchNumber, teamResultChannelId: interaction.channelId || null };
        saveState();
        logAudit(interaction.user.tag, 'discord', 'modulo_risultato_compilato', { team: teamName, slot, total, pos, matchNumber, channelId: interaction.channelId || null });
        return interaction.reply({ content: '📸 Ora invia qui sotto lo screenshot della partita. È obbligatorio per la verifica dello staff.', ephemeral: true });
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
          const entry = state.data.pending[id];
          if (!entry) return interaction.reply({ content: '❌ Risultato non trovato.', ephemeral: true });
          await approvePending(id, interaction.user.tag, 'discord');
          const embed = createResultEmbed(entry, '✅ APPROVATO');
          return interaction.update({ embeds: [embed], components: [] });
        }
        if (action === 'no') {
          const entry = state.data.pending[id];
          if (!entry) return interaction.reply({ content: '❌ Risultato non trovato.', ephemeral: true });
          await rejectPending(id, interaction.user.tag, 'discord');
          const embed = createResultEmbed(entry, '❌ RIFIUTATO');
          return interaction.update({ embeds: [embed], components: [] });
        }
      }
    } catch (err) {
      console.error(err);
      try {
        if (interaction.isRepliable()) {
          const message = err.message || 'Si è verificato un errore durante l'operazione.';
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
      const check = canSubmitResult(temp.team, Number(temp.matchNumber || state.data.currentMatch || 1));
      if (!check.allowed) {
        delete state.data.tempSubmit[message.author.id];
        saveState();
        await message.reply({ content: check.message }).catch(() => {});
        return;
      }
      const attachment = message.attachments.first();
      let image;
      try { image = await saveDiscordAttachmentLocally(attachment); } catch (saveErr) {
        console.error('[messageCreate] errore salvataggio screenshot:', saveErr);
        await message.reply({ content: `❌ ${saveErr.message || 'Non sono riuscito a salvare lo screenshot.'} Il tuo invio NON è stato registrato: prova ad inviare di nuovo lo screenshot.` }).catch(() => {});
        return;
      }
      delete state.data.tempSubmit[message.author.id];
      saveState();
      await createPendingSubmission({ ...temp, image, source: 'discord', submittedBy: message.author.tag });
      await message.delete().catch(() => {});
    } catch (err) {
      console.error('[messageCreate] errore inatteso:', err);
      try { await message.reply({ content: '❌ Errore inatteso nel registrare il tuo invio. Riprova fra qualche secondo.' }); } catch {}
    }
  });
}

module.exports = { registerEvents };
