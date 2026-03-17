import { defineConfig } from 'vite';
import { readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const htmlEntries = Object.fromEntries(
  readdirSync(__dirname)
    .filter((name) => name.endsWith('.html'))
    .map((name) => [name.replace(/\.html$/, ''), resolve(__dirname, name)])
);

export default defineConfig({
  appType: 'mpa',
  build: {
    rollupOptions: {
      input: htmlEntries
    }
  }
});