const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();

// In production, set FRONTEND_URL to your deployed frontend's origin
// (e.g. https://your-app.vercel.app) to restrict CORS properly.
// Falls back to allowing all origins, which is fine for local dev.
const FRONTEND_URL = process.env.FRONTEND_URL;
app.use(cors(FRONTEND_URL ? { origin: FRONTEND_URL } : {}));
app.use(express.json());

const DATA_PATH = path.join(__dirname, "all_dishes_merged.json");
const DISHES = JSON.parse(fs.readFileSync(DATA_PATH, "utf8")).dishes;

/* ---------- ingredient list (built once at startup) ---------- */
// Raw ingredient names in the dataset carry prep notes like
// "onion, diced" or "beans (optional)" — strip those down to a clean,
// display-friendly, deduplicated name for autocomplete purposes.
function cleanIngredientName(raw) {
  return raw
    .split(",")[0]
    .replace(/\([^)]*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
const INGREDIENTS = Array.from(
  new Set(
    DISHES.flatMap((d) => (d.ingredients || []).map((i) => cleanIngredientName(i.name)))
      .filter(Boolean)
      .map((n) => n.toLowerCase())
  )
).sort((a, b) => a.localeCompare(b));

/* ---------- matching logic (same as matcher.js) ---------- */
function normalize(str) {
  return str.toLowerCase().trim().replace(/[^a-z0-9\s]/g, "").replace(/s$/, "");
}
function ingredientMatches(userIngredient, dishIngredient) {
  const u = normalize(userIngredient);
  const d = normalize(dishIngredient);
  return d.includes(u) || u.includes(d);
}
function findMatches(dishes, userIngredients, options = {}) {
  const { cuisine = "all", category = "all", maxMissing = 999 } = options;
  const userSet = userIngredients.map(normalize);

  let pool = dishes;
  if (cuisine !== "all") pool = pool.filter((d) => d.cuisine === cuisine);
  if (category !== "all") pool = pool.filter((d) => d.category === category);

  const results = pool.map((dish) => {
    const dishIngredients = dish.ingredient_names || [];
    const matched = [];
    const missing = [];
    dishIngredients.forEach((ing) => {
      const isMatched = userSet.some((u) => ingredientMatches(u, ing));
      (isMatched ? matched : missing).push(ing);
    });
    return {
      dish,
      matchedCount: matched.length,
      missingCount: missing.length,
      matchedIngredients: matched,
      missingIngredients: missing,
      matchPercent: dishIngredients.length
        ? Math.round((matched.length / dishIngredients.length) * 100)
        : 0,
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

// POST /api/match  -> body: { ingredients: [...], cuisine, category, maxMissing, exactOnly }
app.post("/api/match", (req, res) => {
  const { ingredients = [], cuisine = "all", category = "all", maxMissing = 2, exactOnly = false } = req.body;

  if (!Array.isArray(ingredients) || ingredients.length === 0) {
    return res.status(400).json({ error: "ingredients must be a non-empty array" });
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

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Recipe API running at http://localhost:${PORT}`);
  console.log(`Loaded ${DISHES.length} dishes`);
});
