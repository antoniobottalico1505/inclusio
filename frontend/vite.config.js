import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        funzioni: resolve(__dirname, 'funzioni.html'),
        impatto: resolve(__dirname, 'impatto.html'),
        prezzi: resolve(__dirname, 'prezzi.html'),
        piattaforma: resolve(__dirname, 'piattaforma.html'),
        organizzazioni: resolve(__dirname, 'organizzazioni.html'),
        listaAttesa: resolve(__dirname, 'lista-attesa.html'),
      }
    }
  }
});
