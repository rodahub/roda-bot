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
Events
} = require("discord.js")

const fs = require("fs")

const client = new Client({
intents:[
GatewayIntentBits.Guilds,
GatewayIntentBits.GuildMessages,
GatewayIntentBits.MessageContent
]
})

/* CONFIGURAZIONE */

const MAX_TEAMS = 16
const STAFF_CHANNEL = "1483201939712774145"
const RESULT_CHANNEL = "1478305525111193725"
const VOICE_CATEGORY = "1478303649586348165"

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

/* BOT ONLINE */

client.once("ready",()=>{
console.log(`BOT ONLINE COME ${client.user.tag}`)
})

/* SETUP REGISTRAZIONE */

client.on("messageCreate", async message=>{

if(message.author.bot) return

if(message.content === "!setup"){

const row = new ActionRowBuilder().addComponents(
new ButtonBuilder()
.setCustomId("register_team")
.setLabel("🏆 REGISTRA TEAM")
.setStyle(ButtonStyle.Success)
)

message.channel.send({
content:"**Iscrizione RØDA CUP**",
components:[row]
})

}

})

/* CLICK REGISTRA */

client.on(Events.InteractionCreate, async interaction=>{

if(!interaction.isButton()) return

if(interaction.customId === "register_team"){

let teams = loadTeams()

if(teams.length >= MAX_TEAMS){
interaction.reply({
content:"❌ Gli slot del torneo sono pieni.",
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

})

/* SALVATAGGIO TEAM */

client.on(Events.InteractionCreate, async interaction=>{

if(!interaction.isModalSubmit()) return

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
content:`✅ Team registrato con successo.\nSlot assegnato: **${slot}**`,
ephemeral:true
})

}

})

/* CREAZIONE STANZE VOCALI */

client.on("messageCreate", async message=>{

if(message.author.bot) return

if(message.content === "!crea_stanze"){

let teams = loadTeams()

if(teams.length === 0){
message.reply("❌ Nessun team registrato.")
return
}

await message.reply("🏗️ Creazione stanze in corso...")

for(let t of teams){

let name = `🏆・${t.slot} ${t.team}`

try{

await message.guild.channels.create({
name:name,
type:ChannelType.GuildVoice,
parent:VOICE_CATEGORY
})

}catch(err){
console.log("Errore creazione stanza:",err)
}

}

message.channel.send("✅ Stanze vocali create.")

}

})

/* INVIO CODICE LOBBY */

client.on("messageCreate", async message=>{

if(message.author.bot) return

if(message.content.startsWith("!lobby")){

let code = message.content.split(" ")[1]

if(!code){
message.reply("❌ Inserisci un codice lobby.")
return
}

let teams = loadTeams()

for(let t of teams){

let name = `🏆・${t.slot} ${t.team}`

let channel = message.guild.channels.cache.find(c=>c.name === name)

if(channel){

channel.send(`🎮 **CODICE LOBBY:** ${code}`)

}

}

message.reply("✅ Codice lobby inviato a tutti i team.")

}

})

/* CREAZIONE PANNELLO RISULTATI */

client.on("messageCreate", async message=>{

if(message.author.bot) return

if(message.content === "!pannello"){

if(message.channel.id !== RESULT_CHANNEL) return

const row = new ActionRowBuilder().addComponents(
new ButtonBuilder()
.setCustomId("result_button")
.setLabel("🏆 INVIA RISULTATO MATCH")
.setStyle(ButtonStyle.Primary)
)

message.channel.send({
content:"**RØDA CUP — Invio Risultato Match**",
components:[row]
})

}

})

/* CLICK RISULTATO */

client.on(Events.InteractionCreate, async interaction=>{

if(!interaction.isButton()) return

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

})

/* INVIO RISULTATO + SCREENSHOT */

client.on(Events.InteractionCreate, async interaction=>{

if(!interaction.isModalSubmit()) return

if(interaction.customId === "result_modal"){

const k1 = interaction.fields.getTextInputValue("k1")
const k2 = interaction.fields.getTextInputValue("k2")
const k3 = interaction.fields.getTextInputValue("k3")
const pos = interaction.fields.getTextInputValue("pos")

await interaction.reply({
content:"📸 Carica ora lo **screenshot della partita**.",
ephemeral:true
})

const filter = m => m.author.id === interaction.user.id

const collector = interaction.channel.createMessageCollector({
filter,
max:1,
time:60000
})

collector.on("collect", async msg=>{

if(msg.attachments.size === 0){
msg.reply("❌ Devi caricare uno screenshot.")
return
}

let image = msg.attachments.first().url

let staff = await client.channels.fetch(STAFF_CHANNEL)

staff.send(`
🏆 **NUOVO RISULTATO MATCH**

Kill Player1: ${k1}
Kill Player2: ${k2}
Kill Player3: ${k3}

Posizione: ${pos}

Screenshot:
${image}
`)

await msg.delete()

})

}

})

client.login(process.env.TOKEN)
