'use strict';
const fs=require('fs');
const path=require('path');
const sharp=require('sharp');
const ROOT_DIR=__dirname;
const DATA_DIR=path.join(ROOT_DIR,'data');
const ASSETS_DIR=path.join(ROOT_DIR,'public','assets');
const BUILDS_FILE=path.join(DATA_DIR,'loadout-builds.json');
const OUT_DIR=path.join(DATA_DIR,'loadout-graphics');
const PUBLIC_URL_PREFIX='/loadout-graphics';
function clean(v){return String(v||'').split(/\s+/).join(' ').trim()}
function idOf(b){return clean(b&&(b.id||b._id))}
function fileSafe(v){return clean(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9_-]+/g,'-').replace(/^-+|-+$/g,'')||`loadout-${Date.now()}`}
function xml(v){return clean(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;')}
function fit(v,n){const s=clean(v);return s.length<=n?s:s.slice(0,n-1).trim()+'…'}
function readBuilds(){try{if(!fs.existsSync(BUILDS_FILE))return[];const raw=fs.readFileSync(BUILDS_FILE,'utf8');return raw.trim()?JSON.parse(raw):[]}catch(e){console.error('[loadout-graphics] Errore lettura builds:',e.message);return[]}}
function writeBuilds(rows){fs.mkdirSync(DATA_DIR,{recursive:true});fs.writeFileSync(BUILDS_FILE,JSON.stringify(rows,null,2),'utf8')}
function templatePath(){const names=['loadout-template-base.png','loadout-template.png','roda-loadout-template.png','loadout-template-base.jpg','loadout-template-base.jpeg','loadout-template-base.webp'];for(const n of names){const p=path.join(ASSETS_DIR,n);if(fs.existsSync(p))return p}throw new Error('Template PNG non trovato: public/assets/loadout-template-base.png')}
function rows(build){const list=Array.isArray(build.accessori)?build.accessori:[];const out=list.map(x=>({label:fit(x.slot||x.tipo||'',16),value:fit(x.nome||x.name||x.accessorioNome||x.accessorioId||x.attachmentId||'',28)})).filter(x=>x.label||x.value).slice(0,5);while(out.length<5)out.push({label:'',value:''});return out}
function scale(text,big,small,max){return text.length>max?small:big}
function overlay(build,w,h){
  const weapon=fit(build.armaNome||build.weaponName||build.arma||'LOADOUT',24).toUpperCase();
  const creator=fit(build.creatorName||build.creator||build.firma||'Creator RØDA',24);
  const weaponSize=Math.round(w*scale(weapon,.090,.071,14));
  const labelSize=Math.round(w*.030);
  const valueSize=Math.round(w*.036);
  const creatorSize=Math.round(w*scale(creator,.058,.046,16));
  const ys=[.452,.548,.644,.740,.836];
  const labelX=Math.round(w*.205);
  const valueX=Math.round(w*.415);
  const rowSvg=rows(build).map((r,i)=>{if(!r.label&&!r.value)return'';const y=Math.round(h*ys[i]);return `<g class="row"><text x="${labelX}" y="${y}" text-anchor="start" dominant-baseline="middle" class="label">${xml(r.label?r.label+':':'')}</text><text x="${valueX}" y="${y}" text-anchor="start" dominant-baseline="middle" class="value">${xml(r.value)}</text></g>`}).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><filter id="weaponGlow" x="-80%" y="-80%" width="260%" height="260%"><feDropShadow dx="0" dy="0" stdDeviation="14" flood-color="#f3e8ff" flood-opacity="1"/><feDropShadow dx="0" dy="0" stdDeviation="7" flood-color="#ba72ff" flood-opacity="1"/><feDropShadow dx="0" dy="5" stdDeviation="5" flood-color="#000" flood-opacity=".82"/></filter><filter id="textGlow" x="-55%" y="-55%" width="210%" height="210%"><feDropShadow dx="0" dy="0" stdDeviation="5" flood-color="#c69aff" flood-opacity=".75"/><feDropShadow dx="0" dy="2" stdDeviation="2.5" flood-color="#000" flood-opacity=".48"/></filter><filter id="creatorGlow" x="-80%" y="-80%" width="260%" height="260%"><feDropShadow dx="0" dy="0" stdDeviation="12" flood-color="#ffffff" flood-opacity=".95"/><feDropShadow dx="0" dy="0" stdDeviation="7" flood-color="#b66cff" flood-opacity="1"/><feDropShadow dx="0" dy="4" stdDeviation="4" flood-color="#000" flood-opacity=".75"/></filter><style>.weapon{font-family:Arial Black,Arial,sans-serif;font-size:${weaponSize}px;font-weight:900;fill:#fff;letter-spacing:2.4px;filter:url(#weaponGlow)}.row{filter:url(#textGlow)}.label{font-family:Arial Black,Arial,sans-serif;font-size:${labelSize}px;font-weight:900;fill:#21064f;letter-spacing:.25px}.value{font-family:Arial Black,Arial,sans-serif;font-size:${valueSize}px;font-weight:900;fill:#371070;letter-spacing:.15px}.creator{font-family:Arial Black,Arial,sans-serif;font-size:${creatorSize}px;font-weight:900;fill:#fff;letter-spacing:1.6px;filter:url(#creatorGlow)}</style></defs><text x="${Math.round(w/2)}" y="${Math.round(h*.353)}" text-anchor="middle" dominant-baseline="middle" class="weapon">${xml(weapon)}</text>${rowSvg}<text x="${Math.round(w*.61)}" y="${Math.round(h*.932)}" text-anchor="middle" dominant-baseline="middle" class="creator">${xml(creator)}</text></svg>`
}
async function generateLoadoutGraphic(build){fs.mkdirSync(OUT_DIR,{recursive:true});const src=templatePath();const id=idOf(build)||fileSafe(build.armaNome||build.weaponName||'loadout');const fileName=`${fileSafe(id)}.png`;const outputPath=path.join(OUT_DIR,fileName);const imageUrl=`${PUBLIC_URL_PREFIX}/${fileName}`;const meta=await sharp(src).metadata();const w=meta.width||941,h=meta.height||1672;await sharp(src).composite([{input:Buffer.from(overlay(build,w,h)),top:0,left:0}]).png().toFile(outputPath);return{imageUrl,outputPath,url:imageUrl,fileName}}
async function processBuildGraphics(){const builds=readBuilds();let changed=false;for(const b of builds){if(!idOf(b)||!clean(b.armaNome||b.weaponName||b.arma)||!clean(b.creatorName||b.creator||b.firma)||!Array.isArray(b.accessori)||!b.accessori.length)continue;const r=await generateLoadoutGraphic(b);if(b.graphicUrl!==r.imageUrl||b.imageUrl!==r.imageUrl)changed=true;b.graphicUrl=r.imageUrl;b.imageUrl=r.imageUrl;b.graphicGeneratedAt=new Date().toISOString()}if(changed)writeBuilds(builds)}
module.exports={generateLoadoutGraphic,processBuildGraphics};
