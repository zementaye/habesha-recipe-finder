const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const fs = require("fs");
const path = require("path");
const {
  cleanIngredientName,
  normalize,
  matchScore,
  scoreDish,
} = require("../shared/matching");

const app = express();
app.disable("x-powered-by");

// In production, set FRONTEND_URL to your deployed frontend's origin
// (e.g. https://your-app.vercel.app) to restrict CORS properly.
// Falls back to allowing all origins, which is fine for local dev.
const FRONTEND_URL = process.env.FRONTEND_URL;
app.use(cors(FRONTEND_URL ? { origin: FRONTEND_URL } : {}));
// Cap request body size — the payloads this API expects are tiny (a
// handful of ingredient strings), so anything huge is either a mistake
// or an attempt to abuse the server.
app.use(express.json({ limit: "20kb" }));

// Basic rate limiting so /api/match (the most expensive endpoint — it runs
// fuzzy matching against every dish) can't be hammered. Tune via env vars
// if you need different limits in production.
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.RATE_LIMIT_MAX) || 60, // 60 requests/minute/IP by default
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please slow down." },
});
app.use(limiter);

const DATA_PATH = path.join(__dirname, "all_dishes_merged.json");
const DISHES = JSON.parse(fs.readFileSync(DATA_PATH, "utf8")).dishes;
const DISHES_BY_ID = new Map(DISHES.map((d) => [d.id, d]));

/* ---------- ingredient list (built once at startup) ---------- */
// cleanIngredientName comes from shared/matching.js; used here to build a
// clean, display-friendly, deduplicated ingredient list for autocomplete.
const INGREDIENTS = Array.from(
  new Set(
    DISHES.flatMap((d) => (d.ingredients || []).map((i) => cleanIngredientName(i.name)))
      .filter(Boolean)
      .map((n) => n.toLowerCase())
  )
).sort((a, b) => a.localeCompare(b));

/* ---------- matching logic ----------
   normalize, matchScore, and scoreDish are imported from
   shared/matching.js — the frontend's offline fallback uses an
   ES-module copy of the same file (see scripts/sync-shared.js), so
   this logic only ever needs to be edited in one place. ---------- */

function findMatches(dishes, userIngredients, options = {}) {
  const { cuisine = "all", category = "all", maxMissing = 999 } = options;

  let pool = dishes;
  if (cuisine !== "all") pool = pool.filter((d) => d.cuisine === cuisine);
  if (category !== "all") pool = pool.filter((d) => d.category === category);

  const results = pool.map((dish) => {
    const dishIngredients = dish.ingredient_names || [];
    const { matched, missing, matchPercent } = scoreDish(dishIngredients, userIngredients);
    return {
      dish,
      matchedCount: matched.length,
      missingCount: missing.length,
      matchedIngredients: matched,
      missingIngredients: missing,
      matchPercent,
    };
  });

  return results
    .filter((r) => r.missingCount <= maxMissing && r.matchedCount > 0)
    .sort((a, b) => b.matchPercent - a.matchPercent || a.missingCount - b.missingCount);
}

/* ---------------------------------------------------------
   Dish photos, sourced on demand from the Pexels API and
   cached to disk (backend/image-cache.json) so we only ever
   pay for one lookup per dish, ever — not per request.

   Requires a free Pexels API key (https://www.pexels.com/api/)
   set as PEXELS_API_KEY. Without one, the endpoint below
   responds 501 and the frontend just shows its placeholder —
   nothing else breaks.

   Pexels' terms let you hotlink the returned photo URL
   directly and don't require attribution, but we store and
   surface the photographer credit anyway as a courtesy.
--------------------------------------------------------- */
const PEXELS_API_KEY = process.env.PEXELS_API_KEY;
const IMAGE_CACHE_PATH = path.join(__dirname, "image-cache.json");
// How long a "no photo found" result is cached before we're willing to
// retry — Pexels' library grows over time, so a miss today isn't
// necessarily a miss forever. Successful hits are cached indefinitely.
const NEGATIVE_CACHE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

let imageCache = {};
try {
  imageCache = JSON.parse(fs.readFileSync(IMAGE_CACHE_PATH, "utf8"));
} catch {
  imageCache = {}; // no cache file yet — first run, or it was deleted
}

let cacheWriteTimer = null;
function saveImageCacheSoon() {
  // Debounce writes so a burst of concurrent lookups (e.g. someone
  // paging through many dishes fast) doesn't hammer the filesystem.
  clearTimeout(cacheWriteTimer);
  cacheWriteTimer = setTimeout(() => {
    fs.writeFile(IMAGE_CACHE_PATH, JSON.stringify(imageCache, null, 2), () => {});
  }, 500);
}

async function fetchDishPhoto(dish) {
  const query = [dish.name, dish.country, "food dish"].filter(Boolean).join(" ");
  const res = await fetch(
    `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=1&orientation=landscape`,
    { headers: { Authorization: PEXELS_API_KEY } }
  );
  if (!res.ok) throw new Error(`Pexels API error (${res.status})`);
  const data = await res.json();
  const photo = data.photos && data.photos[0];
  if (!photo) return null;
  return {
    url: photo.src.large,
    width: photo.width,
    height: photo.height,
    credit: photo.photographer,
    creditUrl: photo.photographer_url,
    sourceUrl: photo.url,
    source: "pexels",
  };
}

// GET /api/dish-image/:id -> { image: {...} } | { image: null }
app.get("/api/dish-image/:id", async (req, res) => {
  const dish = DISHES_BY_ID.get(req.params.id);
  if (!dish) return res.status(404).json({ error: "Dish not found" });

  if (!PEXELS_API_KEY) {
    return res.status(501).json({ error: "Image lookup isn't configured (missing PEXELS_API_KEY)." });
  }

  const cached = imageCache[dish.id];
  const cacheIsFreshEnough = cached && (cached.found || Date.now() - cached.cachedAt < NEGATIVE_CACHE_MS);
  if (cacheIsFreshEnough) {
    return res.json({ image: cached.found ? cached.image : null });
  }

  try {
    const image = await fetchDishPhoto(dish);
    imageCache[dish.id] = { found: !!image, image: image || null, cachedAt: Date.now() };
    saveImageCacheSoon();
    res.json({ image });
  } catch (err) {
    console.error(`Dish photo lookup failed for ${dish.id}:`, err.message);
    // Don't cache transient failures (rate limits, network blips) — only
    // cache genuine "no photo exists for this dish" results.
    res.status(502).json({ error: "Image lookup failed, try again later." });
  }
});

/* ---------------------- routes ---------------------- */

// GET /api/dishes  -> full dataset (optionally filtered by cuisine/category)
app.get("/api/dishes", (req, res) => {
  const { cuisine, category } = req.query;
  let result = DISHES;
  if (cuisine) result = result.filter((d) => d.cuisine === cuisine);
  if (category) result = result.filter((d) => d.category === category);
  res.json({ count: result.length, dishes: result });
});

// GET /api/dishes/:id -> single dish detail
app.get("/api/dishes/:id", (req, res) => {
  const dish = DISHES.find((d) => d.id === req.params.id);
  if (!dish) return res.status(404).json({ error: "Dish not found" });
  res.json(dish);
});

// Ingredients are short words/phrases typed by a person — cap both the
// count and the length of each one so a malformed or malicious payload
// can't force expensive Levenshtein comparisons across every dish for
// thousands of "ingredients".
const MAX_INGREDIENTS = 30;
const MAX_INGREDIENT_LENGTH = 60;

// POST /api/match  -> body: { ingredients: [...], cuisine, category, maxMissing, exactOnly }
app.post("/api/match", (req, res) => {
  const { ingredients, cuisine = "all", category = "all", maxMissing = 2, exactOnly = false } = req.body || {};

  if (!Array.isArray(ingredients) || ingredients.length === 0) {
    return res.status(400).json({ error: "ingredients must be a non-empty array" });
  }
  if (ingredients.length > MAX_INGREDIENTS) {
    return res.status(400).json({ error: `ingredients must contain at most ${MAX_INGREDIENTS} items` });
  }
  if (!ingredients.every((i) => typeof i === "string" && i.length > 0 && i.length <= MAX_INGREDIENT_LENGTH)) {
    return res.status(400).json({
      error: `each ingredient must be a non-empty string of at most ${MAX_INGREDIENT_LENGTH} characters`,
    });
  }
  if (typeof cuisine !== "string" || typeof category !== "string") {
    return res.status(400).json({ error: "cuisine and category must be strings" });
  }
  if (maxMissing !== undefined && (typeof maxMissing !== "number" || maxMissing < 0)) {
    return res.status(400).json({ error: "maxMissing must be a non-negative number" });
  }

  const results = findMatches(DISHES, ingredients, {
    cuisine,
    category,
    maxMissing: exactOnly ? 0 : maxMissing,
  });

  res.json({ count: results.length, results });
});

// GET /api/ingredients?q=oni  -> all known ingredient names, optionally filtered
// (used to power the autocomplete/typeahead in the ingredient search bar)
app.get("/api/ingredients", (req, res) => {
  const q = normalize(req.query.q || "");
  const results = q ? INGREDIENTS.filter((i) => normalize(i).includes(q)) : INGREDIENTS;
  res.json({ count: results.length, ingredients: results });
});

// GET /api/search?q=wat  -> name search
app.get("/api/search", (req, res) => {
  const q = normalize(req.query.q || "");
  const matches = DISHES.filter((d) => normalize(d.name).includes(q));
  res.json({ count: matches.length, dishes: matches });
});

// 404 for any route that doesn't match one of the above.
app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Centralized error handler. Without this, an unhandled error (e.g. a
// malformed request body) falls through to Express's default handler,
// which by default sends back a full stack trace to the client — fine
// for local dev, not something to expose once this is publicly deployed.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === "production" ? "Internal server error" : err.message,
  });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Recipe API running at http://localhost:${PORT}`);
  console.log(`Loaded ${DISHES.length} dishes`);
});
