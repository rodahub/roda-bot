'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const WIDTH = 941;
const HEIGHT = 1672;
const TEMPLATE_B64_FILE = path.join(__dirname, 'public', 'assets', 'loadout-template-svg.base64.txt');
const OUTPUT_DIR = path.join(__dirname, 'data', 'loadout-graphics');

function clean(v){ return String(v || '').trim(); }
function xml(v){ return clean(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;'); }
function slug(v){ return clean(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'') || 'loadout'; }
function fit(v,n){ const s=clean(v).replace(/\s+/g,' '); return s.length>n ? s.slice(0,n-1).trim()+'…' : s; }
function pickWeapon(b){ return clean(b.armaNome || b.weaponName || b.arma || b.weapon || 'LOADOUT'); }
function pickCreator(b){ return clean(b.creatorName || b.creator || b.firma || 'Creator RØDA'); }
function pickAttachments(b){ return (Array.isArray(b.accessori)?b.accessori:[]).slice(0,5).map(a=>{ const slot=clean(a.slot || a.tipo || ''); const name=clean(a.nome || a.name || a.accessorio || a.attachment || ''); return slot && name ? `${slot}: ${name}` : (name || slot || '—'); }); }
function text({x,y,text,size,fill='#fff',stroke='#24105f',anchor='middle'}){ return `<text x="${x}" y="${y}" text-anchor="${anchor}" dominant-baseline="middle" font-family="Arial Black, Arial, sans-serif" font-size="${size}" font-weight="900" fill="${fill}" stroke="${stroke}" stroke-width="2" paint-order="stroke fill">${xml(text)}</text>`; }
function overlaySvg(build){ const weapon=fit(pickWeapon(build).toUpperCase(),24); const creator=fit(pickCreator(build),34); const a=pickAttachments(build); while(a.length<5)a.push('—'); const ys=[773,933,1093,1253,1413]; return `<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">${text({x:470,y:590,text:weapon,size:weapon.length>14?52:62})}${a.map((s,i)=>text({x:470,y:ys[i],text:fit(s,42),size:s==='—'?40:34,fill:'#24104f',stroke:'#fff'})).join('')}${text({x:530,y:1580,text:creator,size:creator.length>22?34:40})}</svg>`; }
async function templateBuffer(){ const raw=fs.readFileSync(TEMPLATE_B64_FILE,'utf8').trim(); return sharp(Buffer.from(raw,'base64')).resize(WIDTH,HEIGHT).png().toBuffer(); }
async function generateLoadoutGraphic(build){ fs.mkdirSync(OUTPUT_DIR,{recursive:true}); const fileName=`${slug(build.id || Date.now())}.png`; const outputPath=path.join(OUTPUT_DIR,fileName); await sharp(await templateBuffer()).composite([{input:Buffer.from(overlaySvg(build)),top:0,left:0}]).png().toFile(outputPath); return {fileName, outputPath, url:`/loadout-graphics/${fileName}`}; }
module.exports={generateLoadoutGraphic};
