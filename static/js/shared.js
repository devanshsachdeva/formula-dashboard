/* ============================================================================
   shared.js — code used by EVERY page (Guidelines, UK, Ireland)
   ----------------------------------------------------------------------------
   What lives here and why:
   1. COLOURS        — one colour per brand/manufacturer/category/product so
                       every chart on every page paints the same thing the
                       same colour (Nutricia purples, MJN blues+orange,
                       Nestlé greys, Abbott green).
   2. GLOBAL STATE   — DATA (the JSON payload from the Flask server), SEL
                       (one Set per slicer holding what the user ticked),
                       charts (a registry of live Chart.js objects).
   3. SLICER ENGINE  — the multi-select dropdown component ("msel"): builds
                       the checkbox panels, keeps the button label in sync,
                       handles Select all / Clear / the × button.
   4. LOOKUP MAPS    — quick indexes built once per data load (ICB→region,
                       HDM→ICBs, product→brand).
   5. DATA LOADING   — fetches /api/data and triggers a refresh.
   6. FORMAT HELPERS — number formatting (1.5M / 743.3k), month labels,
                       colour lookup, growth arrows.
   Load order matters: this file must be the FIRST <script> because the
   other files use everything defined here.
   ========================================================================== */
"use strict";

Chart.register(ChartDataLabels);

/* ---------------------------------------------------------------------------
   AUTO-READABLE DATA LABELS (applies to EVERY chart, no per-chart wiring)
   ---------------------------------------------------------------------------
   Combo charts draw a LINE (e.g. the orange/near-black "growth %" line) on top
   of grouped BARS. The line's point labels can land right on a bar or another
   label and become unreadable. Rather than hand-tuning each chart, we detect
   this situation generically: any data label that belongs to a LINE dataset in
   a chart that ALSO contains bars is "riding over the bars", so it gets a
   theme-aware rounded pill behind it — lifting it clear of whatever is
   underneath. Plain bar labels and pure line-chart labels are left untouched
   (no background, no extra padding), so nothing else changes visually.
   These options are all "scriptable" (functions the datalabels plugin calls per
   label at draw time), so they re-evaluate on theme changes and data reloads. */
function labelRidesOverBars(ctx) {
  const ds = ctx && ctx.dataset;
  if (!ds || ds.type !== "line") return false;
  const baseType = ctx.chart && ctx.chart.config && ctx.chart.config.type;
  return (ctx.chart && ctx.chart.data ? ctx.chart.data.datasets : []).some(
    (d) => (d.type || baseType) === "bar"
  );
}

Chart.defaults.set("plugins.datalabels", {
  display: false,
  backgroundColor: (ctx) =>
    labelRidesOverBars(ctx)
      ? (isDark() ? "rgba(9, 9, 11, 0.82)" : "rgba(255, 255, 255, 0.92)")
      : null,
  borderColor: (ctx) =>
    labelRidesOverBars(ctx)
      ? (isDark() ? "rgba(255, 255, 255, 0.16)" : "rgba(24, 24, 27, 0.12)")
      : null,
  borderWidth: (ctx) => (labelRidesOverBars(ctx) ? 1 : 0),
  borderRadius: (ctx) => (labelRidesOverBars(ctx) ? 5 : 0),
  padding: (ctx) =>
    labelRidesOverBars(ctx) ? { top: 2, bottom: 2, left: 5, right: 5 } : 0,
});

/* Global Chart.js theming so every chart on every page shares one polished
   look. These are DEFAULTS only — anything a chart sets explicitly (data
   labels, legend boxes, axis formatters, colours) still wins, so no existing
   label/tooltip formatting changes. */
Chart.defaults.font.family =
  "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
Chart.defaults.font.size = 11;
Chart.defaults.color = "#71717a";                         // zinc-500 axis/legend text
Chart.defaults.borderColor = "rgba(228, 228, 231, 0.8)";  // zinc-200 gridlines
Chart.defaults.set("plugins.tooltip", {
  backgroundColor: "rgba(15, 23, 42, 0.94)",             // dark slate card
  titleFont: { weight: "700", size: 12 },
  bodyFont: { size: 11.5 },
  padding: 10,
  cornerRadius: 8,
  boxPadding: 4,
  caretSize: 5,
});
Chart.defaults.set("plugins.legend.labels", { padding: 14 });
/* shadcn/Tremor chart language: no axis border lines, no tick marks — just
   floating labels over faint horizontal gridlines; gently rounded bars */
Chart.defaults.scale.border = Chart.defaults.scale.border || {};
Chart.defaults.scale.border.display = false;   // no axis spine
Chart.defaults.scale.grid.drawTicks = false;   // no tick nubs
Chart.defaults.scale.ticks.padding = 6;        // labels float clear of the plot
Chart.defaults.elements.bar.borderRadius = 6;  // soft default for any new bars
Chart.defaults.elements.point.hoverRadius = 4;
/* smooth, Apple-ish chart animation: a soft ease-out over ~600ms */
Chart.defaults.animation.duration = 620;
Chart.defaults.animation.easing = "easeOutQuart";
Chart.defaults.animations.colors = { duration: 300 };
Chart.defaults.transitions.active.animation.duration = 200; // snappy hover

/* ---------------------------------------------------------------------------
   DARK MODE
   The whole palette is CSS variables (see :root / :root[data-theme="dark"]),
   so switching theme is just setting an attribute on <html>. Charts draw on a
   <canvas> and can't read CSS variables, so we mirror the key colours here.
--------------------------------------------------------------------------- */
function isDark() {
  return document.documentElement.getAttribute("data-theme") === "dark";
}
// theme-aware ink colours for on-canvas labels/lines (called at render time)
function themeInk() { return isDark() ? "#e4e4e7" : "#1a2333"; }       // strong label
function themeInkSoft() { return isDark() ? "#a1a1aa" : "#475569"; }   // secondary label
function themeContrast() { return isDark() ? "#f4f4f5" : "#111827"; }  // high-contrast line

// push the current theme's neutrals into Chart.js defaults (axis text/gridlines)
function applyChartTheme() {
  Chart.defaults.color = isDark() ? "#a1a1aa" : "#71717a";
  Chart.defaults.borderColor = isDark() ? "rgba(255, 255, 255, 0.08)" : "rgba(228, 228, 231, 0.8)";
}

// read the saved choice (or the OS preference) and apply it
function initTheme() {
  const saved = localStorage.getItem("dashboard-theme");
  const dark = saved ? saved === "dark"
    : window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  applyChartTheme();
  syncThemeToggle();
}

function syncThemeToggle() {
  const btn = document.getElementById("theme-toggle");
  if (btn) btn.textContent = isDark() ? "☀️" : "🌙";
}

// flip the theme, persist it, re-theme + redraw whatever page is showing
function toggleTheme() {
  const dark = !isDark();
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  localStorage.setItem("dashboard-theme", dark ? "dark" : "light");
  applyChartTheme();
  syncThemeToggle();
  if (typeof showPage === "function") showPage(); // redraws the active page's charts
}

// Manufacturer colour families (single scheme reused by EVERY chart, table and
// KPI card so the whole report reads the same):
//   Nutricia -> purples · Nestlé -> pinks · MJN -> dark blues + cyan ·
//   Abbott -> green · Other -> slate.
// NOTE: the MJN blues/cyan are placeholders — swap in the exact brand hex codes
// here (and in PRODUCT_COLORS below) once provided; nothing else needs editing.
const BRAND_COLORS = {
  NEOCATE: "#7c3aed",    // Nutricia — violet
  PEPTI: "#9333ea",      // Nutricia — purple
  NUTRAMIGEN: "#1d4ed8", // MJN — dark blue
  PURAMINO: "#06b6d4",   // MJN — cyan
  ALTHERA: "#be185d",    // Nestlé — deep pink
  ALFAMINO: "#ec4899",   // Nestlé — pink
  ARIZE: "#16a34a",      // Abbott — green
  OTHER: "#64748b",      // slate
};
const MFR_COLORS = {
  NUTRICIA: "#7c3aed",   // purple
  NESTLE: "#db2777",     // pink
  MJN: "#1d4ed8",        // dark blue
  ABBOTT: "#16a34a",     // green
  OTHER: "#64748b",      // slate
};
const CAT_COLORS = { EHF: "#2563eb", AAF: "#f97316", RICE: "#a855f7" };
const FALLBACK = ["#64748b", "#f59e0b", "#10b981", "#8b5cf6", "#ec4899", "#14b8a6"];
// growth is ALWAYS orange across the report (line colour + label ink)
const GROWTH_COLOR = "#f97316";
function growthLabelColor() { return isDark() ? "#fb923c" : "#c2410c"; }
// client-line products: shades within each manufacturer's colour family
const PRODUCT_COLORS = {
  // Nutricia — Neocate violets (dark -> light)
  "NEOCATE LCP": "#4c1d95",
  "NEOCATE SYNEO": "#6d28d9",
  "NEOCATE JUNIOR": "#7c3aed",
  "NEOCATE SPOON": "#8b5cf6",
  "NEOCATE ADVANCE": "#a78bfa",
  // Nutricia — Pepti purples (dark -> light)
  "PEPTI 1": "#7e22ce",
  "PEPTI 2": "#9333ea",
  "PEPTI SYNEO": "#a855f7",
  "PEPTI JUNIOR": "#c084fc",
  // MJN — Nutramigen dark blues + Puramino cyan (placeholder hexes)
  "NUTRAMIGEN 1-MJN": "#1e3a8a",
  "NUTRAMIGEN 2-MJN": "#2563eb",
  "NUTRAMIGEN 3-MJN": "#60a5fa",
  "PURAMINO": "#06b6d4",
  // Nestlé pinks
  "ALTHERA": "#be185d",
  "ALFAMINO": "#ec4899",
  // Abbott green
  "SIMILAC ARIZE": "#16a34a",
  // Other — slate
  "PREGESTIMIL": "#64748b",
  "ELECARE": "#94a3b8",
};
const FAR_FUTURE = "2049-01-01"; // 2050-01-01 entries are "no date" placeholders

let RAW = null;             // the full, unscoped payload from /api/data
let DATA = null;            // the RLS-scoped view every page reads from
let RAW_HDM_ICBS = new Map(); // hdm -> Set(icb), from the FULL data (for the login list)
let RLS_HDM = null;         // the HDM the dashboard is locked to (null = full/admin)
let trendDim = "brand";     // brand | manufacturer | category
let trendValue = "actual";  // actual | ms — monthly trend switch
let explorerMode = "actual"; // actual | ms — interval explorer switch
let glSort = { key: "ICB", dir: 1 };
const charts = {};

// Multi-select filter state: one Set per slicer holding exactly the values
// the user has ticked. An EMPTY Set means "no filter" (= show everything).
// The Guidelines page and the UK page each have their own keys, so filtering
// one page never affects the other.
const SEL = {
  // Guidelines page slicers
  region: new Set(),
  icb: new Set(),
  ccg: new Set(),    // sub-ICB prescribing unit (the performance PCO)
  manufacturer: new Set(),
  brand: new Set(),
  hdm: new Set(),
  category: new Set(), // shared with the clickable EHF/AAF/RICE cards
  // UK Performance page slicers (independent copies)
  ukCategory: new Set(),
  ukRegion: new Set(),
  ukicb: new Set(),
  ukccg: new Set(),
  ukhdm: new Set(),
  ukmanufacturer: new Set(),
  ukbrand: new Set(),
};

const $ = (id) => document.getElementById(id);
const singles = {
  metric: () => $("f-metric").value,
  period: () => $("f-period").value,
};

/** The drill-down ICB — only defined when exactly one ICB is selected. */
function singleICB() {
  return SEL.icb.size === 1 ? [...SEL.icb][0] : "";
}

function catLabel() {
  return SEL.category.size ? [...SEL.category].sort().join(" + ") : "all categories";
}

/** Category the interval visuals follow: the (first) selected card, else EHF. */
function explorerCategory() {
  for (const c of ["EHF", "AAF", "RICE"]) if (SEL.category.has(c)) return c;
  return "EHF";
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ---------- lookup maps ----------

let ICB_REGION = new Map();   // icb -> region
let CCG_ICB = new Map();      // ccg -> icb (each CCG belongs to one ICB)
let HDM_ICBS = new Map();     // hdm -> Set(icb)
let PRODUCT_BRAND = new Map(); // client-line product -> brand

function buildMaps() {
  ICB_REGION = new Map();
  CCG_ICB = new Map();
  PRODUCT_BRAND = new Map();
  for (const r of DATA.performance) {
    if (!ICB_REGION.has(r.icb)) ICB_REGION.set(r.icb, r.region);
    if (!CCG_ICB.has(r.ccg)) CCG_ICB.set(r.ccg, r.icb);
    if (!PRODUCT_BRAND.has(r.product)) PRODUCT_BRAND.set(r.product, r.brand);
  }
  HDM_ICBS = new Map();
  for (const g of DATA.gl_detail) {
    const h = (g.HDM || "").trim();
    if (!h) continue;
    if (!HDM_ICBS.has(h)) HDM_ICBS.set(h, new Set());
    HDM_ICBS.get(h).add(g.ICB);
  }
}

/** Union of ICBs covered by the selected HDMs (null = no HDM filter). */
function hdmICBUnion() {
  if (!SEL.hdm.size) return null;
  const u = new Set();
  for (const h of SEL.hdm) for (const i of HDM_ICBS.get(h) || []) u.add(i);
  return u;
}

/** ICBs allowed by the region + HDM filters (ignores the ICB filter itself). */
function icbListForDropdown() {
  let list = DATA.meta.icbs;
  if (SEL.region.size) list = list.filter((i) => SEL.region.has(ICB_REGION.get(i)));
  const hu = hdmICBUnion();
  if (hu) list = list.filter((i) => hu.has(i));
  return list;
}

// ---------- multi-select dropdown component ----------

const MSEL_DEFS = [
  { key: "category", placeholder: "All categories" },
  { key: "region", placeholder: "All regions" },
  { key: "icb", placeholder: "All ICBs" },
  { key: "ccg", placeholder: "All CCGs" },
  { key: "manufacturer", placeholder: "All manufacturers" },
  { key: "brand", placeholder: "All brands" },
  { key: "hdm", placeholder: "All HDMs" },
  { key: "ukCategory", placeholder: "All categories" },
  { key: "ukRegion", placeholder: "All regions" },
  { key: "ukicb", placeholder: "All ICBs" },
  { key: "ukccg", placeholder: "All CCGs" },
  { key: "ukmanufacturer", placeholder: "All manufacturers" },
  { key: "ukbrand", placeholder: "All brands" },
  { key: "ukhdm", placeholder: "All HDMs" },
];

const mselEl = (key) => $("ms-" + key);

function setMselOptions(key, options) {
  const el = mselEl(key);
  el._optionList = options;
  // prune selections that are no longer available
  for (const v of [...SEL[key]]) if (!options.includes(v)) SEL[key].delete(v);
  const panel = el.querySelector(".msel-panel");
  panel.innerHTML =
    `<div class="msel-actions">
       <button type="button" class="msel-all">Select all</button>
       <button type="button" class="msel-none">Clear</button>
     </div>` +
    options
      .map(
        (o) => `<label class="msel-opt"><input type="checkbox" value="${esc(o)}"${
          SEL[key].has(o) ? " checked" : ""
        }><span>${esc(o)}</span></label>`
      )
      .join("");
  panel.querySelectorAll("input").forEach((cb) =>
    cb.addEventListener("change", () => {
      if (cb.checked) SEL[key].add(cb.value);
      else SEL[key].delete(cb.value);
      updateMselUI(key);
      onFilterChange(key);
    })
  );
  panel.querySelector(".msel-all").addEventListener("click", (e) => {
    e.stopPropagation();
    SEL[key] = new Set(el._optionList);
    updateMselUI(key);
    onFilterChange(key);
  });
  panel.querySelector(".msel-none").addEventListener("click", (e) => {
    e.stopPropagation();
    SEL[key].clear();
    updateMselUI(key);
    onFilterChange(key);
  });
  updateMselUI(key);
}

function updateMselUI(key) {
  const el = mselEl(key);
  const def = MSEL_DEFS.find((d) => d.key === key);
  const n = SEL[key].size;
  el.querySelector(".msel-btn").textContent =
    n === 0 ? def.placeholder : n === 1 ? [...SEL[key]][0] : n + " selected";
  el.querySelector(".msel-btn").classList.toggle("active", n > 0);
  // always visible; disabled (grey) when there is nothing to clear
  const clear = el.querySelector(".msel-clear");
  clear.hidden = false;
  clear.disabled = n === 0;
  el.querySelectorAll(".msel-panel input").forEach((cb) => (cb.checked = SEL[key].has(cb.value)));
}

function closeAllMsels() {
  document.querySelectorAll(".msel-panel").forEach((p) => (p.hidden = true));
}

function initMsels() {
  for (const def of MSEL_DEFS) {
    const el = mselEl(def.key);
    el.querySelector(".msel-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      const panel = el.querySelector(".msel-panel");
      const wasOpen = !panel.hidden;
      closeAllMsels();
      panel.hidden = wasOpen;
    });
    el.querySelector(".msel-clear").addEventListener("click", (e) => {
      e.stopPropagation();
      SEL[def.key].clear();
      updateMselUI(def.key);
      onFilterChange(def.key);
    });
  }
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".msel")) closeAllMsels();
  });
}

// Called every time ANY slicer changes. Routes the change to the page that
// owns the slicer: UK keys all start with "uk"; everything else belongs to
// the Guidelines page. Each page's render function handles its own
// cross-filtering and localStorage saving.
function onFilterChange(key) {
  if (key.startsWith("uk")) {
    renderUK();
    return;
  }
  render();
}

// ---------- data loading ----------

async function loadData() {
  const res = await fetch("/api/data");
  if (!res.ok) throw new Error("Failed to load /api/data: " + res.status);
  RAW = await res.json();
  // HDM -> ICBs from the FULL data (drives the login list; survives scoping)
  RAW_HDM_ICBS = new Map();
  for (const g of RAW.gl_detail) {
    const h = (g.HDM || "").trim();
    if (!h) continue;
    if (!RAW_HDM_ICBS.has(h)) RAW_HDM_ICBS.set(h, new Set());
    RAW_HDM_ICBS.get(h).add(g.ICB);
  }
  applyRLS(RLS_HDM); // (re)apply the current scope -> sets DATA + rebuilds maps
  $("generated-at").textContent = "Data built " + RAW.generated_at.replace("T", " ");
}

// ---------- Row-Level Security (HDM "view as") ----------
// Soft RLS: the dashboard is locked to one HDM's ICBs by FILTERING THE DATA
// itself, so every chart, table, KPI and slicer is scoped automatically and a
// user can't widen past their territory. RLS_HDM = null means full/admin.

/** All HDM names from the full data, for the login screen. */
function allHdms() {
  return [...RAW_HDM_ICBS.keys()].sort();
}

/** Build a payload containing only rows for the given set of ICBs, with meta
 *  recomputed so slicers only ever offer in-scope values. */
function scopeData(raw, allowed) {
  const perf = raw.performance.filter((r) => allowed.has(r.icb));
  const uniq = (arr) => [...new Set(arr)].sort();
  return {
    ...raw,
    performance: perf,
    guidelines: raw.guidelines.filter((g) => allowed.has(g.ICB)),
    gl_detail: raw.gl_detail.filter((g) => allowed.has(g.ICB)),
    gl_history: Object.fromEntries(
      Object.entries(raw.gl_history || {}).filter(([icb]) => allowed.has(icb))
    ),
    gl_events: (raw.gl_events || []).filter((e) => allowed.has(e.icb)),
    meta: {
      months: raw.meta.months, // keep the full timeline so trends aren't truncated
      regions: uniq(perf.map((r) => r.region)),
      icbs: uniq(perf.map((r) => r.icb)),
      ccgs: uniq(perf.map((r) => r.ccg)),
      categories: uniq(perf.map((r) => r.category)),
      brands: uniq(perf.map((r) => r.brand)),
      products: uniq(perf.map((r) => r.product)),
      manufacturers: uniq(perf.map((r) => r.manufacturer)),
    },
  };
}

/** Lock (or unlock) the dashboard to an HDM. Rebuilds the scoped DATA + maps. */
function applyRLS(hdm) {
  RLS_HDM = hdm && RAW_HDM_ICBS.has(hdm) ? hdm : null;
  DATA = RLS_HDM ? scopeData(RAW, RAW_HDM_ICBS.get(RLS_HDM)) : RAW;
  document.documentElement.setAttribute("data-rls", RLS_HDM ? "scoped" : "all");
  buildMaps();
  _lastSelSig = null;   // force guideline slicer option lists to rebuild
  _ukLastSig = null;    // force UK slicer option lists to rebuild
}

// The header "Refresh data" button — available on EVERY page. Forces the
// server to re-read the Excel workbooks, downloads the fresh JSON, then
// redraws whichever page is currently on screen (showPage in main.js knows
// which one that is). The button doubles as the visual: it greys out and
// reads "Refreshing…" while the work happens, and the "Data built …"
// timestamp next to it updates when done.
async function refreshData() {
  const btn = $("refresh-btn");
  btn.disabled = true;
  btn.textContent = "Refreshing…";
  try {
    await fetch("/api/refresh", { method: "POST" }); // server re-reads Excel
    await loadData();                                // browser gets fresh JSON
    showPage();                                      // redraw the current page
  } catch (e) {
    alert("Refresh failed: " + e.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = "&#8635; Refresh data";
  }
}

function sumBy(rows, keyFn, metric) {
  const out = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    out.set(k, (out.get(k) || 0) + r[metric]);
  }
  return out;
}

// ---------- formatting ----------

function fmtNum(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
  return n.toFixed(0);
}
function metricSuffix() {
  const m = singles.metric();
  return m === "factored_units" ? " KGs" : m === "units" ? " units" : "";
}
function fmtMetric(n) {
  return (singles.metric() === "value" ? "£" : "") + fmtNum(n) + (singles.metric() === "value" ? "" : metricSuffix());
}
function monthLabel(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
}
function quarterKey(iso) {
  return iso.slice(0, 4) + "-Q" + (Math.floor((Number(iso.slice(5, 7)) - 1) / 3) + 1);
}
function colorFor(key, mode, i) {
  if (mode === "product") return PRODUCT_COLORS[key] || FALLBACK[i % FALLBACK.length];
  const table = mode === "manufacturer" ? MFR_COLORS : mode === "category" ? CAT_COLORS : BRAND_COLORS;
  return table[key] || FALLBACK[i % FALLBACK.length];
}

/* Paint a KPI card's "top colour shade" from the report's colour scheme, so
   the accent automatically follows whatever brand/manufacturer the card is
   about (e.g. an EHF card led by Nutramigen goes MJN-blue; a Nutricia-led
   card goes purple). One place = every KPI card stays consistent. Pass the
   already-resolved brand/manufacturer colour (via colorFor). */
function applyKpiAccent(el, color) {
  if (!el || !color) return;
  el.style.borderTopColor = color;
  el.style.setProperty("--kpi", color);
  el.style.background = `linear-gradient(180deg, ${withAlpha(color, 0.09)}, var(--card) 60%)`;
}
function growthHTML(cur, prev, vsLabel) {
  if (!prev) return `<span class="growth flat">no comparison</span>`;
  const pct = ((cur - prev) / prev) * 100;
  const cls = pct > 0.5 ? "up" : pct < -0.5 ? "down" : "flat";
  const arrow = pct > 0.5 ? "▲" : pct < -0.5 ? "▼" : "▬";
  return `<span class="growth ${cls}">${arrow} ${pct >= 0 ? "+" : ""}${pct.toFixed(1)}% vs ${vsLabel}</span>`;
}

// visible ICBs under region/HDM/ICB/CCG filters (for guideline sections).
// A CCG selection scopes to the parent ICBs, since guidelines are ICB-level.
function visibleICBs() {
  let base = SEL.icb.size ? new Set(SEL.icb) : new Set(icbListForDropdown());
  if (SEL.ccg.size) {
    const fromCcg = new Set([...SEL.ccg].map((c) => CCG_ICB.get(c)).filter(Boolean));
    base = new Set([...base].filter((i) => fromCcg.has(i)));
  }
  return base;
}
