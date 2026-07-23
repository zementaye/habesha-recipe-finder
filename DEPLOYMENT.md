# Deployment Guide

This project has two parts that deploy separately:
- `backend/` → an Express API (deploy to Render)
- `frontend/` → a Vite + React app (deploy to Vercel)

Both have free tiers that are enough for a portfolio project.

---

## 0. Push to GitHub first

Both Render and Vercel deploy by connecting to a GitHub repo.

```bash
cd project
git init
git add .
git commit -m "Initial commit"
```

Create a new repo on GitHub (github.com → New repository), then:

```bash
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git branch -M main
git push -u origin main
```

---

## 1. Deploy the backend to Render

1. Go to [render.com](https://render.com) and sign up / log in (GitHub login is easiest).
2. Click **New +** → **Web Service**.
3. Connect your GitHub account and select your repo.
4. Configure:
   - **Root Directory**: `backend`
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: Free
5. Click **Create Web Service**. Render will build and deploy — takes a couple minutes.
6. Once live, copy your backend URL (looks like `https://your-app-name.onrender.com`).
7. Test it: visit `https://your-app-name.onrender.com/api/dishes` in your browser — you should see JSON with 120 dishes.

**Note:** Free Render services spin down after inactivity and take ~30–50 seconds to wake up on the next request. That's normal for the free tier — worth mentioning if a recruiter tries it and it's briefly slow to load.

---

## 2. Deploy the frontend to Vercel

1. Go to [vercel.com](https://vercel.com) and sign up / log in (GitHub login is easiest).
2. Click **Add New** → **Project**.
3. Import your GitHub repo.
4. Configure:
   - **Root Directory**: `frontend`
   - **Framework Preset**: Vite (should auto-detect)
   - **Build Command**: `npm run build` (default)
   - **Output Directory**: `dist` (default)
5. Before deploying, add an environment variable:
   - Go to **Environment Variables**
   - Key: `VITE_API_URL`
   - Value: your Render backend URL from step 1 (e.g. `https://your-app-name.onrender.com`)
6. Click **Deploy**.

Once done, you'll get a live URL like `https://your-app.vercel.app` — that's your portfolio link.

---

## 3. Lock down CORS (recommended)

Right now the backend allows requests from anywhere. Once your frontend is live, tighten this:

1. In Render, go to your backend service → **Environment**.
2. Add an environment variable:
   - Key: `FRONTEND_URL`
   - Value: your Vercel URL (e.g. `https://your-app.vercel.app`)
3. Redeploy the backend (Render usually does this automatically when env vars change).

The server code already reads `FRONTEND_URL` and restricts CORS to it when set — see `backend/server.js`.

---

## 4. Verify everything works end to end

1. Open your Vercel URL.
2. Add a few ingredients (e.g. onion, berbere, chicken).
3. You should see matched dishes — this confirms the frontend is successfully calling your live backend.
4. If you instead see "API unreachable — showing sample data," check:
   - Is `VITE_API_URL` set correctly in Vercel? (Redeploy after changing env vars — they don't apply retroactively.)
   - Is the Render backend awake? (Free tier sleeps after inactivity — visit the `/api/dishes` URL directly to wake it up.)
   - Does `FRONTEND_URL` on Render exactly match your Vercel URL (including `https://`, no trailing slash)?

---

## 5. Local development

**Backend:**
```bash
cd backend
npm install
npm start
# runs at http://localhost:3001
```

**Frontend:**
```bash
cd frontend
npm install
cp .env.example .env   # already points at localhost:3001 by default
npm run dev
# runs at http://localhost:5173
```

---

## What to put in your portfolio

Once deployed, link the live Vercel URL as the demo and the GitHub repo as the source. A short note like *"Built because no comparable ingredient-matching API exists for Ethiopian/Eritrean cuisine — designed the dataset and matching logic from scratch"* goes a long way in an interview.
