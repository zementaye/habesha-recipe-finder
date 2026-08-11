#!/usr/bin/env node
/**
 * scripts/sync-dishes.js
 *
 * Regenerates two generated frontend files from
 * backend/all_dishes_merged.json, so nothing has to be kept in sync by
 * hand:
 *
 *  - frontend/src/dishes-fallback.js — the full dish dataset. A
 *    standalone module (not inlined into RecipeFinder.jsx) so Vite can
 *    code-split it into its own chunk and the app can `import()` it
 *    lazily, only when the API is actually unreachable, instead of
 *    shipping ~500 dishes' worth of JSON in the main bundle on every
 *    page load.
 *
 *  - frontend/src/ingredient-names.js — just the deduplicated, sorted
 *    ingredient names (a tiny fraction of the full dataset's size), used
 *    to power the ingredient autocomplete instantly without needing the
 *    full dataset loaded.
 *
 * Usage:
 *   node scripts/sync-dishes.js
 *
 * This is wired up as a `predev` / `prebuild` step in frontend/package.json,
 * so `npm run dev` and `npm run build` in frontend/ always run it
 * automatically. You can also run it manually any time
 * backend/all_dishes_merged.json changes.
 */

const fs = require("fs");
const path = require("path");
const { cleanIngredientName } = require("../shared/matching");

const BACKEND_JSON_PATH = path.join(__dirname, "..", "backend", "all_dishes_merged.json");
const DISHES_OUT_PATH = path.join(__dirname, "..", "frontend", "src", "dishes-fallback.js");
const INGREDIENTS_OUT_PATH = path.join(__dirname, "..", "frontend", "src", "ingredient-names.js");

function main() {
  const backendRaw = fs.readFileSync(BACKEND_JSON_PATH, "utf8");
  const { dishes } = JSON.parse(backendRaw);

  if (!Array.isArray(dishes) || dishes.length === 0) {
    throw new Error(`No dishes found in ${BACKEND_JSON_PATH}`);
  }

  const dishesBanner =
    "// GENERATED FILE — do not hand-edit.\n" +
    "// Source of truth: backend/all_dishes_merged.json. Regenerate with:\n" +
    "//   node scripts/sync-dishes.js  (or npm run dev / npm run build, which do it automatically)\n" +
    "//\n" +
    "// Loaded via dynamic import() only when the API is unreachable — see\n" +
    "// the offline-fallback code in RecipeFinder.jsx — so this ~500-dish\n" +
    "// dataset does not bloat the main app bundle for the common case.\n\n";
  const dishesOutput = `${dishesBanner}export const DISHES = ${JSON.stringify(dishes)};\n`;
  fs.writeFileSync(DISHES_OUT_PATH, dishesOutput, "utf8");

  const ingredientSet = new Set();
  dishes.forEach((d) => {
    (d.ingredients || []).forEach((i) => {
      const clean = cleanIngredientName(i.name).toLowerCase();
      if (clean) ingredientSet.add(clean);
    });
  });
  const ingredientNames = Array.from(ingredientSet).sort((a, b) => a.localeCompare(b));

  const ingredientsBanner =
    "// GENERATED FILE — do not hand-edit.\n" +
    "// Source of truth: backend/all_dishes_merged.json. Regenerate with:\n" +
    "//   node scripts/sync-dishes.js  (or npm run dev / npm run build, which do it automatically)\n" +
    "//\n" +
    "// Deduplicated, cleaned, sorted ingredient names across every dish —\n" +
    "// kept as a small standalone module so the ingredient autocomplete\n" +
    "// works without loading the full dish dataset (see dishes-fallback.js).\n\n";
  const ingredientsOutput = `${ingredientsBanner}export const INGREDIENT_NAMES = ${JSON.stringify(ingredientNames)};\n`;
  fs.writeFileSync(INGREDIENTS_OUT_PATH, ingredientsOutput, "utf8");

  console.log(
    `Synced ${dishes.length} dishes from ${path.relative(process.cwd(), BACKEND_JSON_PATH)} into:\n` +
      `  - ${path.relative(process.cwd(), DISHES_OUT_PATH)}\n` +
      `  - ${path.relative(process.cwd(), INGREDIENTS_OUT_PATH)} (${ingredientNames.length} unique ingredients)`
  );
}

main();
