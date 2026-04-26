const fs = require('fs');
const path = require('path');
const { ChannelType } = require('discord.js');
const { FIXED_TOURNAMENT_NAME, MAX_TEAMS, PLAYERS_PER_TEAM } = require('../storage');

function sanitizeText(value) {
  return String(value || '').trim();
}

function sanitizePositiveInteger(value, fallback = 1, max = 9999) {
  const num = Number(value);
  if (!Number.isInteger(num) || num <= 0) return fallback;
  return Math.min(num, max);
}

function normalizeBaseUrl(value) {
  const clean = sanitizeText(value);
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

function chunkArray(list, size) {
  const chunks = [];
  for (let i = 0; i < list.length; i += size) {
    chunks.push(list.slice(i, i + size));
  }
  return chunks;
}

function normalizeSubmissionTeamName(teamName) {
  return sanitizeText(teamName).toLowerCase();
}

function buildSubmissionKey(teamName, matchNumber) {
  return `${normalizeSubmissionTeamName(teamName)}::match_${Number(matchNumber || 1)}`;
}

function buildResultButtonCustomId(slot) {
  return `result_submit_slot_${Number(slot)}`;
}

function getDiscordChannelTypeLabel(type) {
  if (type === ChannelType.GuildCategory) return 'category';
  if (type === ChannelType.GuildText) return 'text';
  if (type === ChannelType.GuildVoice) return 'voice';
  if (type === ChannelType.GuildAnnouncement) return 'announcement';
  if (type === ChannelType.GuildStageVoice) return 'stage';
  if (type === ChannelType.GuildForum) return 'forum';
  return 'other';
}

function getLogoUrl() {
  const logoPath = path.join(__dirname, '..', 'public', 'roda-logo.png');
  if (!fs.existsSync(logoPath)) return null;
  const baseUrl = getPublicBaseUrl();
  if (!baseUrl) return null;
  const url = `${baseUrl}/roda-logo.png`;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return url;
  } catch {
    return null;
  }
}

function loadPointsConfig() {
  const fallback = {
    kill: 1,
    placement: { 1: 10, 2: 6, 3: 5, 4: 4, 5: 3, 6: 2, 7: 1, 8: 1 }
  };
  const possibleFiles = [
    path.join(__dirname, '..', 'points.json'),
    path.join(__dirname, '..', 'points.js')
  ];
  for (const filePath of possibleFiles) {
    try {
      if (!fs.existsSync(filePath)) continue;
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      return {
        kill: Number(parsed.kill || fallback.kill),
        placement: parsed.placement && typeof parsed.placement === 'object'
          ? parsed.placement
          : fallback.placement
      };
    } catch (err) {
      console.error(`Errore lettura punteggio ${filePath}:`, err.message);
    }
  }
  return fallback;
}

function calcPoints(pos, kills) {
  const config = loadPointsConfig();
  const killPoints = Number(config.kill || 1);
  const placementBonus = Number(config.placement?.[String(Number(pos))] || 0);
  return Number(kills || 0) * killPoints + placementBonus;
}

function buildLobbyCodeMessage(lobbyCode) {
  const cleanCode = sanitizeText(lobbyCode);
  return `🎮 **CODICE LOBBY**\n\nCodice: **${cleanCode}**\n\nIl codice viene inviato nelle stanze ufficiali dei team.\nBuon game 🔥`;
}

module.exports = {
  sanitizeText,
  sanitizePositiveInteger,
  normalizeBaseUrl,
  getPublicBaseUrl,
  buildPublicUploadUrl,
  sanitizeChannelNamePart,
  buildTeamVoiceChannelName,
  chunkArray,
  normalizeSubmissionTeamName,
  buildSubmissionKey,
  buildResultButtonCustomId,
  getDiscordChannelTypeLabel,
  getLogoUrl,
  loadPointsConfig,
  calcPoints,
  buildLobbyCodeMessage,
  FIXED_TOURNAMENT_NAME,
  MAX_TEAMS,
  PLAYERS_PER_TEAM
};
