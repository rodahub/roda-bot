const { 
Client,
GatewayIntentBits,
ActionRowBuilder,
ButtonBuilder,
ButtonStyle,
ModalBuilder,
TextInputBuilder,
TextInputStyle,
ChannelType
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

/* DATABASE */

function loadTeams(){
return JSON.parse(fs.readFileSync("./teams.json"))
}

function saveTeams(data){
fs.writeFileSync("./teams.json", JSON.stringify(data,null,2))
}

/* BOT READY */

client.once("ready",()=>{
console.log("RØDA BOT ONLINE")
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

client.on("interactionCreate", async interaction=>{

if(!interaction.isButton()) return

if(interaction.customId === "register_team"){

let teams = loadTeams()

if(teams.length >= MAX_TEAMS){
interaction.reply({
content:"❌ Slot torneo pieni",
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

/* INVIO TEAM */

client.on("interactionCreate", async interaction=>{

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
content:`✅ Team registrato. Slot ${slot}`,
ephemeral:true
})

}

})

/* CREA VOCALI */

client.on("messageCreate", async message=>{

if(message.content === "!crea_stanze"){

let teams = loadTeams()

if(teams.length === 0){
message.reply("Nessun team registrato")
return
}

for(let t of teams){

let name = `🏆・${t.slot} ${t.team}`

await message.guild.channels.create({
name:name,
type:ChannelType.GuildVoice,
parent:VOICE_CATEGORY
})

}

message.reply("Stanze create")

}

})

/* CODICE LOBBY */

client.on("messageCreate", async message=>{

if(message.content.startsWith("!lobby")){

let code = message.content.split(" ")[1]

let teams = loadTeams()

for(let t of teams){

let channelName = `🏆・${t.slot} ${t.team}`

let channel = message.guild.channels.cache.find(c=>c.name === channelName)

if(channel){
channel.send(`🎮 CODICE LOBBY: ${code}`)
}

}

}

})

/* PANNELLO RISULTATI */

client.on("messageCreate", async message=>{

if(message.content === "!pannello"){

if(message.channel.id !== RESULT_CHANNEL) return

const row = new ActionRowBuilder().addComponents(
new ButtonBuilder()
.setCustomId("result_button")
.setLabel("🏆 INVIA RISULTATO MATCH")
.setStyle(ButtonStyle.Primary)
)

message.channel.send({
content:"**Invia risultato match**",
components:[row]
})

}

})

/* CLICK RISULTATO */

client.on("interactionCreate", async interaction=>{

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
.setLabel("Posizione")
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

/* INVIO RISULTATO */

client.on("interactionCreate", async interaction=>{

if(!interaction.isModalSubmit()) return

if(interaction.customId === "result_modal"){

const k1 = interaction.fields.getTextInputValue("k1")
const k2 = interaction.fields.getTextInputValue("k2")
const k3 = interaction.fields.getTextInputValue("k3")
const pos = interaction.fields.getTextInputValue("pos")

interaction.reply({
content:"📸 Carica lo screenshot ora",
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

Screen: ${image}
`)

msg.delete()

})

}

})

client.login(process.env.TOKEN)
