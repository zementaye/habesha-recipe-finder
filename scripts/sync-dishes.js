#!/usr/bin/env node
/**
 * scripts/sync-dishes.js
 *
 * Regenerates the embedded `const DISHES = [...]` line in
 * frontend/src/RecipeFinder.jsx from backend/all_dishes_merged.json,
 * so the two copies of the dataset can't silently drift apart again.
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

const BACKEND_JSON_PATH = path.join(__dirname, "..", "backend", "all_dishes_merged.json");
const FRONTEND_JSX_PATH = path.join(__dirname, "..", "frontend", "src", "RecipeFinder.jsx");

const DISHES_LINE_PATTERN = /^const DISHES = \[.*\];$/m;

function main() {
  const backendRaw = fs.readFileSync(BACKEND_JSON_PATH, "utf8");
  const { dishes } = JSON.parse(backendRaw);

  if (!Array.isArray(dishes) || dishes.length === 0) {
    throw new Error(`No dishes found in ${BACKEND_JSON_PATH}`);
  }

  const newLine = `const DISHES = ${JSON.stringify(dishes)};`;

  const jsxSource = fs.readFileSync(FRONTEND_JSX_PATH, "utf8");

  if (!DISHES_LINE_PATTERN.test(jsxSource)) {
    throw new Error(
      `Could not find a "const DISHES = [...];" line in ${FRONTEND_JSX_PATH}. ` +
        `The sync script expects the embedded dataset to live on a single line ` +
        `starting with "const DISHES = [" and ending with "];".`
    );
  }

  const updatedSource = jsxSource.replace(DISHES_LINE_PATTERN, () => newLine);

  fs.writeFileSync(FRONTEND_JSX_PATH, updatedSource, "utf8");

  console.log(
    `Synced ${dishes.length} dishes from ${path.relative(process.cwd(), BACKEND_JSON_PATH)} ` +
      `into ${path.relative(process.cwd(), FRONTEND_JSX_PATH)}`
  );
}

main();
