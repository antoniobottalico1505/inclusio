const fs = require('fs');
const path = require('path');
const { ensureStateRow, writeDb, normalizeDb, pool } = require('../db');

async function main() {
  const seedPath = path.join(__dirname, '..', 'data', 'seed.json');
  const raw = fs.readFileSync(seedPath, 'utf8');
  const seed = JSON.parse(raw);

  await ensureStateRow();
  await writeDb(normalizeDb(seed));

  console.log(`Reseed completato da: ${seedPath}`);
}

main()
  .catch((error) => {
    console.error('Reseed fallito:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await pool.end();
    } catch {}
  });