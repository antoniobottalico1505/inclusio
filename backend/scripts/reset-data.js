const fs = require('fs');
const path = require('path');

const baseDir = path.join(__dirname, '..');
const seedPath = path.join(baseDir, 'data', 'seed.json');
const dbPath = path.join(baseDir, 'data', 'db.json');

fs.copyFileSync(seedPath, dbPath);
console.log('Inclusio demo data reset completato.');
