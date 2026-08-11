import React, { useState, useMemo, useRef, useEffect } from "react";
import { Plus, X, Search, Flame, Leaf, ChefHat, Clock, Users, SlidersHorizontal, WifiOff, ArrowLeft } from "lucide-react";
import { INGREDIENT_NAMES } from "./ingredient-names";
import { scoreDish as sharedScoreDish } from "./matching";

// Points at your deployed backend in production (set VITE_API_URL in your
// hosting provider's env vars), falls back to localhost for local dev, and
// falls back further to the offline dataset (lazy-loaded from
// ./dishes-fallback.js, see the fetch effect below) if neither is reachable.
const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3001";

const SPICE_LABELS = ["None", "Mild", "Medium", "Hot"];
const SPICE_MAP = { none: 0, mild: 1, medium: 2, hot: 3 };
const QUICK_ADD = ["onion","garlic","tomato","berbere","chicken","lentils","ginger","potato","rice","olive oil","egg","beef","cabbage","chickpeas"];
const RESULTS_PAGE_SIZE = 24; // cards shown at once before "Show more" — keeps a broad ingredient list from rendering hundreds of cards up front
const FAVORITES_STORAGE_KEY = "habesha-recipe-finder:favorites";

/* ---------------------------------------------------------
   Normalize a raw dish record (same shape whether it came
   from the embedded array or the API) into what the UI needs.
--------------------------------------------------------- */
function normalizeDish(d) {
  const spice = typeof d.spice_level === "number" ? d.spice_level : (SPICE_MAP[d.spice_level] ?? 0);
  const subtitleParts = [];
  if (d.name_amharic) subtitleParts.push(d.name_amharic);
  subtitleParts.push(d.country || d.region || "");
  return {
    id: d.id,
    name: d.name,
    subtitle: subtitleParts.filter(Boolean).join(" · "),
    cuisine: d.cuisine,
    region: d.region,
    category: d.category,
    spice,
    prep: d.prep_time_minutes,
    cook: d.cook_time_minutes,
    serves: d.serves,
    ingredients: d.ingredients || [],
    ingredientNames: (d.ingredients || []).map((i) => i.name.toLowerCase()),
    substitutions: d.substitutions || {},
    steps: d.steps || [],
    description: d.description || null,
    nutrition: d.nutrition || null,
  };
}

/* ---------------------------------------------------------
   Matching logic itself lives in shared/matching.js (a single
   source of truth also used by backend/server.js — see
   scripts/sync-shared.js for how this copy is generated). This
   is a thin adapter so call sites below can keep passing a
   normalized `dish` object and getting back { have, missing,
   percent } the way they always have.
--------------------------------------------------------- */
function scoreDish(dish, userIngredients) {
  const { matched, missing, matchPercent } = sharedScoreDish(dish.ingredientNames, userIngredients);
  return { have: matched, missing, percent: matchPercent };
}

/* ---------------------------------------------------------
   Signature visual: mesob-inspired ring, reused as the
   match-% indicator and as decorative hero graphic.
--------------------------------------------------------- */
function MatchRing({ percent, size = 56, accent }) {
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (percent / 100) * c;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#E7DAB8" strokeWidth="5" />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none" stroke={accent} strokeWidth="5"
        strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: "stroke-dashoffset 0.5s ease" }}
      />
      <text x="50%" y="52%" textAnchor="middle" dominantBaseline="middle" fontFamily="'IBM Plex Mono', monospace" fontSize={size * 0.24} fontWeight="600" fill="#2A1B12">
        {percent}%
      </text>
    </svg>
  );
}

function HeroSpiral() {
  const rings = [46, 37, 28, 19, 10];
  return (
    <svg viewBox="0 0 120 120" width="120" height="120" style={{ opacity: 0.9 }}>
      {rings.map((r, i) => (
        <circle key={r} cx="60" cy="60" r={r} fill="none" stroke={i % 2 === 0 ? "#9E2B1B" : "#C98A2C"} strokeWidth="2.5" strokeDasharray={i % 2 === 0 ? "1 7" : "none"} opacity={0.85 - i * 0.08} />
      ))}
      <circle cx="60" cy="60" r="4" fill="#4B6B3A" />
    </svg>
  );
}

/* ---------------------------------------------------------
   Detail modal — shown on card click, works regardless of
   how many ingredients the user has (full steps always shown).
--------------------------------------------------------- */
/* ---------------------------------------------------------
   DishEmblem: a generated, layered "plate" scene instead of a
   sourced photo. Real photos turned out to fight the tilt
   interaction — every source photo has a different crop and
   framing, so a fixed-size box either cut off the food or
   showed mostly background. This is drawn from the dish's own
   data (id, accent color, spice level) instead, so every one
   of the 500 dishes gets a properly-composed, licensing-free
   scene with zero lookups.

   Each layer (plate, food mound, steam, flecks) moves by a
   different amount as you tilt it — actual parallax depth,
   which a flat photo can't give you — plus the same overall
   perspective tilt as before for the "turning it in your
   hands" feel.
--------------------------------------------------------- */
function hashSeed(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(h, 31) + str.charCodeAt(i)) | 0;
  return h;
}
// Deterministic 0..1 pseudo-random values derived from a dish's id, so
// its emblem looks the same every time without storing anything.
function seededRandoms(id, count) {
  let s = hashSeed(id) || 1;
  const out = [];
  for (let i = 0; i < count; i++) {
    s = (Math.imul(s, 48271) % 2147483647 + 2147483647) % 2147483647 || 1;
    out.push((s % 10000) / 10000);
  }
  return out;
}

function DishEmblem({ dish, accent }) {
  const frameRef = useRef(null);
  const [tilt, setTilt] = useState({ rx: 0, ry: 0, mx: 50, my: 50 });
  const [active, setActive] = useState(false);

  const updateFromPoint = (clientX, clientY) => {
    const el = frameRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const clampedX = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const clampedY = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
    const maxDeg = 10;
    setTilt({
      rx: (0.5 - clampedY) * maxDeg * 2,
      ry: (clampedX - 0.5) * maxDeg * 2,
      mx: clampedX * 100,
      my: clampedY * 100,
    });
  };
  const reset = () => { setActive(false); setTilt({ rx: 0, ry: 0, mx: 50, my: 50 }); };

  // Parallax offset for a layer: further-back layers barely move,
  // foreground layers (flecks) swing further, selling the depth.
  const parallax = (depth) => ({
    x: (tilt.ry / 20) * depth,
    y: (-tilt.rx / 20) * depth,
  });

  const r = seededRandoms(dish.id, 16);
  const blobRadius = `${38 + r[0] * 24}% ${62 - r[0] * 24}% ${58 + r[1] * 20}% ${42 - r[1] * 20}% / ${44 + r[2] * 18}% ${40 + r[3] * 18}% ${60 - r[3] * 18}% ${56 - r[2] * 18}%`;
  const blobRotate = -8 + r[4] * 16;
  const gold = "#E8B84B";
  const showSteam = dish.spice > 0 || dish.category === "non-fasting";
  const fleckCount = 6;
  const flecks = Array.from({ length: fleckCount }, (_, i) => ({
    x: 28 + r[(5 + i) % 16] * 44,
    y: 26 + r[(9 + i) % 16] * 48,
    size: 3 + r[(2 + i) % 16] * 5,
    color: i % 3 === 0 ? gold : i % 3 === 1 ? accent : "#FFF7E6",
  }));

  const plateP = parallax(3);
  const blobP = parallax(7);
  const fleckP = parallax(14);

  return (
    <div style={{ marginBottom: 6 }}>
      <div
        ref={frameRef}
        onMouseMove={(e) => { setActive(true); updateFromPoint(e.clientX, e.clientY); }}
        onMouseLeave={reset}
        onTouchMove={(e) => { if (e.touches[0]) { setActive(true); updateFromPoint(e.touches[0].clientX, e.touches[0].clientY); } }}
        onTouchEnd={reset}
        style={{ perspective: 900, height: 260, borderRadius: 14, cursor: "grab" }}
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            borderRadius: 14,
            position: "relative",
            overflow: "hidden",
            background: `radial-gradient(120% 100% at 30% 20%, ${accent}14, #FBF3E3 65%)`,
            transform: `rotateX(${tilt.rx}deg) rotateY(${tilt.ry}deg) scale(${active ? 1.015 : 1})`,
            transition: active ? "transform 60ms linear" : "transform 350ms ease-out",
            boxShadow: active ? "0 20px 30px -12px rgba(42,27,18,0.35)" : "0 8px 18px -8px rgba(42,27,18,0.25)",
            border: "1px solid #EFE6D0",
          }}
        >
          {/* background spiral echo, reusing the app's mesob motif */}
          <div
            style={{
              position: "absolute", inset: 0, opacity: 0.25,
              transform: `translate(${plateP.x}px, ${plateP.y}px)`,
              backgroundImage: `repeating-radial-gradient(circle at 75% 30%, ${accent}22 0, ${accent}22 2px, transparent 2px, transparent 14px)`,
            }}
          />
          {/* plate */}
          <div
            style={{
              position: "absolute", left: "50%", top: "58%", width: "72%", height: "58%",
              transform: `translate(-50%, -50%) translate(${plateP.x}px, ${plateP.y}px)`,
              borderRadius: "50%",
              background: "radial-gradient(circle at 35% 30%, #FFFDF7, #EFE1C0 70%, #DCCFA8)",
              boxShadow: "0 10px 20px -8px rgba(42,27,18,0.25), inset 0 -6px 12px rgba(42,27,18,0.08)",
            }}
          />
          {/* food mound */}
          <div
            style={{
              position: "absolute", left: "50%", top: "56%", width: "50%", height: "42%",
              transform: `translate(-50%, -50%) translate(${blobP.x}px, ${blobP.y}px) rotate(${blobRotate}deg)`,
              borderRadius: blobRadius,
              background: `radial-gradient(circle at 35% 30%, ${gold}, ${accent} 75%)`,
              boxShadow: `0 8px 16px -6px ${accent}66`,
            }}
          >
            {flecks.map((f, i) => (
              <div
                key={i}
                style={{
                  position: "absolute", left: `${f.x}%`, top: `${f.y}%`,
                  width: f.size, height: f.size, borderRadius: "50%",
                  background: f.color,
                  transform: `translate(${fleckP.x}px, ${fleckP.y}px)`,
                  boxShadow: "0 1px 2px rgba(42,27,18,0.3)",
                }}
              />
            ))}
          </div>
          {/* steam, for hot/non-fasting dishes */}
          {showSteam && [0, 1].map((i) => (
            <div
              key={i}
              className="rf-steam"
              style={{
                position: "absolute", left: `${44 + i * 12}%`, top: "18%", width: 10, height: 60,
                borderRadius: 999, background: "linear-gradient(rgba(255,255,255,0.55), rgba(255,255,255,0))",
                filter: "blur(3px)", animationDelay: `${i * 0.6}s`,
              }}
            />
          ))}
          {/* moving glare, sells the tilt/rotation */}
          <div
            style={{
              position: "absolute", inset: 0, pointerEvents: "none",
              background: `radial-gradient(circle at ${tilt.mx}% ${tilt.my}%, rgba(255,255,255,0.3), rgba(255,255,255,0) 45%)`,
              opacity: active ? 1 : 0.4,
              transition: "opacity 200ms ease-out",
            }}
          />
        </div>
      </div>
    </div>
  );
}

function DishModal({ entry, onClose, isFavorite, onToggleFavorite }) {
  const { dish, have, missing, percent } = entry;
  const accent = dish.cuisine === "habesha" ? "#9E2B1B" : "#C98A2C";
  const haveSet = new Set(have);

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(42,27,18,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 50 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: "#FFFDF7", borderRadius: 18, maxWidth: 560, width: "100%", maxHeight: "88vh", overflowY: "auto", padding: 24, border: "1px solid #E7DAB8" }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <button onClick={onClose} className="rf-btn rf-focus" style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#7A6A54", fontSize: 13, padding: 0, cursor: "pointer" }}>
            <ArrowLeft size={15} /> Back to results
          </button>
          <button
            onClick={onToggleFavorite}
            aria-label={isFavorite ? `Remove ${dish.name} from favorites` : `Add ${dish.name} to favorites`}
            aria-pressed={isFavorite}
            className="rf-btn rf-focus"
            style={{ display: "flex", alignItems: "center", gap: 5, border: "none", background: "transparent", cursor: "pointer", fontSize: 13, fontWeight: 500, color: isFavorite ? "#C98A2C" : "#9C8D74" }}
          >
            {isFavorite ? "★ Favorited" : "☆ Add to favorites"}
          </button>
        </div>

        <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
          <MatchRing percent={percent} size={64} accent={accent} />
          <div>
            <div className="rf-display" style={{ fontSize: 22, fontWeight: 600 }}>{dish.name}</div>
            <div style={{ fontSize: 13, color: "#8A7A62", marginTop: 2 }}>{dish.subtitle}</div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 14, marginTop: 14, fontSize: 12.5, color: "#7A6A54", flexWrap: "wrap" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}><Flame size={13} color={dish.spice > 0 ? "#9E2B1B" : "#C7BB9E"} />{SPICE_LABELS[dish.spice]}</span>
          {(dish.prep || dish.cook) && <span className="rf-mono" style={{ display: "flex", alignItems: "center", gap: 4 }}><Clock size={13} />{(dish.prep || 0) + (dish.cook || 0)}m</span>}
          {dish.serves && <span className="rf-mono" style={{ display: "flex", alignItems: "center", gap: 4 }}><Users size={13} />{dish.serves}</span>}
          <span style={{ textTransform: "capitalize" }}>{dish.category}</span>
        </div>

        <div style={{ marginTop: 16 }}>
          <DishEmblem dish={dish} accent={accent} />
        </div>

        <div style={{ marginTop: 20 }}>
          <div className="rf-display" style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>Ingredients</div>
          <div style={{ fontSize: 11, color: "#9C8D74", marginBottom: 8 }}>
            Gram amounts are approximate — based on typical ingredient density, since cup and spoon sizes vary by ingredient.
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {dish.ingredients.map((ing) => {
              const has = haveSet.has(ing.name.toLowerCase());
              const measure = [ing.quantity, ing.unit].filter(Boolean).join(" ");
              return (
                <div key={ing.name} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: 13.5, padding: "6px 10px", borderRadius: 8, background: has ? "#EAF0E3" : "transparent", border: has ? "none" : "1px solid #EFE6D0" }}>
                  <span style={{ color: has ? "#4B6B3A" : "#5A4A3A", fontWeight: has ? 600 : 400 }}>{ing.name}</span>
                  <span className="rf-mono" style={{ color: "#9C8D74", textAlign: "right" }}>
                    {measure}
                    {ing.grams != null && <span style={{ color: "#B9AB8E" }}> ({ing.grams} g)</span>}
                  </span>
                </div>
              );
            })}
          </div>
          {missing.length > 0 && (
            <div style={{ fontSize: 12, color: "#9C8D74", marginTop: 8 }}>
              You're missing {missing.length} ingredient{missing.length !== 1 ? "s" : ""} — the steps below still work, just pick these up first.
            </div>
          )}
        </div>

        {dish.nutrition && (
          <div style={{ marginTop: 18 }}>
            <div className="rf-display" style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Nutrition Facts</div>
            <div style={{ fontSize: 11, color: "#9C8D74", marginBottom: 8 }}>
              Estimated per serving — based on typical ingredients for this dish, not a lab measurement.
            </div>
            <div style={{ border: "1px solid #2A1B12", borderRadius: 4, overflow: "hidden" }}>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", borderBottom: "6px solid #2A1B12", fontWeight: 700, fontSize: 15 }}>
                <span>Calories</span>
                <span className="rf-mono">{dish.nutrition.calories}</span>
              </div>
              {[
                ["Total Fat", `${dish.nutrition.fat_g} g`, false],
                ["  Saturated Fat", `${dish.nutrition.saturated_fat_g} g`, true],
                ["  Unsaturated Fat", `${dish.nutrition.unsaturated_fat_g} g`, true],
                ["Total Carbohydrate", `${dish.nutrition.carbs_g} g`, false],
                ["  Sugars", `${dish.nutrition.sugar_g} g`, true],
                ["  Fiber", `${dish.nutrition.fiber_g} g`, true],
                ["Protein", `${dish.nutrition.protein_g} g`, false],
              ].map(([label, value, indented], i, arr) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: indented ? "5px 12px 5px 22px" : "6px 12px", fontSize: indented ? 12.5 : 13.5, fontWeight: indented ? 400 : 600, borderBottom: i < arr.length - 1 ? "1px solid #EFE6D0" : "none", color: "#2A1B12" }}>
                  <span>{label}</span>
                  <span className="rf-mono">{value}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {Object.keys(dish.substitutions).length > 0 && (
          <div style={{ marginTop: 18 }}>
            <div className="rf-display" style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>Substitutions</div>
            <div style={{ fontSize: 13, color: "#5A4A3A" }}>
              {Object.entries(dish.substitutions).map(([k, v]) => (
                <div key={k} style={{ marginBottom: 4 }}><strong>{k}:</strong> {Array.isArray(v) ? v.join(", ") : v}</div>
              ))}
            </div>
          </div>
        )}

        {dish.description && (
          <div style={{ marginTop: 18 }}>
            <div className="rf-display" style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>About this dish</div>
            <div style={{ fontSize: 13.5, color: "#3A2A1C", lineHeight: 1.5 }}>{dish.description}</div>
          </div>
        )}

        <div style={{ marginTop: 18 }}>
          <div className="rf-display" style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>Instructions</div>
          {dish.steps.length > 0 ? (
            <ol style={{ paddingLeft: 20, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
              {dish.steps.map((s, i) => (
                <li key={i} style={{ fontSize: 13.5, color: "#3A2A1C", lineHeight: 1.5 }}>{s}</li>
              ))}
            </ol>
          ) : (
            <div style={{ fontSize: 13.5, color: "#8A7A62", background: "#FBF3E3", border: "1px solid #EFE6D0", borderRadius: 10, padding: "10px 12px" }}>
              Full step-by-step instructions aren't written up for this dish yet — it's on the list. For now, use the ingredients above as a starting point.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   Main component
--------------------------------------------------------- */
export default function RecipeFinder() {
  const [ingredients, setIngredients] = useState([]);
  const [inputValue, setInputValue] = useState("");
  const [cuisineFilter, setCuisineFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [exactOnly, setExactOnly] = useState(false);
  const [apiResults, setApiResults] = useState(null);
  const [usingFallback, setUsingFallback] = useState(false);
  const [fallbackDishes, setFallbackDishes] = useState(null); // lazy-loaded, see fetch effect below
  const [isSearching, setIsSearching] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [visibleCount, setVisibleCount] = useState(RESULTS_PAGE_SIZE);
  const [favorites, setFavorites] = useState(() => {
    try {
      const raw = localStorage.getItem(FAVORITES_STORAGE_KEY);
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch {
      return new Set(); // localStorage unavailable (e.g. private browsing) — favorites just won't persist
    }
  });
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const inputRef = useRef(null);
  const listboxId = "ingredient-suggestions";

  const toggleFavorite = (dishId) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(dishId)) next.delete(dishId); else next.add(dishId);
      try { localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(Array.from(next))); } catch { /* ignore — non-fatal if storage is unavailable */ }
      return next;
    });
  };

  // Reset pagination whenever the underlying result set could change shape,
  // so "Show more" always starts back at the first page for a new search.
  useEffect(() => {
    setVisibleCount(RESULTS_PAGE_SIZE);
  }, [ingredients, cuisineFilter, categoryFilter, exactOnly, showFavoritesOnly]);


  // Every distinct ingredient across all 500 dishes, cleaned up,
  // deduplicated, and sorted at build time (see scripts/sync-dishes.js) —
  // this powers the "type an ingredient" autocomplete so people can see
  // what's actually in the database as they type, instead of typing
  // something the matcher has never heard of. This is a small dedicated
  // file so the autocomplete works instantly without pulling in the full
  // (much larger) dish dataset.
  const ALL_INGREDIENTS = INGREDIENT_NAMES;

  const suggestions = useMemo(() => {
    const q = inputValue.trim().toLowerCase();
    if (!q) return [];
    return ALL_INGREDIENTS.filter((i) => i.includes(q) && !ingredients.includes(i)).slice(0, 8);
  }, [inputValue, ingredients, ALL_INGREDIENTS]);

  const addIngredient = (raw) => {
    const val = raw.trim().toLowerCase();
    if (!val) return;
    if (!ingredients.includes(val)) setIngredients([...ingredients, val]);
    setInputValue("");
    setShowSuggestions(false);
    setHighlightedIndex(-1);
    inputRef.current?.focus();
  };
  const removeIngredient = (val) => setIngredients(ingredients.filter((i) => i !== val));

  // Debounced fetch against the real backend. Falls back to local computation
  // over a lazily-loaded offline dataset (frontend/src/dishes-fallback.js) if
  // the API can't be reached — that dataset is only fetched as a separate
  // chunk the first time it's actually needed, so the ~500-dish JSON doesn't
  // bloat the main bundle for the common case where the API is up.
  useEffect(() => {
    if (ingredients.length === 0) {
      setApiResults(null);
      setIsSearching(false);
      return;
    }
    setIsSearching(true);
    const timer = setTimeout(() => {
      fetch(`${API_BASE}/api/match`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ingredients,
          cuisine: cuisineFilter,
          category: categoryFilter,
          maxMissing: exactOnly ? 0 : 999,
        }),
      })
        .then((res) => { if (!res.ok) throw new Error("API error"); return res.json(); })
        .then((data) => {
          setApiResults(
            data.results.map((r) => ({
              dish: normalizeDish(r.dish),
              have: r.matchedIngredients,
              missing: r.missingIngredients,
              percent: r.matchPercent,
            }))
          );
          setUsingFallback(false);
        })
        .catch(() => {
          setApiResults(null);
          setUsingFallback(true);
          setFallbackDishes((prev) => {
            if (prev) return prev; // already loaded, don't re-import
            import("./dishes-fallback.js").then((mod) => setFallbackDishes(mod.DISHES));
            return prev;
          });
        })
        .finally(() => setIsSearching(false));
    }, 350);
    return () => clearTimeout(timer);
  }, [ingredients, cuisineFilter, categoryFilter, exactOnly]);

  const localResults = useMemo(() => {
    if (!fallbackDishes) return [];
    let pool = fallbackDishes.map(normalizeDish);
    if (cuisineFilter !== "all") pool = pool.filter((d) => d.cuisine === cuisineFilter);
    if (categoryFilter !== "all") pool = pool.filter((d) => d.category === categoryFilter);

    return pool
      .map((dish) => ({ dish, ...scoreDish(dish, ingredients) }))
      .filter((r) => r.have.length > 0)
      .filter((r) => !exactOnly || r.missing.length === 0)
      .sort((a, b) => b.percent - a.percent || a.missing.length - b.missing.length);
  }, [ingredients, cuisineFilter, categoryFilter, exactOnly, fallbackDishes]);

  const results = apiResults && !usingFallback ? apiResults : localResults;
  const visibleResults = showFavoritesOnly ? results.filter((r) => favorites.has(r.dish.id)) : results;
  const pagedResults = visibleResults.slice(0, visibleCount);
  const loadingFallbackData = usingFallback && !fallbackDishes;

  return (
    <div style={{ background: "#F6EFE0", minHeight: "100%", fontFamily: "'IBM Plex Sans', sans-serif", color: "#2A1B12" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
        .rf-display { font-family: 'Fraunces', serif; }
        .rf-mono { font-family: 'IBM Plex Mono', monospace; }
        .rf-chip { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 999px; font-size: 13.5px; font-weight: 500; border: 1px solid #DCCFB0; background: #FFFDF7; transition: all 0.15s ease; }
        .rf-btn { cursor: pointer; transition: all 0.15s ease; }
        .rf-btn:active { transform: scale(0.97); }
        .rf-card { transition: transform 0.18s ease, box-shadow 0.18s ease; cursor: pointer; }
        .rf-card:hover { transform: translateY(-3px); box-shadow: 0 10px 24px -8px rgba(42,27,18,0.18); }
        input:focus { outline: none; }
        .rf-focus:focus-visible { outline: 2px solid #9E2B1B; outline-offset: 2px; }
        @keyframes rf-spin { to { transform: rotate(360deg); } }
        .rf-steam { animation: rf-steam-drift 3.2s ease-in-out infinite; }
        @keyframes rf-steam-drift {
          0% { transform: translateY(0) scaleY(0.9); opacity: 0; }
          30% { opacity: 0.7; }
          100% { transform: translateY(-38px) scaleY(1.2); opacity: 0; }
        }
      `}</style>

      <div style={{ borderBottom: "1px solid #E7DAB8", padding: "40px 24px 32px" }}>
        <div style={{ maxWidth: 880, margin: "0 auto", display: "flex", alignItems: "center", gap: 24, flexWrap: "wrap" }}>
          <HeroSpiral />
          <div style={{ flex: 1, minWidth: 240 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <ChefHat size={18} color="#9E2B1B" />
              <span className="rf-mono" style={{ fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase", color: "#9E2B1B", fontWeight: 600 }}>
                Habesha &amp; World Kitchen
              </span>
            </div>
            <h1 className="rf-display" style={{ fontSize: "clamp(28px, 4vw, 40px)", fontWeight: 600, lineHeight: 1.1, margin: 0 }}>
              What's in your kitchen?
            </h1>
            <p style={{ marginTop: 8, color: "#5A4A3A", fontSize: 15.5, maxWidth: 520 }}>
              Add what you have on hand — we'll match it against all 500 dishes, from doro wat to pad thai. Tap any dish to see the full recipe, even if you're missing a few things.
            </p>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 880, margin: "0 auto", padding: "28px 24px 64px" }}>
        <div style={{ background: "#FFFDF7", border: "1px solid #E7DAB8", borderRadius: 16, padding: 20 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ position: "relative", flex: 1 }}>
              <Search size={16} color="#9C8D74" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }} />
              <input
                ref={inputRef}
                value={inputValue}
                onChange={(e) => { setInputValue(e.target.value); setShowSuggestions(true); setHighlightedIndex(-1); }}
                onFocus={() => setShowSuggestions(true)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 120)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (showSuggestions && highlightedIndex >= 0 && suggestions[highlightedIndex]) {
                      addIngredient(suggestions[highlightedIndex]);
                    } else {
                      addIngredient(inputValue);
                    }
                  } else if (e.key === "ArrowDown" && suggestions.length > 0) {
                    e.preventDefault();
                    setShowSuggestions(true);
                    setHighlightedIndex((i) => (i + 1) % suggestions.length);
                  } else if (e.key === "ArrowUp" && suggestions.length > 0) {
                    e.preventDefault();
                    setHighlightedIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
                  } else if (e.key === "Escape") {
                    setShowSuggestions(false);
                  }
                }}
                placeholder="Type an ingredient, e.g. shiro powder"
                aria-label="Type an ingredient"
                className="rf-focus"
                autoComplete="off"
                role="combobox"
                aria-expanded={showSuggestions && suggestions.length > 0}
                aria-controls={listboxId}
                aria-autocomplete="list"
                aria-activedescendant={highlightedIndex >= 0 ? `${listboxId}-option-${highlightedIndex}` : undefined}
                style={{ width: "100%", padding: "10px 12px 10px 36px", borderRadius: 10, border: "1px solid #DCCFB0", fontSize: 14.5, background: "#FBF7EE", boxSizing: "border-box" }}
              />
              {showSuggestions && suggestions.length > 0 && (
                <div
                  id={listboxId}
                  role="listbox"
                  style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, background: "#FFFDF7", border: "1px solid #E7DAB8", borderRadius: 10, boxShadow: "0 10px 24px -8px rgba(42,27,18,0.22)", zIndex: 20, maxHeight: 220, overflowY: "auto" }}
                >
                  {suggestions.map((s, idx) => (
                    <div
                      key={s}
                      id={`${listboxId}-option-${idx}`}
                      role="option"
                      aria-selected={idx === highlightedIndex}
                      onMouseDown={(e) => { e.preventDefault(); addIngredient(s); }}
                      onMouseEnter={() => setHighlightedIndex(idx)}
                      style={{
                        padding: "9px 14px",
                        fontSize: 14,
                        cursor: "pointer",
                        color: "#2A1B12",
                        background: idx === highlightedIndex ? "#F3E6CB" : "transparent",
                        borderBottom: idx < suggestions.length - 1 ? "1px solid #F1E8D4" : "none",
                      }}
                    >
                      {s}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <button onClick={() => addIngredient(inputValue)} className="rf-btn rf-focus" style={{ background: "#9E2B1B", color: "#FFF9EF", border: "none", borderRadius: 10, padding: "0 16px", display: "flex", alignItems: "center", gap: 6, fontWeight: 600, fontSize: 14 }}>
              <Plus size={16} /> Add
            </button>
          </div>

          <div style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap" }}>
            {QUICK_ADD.filter((q) => !ingredients.includes(q)).map((q) => (
              <button key={q} onClick={() => addIngredient(q)} className="rf-btn rf-focus" style={{ background: "transparent", border: "1px dashed #DCCFB0", borderRadius: 999, padding: "5px 11px", fontSize: 13, color: "#7A6A54", cursor: "pointer" }}>
                + {q}
              </button>
            ))}
          </div>

          {ingredients.length > 0 && (
            <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid #EFE6D0", display: "flex", flexWrap: "wrap", gap: 8 }}>
              {ingredients.map((ing) => (
                <span key={ing} className="rf-chip" style={{ borderColor: "#E9C9A8", background: "#FBF0E1" }}>
                  {ing}
                  <X size={13} className="rf-btn" style={{ cursor: "pointer" }} onClick={() => removeIngredient(ing)} />
                </span>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 20, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#7A6A54", fontSize: 13, fontWeight: 600 }}>
            <SlidersHorizontal size={14} /> Filter
          </div>
          {[
            { key: "cuisine", value: cuisineFilter, set: setCuisineFilter, opts: [["all", "All cuisines"], ["habesha", "Habesha"], ["international", "International"]] },
            { key: "category", value: categoryFilter, set: setCategoryFilter, opts: [["all", "Any"], ["fasting", "Fasting"], ["non-fasting", "Non-fasting"]] },
          ].map((group) => (
            <div key={group.key} style={{ display: "flex", gap: 6, background: "#FFFDF7", border: "1px solid #E7DAB8", borderRadius: 999, padding: 3 }}>
              {group.opts.map(([val, label]) => (
                <button key={val} onClick={() => group.set(val)} className="rf-btn" style={{ border: "none", borderRadius: 999, padding: "6px 12px", fontSize: 13, fontWeight: 500, cursor: "pointer", background: group.value === val ? "#2A1B12" : "transparent", color: group.value === val ? "#FBF0E1" : "#5A4A3A" }}>
                  {label}
                </button>
              ))}
            </div>
          ))}
          <button onClick={() => setExactOnly(!exactOnly)} className="rf-btn" style={{ display: "flex", alignItems: "center", gap: 6, border: "1px solid #E7DAB8", borderRadius: 999, padding: "6px 12px", fontSize: 13, fontWeight: 500, cursor: "pointer", background: exactOnly ? "#4B6B3A" : "#FFFDF7", color: exactOnly ? "#F6EFE0" : "#5A4A3A" }}>
            <Leaf size={13} /> Ready to cook now
          </button>
          {usingFallback && (
            <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "#9C8D74", marginLeft: "auto" }}>
              <WifiOff size={13} /> API unreachable — showing sample data
            </span>
          )}
          {!usingFallback && isSearching && (
            <span
              role="status"
              aria-live="polite"
              style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#9C8D74", marginLeft: "auto" }}
            >
              <Spinner /> Searching…
            </span>
          )}
        </div>

        <div style={{ marginTop: 24 }}>
          {ingredients.length === 0 ? (
            <EmptyState text="Add a few ingredients above to see what you can cook." />
          ) : loadingFallbackData ? (
            <EmptyState text="Loading offline recipe data…" icon={<Spinner size={28} />} />
          ) : visibleResults.length === 0 ? (
            <EmptyState
              text={
                showFavoritesOnly
                  ? "None of your favorites match these ingredients yet."
                  : "No dishes match yet — try adding more ingredients or loosening a filter."
              }
            />
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                <div style={{ fontSize: 13, color: "#7A6A54" }}>
                  {visibleResults.length} dish{visibleResults.length !== 1 ? "es" : ""} found — tap any card for the full recipe
                </div>
                {favorites.size > 0 && (
                  <button
                    onClick={() => setShowFavoritesOnly((v) => !v)}
                    className="rf-btn rf-focus"
                    style={{ display: "flex", alignItems: "center", gap: 5, border: "1px solid #E7DAB8", borderRadius: 999, padding: "5px 11px", fontSize: 12.5, fontWeight: 500, cursor: "pointer", background: showFavoritesOnly ? "#9E2B1B" : "#FFFDF7", color: showFavoritesOnly ? "#FFF9EF" : "#5A4A3A" }}
                  >
                    ★ {showFavoritesOnly ? "Showing favorites" : `Favorites only (${favorites.size})`}
                  </button>
                )}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14 }}>
                {pagedResults.map((entry) => (
                  <DishCard
                    key={entry.dish.id}
                    entry={entry}
                    onClick={() => setSelectedEntry(entry)}
                    isFavorite={favorites.has(entry.dish.id)}
                    onToggleFavorite={() => toggleFavorite(entry.dish.id)}
                  />
                ))}
              </div>
              {visibleCount < visibleResults.length && (
                <div style={{ textAlign: "center", marginTop: 18 }}>
                  <button
                    onClick={() => setVisibleCount((c) => c + RESULTS_PAGE_SIZE)}
                    className="rf-btn rf-focus"
                    style={{ border: "1px solid #DCCFB0", background: "#FFFDF7", borderRadius: 999, padding: "8px 20px", fontSize: 13.5, fontWeight: 600, color: "#5A4A3A", cursor: "pointer" }}
                  >
                    Show more ({visibleResults.length - visibleCount} left)
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {selectedEntry && (
        <DishModal
          entry={selectedEntry}
          onClose={() => setSelectedEntry(null)}
          isFavorite={favorites.has(selectedEntry.dish.id)}
          onToggleFavorite={() => toggleFavorite(selectedEntry.dish.id)}
        />
      )}
    </div>
  );
}

function EmptyState({ text, icon }) {
  return (
    <div style={{ textAlign: "center", padding: "56px 20px", border: "1px dashed #DCCFB0", borderRadius: 16, color: "#7A6A54" }}>
      <div style={{ marginBottom: 10, display: "flex", justifyContent: "center" }}>
        {icon || <ChefHat size={28} color="#C98A2C" />}
      </div>
      <div style={{ fontSize: 14.5 }}>{text}</div>
    </div>
  );
}

// Small inline loading spinner, used both next to the search box while a
// debounced fetch is in flight and as the icon for the "loading offline
// data" empty state.
function Spinner({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ animation: "rf-spin 0.8s linear infinite" }}>
      <circle cx="12" cy="12" r="9" fill="none" stroke="#DCCFB0" strokeWidth="3" />
      <path d="M12 3a9 9 0 0 1 9 9" fill="none" stroke="#9E2B1B" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function DishCard({ entry, onClick, isFavorite, onToggleFavorite }) {
  const { dish, have, missing, percent } = entry;
  const accent = dish.cuisine === "habesha" ? "#9E2B1B" : "#C98A2C";
  return (
    <div className="rf-card" onClick={onClick} style={{ position: "relative", background: "#FFFDF7", border: "1px solid #E7DAB8", borderRadius: 14, padding: 16 }}>
      <button
        onClick={(e) => { e.stopPropagation(); onToggleFavorite(); }}
        aria-label={isFavorite ? `Remove ${dish.name} from favorites` : `Add ${dish.name} to favorites`}
        aria-pressed={isFavorite}
        className="rf-btn rf-focus"
        style={{ position: "absolute", top: 10, right: 10, border: "none", background: "transparent", cursor: "pointer", fontSize: 18, lineHeight: 1, color: isFavorite ? "#C98A2C" : "#DCCFB0" }}
      >
        {isFavorite ? "★" : "☆"}
      </button>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <MatchRing percent={percent} accent={accent} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="rf-display" style={{ fontSize: 17, fontWeight: 600, lineHeight: 1.2 }}>{dish.name}</div>
          <div style={{ fontSize: 12.5, color: "#8A7A62", marginTop: 2 }}>{dish.subtitle}</div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 12, fontSize: 12, color: "#7A6A54", flexWrap: "wrap" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <Flame size={12} color={dish.spice > 0 ? "#9E2B1B" : "#C7BB9E"} />
          {SPICE_LABELS[dish.spice]}
        </span>
        {(dish.prep || dish.cook) && (
          <span style={{ display: "flex", alignItems: "center", gap: 4 }} className="rf-mono">
            <Clock size={12} /> {(dish.prep || 0) + (dish.cook || 0)}m
          </span>
        )}
        {dish.serves && (
          <span style={{ display: "flex", alignItems: "center", gap: 4 }} className="rf-mono">
            <Users size={12} /> {dish.serves}
          </span>
        )}
      </div>

      <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 5 }}>
        {have.slice(0, 4).map((i) => (
          <span key={i} style={{ fontSize: 11, background: "#EAF0E3", color: "#4B6B3A", padding: "3px 8px", borderRadius: 999, fontWeight: 500 }}>{i}</span>
        ))}
        {missing.slice(0, 3).map((i) => (
          <span key={i} style={{ fontSize: 11, background: "transparent", border: "1px solid #E7DAB8", color: "#9C8D74", padding: "2px 7px", borderRadius: 999 }}>{i}</span>
        ))}
        {missing.length > 3 && (
          <span style={{ fontSize: 11, color: "#9C8D74", padding: "3px 4px" }}>+{missing.length - 3} more</span>
        )}
      </div>
    </div>
  );
}
