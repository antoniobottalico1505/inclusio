
const fs = require('fs');
const path = require('path');

const seedPath = path.join(__dirname, '..', 'data', 'seed.json');
const dbPath = path.join(__dirname, '..', 'data', 'db.json');

fs.copyFileSync(seedPath, dbPath);
console.log('Database demo resettato.');
