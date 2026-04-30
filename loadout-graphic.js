'use strict';

const graphics = require('./loadout-graphics');

async function generateLoadoutGraphic(build) {
  const result = await graphics.generateLoadoutGraphic(build);
  return {
    fileName: result.fileName || '',
    outputPath: result.outputPath || '',
    url: result.url || result.imageUrl || ''
  };
}

module.exports = { generateLoadoutGraphic };
