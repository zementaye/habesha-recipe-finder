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
let DISHES;
try {
  const parsed = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
  DISHES = parsed.dishes;
  if (!Array.isArray(DISHES) || DISHES.length === 0) {
    throw new Error("all_dishes_merged.json has no dishes array");
  }
} catch (err) {
  console.error(`Failed to load dish data from ${DATA_PATH}:`, err.message);
  process.exit(1);
}

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

/* ---------- matching logic (kept identical in frontend/src/RecipeFinder.jsx —
   see that file's matching section if you change anything here) ---------- */
function normalize(str) {
  let s = str.toLowerCase().trim().replace(/[^a-z0-9\s]/g, "");
  // Crude plural stripping. A bare `s$` strip mishandles "-oes"/"-shes"/etc.
  // plurals — e.g. "tomatoes" -> "tomatoe" instead of "tomato" — which
  // silently broke exact matches on common ingredients like tomato/potato.
  // Note: this still doesn't handle "-ies" plurals (e.g. "chilies"), which
  // would need real stemming to fix properly.
  if (/[^aeiou]oes$/.test(s) || /(ch|sh|x|z|s)es$/.test(s)) {
    s = s.replace(/es$/, "");
  } else {
    s = s.replace(/s$/, "");
  }
  return s;
}

// Dependency-free Levenshtein distance, used only for short-string typo
// tolerance (e.g. "chiken" -> "chicken"). Keeping this hand-rolled avoids
// pulling in a package for what's a small, well-understood algorithm.
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j - 1], prev[j], cur[j - 1]);
    }
    prev = cur;
  }
  return prev[n];
}
function fuzzyHit(u, target) {
  if (!target || u.length < 4 || target.length < 4) return false;
  const dist = levenshtein(u, target);
  return dist <= 1 || dist / Math.max(u.length, target.length) <= 0.25;
}

// Scores how well a single user-typed ingredient matches a single dish
// ingredient, from 0 (no match) to 1 (exact match), in tiers:
//   1.0  exact match on the ingredient's core name (prep notes stripped,
//        e.g. "onion" vs "onion, diced")
//   0.7  whole-word match against the ingredient's core or full name
//        (e.g. "onion" inside "green onion", "pickled onion", "onion powder" —
//        real hits, but weaker than having exactly that ingredient)
//   0.45 substring match that isn't a whole word
//   0.4  fuzzy match for likely typos (e.g. "chiken" -> "chicken")
//   0    no match
function matchScore(userIngredient, dishIngredientRaw) {
  const u = normalize(userIngredient);
  if (!u) return 0;

  const core = normalize(cleanIngredientName(dishIngredientRaw));
  const full = normalize(dishIngredientRaw);
  if (!core && !full) return 0;

  if (u === core) return 1.0;

  const coreWords = core ? core.split(/\s+/).filter(Boolean) : [];
  const fullWords = full ? full.split(/\s+/).filter(Boolean) : [];
  if (coreWords.includes(u) || fullWords.includes(u)) return 0.7;

  if ((core && (core.includes(u) || u.includes(core))) || (full && (full.includes(u) || u.includes(full)))) {
    return 0.45;
  }

  if (fuzzyHit(u, core) || fuzzyHit(u, full)) return 0.4;
  for (const w of coreWords.length ? coreWords : fullWords) {
    if (fuzzyHit(u, w)) return 0.4;
  }

  return 0;
}
function ingredientMatches(userIngredient, dishIngredient) {
  return matchScore(userIngredient, dishIngredient) > 0;
}

// Scores a dish against the user's ingredient list. Ingredients earlier in
// a dish's list are weighted more heavily than later ones — the dataset
// consistently lists the core/protein ingredients first and garnishes or
// optional extras last (see doro_tibs, jollof_rice, etc.), so this is a
// reasonable proxy for "core" vs "minor" without needing extra metadata.
// The final percent blends match-tier strength (a whole-word hit counts for
// less than an exact one) with that positional weighting, so missing a
// core ingredient hurts more than missing a garnish, and a fuzzy/partial
// hit counts for less than a clean match.
function scoreDish(dishIngredientNames, userIngredients) {
  const n = dishIngredientNames.length;
  const matched = [];
  const missing = [];
  let weightedScore = 0;
  let weightedTotal = 0;

  dishIngredientNames.forEach((ing, idx) => {
    const weight = n - idx; // earlier ingredients weigh more
    weightedTotal += weight;
    let best = 0;
    for (const u of userIngredients) {
      const s = matchScore(u, ing);
      if (s > best) best = s;
      if (best === 1) break;
    }
    if (best > 0) {
      matched.push(ing);
      weightedScore += weight * best;
    } else {
      missing.push(ing);
    }
  });

  return {
    matched,
    missing,
    matchPercent: weightedTotal ? Math.round((weightedScore / weightedTotal) * 100) : 0,
  };
}

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

// GET /api/health -> simple liveness/readiness check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", dishCount: DISHES.length });
});

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
  // Guard against non-string entries (e.g. numbers, null) which would
  // otherwise throw inside normalize()/matchScore().
  const cleanIngredients = ingredients.filter((i) => typeof i === "string" && i.trim().length > 0);
  if (cleanIngredients.length === 0) {
    return res.status(400).json({ error: "ingredients must contain at least one non-empty string" });
  }

  const results = findMatches(DISHES, cleanIngredients, {
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
