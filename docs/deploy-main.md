# Sequenza minima corretta

## 1) Backend prima
Deploya prima Render, perché il frontend Vercel deve conoscere l'URL API.

## 2) Frontend dopo
Imposta `VITE_API_BASE_URL` sul dominio Render ottenuto.

## 3) Rifinitura CORS
Aggiorna `CORS_ORIGIN` del backend con il dominio Vercel finale.

## 4) Redeploy automatico
Un push su `main` ridistribuisce i due progetti collegati ai rispettivi servizi.
