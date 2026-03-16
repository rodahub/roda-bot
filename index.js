const { 
Client,
GatewayIntentBits,
SlashCommandBuilder,
REST,
Routes,
ActionRowBuilder,
ButtonBuilder,
ButtonStyle,
ModalBuilder,
TextInputBuilder,
TextInputStyle,
ChannelType
} = require('discord.js');

const fs = require("fs");

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const MAX_TEAMS = 16;

const CATEGORY_ID = "1478303649586348165";
const STAFF_CHANNEL = "1483201939712774145";
const RESULT_CHANNEL = "1478305525111193725";

let teams = [];

function loadTeams() {
  if (fs.existsSync("teams.json")) {
    teams = JSON.parse(fs.readFileSync("teams.json"));
  }
}

function saveTeams() {
  fs.writeFileSync("teams.json", JSON.stringify(teams, null, 2));
}

const commands = [

  new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Crea il pannello registrazione'),

  new SlashCommandBuilder()
    .setName('create_rooms')
    .setDescription('Crea le vocali team'),

  new SlashCommandBuilder()
    .setName('panel_results')
    .setDescription('Crea pannello invio risultati'),

].map(command => command.toJSON());

client.once('ready', async () => {

  console.log("RØDA BOT ONLINE");

  loadTeams();

  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(client.user.id, "1442509991109066765"),
    { body: commands },
  );

});

client.on('interactionCreate', async interaction => {

if (interaction.isChatInputCommand()) {

if (interaction.commandName === "setup") {

const button = new ButtonBuilder()
.setCustomId("register_team")
.setLabel("REGISTRA TEAM")
.setStyle(ButtonStyle.Success);

const row = new ActionRowBuilder().addComponents(button);

await interaction.reply({
content:"🏆 RØDA CUP\nPremi per registrare il team",
components:[row]
});

}

if (interaction.commandName === "panel_results") {

const button = new ButtonBuilder()
.setCustomId("send_result")
.setLabel("INVIA RISULTATO MATCH")
.setStyle(ButtonStyle.Primary);

const row = new ActionRowBuilder().addComponents(button);

const channel = await client.channels.fetch(RESULT_CHANNEL);

channel.send({
content:"🏆 **INVIO RISULTATI MATCH**\nPremi il bottone sotto.",
components:[row]
});

await interaction.reply({content:"Pannello creato.",ephemeral:true});

}

if (interaction.commandName === "create_rooms") {

const guild = interaction.guild;

for (const team of teams) {

const roomName = `🏆・${team.slot}・${team.teamName}`;

await guild.channels.create({
name: roomName,
type: ChannelType.GuildVoice,
parent: CATEGORY_ID,
userLimit:3
});

}

await interaction.reply({content:"Stanze create",ephemeral:true});

}

}

if (interaction.isButton()) {

if (interaction.customId === "register_team") {

if (teams.length >= MAX_TEAMS) {
return interaction.reply({content:"Slot pieni",ephemeral:true});
}

const modal = new ModalBuilder()
.setCustomId("team_reg")
.setTitle("Registrazione Team");

const team = new TextInputBuilder()
.setCustomId("team")
.setLabel("Nome Team")
.setStyle(TextInputStyle.Short);

const p1 = new TextInputBuilder()
.setCustomId("p1")
.setLabel("Player 1")
.setStyle(TextInputStyle.Short);

const p2 = new TextInputBuilder()
.setCustomId("p2")
.setLabel("Player 2")
.setStyle(TextInputStyle.Short);

const p3 = new TextInputBuilder()
.setCustomId("p3")
.setLabel("Player 3")
.setStyle(TextInputStyle.Short);

modal.addComponents(
new ActionRowBuilder().addComponents(team),
new ActionRowBuilder().addComponents(p1),
new ActionRowBuilder().addComponents(p2),
new ActionRowBuilder().addComponents(p3)
);

interaction.showModal(modal);

}

if (interaction.customId === "send_result") {

const modal = new ModalBuilder()
.setCustomId("match_result")
.setTitle("Invia Risultato");

const team = new TextInputBuilder()
.setCustomId("team")
.setLabel("Nome Team")
.setStyle(TextInputStyle.Short);

const k1 = new TextInputBuilder()
.setCustomId("k1")
.setLabel("Kill Player1")
.setStyle(TextInputStyle.Short);

const k2 = new TextInputBuilder()
.setCustomId("k2")
.setLabel("Kill Player2")
.setStyle(TextInputStyle.Short);

const k3 = new TextInputBuilder()
.setCustomId("k3")
.setLabel("Kill Player3")
.setStyle(TextInputStyle.Short);

const pos = new TextInputBuilder()
.setCustomId("pos")
.setLabel("Posizione")
.setStyle(TextInputStyle.Short);

modal.addComponents(
new ActionRowBuilder().addComponents(team),
new ActionRowBuilder().addComponents(k1),
new ActionRowBuilder().addComponents(k2),
new ActionRowBuilder().addComponents(k3),
new ActionRowBuilder().addComponents(pos)
);

interaction.showModal(modal);

}

}

if (interaction.isModalSubmit()) {

if (interaction.customId === "team_reg") {

const team = interaction.fields.getTextInputValue("team");
const p1 = interaction.fields.getTextInputValue("p1");
const p2 = interaction.fields.getTextInputValue("p2");
const p3 = interaction.fields.getTextInputValue("p3");

const slot = teams.length + 1;

teams.push({slot,team,p1,p2,p3});

saveTeams();

interaction.reply({content:`Team registrato SLOT ${slot}`,ephemeral:true});

}

if (interaction.customId === "match_result") {

const team = interaction.fields.getTextInputValue("team");
const k1 = parseInt(interaction.fields.getTextInputValue("k1"));
const k2 = parseInt(interaction.fields.getTextInputValue("k2"));
const k3 = parseInt(interaction.fields.getTextInputValue("k3"));
const pos = parseInt(interaction.fields.getTextInputValue("pos"));

const kills = k1 + k2 + k3;

const bonus = {
1:10,
2:6,
3:5,
4:4,
5:3,
6:2,
7:1,
8:1
};

const points = kills + (bonus[pos] || 0);

const staff = await client.channels.fetch(STAFF_CHANNEL);

const approve = new ButtonBuilder()
.setCustomId("approve")
.setLabel("APPROVA")
.setStyle(ButtonStyle.Success);

const reject = new ButtonBuilder()
.setCustomId("reject")
.setLabel("RIFIUTA")
.setStyle(ButtonStyle.Danger);

const row = new ActionRowBuilder().addComponents(approve,reject);

staff.send({
content:`📊 NUOVO RISULTATO

Team: ${team}

Kill Totali: ${kills}
Posizione: ${pos}

Punti Match: ${points}`,
components:[row]
});

interaction.reply({content:"Risultato inviato allo staff",ephemeral:true});

}

}

});

client.login(process.env.TOKEN);
