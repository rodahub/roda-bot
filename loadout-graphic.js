'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const WIDTH = 941;
const HEIGHT = 1672;
const OUTPUT_DIR = path.join(__dirname, 'data', 'loadout-graphics');

const BASE_TEMPLATE_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="941" height="1672" viewBox="0 0 941 1672">
  <defs>
    <radialGradient id="bg" cx="50%" cy="25%" r="86%">
      <stop offset="0" stop-color="#fffaff"/>
      <stop offset="0.24" stop-color="#efe2ff"/>
      <stop offset="0.48" stop-color="#8b5cf6"/>
      <stop offset="0.74" stop-color="#301063"/>
      <stop offset="1" stop-color="#050312"/>
    </radialGradient>
    <linearGradient id="darkBar" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#120024"/>
      <stop offset="0.5" stop-color="#21006f"/>
      <stop offset="1" stop-color="#100022"/>
    </linearGradient>
    <linearGradient id="lightBar" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#fffaff"/>
      <stop offset="0.5" stop-color="#d9c7ff"/>
      <stop offset="1" stop-color="#fffaff"/>
    </linearGradient>
    <filter id="glow" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="7" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="deepShadow" x="-35%" y="-35%" width="170%" height="170%">
      <feDropShadow dx="0" dy="7" stdDeviation="7" flood-color="#12002e" flood-opacity="0.8"/>
    </filter>
    <pattern id="grain" width="64" height="64" patternUnits="userSpaceOnUse">
      <circle cx="9" cy="11" r="1.1" fill="#ffffff" opacity="0.12"/>
      <circle cx="38" cy="21" r="1.4" fill="#ffffff" opacity="0.08"/>
      <circle cx="52" cy="49" r="1" fill="#ffffff" opacity="0.1"/>
      <path d="M0 32 H64" stroke="#ffffff" stroke-width="0.5" opacity="0.035"/>
    </pattern>
  </defs>

  <rect width="941" height="1672" fill="url(#bg)"/>
  <rect width="941" height="1672" fill="url(#grain)" opacity="0.7"/>
  <g opacity="0.35" filter="url(#glow)">
    <path d="M90 150 C230 60 330 120 470 80 C650 30 760 80 860 160" fill="none" stroke="#ffffff" stroke-width="3"/>
    <path d="M80 330 C260 245 330 285 470 220 C650 140 760 220 870 295" fill="none" stroke="#ffffff" stroke-width="2"/>
  </g>

  <path d="M34 18 H907 L930 42 V228 L918 241 V1430 L930 1443 V1628 L907 1653 H34 L11 1628 V1443 L23 1430 V241 L11 228 V42 Z" fill="none" stroke="#b78aff" stroke-width="4" filter="url(#glow)"/>
  <path d="M48 38 H893 L914 59 V1611 L893 1633 H48 L27 1611 V59 Z" fill="none" stroke="#6f35ff" stroke-width="1.8" opacity="0.8"/>

  <g transform="translate(470 208)" filter="url(#glow)">
    <circle r="118" fill="none" stroke="#8d55ff" stroke-width="7"/>
    <circle r="86" fill="none" stroke="#5b25d9" stroke-width="18" opacity="0.92"/>
    <path d="M-142 120 L86 -112 L35 29 L141 -73 L-86 140 L-33 0 Z" fill="#5d20df" stroke="#f3eaff" stroke-width="5"/>
  </g>
  <text x="470" y="445" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-size="72" font-weight="900" fill="#4212b8" stroke="#f1e8ff" stroke-width="1.5" filter="url(#glow)">RØDA</text>

  <g transform="translate(0 505)" filter="url(#deepShadow)">
    <path d="M70 0 H870 L905 36 V125 L870 162 H70 L36 125 V36 Z" fill="url(#darkBar)" stroke="#d8b6ff" stroke-width="4" filter="url(#glow)"/>
    <path d="M84 15 H856 L887 46 V115 L856 146 H84 L53 115 V46 Z" fill="none" stroke="#7d3cff" stroke-width="2" opacity="0.95"/>
  </g>

  <g id="slots" filter="url(#deepShadow)">
    <g transform="translate(0 688)"><path d="M73 0 H867 L899 32 V111 L867 144 H73 L42 111 V32 Z" fill="url(#lightBar)" stroke="#f2e8ff" stroke-width="3" filter="url(#glow)"/></g>
    <g transform="translate(0 848)"><path d="M73 0 H867 L899 32 V111 L867 144 H73 L42 111 V32 Z" fill="url(#lightBar)" stroke="#f2e8ff" stroke-width="3" filter="url(#glow)"/></g>
    <g transform="translate(0 1008)"><path d="M73 0 H867 L899 32 V111 L867 144 H73 L42 111 V32 Z" fill="url(#lightBar)" stroke="#f2e8ff" stroke-width="3" filter="url(#glow)"/></g>
    <g transform="translate(0 1168)"><path d="M73 0 H867 L899 32 V111 L867 144 H73 L42 111 V32 Z" fill="url(#lightBar)" stroke="#f2e8ff" stroke-width="3" filter="url(#glow)"/></g>
    <g transform="translate(0 1328)"><path d="M73 0 H867 L899 32 V111 L867 144 H73 L42 111 V32 Z" fill="url(#lightBar)" stroke="#f2e8ff" stroke-width="3" filter="url(#glow)"/></g>
  </g>

  <g transform="translate(0 1514)" filter="url(#deepShadow)">
    <path d="M78 0 H863 L896 31 V113 L863 145 H78 L46 113 V31 Z" fill="url(#darkBar)" stroke="#d8b6ff" stroke-width="4" filter="url(#glow)"/>
    <path d="M91 18 H204 V127 H91 Z" fill="#150033" stroke="#b98cff" stroke-width="3"/>
    <path d="M121 103 L164 45 L188 70 L142 121 Z" fill="#efe4ff" stroke="#6725ff" stroke-width="2" filter="url(#glow)"/>
    <path d="M240 108 H815" stroke="#e6d6ff" stroke-width="3" opacity="0.7"/>
  </g>
</svg>`;

function clean(v){ return String(v || '').trim(); }
function xml(v){ return clean(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;'); }
function slug(v){ return clean(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'') || 'loadout'; }
function fit(v,n){ const s=clean(v).replace(/\s+/g,' '); return s.length>n ? s.slice(0,n-1).trim()+'…' : s; }
function pickWeapon(b){ return clean(b.armaNome || b.weaponName || b.arma || b.weapon || 'LOADOUT'); }
function pickCreator(b){ return clean(b.creatorName || b.creator || b.firma || 'Creator RØDA'); }
function pickAttachments(b){ return (Array.isArray(b.accessori)?b.accessori:[]).slice(0,5).map(a=>{ const slot=clean(a.slot || a.tipo || ''); const name=clean(a.nome || a.name || a.accessorio || a.attachment || ''); return slot && name ? `${slot}: ${name}` : (name || slot || '—'); }); }
function text({x,y,text,size,fill='#fff',stroke='#24105f',anchor='middle'}){ return `<text x="${x}" y="${y}" text-anchor="${anchor}" dominant-baseline="middle" font-family="Arial Black, Arial, sans-serif" font-size="${size}" font-weight="900" fill="${fill}" stroke="${stroke}" stroke-width="2" paint-order="stroke fill">${xml(text)}</text>`; }
function overlaySvg(build){ const weapon=fit(pickWeapon(build).toUpperCase(),24); const creator=fit(pickCreator(build),34); const a=pickAttachments(build); while(a.length<5)a.push('—'); const ys=[760,920,1080,1240,1400]; return `<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">${text({x:470,y:585,text:weapon,size:weapon.length>14?52:62})}${a.map((s,i)=>text({x:470,y:ys[i],text:fit(s,42),size:s==='—'?40:34,fill:'#24104f',stroke:'#fff'})).join('')}${text({x:540,y:1587,text:creator,size:creator.length>22?34:40})}</svg>`; }
async function templateBuffer(){ return sharp(Buffer.from(BASE_TEMPLATE_SVG)).resize(WIDTH,HEIGHT).png().toBuffer(); }
async function generateLoadoutGraphic(build){ fs.mkdirSync(OUTPUT_DIR,{recursive:true}); const fileName=`${slug(build.id || Date.now())}.png`; const outputPath=path.join(OUTPUT_DIR,fileName); await sharp(await templateBuffer()).composite([{input:Buffer.from(overlaySvg(build)),top:0,left:0}]).png().toFile(outputPath); return {fileName, outputPath, url:`/loadout-graphics/${fileName}`}; }
module.exports={generateLoadoutGraphic};
