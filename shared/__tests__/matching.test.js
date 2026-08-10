// describe/it/expect come from vitest's globals (enabled in
// backend/vitest.config.js) so this file can run whether it's picked up
// from backend/ or executed directly with `npx vitest`.
const { matchScore, scoreDish, cleanIngredientName, normalize } = require("../matching");

describe("cleanIngredientName", () => {
  it("strips prep notes after a comma", () => {
    expect(cleanIngredientName("onion, diced")).toBe("onion");
  });
  it("strips parenthetical notes", () => {
    expect(cleanIngredientName("beans (optional)")).toBe("beans");
  });
  it("collapses extra whitespace", () => {
    expect(cleanIngredientName("niter kibbeh  or oil")).toBe("niter kibbeh  or oil".replace(/\s+/g, " "));
  });
});

describe("normalize", () => {
  it("lowercases and strips punctuation", () => {
    expect(normalize("Berbere!")).toBe("berbere");
  });
  it("strips a single trailing s (naive pluralization)", () => {
    expect(normalize("onions")).toBe("onion");
  });
});

describe("matchScore tiers", () => {
  it("scores an exact core-name match as 1.0", () => {
    expect(matchScore("onion", "onion, diced")).toBe(1.0);
  });

  it("scores a whole-word match inside a longer ingredient as 0.7", () => {
    expect(matchScore("onion", "green onion, sliced")).toBe(0.7);
  });

  it("scores a non-whole-word substring match as 0.45", () => {
    // "kibbeh" is a substring of "niter kibbeh" but not a standalone word match
    // against a shorter partial token — use a case with a true substring, not a word.
    expect(matchScore("kib", "niter kibbeh")).toBe(0.45);
  });

  it("tolerates a one-character typo (fuzzy tier, 0.4)", () => {
    expect(matchScore("chiken", "chicken, cut into pieces")).toBe(0.4);
  });

  it("does not fuzzy-match short strings (under 4 chars) to avoid false positives", () => {
    // "egg" (3 chars) shouldn't fuzzy-match something unrelated and short
    expect(matchScore("egg", "beg")).toBe(0);
  });

  it("returns 0 for unrelated ingredients", () => {
    expect(matchScore("pineapple", "berbere")).toBe(0);
  });

  it("returns 0 for an empty user ingredient", () => {
    expect(matchScore("", "onion")).toBe(0);
  });

  it("is case- and plural-insensitive", () => {
    expect(matchScore("Onions", "onion, diced")).toBe(1.0);
  });
});

describe("scoreDish weighting", () => {
  const dishIngredients = ["beef, cubed", "onion", "berbere", "garlic", "salt"];

  it("gives a higher matchPercent for matching an earlier (core) ingredient than a later one", () => {
    const coreMatch = scoreDish(dishIngredients, ["beef"]);
    const garnishMatch = scoreDish(dishIngredients, ["salt"]);
    expect(coreMatch.matchPercent).toBeGreaterThan(garnishMatch.matchPercent);
  });

  it("reaches 100% only when every ingredient matches exactly", () => {
    const result = scoreDish(dishIngredients, ["beef", "onion", "berbere", "garlic", "salt"]);
    expect(result.matchPercent).toBe(100);
    expect(result.missing).toEqual([]);
  });

  it("returns 0% and all-missing when nothing matches", () => {
    const result = scoreDish(dishIngredients, ["pineapple", "coconut"]);
    expect(result.matchPercent).toBe(0);
    expect(result.matched).toEqual([]);
    expect(result.missing).toEqual(dishIngredients);
  });

  it("partial (whole-word/fuzzy) matches score lower than exact matches for the same ingredient set", () => {
    const exact = scoreDish(dishIngredients, ["beef", "onion", "berbere", "garlic", "salt"]);
    const fuzzy = scoreDish(dishIngredients, ["beaf", "onions", "berbere", "garlic", "salt"]);
    expect(fuzzy.matchPercent).toBeLessThanOrEqual(exact.matchPercent);
  });

  it("handles an empty dish ingredient list without dividing by zero", () => {
    const result = scoreDish([], ["onion"]);
    expect(result.matchPercent).toBe(0);
    expect(result.matched).toEqual([]);
    expect(result.missing).toEqual([]);
  });
});
