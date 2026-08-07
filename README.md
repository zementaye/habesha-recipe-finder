# Habesha & World Kitchen

A recipe finder that matches the ingredients you already have against a database of 500 dishes spanning Habesha (Ethiopian & Eritrean) cuisine and cuisines from around the world — then walks you through beginner-friendly, step-by-step instructions for whatever you can make.

## Features

- **Ingredient-based dish matching** — type in what's in your kitchen and get ranked results, with typo tolerance and smarter scoring than a plain substring search (see [Matching logic](#matching-logic) below).
- **500-dish database** spanning Habesha/Ethiopian-Eritrean cuisine plus dishes from South Asia, East Asia, Southeast Asia, the Middle East, Africa, Europe, and the Americas.
- **Ingredient autocomplete** — a "type an ingredient" search bar backed by a deduplicated, cleaned list of every ingredient across the whole dataset.
- **Full recipes** — every dish has detailed, beginner-friendly step-by-step instructions that explain the "why," what doneness looks like, and common mistakes to avoid.
- **Offline-friendly frontend** — the app calls a live backend API, but also carries a full embedded copy of the dataset so it keeps working even if the API is unreachable.
- **Telegram bot** — a thin wrapper that opens the frontend as a Telegram Web App.

## Tech stack

- **Backend**: Node.js + Express, serving the dataset from a single JSON file (`backend/all_dishes_merged.json`).
- **Frontend**: Vite + React (`frontend/src/RecipeFinder.jsx`).
- **Telegram bot**: `node-telegram-bot-api`.
- **Deploys**: backend → [Render](https://render.com), frontend → [Vercel](https://vercel.com). See [DEPLOYMENT.md](./DEPLOYMENT.md) for the full walkthrough, environment variables, and CORS setup.

## Project structure

```
backend/          Express API (server.js) + the dish dataset (all_dishes_merged.json)
frontend/         Vite + React app (src/RecipeFinder.jsx)
telegram-bot/      Telegram bot that opens the frontend as a Web App
scripts/          Build tooling shared across the project (dish-data sync)
```

## Running locally

### Backend

```bash
cd backend
npm install
npm start
# runs at http://localhost:3001
```

Endpoints: `GET /api/dishes`, `GET /api/dishes/:id`, `POST /api/match`, `GET /api/search`, `GET /api/ingredients`.

### Frontend

```bash
cd frontend
npm install
npm run dev
# runs at http://localhost:5173
```

By default the frontend talks to `http://localhost:3001`. To point it at a different backend, set `VITE_API_URL` in your environment before running `npm run dev` / `npm run build`.

## Keeping the dataset in sync

The frontend embeds a full copy of the dish dataset (`const DISHES = [...]` near the top of `frontend/src/RecipeFinder.jsx`) so the app keeps working even if the backend API is unreachable. That embedded copy is **generated**, not hand-maintained — it's built from `backend/all_dishes_merged.json` by `scripts/sync-dishes.js`.

This runs automatically as a `predev` / `prebuild` step whenever you run `npm run dev` or `npm run build` in `frontend/`, so in normal use you don't need to think about it. If you edit `backend/all_dishes_merged.json` directly and want to refresh the embedded copy without starting the dev server or a full build, run it manually:

```bash
node scripts/sync-dishes.js
```

(or `npm run sync-dishes` from inside `frontend/`).

## Matching logic

Both the backend (`backend/server.js`) and the frontend's offline fallback (`frontend/src/RecipeFinder.jsx`) implement the same ingredient-matching logic, kept in sync by hand since they can't share a module directly. If you change one, change the other.

At a high level, each user-typed ingredient is scored against each dish ingredient in tiers — an exact match (prep notes stripped, e.g. "onion" vs. "onion, diced") counts for more than a whole-word match inside a longer name (e.g. "onion" inside "pickled onion"), which counts for more than a fuzzy match for likely typos (e.g. "chiken" → "chicken", via a small dependency-free Levenshtein-distance check). A dish's overall match percentage weights ingredients listed earlier (typically the core/protein ingredients) more heavily than ones listed later (typically garnishes or optional extras), so missing a core ingredient hurts a dish's ranking more than missing a garnish does.

## Deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md) for deploying the backend to Render and the frontend to Vercel, including environment variables and locking down CORS.
