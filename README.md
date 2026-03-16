# Inclusio — frontend Vercel + backend Render

Monorepo separato in due servizi:

- `frontend/` -> Vite static frontend per Vercel
- `backend/` -> Node/Express API per Render

## Obiettivo del prodotto

Inclusio è una piattaforma per ridurre solitudine ed esclusione sociale attraverso:

- piccoli gruppi curati
- buddy match
- attività guidate a basso attrito
- check-in di benessere sociale
- strumenti per community, scuole e organizzazioni

## Avvio locale

### Backend

```bash
cd backend
npm install
npm start
```

Backend su `http://localhost:3000`

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend su `http://localhost:5173`

Crea `frontend/.env` con:

```bash
VITE_API_BASE_URL=http://localhost:3000
```

## Deploy Render

- Service type: Web Service
- Root Directory: `backend`
- Build Command: `npm install`
- Start Command: `npm start`
- Health Check Path: `/api/health`

Environment variables:

```bash
NODE_VERSION=20
CORS_ORIGIN=https://TUO-PROGETTO.vercel.app
```

## Deploy Vercel

- Root Directory: `frontend`
- Framework preset: `Vite`
- Production branch: `main`

Environment variables:

```bash
VITE_API_BASE_URL=https://TUO-BACKEND.onrender.com
```

## Note

- I dati demo persistono in `backend/data/db.json`.
- Su Render il filesystem è effimero: per produzione reale usa Postgres o storage persistente.
- Il sito include già lista d'attesa e lead form partner per monetizzazione.
