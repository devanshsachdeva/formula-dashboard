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
// Aggregate KPI cards (Volume / Value) use fixed accents OUTSIDE the brand
// palette, so they never look like they belong to a brand/manufacturer.
const KPI_VOLUME_COLOR = "#0d9488"; // teal
const KPI_VALUE_COLOR = "#4d7c0f";  // olive
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
  // Ireland page slicers (no HDM — Ireland has a single owner)
  ieCategory: new Set(),
  ieManufacturer: new Set(),
  iebrand: new Set(),
  ieproduct: new Set(),
  ieprovince: new Set(),
  iecounty: new Set(),
  iebrick: new Set(),
  ieminibrick: new Set(),
  ieplan: new Set(),
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
  { key: "ieCategory", placeholder: "All categories" },
  { key: "ieManufacturer", placeholder: "All manufacturers" },
  { key: "iebrand", placeholder: "All brands" },
  { key: "ieproduct", placeholder: "All products" },
  { key: "ieprovince", placeholder: "All provinces" },
  { key: "iecounty", placeholder: "All counties" },
  { key: "iebrick", placeholder: "All bricks" },
  { key: "ieminibrick", placeholder: "All mini bricks" },
  { key: "ieplan", placeholder: "All account plans" },
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
  if (key.startsWith("ie")) {
    renderIreland();
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

/** All HDM names from the full data, for the login screen. Ireland's single
 *  HDM (Celine Jordan) is appended so she can log in and see HER page. */
function allHdms() {
  const hdms = [...RAW_HDM_ICBS.keys()];
  if (RAW.ireland && RAW.ireland.hdm && !hdms.includes(RAW.ireland.hdm)) {
    hdms.push(RAW.ireland.hdm);
  }
  return hdms.sort();
}

/** Is this HDM the Ireland owner? */
function isIrelandHdm(hdm) {
  return !!(hdm && RAW && RAW.ireland && RAW.ireland.hdm === hdm);
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

/** Lock (or unlock) the dashboard to an HDM. Rebuilds the scoped DATA + maps.
 *  Ireland rule: the whole Ireland dataset belongs to ONE HDM (Celine
 *  Jordan). She sees Ireland in full but no UK rows; UK HDMs see their UK
 *  ICBs but no Ireland; admin sees everything. */
function applyRLS(hdm) {
  const ie = isIrelandHdm(hdm);
  RLS_HDM = hdm && (RAW_HDM_ICBS.has(hdm) || ie) ? hdm : null;
  if (!RLS_HDM) {
    DATA = RAW;                                        // admin — everything
  } else if (ie) {
    DATA = { ...scopeData(RAW, new Set()), ireland: RAW.ireland };
  } else {
    DATA = { ...scopeData(RAW, RAW_HDM_ICBS.get(RLS_HDM)), ireland: null };
  }
  document.documentElement.setAttribute("data-rls", RLS_HDM ? "scoped" : "all");
  buildMaps();
  _lastSelSig = null;   // force guideline slicer option lists to rebuild
  _ukLastSig = null;    // force UK slicer option lists to rebuild
  if (typeof _ieLastSig !== "undefined") _ieLastSig = null; // Ireland slicers too
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

// ---------- animated segmented-control toggles (auto, report-wide) ----------
// Every .toggle group (MS%/Actuals, By brand/product/…, AAF/EHF, Brands/
// Products) gets a white "thumb" pill that SLIDES to the active option
// instead of the pill just jumping. Fully automatic: a MutationObserver
// watches each group's buttons for the .active class, so none of the existing
// click handlers change. Position is re-measured on page switch and resize
// (a hidden page has zero-width buttons, so placement is deferred until the
// toggle is actually visible).

function positionToggleThumb(t) {
  const thumb = t.querySelector(".toggle-thumb");
  if (!thumb) return;
  const active = t.querySelector("button.active");
  if (!active || !active.offsetWidth) {
    // hidden page (no layout yet) or nothing active — park invisibly and
    // re-place without animation next time we're visible
    thumb.style.opacity = "0";
    thumb.dataset.placed = "";
    return;
  }
  const firstPlace = thumb.dataset.placed !== "1";
  if (firstPlace) thumb.style.transition = "none"; // don't slide in from (0,0)
  thumb.style.opacity = "1";
  thumb.style.width = active.offsetWidth + "px";
  thumb.style.height = active.offsetHeight + "px";
  thumb.style.transform = `translate(${active.offsetLeft}px, ${active.offsetTop}px)`;
  if (firstPlace) {
    void thumb.offsetWidth; // flush so the un-animated placement is committed
    thumb.style.transition = "";
    thumb.dataset.placed = "1";
  }
}

function positionAllToggleThumbs() {
  document.querySelectorAll(".toggle").forEach(positionToggleThumb);
}

function initToggleThumbs() {
  document.querySelectorAll(".toggle").forEach((t) => {
    if (t.querySelector(".toggle-thumb")) return;
    const thumb = document.createElement("span");
    thumb.className = "toggle-thumb";
    thumb.setAttribute("aria-hidden", "true");
    t.prepend(thumb);
    t.classList.add("has-thumb");
    new MutationObserver(() => positionToggleThumb(t)).observe(t, {
      attributes: true,
      attributeFilter: ["class"],
      subtree: true,
    });
    positionToggleThumb(t);
  });
  window.addEventListener("resize", positionAllToggleThumbs);
}

// ---------- click-to-sort on every table column (auto, report-wide) ----------
// enableAllTableSorts() makes every <table> sortable by clicking any column
// header. Tables that already have bespoke sorting (their headers carry a
// data-sort attribute — the Guidelines & exclusivity tables) are left alone.
// The chosen sort is remembered per table and re-applied automatically after
// a re-render (the league tables rebuild their tbody on every filter change),
// via a MutationObserver on the tbody. Number-vs-text is auto-detected per
// column, understanding k/M suffixes, £/€ and ▲/▼ delta arrows.

const _tableSortState = new WeakMap(); // table -> { col, dir }

function _cellText(td) {
  return td ? (td.textContent || "").trim() : "";
}

// does this cell read as a number? (currency/arrow/sign prefix then a digit)
function _looksNumeric(t) {
  return /^[▲▼▬↑↓\s]*[-+]?\s*[£€$]?\s*\d/.test(t);
}

function _toSortNumber(t) {
  const down = /[▼↓]/.test(t);
  const cleaned = t.replace(/,/g, "");
  const m = cleaned.match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  let n = parseFloat(m[0]);
  const suf = cleaned.match(/\d\s*([kKmMbB])/); // 895.9k, 1.5M, £93.33M
  if (suf) n *= { k: 1e3, m: 1e6, b: 1e9 }[suf[1].toLowerCase()];
  if (down && n > 0) n = -n; // a ▼ delta with no explicit sign is negative
  return n;
}

function _sortTable(table, col, dir) {
  const tbody = table.tBodies[0];
  if (!tbody) return;
  const rows = [...tbody.rows];
  if (rows.length < 2) return;
  const cells = rows.map((r) => _cellText(r.cells[col]));
  const nonEmpty = cells.filter((v) => v && v !== "—" && v !== "n/a");
  const numeric =
    nonEmpty.length > 0 &&
    nonEmpty.filter(_looksNumeric).length / nonEmpty.length >= 0.6;
  const idx = rows.map((r, i) => i);
  idx.sort((ia, ib) => {
    const ta = cells[ia], tb = cells[ib];
    let cmp;
    if (numeric) {
      const na = _toSortNumber(ta), nb = _toSortNumber(tb);
      if (na == null && nb == null) cmp = 0;
      else if (na == null) cmp = 1;          // blanks always last
      else if (nb == null) cmp = -1;
      else cmp = na - nb;
    } else {
      cmp = ta.localeCompare(tb, undefined, { numeric: true, sensitivity: "base" });
    }
    return (dir === "desc" ? -cmp : cmp) || ia - ib; // stable
  });
  const frag = document.createDocumentFragment();
  idx.forEach((i) => frag.appendChild(rows[i]));
  tbody.appendChild(frag);
}

function _applyTableSort(table) {
  const st = _tableSortState.get(table);
  if (!st) return;
  const head = table.tHead && table.tHead.rows[0];
  if (head && st.col >= head.cells.length) { _tableSortState.delete(table); return; }
  table._sorting = true;                     // ignore our own reorder mutations
  _sortTable(table, st.col, st.dir);
  Promise.resolve().then(() => { table._sorting = false; });
}

function _markSortHeaders(table) {
  const head = table.tHead && table.tHead.rows[0];
  if (!head) return;
  [...head.cells].forEach((th) => th.classList.add("th-sort"));
}

function _updateSortHeaders(table) {
  const st = _tableSortState.get(table);
  const head = table.tHead && table.tHead.rows[0];
  if (!head) return;
  [...head.cells].forEach((th, i) => {
    th.classList.remove("sort-asc", "sort-desc");
    if (st && st.col === i) th.classList.add(st.dir === "asc" ? "sort-asc" : "sort-desc");
  });
}

function enableTableSort(table) {
  if (!table || table._sortEnabled) return;
  const head = table.tHead;
  if (!head || !head.rows[0]) return;
  // leave tables that already manage their own sorting (data-sort headers)
  if ([...head.rows[0].cells].some((th) => th.hasAttribute("data-sort"))) return;
  table._sortEnabled = true;
  table._hdrLen = head.rows[0].cells.length;
  table.classList.add("table-sortable");
  _markSortHeaders(table);
  // DELEGATED click: survives header rebuilds (e.g. the league Brands/Products
  // switch rewrites the whole header row).
  head.addEventListener("click", (e) => {
    const th = e.target.closest("th");
    if (!th || !head.contains(th)) return;
    const col = th.cellIndex;
    const cur = _tableSortState.get(table);
    const dir = cur && cur.col === col && cur.dir === "asc" ? "desc" : "asc";
    _tableSortState.set(table, { col, dir });
    _applyTableSort(table);
    _updateSortHeaders(table);
  });
  const tbody = table.tBodies[0];
  if (tbody) {
    new MutationObserver(() => {
      if (table._sorting) return;            // our own reorder — skip
      // a re-render may have rebuilt the header too — re-tag it
      _markSortHeaders(table);
      // if the column layout changed (e.g. Brands<->Products), drop the sort
      const len = table.tHead.rows[0].cells.length;
      if (len !== table._hdrLen) {
        table._hdrLen = len;
        _tableSortState.delete(table);
        _updateSortHeaders(table);
        return;
      }
      if (_tableSortState.get(table)) {      // re-apply the chosen sort
        _applyTableSort(table);
        _updateSortHeaders(table);
      }
    }).observe(tbody, { childList: true });
  }
}

function enableAllTableSorts() {
  document.querySelectorAll("table").forEach(enableTableSort);
}

// ---------- copy-visual-as-image (auto-added to every chart) ----------
// upsertChart() calls ensureCopyButton() for each canvas it draws on, so EVERY
// visual across the report gets a small hover button that copies the chart.
// JPEG has no transparency, so the canvas is first flattened onto the card
// background. Clipboards only accept PNG bitmaps for images, so the click
// copies a PNG (pasteable into email/PowerPoint); if the clipboard is
// unavailable (http, older browser, permissions) it downloads a .jpg instead.
// Alt/Option-click always downloads the .jpg file.

function flattenChartCanvas(src) {
  const c = document.createElement("canvas");
  c.width = src.width;
  c.height = src.height;
  const ctx = c.getContext("2d");
  ctx.fillStyle = isDark() ? "#000000" : "#ffffff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(src, 0, 0);
  return c;
}

function downloadChartJpeg(flat, id) {
  const a = document.createElement("a");
  a.href = flat.toDataURL("image/jpeg", 0.92);
  a.download = id + ".jpg";
  a.click();
}

async function copyChartImage(id, btn, forceDownload) {
  const chart = charts[id];
  const src = chart ? chart.canvas : $(id);
  if (!src) return;
  const flat = flattenChartCanvas(src);
  let ok = false;
  if (!forceDownload && navigator.clipboard && window.ClipboardItem) {
    try {
      const blob = await new Promise((r) => flat.toBlob(r, "image/png"));
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      ok = true;
    } catch (_) { /* fall through to download */ }
  }
  if (!ok) downloadChartJpeg(flat, id);
  if (btn) {
    const original = btn.innerHTML;
    btn.innerHTML = ok ? "✓ Copied" : "✓ Saved";
    btn.classList.add("done");
    setTimeout(() => { btn.innerHTML = original; btn.classList.remove("done"); }, 1400);
  }
}

const COPY_ICON_SVG =
  '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<rect x="9" y="9" width="13" height="13" rx="2"/>' +
  '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';

function ensureCopyButton(id) {
  const canvas = $(id);
  if (!canvas) return;
  const wrap = canvas.closest(".chart-wrap") || canvas.parentElement;
  if (!wrap || wrap.querySelector(".chart-copy-btn")) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "chart-copy-btn";
  btn.title = "Copy visual as image (Alt-click to download JPEG)";
  btn.innerHTML = COPY_ICON_SVG + " Copy";
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    copyChartImage(id, btn, e.altKey);
  });
  wrap.appendChild(btn);
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
