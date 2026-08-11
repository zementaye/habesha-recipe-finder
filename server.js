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

// GET /api/search?q=wat&cuisine=habesha&category=fasting  -> find dishes in
// general, no ingredients required. Matches against name, Amharic name,
// country, region, cuisine, dish type, and description. An empty/missing q
// just returns the (optionally filtered) dish list, so this also powers
// plain "browse everything" with no search term typed yet.
app.get("/api/search", (req, res) => {
  const q = normalize(req.query.q || "");
  const { cuisine, category } = req.query;

  let pool = DISHES;
  if (cuisine && cuisine !== "all") pool = pool.filter((d) => d.cuisine === cuisine);
  if (category && category !== "all") pool = pool.filter((d) => d.category === category);

  const matches = q
    ? pool.filter((d) => {
        const haystack = [d.name, d.name_amharic, d.country, d.region, d.cuisine, d.type, d.description]
          .filter(Boolean)
          .map(normalize)
          .join(" ");
        return haystack.includes(q);
      })
    : pool;

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
