const { 
Client,
GatewayIntentBits,
ActionRowBuilder,
ButtonBuilder,
ButtonStyle,
ModalBuilder,
TextInputBuilder,
TextInputStyle,
ChannelType,
Events,
SlashCommandBuilder,
REST,
Routes
} = require("discord.js")

const fs = require("fs")

const client = new Client({
intents:[
GatewayIntentBits.Guilds,
GatewayIntentBits.GuildMessages,
GatewayIntentBits.MessageContent
]
})

/* CONFIG */

const MAX_TEAMS = 16
const STAFF_CHANNEL = "1483201939712774145"
const RESULT_CHANNEL = "1478305525111193725"
const VOICE_CATEGORY = "1478303649586348165"

const CLIENT_ID = process.env.CLIENT_ID
const GUILD_ID = process.env.GUILD_ID
const TOKEN = process.env.TOKEN

/* DATABASE */

function loadTeams(){
try{
return JSON.parse(fs.readFileSync("./teams.json"))
}catch{
return []
}
}

function saveTeams(data){
fs.writeFileSync("./teams.json", JSON.stringify(data,null,2))
}

/* SLASH COMMANDS */

const commands = [

new SlashCommandBuilder()
.setName("setup")
.setDescription("Crea pannello registrazione"),

new SlashCommandBuilder()
.setName("crea_stanze")
.setDescription("Crea stanze vocali dei team"),

new SlashCommandBuilder()
.setName("lobby")
.setDescription("Invia codice lobby ai team")
.addStringOption(option =>
option.setName("codice")
.setDescription("Codice lobby")
.setRequired(true)
),

new SlashCommandBuilder()
.setName("pannello")
.setDescription("Crea pannello risultati")

].map(command => command.toJSON())

/* REGISTRA COMANDI */

const rest = new REST({ version: '10' }).setToken(TOKEN)

async function registerCommands(){

try{

console.log("Pulizia vecchi slash commands...")

await rest.put(
Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
{ body: [] }
)

console.log("Registrazione nuovi slash commands...")

await rest.put(
Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
{ body: commands }
)

console.log("Slash commands aggiornati")

}catch(error){
console.error(error)
}

}

/* READY */

client.once("ready", async()=>{

console.log(`BOT ONLINE COME ${client.user.tag}`)

await registerCommands()

})

/* INTERAZIONI */

client.on(Events.InteractionCreate, async interaction => {

if(interaction.isChatInputCommand()){

/* SETUP */

if(interaction.commandName === "setup"){

const row = new ActionRowBuilder().addComponents(
new ButtonBuilder()
.setCustomId("register_team")
.setLabel("🏆 REGISTRA TEAM")
.setStyle(ButtonStyle.Success)
)

interaction.reply({
content:"**Iscrizione RØDA CUP**",
components:[row]
})

}

/* CREA STANZE */

if(interaction.commandName === "crea_stanze"){

let teams = loadTeams()

if(teams.length === 0){
interaction.reply("❌ Nessun team registrato.")
return
}

await interaction.reply("🏗️ Creazione stanze...")

for(let t of teams){

let name = `🏆・${t.slot} ${t.team}`

try{

await interaction.guild.channels.create({
name:name,
type:ChannelType.GuildVoice,
parent:VOICE_CATEGORY
})

}catch(err){
console.log(err)
}

}

interaction.followUp("✅ Stanze vocali create.")

}

/* LOBBY */

if(interaction.commandName === "lobby"){

let code = interaction.options.getString("codice")

let teams = loadTeams()

for(let t of teams){

let channelName = `🏆・${t.slot} ${t.team}`

let channel = interaction.guild.channels.cache.find(
c => c.name === channelName
)

if(channel){

try{
await channel.send(`🎮 **CODICE LOBBY:** ${code}`)
}catch(err){
console.log(err)
}

}

}

interaction.reply("✅ Codice lobby inviato.")

}

/* PANNELLO RISULTATI */

if(interaction.commandName === "pannello"){

if(interaction.channel.id !== RESULT_CHANNEL){
interaction.reply({
content:"❌ Usa questo comando nel canale calcolo.",
ephemeral:true
})
return
}

const row = new ActionRowBuilder().addComponents(
new ButtonBuilder()
.setCustomId("result_button")
.setLabel("🏆 INVIA RISULTATO MATCH")
.setStyle(ButtonStyle.Primary)
)

interaction.reply({
content:"**RØDA CUP — Invio Risultato Match**",
components:[row]
})

}

}

/* BOTTONI */

if(interaction.isButton()){

if(interaction.customId === "register_team"){

let teams = loadTeams()

if(teams.length >= MAX_TEAMS){
interaction.reply({
content:"❌ Slot torneo pieni.",
ephemeral:true
})
return
}

const modal = new ModalBuilder()
.setCustomId("team_modal")
.setTitle("Registrazione Team")

const team = new TextInputBuilder()
.setCustomId("team")
.setLabel("Nome Team")
.setStyle(TextInputStyle.Short)

const p1 = new TextInputBuilder()
.setCustomId("p1")
.setLabel("Player1 COD")
.setStyle(TextInputStyle.Short)

const p2 = new TextInputBuilder()
.setCustomId("p2")
.setLabel("Player2 COD")
.setStyle(TextInputStyle.Short)

const p3 = new TextInputBuilder()
.setCustomId("p3")
.setLabel("Player3 COD")
.setStyle(TextInputStyle.Short)

modal.addComponents(
new ActionRowBuilder().addComponents(team),
new ActionRowBuilder().addComponents(p1),
new ActionRowBuilder().addComponents(p2),
new ActionRowBuilder().addComponents(p3)
)

interaction.showModal(modal)

}

if(interaction.customId === "result_button"){

const modal = new ModalBuilder()
.setCustomId("result_modal")
.setTitle("Risultato Match")

const k1 = new TextInputBuilder()
.setCustomId("k1")
.setLabel("Kill Player1")
.setStyle(TextInputStyle.Short)

const k2 = new TextInputBuilder()
.setCustomId("k2")
.setLabel("Kill Player2")
.setStyle(TextInputStyle.Short)

const k3 = new TextInputBuilder()
.setCustomId("k3")
.setLabel("Kill Player3")
.setStyle(TextInputStyle.Short)

const pos = new TextInputBuilder()
.setCustomId("pos")
.setLabel("Posizione Finale")
.setStyle(TextInputStyle.Short)

modal.addComponents(
new ActionRowBuilder().addComponents(k1),
new ActionRowBuilder().addComponents(k2),
new ActionRowBuilder().addComponents(k3),
new ActionRowBuilder().addComponents(pos)
)

interaction.showModal(modal)

}

}

/* MODAL */

if(interaction.isModalSubmit()){

if(interaction.customId === "team_modal"){

let teams = loadTeams()

const teamName = interaction.fields.getTextInputValue("team")
const p1 = interaction.fields.getTextInputValue("p1")
const p2 = interaction.fields.getTextInputValue("p2")
const p3 = interaction.fields.getTextInputValue("p3")

let slot = teams.length + 1

teams.push({
slot:slot,
team:teamName,
players:[p1,p2,p3]
})

saveTeams(teams)

interaction.reply({
content:`✅ Team registrato.\nSlot: ${slot}`,
ephemeral:true
})

}

if(interaction.customId === "result_modal"){

const k1 = interaction.fields.getTextInputValue("k1")
const k2 = interaction.fields.getTextInputValue("k2")
const k3 = interaction.fields.getTextInputValue("k3")
const pos = interaction.fields.getTextInputValue("pos")

await interaction.reply({
content:"📸 Carica screenshot partita.",
ephemeral:true
})

const filter = m => m.author.id === interaction.user.id

const collector = interaction.channel.createMessageCollector({
filter,
max:1,
time:60000
})

collector.on("collect", async msg=>{

if(msg.attachments.size === 0) return

let image = msg.attachments.first().url

let staff = await client.channels.fetch(STAFF_CHANNEL)

staff.send(`
🏆 NUOVO RISULTATO

Kill1: ${k1}
Kill2: ${k2}
Kill3: ${k3}

Posizione: ${pos}

Screenshot:
${image}
`)

await msg.delete()

})

}

}

})

client.login(TOKEN)
