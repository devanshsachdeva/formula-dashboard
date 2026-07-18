/* ============================================================================
   uk.js — everything on the UK PERFORMANCE page (#/uk)
   ----------------------------------------------------------------------------
   This page re-uses the same data the Guidelines page loaded (the global
   DATA object from shared.js) but has its OWN set of slicers, so filtering
   here never disturbs the Guidelines page and vice-versa.

   The page is built from:
     - 6 slicers   (Category, Region, ICB, HDM, Manufacturer, Brand)
     - 2 selects   (Period, Metric)
     - 4 KPI cards (Volume, Value, Top manufacturer, Top brand)
     - 4 charts    (Region bars, Manufacturer MS% trend, Category mix, Movers)
     - 1 table     (Brand league)
   renderUK() at the bottom redraws all of them whenever anything changes.
   ========================================================================== */

/* ---------------------------------------------------------------------------
   1. PAGE STATE
   ukState holds the two single-choice controls plus the Category-mix toggle.
   The multi-select slicers do NOT live here — their ticked values live in
   the global SEL object (shared.js) under UK-specific keys, so the generic
   slicer component can drive them.
--------------------------------------------------------------------------- */
const ukState = {
  period: "mat",             // mat | qtr | ytd | all — which time window
  metric: "factored_units",  // factored_units (KGs) | value (£) | units
  catMode: "ms",             // Category-mix chart: "ms" = share %, "actual" = volumes
  trendDim: "brand",         // Monthly trend: brand | product | manufacturer
  trendValue: "actual",      // Monthly trend: "actual" = volumes, "ms" = share %
  matDim: "brand",           // MAT year-on-year: brand | product
  matValue: "actual",        // MAT year-on-year: "actual" = volumes, "ms" = share %
};

// The six slicer keys this page owns. Each key matches an element with
// id="ms-<key>" in index.html and a Set with the same name inside SEL.
const UK_SLICERS = ["ukCategory", "ukRegion", "ukicb", "ukccg", "ukhdm", "ukmanufacturer", "ukbrand"];

// Which column of a performance row each slicer checks against.
// (ukhdm is missing on purpose — HDMs map to ICBs first, handled separately.)
const UK_FIELD = {
  ukCategory: "category",
  ukRegion: "region",
  ukicb: "icb",
  ukccg: "ccg",
  ukmanufacturer: "manufacturer",
  ukbrand: "brand",
};

/* ---------------------------------------------------------------------------
   2. TIME WINDOWS
   Turns the Period dropdown into two lists of month strings:
     cur  = the months we are looking at (e.g. the last 12 for MAT)
     prev = the months we compare against (e.g. the 12 before those)
   Growth % on the KPI cards is simply cur vs prev.
--------------------------------------------------------------------------- */
function ukWindows() {
  const months = DATA.meta.months;                    // all months, oldest first
  const lastN = (n) => months.slice(-n);              // the newest n months
  const prevN = (n) => months.slice(-2 * n, -n);      // the n months before those
  if (ukState.period === "qtr")
    return { cur: lastN(3), prev: prevN(3), label: "Rolling QTR", vs: "prior QTR" };
  if (ukState.period === "ytd") {
    // YTD = every month of the latest year, compared with the SAME months
    // of the year before (Jan–May vs Jan–May, never Jan–May vs a full year).
    const year = months[months.length - 1].slice(0, 4);
    const cur = months.filter((m) => m.startsWith(year));
    const prevYear = String(Number(year) - 1);
    const mm = new Set(cur.map((m) => m.slice(5, 7)));
    const prev = months.filter((m) => m.startsWith(prevYear) && mm.has(m.slice(5, 7)));
    return { cur, prev, label: "YTD " + year, vs: "YTD " + prevYear };
  }
  if (ukState.period === "all")
    return { cur: months, prev: [], label: "All data", vs: "" };
  // default: MAT = Moving Annual Total, the last 12 months
  return { cur: lastN(12), prev: prevN(12), label: "MAT", vs: "prior MAT" };
}

/* ---------------------------------------------------------------------------
   3. ROW FILTERING
   ukMatches(row, excludeKey) answers: "does this data row pass every UK
   slicer?"  excludeKey lets the cross-filter ask "…every slicer EXCEPT the
   one I'm rebuilding" (see section 4).
   The rule per slicer: if nothing is ticked the slicer allows everything;
   otherwise the row's value must be one of the ticked values.
--------------------------------------------------------------------------- */
function ukHdmUnion() {
  // HDMs are people who own ICBs, so an HDM filter really means
  // "only rows whose ICB belongs to one of the ticked HDMs".
  if (!SEL.ukhdm.size) return null;                   // no HDM ticked = allow all
  const u = new Set();
  for (const h of SEL.ukhdm) for (const i of HDM_ICBS.get(h) || []) u.add(i);
  return u;                                           // the allowed ICBs
}

function ukMatches(r, excludeKey) {
  // HDM check first (unless we're rebuilding the HDM slicer itself)
  if (excludeKey !== "ukhdm") {
    const hu = ukHdmUnion();
    if (hu && !hu.has(r.icb)) return false;
  }
  // then every ordinary slicer
  for (const k of UK_SLICERS) {
    if (k === excludeKey || k === "ukhdm") continue;  // skip HDM (done above)
    if (SEL[k].size && !SEL[k].has(r[UK_FIELD[k]])) return false;
  }
  return true;
}

// Rows inside the chosen time window that pass every slicer.
function ukRows(win) {
  const set = new Set(win);                            // Set = fast lookup
  return DATA.performance.filter((r) => set.has(r.date) && ukMatches(r, null));
}

/* ---------------------------------------------------------------------------
   4. SLICER CROSS-FILTERING
   Same idea as the Guidelines page: each slicer's list of options is
   recomputed from the rows that the OTHER five slicers still allow.
   Example: tick Manufacturer = MJN and the Brand slicer only offers
   Nutramigen and Puramino. A slicer never constrains itself (otherwise you
   could never widen your own selection), and values you already ticked are
   never removed from the list.
--------------------------------------------------------------------------- */
let _ukLastSig = null; // remembers the last selection so we skip useless rebuilds

function ukAvailableOptions(key) {
  const rows = DATA.performance.filter((r) => ukMatches(r, key));
  if (key === "ukhdm") {
    // an HDM is offered if at least one of their ICBs survives the other slicers
    const icbs = new Set(rows.map((r) => r.icb));
    return [...HDM_ICBS.keys()].filter((h) => {
      for (const i of HDM_ICBS.get(h)) if (icbs.has(i)) return true;
      return false;
    });
  }
  return [...new Set(rows.map((r) => r[UK_FIELD[key]]))]; // unique values only
}

function refreshUKSlicers() {
  // build a "signature" of the current ticks; if unchanged, nothing to do
  const sig = UK_SLICERS.map((k) => [...SEL[k]].sort().join(",")).join("|");
  if (sig === _ukLastSig) return;
  _ukLastSig = sig;
  // don't rebuild the panel the user has open (their scroll position would jump)
  const openPanel = document.querySelector(".msel-panel:not([hidden])");
  const openKey = openPanel ? openPanel.closest(".msel").id.replace("ms-", "") : null;
  for (const k of UK_SLICERS) {
    if (k === openKey) continue;
    // union with the current selection so ticked values always stay visible
    setMselOptions(k, [...new Set([...ukAvailableOptions(k), ...SEL[k]])].sort());
  }
}

/* ---------------------------------------------------------------------------
   5. SMALL HELPERS for this page
--------------------------------------------------------------------------- */
// "SCOTLAND · EHF" style summary of what is filtered, shown under the KPIs.
function ukScopeLabel() {
  const bits = [];
  for (const k of UK_SLICERS)
    if (SEL[k].size) bits.push([...SEL[k]].sort().join(" + "));
  return bits.length ? bits.join(" · ") : "all data";
}

// Format a number in the currently selected metric ("£93.33M", "162.0k KGs").
function fmtMetricUK(n) {
  return (ukState.metric === "value" ? "£" : "") + fmtNum(n) +
    (ukState.metric === "factored_units" ? " KGs" : ukState.metric === "units" ? " units" : "");
}

/* ---------------------------------------------------------------------------
   6. KPI CARDS — four headline numbers with growth arrows.
   We always show Volume in KGs and Value in £ (regardless of the metric
   dropdown) because both are interesting; the metric dropdown decides how
   shares and the charts are measured.
--------------------------------------------------------------------------- */
function renderUKKPIs(win, cur, prev) {
  const metric = ukState.metric;
  const sum = (rows, m) => rows.reduce((s, r) => s + r[m], 0); // add a column up

  const volCur = sum(cur, "factored_units"), volPrev = sum(prev, "factored_units");
  const valCur = sum(cur, "value"), valPrev = sum(prev, "value");

  // rank manufacturers and brands by the selected metric to find the leaders
  const total = sum(cur, metric);
  const byMfr = [...sumBy(cur, (r) => r.manufacturer, metric).entries()].sort((a, b) => b[1] - a[1]);
  const byBrand = [...sumBy(cur, (r) => r.brand, metric).entries()].sort((a, b) => b[1] - a[1]);
  const topMfr = byMfr[0], topBrand = byBrand[0];

  // build the four cards as HTML (growthHTML draws the ▲/▼ +x.x% part)
  $("uk-kpis").innerHTML = `
    <div class="card kpi">
      <span class="kpi-label">Volume — ${win.label}</span>
      <span class="kpi-value">${fmtNum(volCur)} KGs</span>
      ${growthHTML(volCur, volPrev, win.vs)}
      <span class="kpi-sub">${esc(ukScopeLabel())}</span>
    </div>
    <div class="card kpi">
      <span class="kpi-label">Value — ${win.label}</span>
      <span class="kpi-value">£${fmtNum(valCur)}</span>
      ${growthHTML(valCur, valPrev, win.vs)}
      <span class="kpi-sub">${esc(ukScopeLabel())}</span>
    </div>
    <div class="card kpi">
      <span class="kpi-label">Top manufacturer</span>
      <span class="kpi-value">${topMfr ? esc(topMfr[0]) : "—"}</span>
      <span class="kpi-sub">${topMfr && total ? "MS% " + ((topMfr[1] / total) * 100).toFixed(1) + "%" : "no data"}</span>
    </div>
    <div class="card kpi">
      <span class="kpi-label">Top brand</span>
      <span class="kpi-value">${topBrand ? esc(topBrand[0]) : "—"}</span>
      <span class="kpi-sub">${topBrand && total ? "MS% " + ((topBrand[1] / total) * 100).toFixed(1) + "%" : "no data"}</span>
    </div>`;

  // Top colour shades auto-follow the report's colour scheme: the leading
  // manufacturer/brand colour drives each card, so the KPIs recolour with the
  // data (MJN-blue, Nutricia-purple, Nestlé-pink…) instead of fixed hues.
  const cards = $("uk-kpis").querySelectorAll(".kpi");
  const mfrColor = topMfr ? colorFor(topMfr[0], "manufacturer", 0) : null;
  const brandColor = topBrand ? colorFor(topBrand[0], "brand", 0) : null;
  applyKpiAccent(cards[0], brandColor);   // Volume — overall leader
  applyKpiAccent(cards[1], mfrColor);     // Value — leading manufacturer
  applyKpiAccent(cards[2], mfrColor);     // Top manufacturer
  applyKpiAccent(cards[3], brandColor);   // Top brand
}

/* ---------------------------------------------------------------------------
   7. CHART: Volume by NHS region (horizontal bars, labelled)
   How a Chart.js chart works, in one breath: you give it a <canvas>, a type
   ("bar", "line", …), data { labels, datasets } and options; it draws it.
   upsertChart() (defined in guidelines.js) destroys any previous chart on
   the same canvas first — you can't draw two charts on one canvas.
--------------------------------------------------------------------------- */
function renderUKRegion(win, cur, prev) {
  const metric = ukState.metric;
  const curBy = sumBy(cur, (r) => r.region, metric);   // region -> total now
  const prevBy = sumBy(prev, (r) => r.region, metric); // region -> total before
  const entries = [...curBy.entries()].sort((a, b) => b[1] - a[1]); // biggest first

  upsertChart("uk-chart-region", {
    type: "bar",
    data: {
      labels: entries.map(([k]) => k),                 // bar names (regions)
      datasets: [{
        data: entries.map(([, v]) => v),               // bar lengths (volumes)
        backgroundColor: "#4f46e5",
        borderRadius: 6,
        // LABELS: the datalabels plugin prints a value on each bar.
        // anchor/align "end" = at the bar's tip, just outside it.
        datalabels: {
          display: true, anchor: "end", align: "end", offset: 2, clamp: true,
          color: themeInk(), font: { size: 10, weight: "700" },
          formatter: (v) => fmtNum(v),                 // 648012 -> "648.0k"
        },
      }],
    },
    options: {
      indexAxis: "y",                                  // "y" = horizontal bars
      responsive: true, maintainAspectRatio: false,    // fill the card
      layout: { padding: { right: 48 } },              // room for the end labels
      plugins: {
        legend: { display: false },                    // one series → no legend
        tooltip: {
          callbacks: {
            // the hover box also explains growth vs the comparison window
            label: (c) => {
              const region = entries[c.dataIndex][0];
              const p = prevBy.get(region) || 0;
              const g = p ? (((c.parsed.x - p) / p) * 100).toFixed(1) + "% vs " + win.vs : "no comparison";
              return ` ${fmtMetricUK(c.parsed.x)} (${g})`;
            },
          },
        },
      },
      scales: { x: { beginAtZero: true, ticks: { callback: (v) => fmtNum(v) } } },
    },
  });
}

/* ---------------------------------------------------------------------------
   8. CHART: Monthly trend (full width — lines, every point labelled)
   Two toggles drive it:
     - dimension: one line per BRAND, PRODUCT (client line) or MANUFACTURER
     - value:     "Actuals" = raw volumes, "MS%" = share of each month
   MS% denominator rule: the month total IGNORES the brand & manufacturer
   slicers. Otherwise filtering to one brand would show a flat 100% line
   (the brand's share of itself) instead of its true market share.
--------------------------------------------------------------------------- */
// Like ukMatches() but skips the brand + manufacturer slicers — used only to
// build the MS% denominator ("the whole market in scope").
function ukMatchesMarket(r) {
  const hu = ukHdmUnion();
  if (hu && !hu.has(r.icb)) return false;
  for (const k of ["ukCategory", "ukRegion", "ukicb", "ukccg"])
    if (SEL[k].size && !SEL[k].has(r[UK_FIELD[k]])) return false;
  return true;
}

// The one ICB the user has drilled into (exactly one ticked), else "".
// Mirrors singleICB() on the Guidelines page but reads the UK slicer.
function ukSingleICB() {
  return SEL.ukicb.size === 1 ? [...SEL.ukicb][0] : "";
}
// Which category the guideline interval bands are labelled for (first ticked,
// else EHF). Mirrors explorerCategory() but reads the UK category slicer.
function ukExplorerCategory() {
  for (const c of ["EHF", "AAF", "RICE"]) if (SEL.ukCategory.has(c)) return c;
  return "EHF";
}
// Human label of the category scope, for the MS% hint text.
function ukCatLabel() {
  return SEL.ukCategory.size ? [...SEL.ukCategory].sort().join(" + ") : "all categories";
}

/* Built to mirror the Guidelines page's renderTrend(), but every row comes
   from the UK slicers (ukRows / ukMatchesMarket) instead of the GL ones.
   Feature parity with GL:
     - four dimensions: brand | product | manufacturer | category
     - Actuals / MS% value toggle (MS% denominator ignores brand+manufacturer)
     - a value label on every point
     - the chart respects the Period control (win.cur), like GL
     - drill to ONE ICB and you get the same shaded guideline-interval bands
       and dashed publish/change markers the GL trend shows. */
function renderUKTrend() {
  const metric = ukState.metric;
  const win = ukWindows();                             // Period control decides the window
  const months = win.cur;                              // ISO months, e.g. "2025-03-01"
  const dim = ukState.trendDim;                        // brand | product | manufacturer | category
  const isMS = ukState.trendValue === "ms";
  const rows = ukRows(months);                         // all UK slicers, within the period

  // one line per distinct value of the chosen dimension, biggest first
  const keys = [...sumBy(rows, (r) => r[dim], metric).entries()]
    .sort((a, b) => b[1] - a[1]).map(([k]) => k);

  // "month key" -> volume for the line values
  const cell = new Map();
  for (const r of rows)
    cell.set(r.date + " " + r[dim], (cell.get(r.date + " " + r[dim]) || 0) + r[metric]);

  // month -> total for the MS% maths. Denominator = the whole market in scope
  // (region/ICB/HDM/category), IGNORING brand+manufacturer, so filtering to one
  // brand shows its real share, not a flat 100% of itself.
  const monthSet = new Set(months);
  const monthTotal = new Map();
  const denomRows = isMS
    ? DATA.performance.filter((r) => monthSet.has(r.date) && ukMatchesMarket(r))
    : rows;
  for (const r of denomRows)
    monthTotal.set(r.date, (monthTotal.get(r.date) || 0) + r[metric]);

  // which ICB (if exactly one) unlocks the guideline bands/markers
  const selIcb = ukSingleICB();

  // hint text — same wording as the GL trend
  $("uk-trend-hint").textContent =
    (isMS ? `(monthly ${dim} MS% of ${ukCatLabel()})` : "") +
    (selIcb ? " — shaded bands = guideline intervals" : "");

  upsertChart("uk-chart-trend", {
    type: "line",
    data: {
      labels: months.map(monthLabel),                  // "Jun 23", "Jul 23", …
      datasets: keys.map((k, i) => ({
        label: k,
        data: months.map((mo) => {
          const v = cell.get(mo + " " + k) || 0;
          if (!isMS) return v;                         // Actuals: the volume
          const t = monthTotal.get(mo) || 0;
          return t ? (v / t) * 100 : 0;                // MS%: share of month
        }),
        borderColor: colorFor(k, dim, i),              // family colours
        backgroundColor: colorFor(k, dim, i),
        fill: false, tension: 0.25,                    // slight curve smoothing
        pointRadius: 0, pointHitRadius: 8,             // no dots, easy hover
        borderWidth: 2,
        // LABELS: pointLabels() (guidelines.js) prints the value at every
        // point in the line's own colour; isMS decides % vs number format.
        datalabels: pointLabels(colorFor(k, dim, i), isMS),
      })),
    },
    // the two background plugins are shared with the GL trend; they only draw
    // when we hand them bands/marks (empty when no single ICB is selected)
    plugins: [intervalBandsPlugin, glMarkerPlugin],
    options: {
      responsive: true, maintainAspectRatio: false,
      layout: { padding: { top: 14 } },                // headroom for labels
      interaction: { mode: "index", intersect: false },// hover shows all lines
      plugins: {
        // guideline interval shading, labelled for the UK-selected category
        intervalBands: { bands: bandsFor(selIcb, months, ukExplorerCategory()) },
        // dashed vertical lines at guideline publish/change/event months
        glMarkers: { marks: glMarksFor(months, selIcb) },
        legend: { position: "bottom", labels: { boxWidth: 12, usePointStyle: true } },
        tooltip: {
          callbacks: {
            label: (c) =>
              ` ${c.dataset.label}: ` +
              (isMS ? "MS% " + c.parsed.y.toFixed(1) + "%" : fmtMetricUK(c.parsed.y)),
          },
        },
      },
      scales: {
        // no fixed max — the axis fits the data so the lines fill the chart
        y: { beginAtZero: true, grace: "8%", ticks: { callback: (v) => (isMS ? v + "%" : fmtNum(v)) } },
        x: { grid: { display: false } },
      },
    },
  });
}

/* ---------------------------------------------------------------------------
   9. CHART: Category mix (QUARTERLY stacked bars with an MS%/Actuals toggle)
   Why quarterly? 36 monthly bars were unreadably thin. 12 quarterly bars
   are wide enough to print a label inside every segment.
   Why a toggle? "Mix" is really about proportions (MS% mode, bars always
   reach 100%), but sometimes you want the raw volumes (Actuals mode).
   Note: this chart deliberately IGNORES the Category slicer — a mix of one
   category is meaningless — but respects all the other slicers.
--------------------------------------------------------------------------- */
function renderUKCatMix() {
  const metric = ukState.metric;
  const isMS = ukState.catMode === "ms";
  // rows passing every slicer EXCEPT ukCategory (see note above)
  const rows = DATA.performance.filter((r) => ukMatches(r, "ukCategory"));
  const cats = ["EHF", "AAF", "RICE"].filter((c) => DATA.meta.categories.includes(c));
  // ordered unique quarters, e.g. 2023-Q2 … 2026-Q2 (quarterKey is in shared.js)
  const quarters = [...new Set(DATA.meta.months.map(quarterKey))];

  // "quarter category" -> volume, and quarter -> total (for the % maths)
  const cell = new Map(), qTotal = new Map();
  for (const r of rows) {
    if (!cats.includes(r.category)) continue;
    const q = quarterKey(r.date);
    cell.set(q + " " + r.category, (cell.get(q + " " + r.category) || 0) + r[metric]);
    qTotal.set(q, (qTotal.get(q) || 0) + r[metric]);
  }

  upsertChart("uk-chart-cat", {
    type: "bar",
    data: {
      labels: quarters,
      datasets: cats.map((c) => ({
        label: c,
        data: quarters.map((q) => {
          const v = cell.get(q + " " + c) || 0;
          if (!isMS) return v;                          // Actuals: raw volume
          const t = qTotal.get(q) || 0;
          return t ? (v / t) * 100 : 0;                 // MS%: share of quarter
        }),
        backgroundColor: CAT_COLORS[c],
        // LABELS inside each segment — but only when the segment is big
        // enough to fit text (≥6% in MS% mode, ≥8% of the quarter otherwise).
        datalabels: {
          display: (ctx) => {
            const v = ctx.dataset.data[ctx.dataIndex];
            if (isMS) return v >= 6;
            const t = qTotal.get(quarters[ctx.dataIndex]) || 0;
            return t && v / t >= 0.08;
          },
          color: "#fff", font: { weight: "700", size: 10 },
          formatter: (v) => (isMS ? v.toFixed(0) + "%" : fmtNum(v)),
        },
      })),
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom", labels: { boxWidth: 12, usePointStyle: true } },
        tooltip: {
          callbacks: {
            // Actuals tooltip shows BOTH the volume and the share
            label: (c) => {
              if (isMS) return ` ${c.dataset.label}: ${c.parsed.y.toFixed(1)}%`;
              const t = qTotal.get(quarters[c.dataIndex]) || 0;
              const pct = t ? ((c.parsed.y / t) * 100).toFixed(1) : 0;
              return ` ${c.dataset.label}: ${fmtMetricUK(c.parsed.y)} (${pct}%)`;
            },
          },
        },
      },
      scales: {
        x: { stacked: true, grid: { display: false } }, // stacked = segments pile up
        y: {
          stacked: true,
          max: isMS ? 100 : undefined,                  // MS% bars always total 100
          ticks: { callback: (v) => (isMS ? v + "%" : fmtNum(v)) },
        },
      },
    },
  });
}

/* ---------------------------------------------------------------------------
   10. CHART: ICB movers (who grew / shrank the most vs the prior window)
--------------------------------------------------------------------------- */
function renderUKMovers(win, cur, prev) {
  const metric = ukState.metric;
  const curBy = sumBy(cur, (r) => r.icb, metric);
  const prevBy = sumBy(prev, (r) => r.icb, metric);
  const total = [...curBy.values()].reduce((s, v) => s + v, 0);

  // growth % per ICB — but skip tiny ICBs whose percentages would be noise
  const movers = [];
  for (const [icb, c] of curBy) {
    const p = prevBy.get(icb) || 0;
    if (!p || c + p < total * 0.005) continue;
    movers.push({ icb, pct: ((c - p) / p) * 100 });
  }
  movers.sort((a, b) => b.pct - a.pct);
  // best 5 + worst 5 (deduplicated in case fewer than 10 exist)
  const top = [...movers.slice(0, 5), ...movers.slice(-5)].filter(
    (m, i, arr) => arr.findIndex((x) => x.icb === m.icb) === i
  );

  upsertChart("uk-chart-movers", {
    type: "bar",
    data: {
      labels: top.map((m) => m.icb),
      datasets: [{
        data: top.map((m) => m.pct),
        // green bars grow to the right, red bars to the left
        backgroundColor: top.map((m) => (m.pct >= 0 ? "#16a34a" : "#dc2626")),
        borderRadius: 6,
        datalabels: {
          display: true, anchor: "end", align: "end", offset: 2, clamp: true,
          color: themeInk(), font: { size: 10, weight: "700" },
          formatter: (v) => (v >= 0 ? "+" : "") + v.toFixed(1) + "%",
        },
      }],
    },
    options: {
      indexAxis: "y",
      responsive: true, maintainAspectRatio: false,
      layout: { padding: { right: 54 } },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (c) => ` ${(c.parsed.x >= 0 ? "+" : "") + c.parsed.x.toFixed(1)}% vs ${win.vs}` } },
      },
      scales: { x: { ticks: { callback: (v) => v + "%" } } },
    },
  });
}

/* ---------------------------------------------------------------------------
   11. TABLE: brand league — volume, growth, share and share-change per brand
--------------------------------------------------------------------------- */
function renderUKBrandTable(win, cur, prev) {
  const metric = ukState.metric;
  const brandMfr = new Map(); // brand -> its manufacturer (for the 2nd column)
  for (const r of cur) if (!brandMfr.has(r.brand)) brandMfr.set(r.brand, r.manufacturer);

  const curBy = sumBy(cur, (r) => r.brand, metric);
  const prevBy = sumBy(prev, (r) => r.brand, metric);
  const curTotal = [...curBy.values()].reduce((s, v) => s + v, 0);
  const prevTotal = [...prevBy.values()].reduce((s, v) => s + v, 0);

  const rows = [...curBy.entries()].sort((a, b) => b[1] - a[1]).map(([b, v]) => {
    const p = prevBy.get(b) || 0;
    const ms = curTotal ? (v / curTotal) * 100 : 0;              // share now
    const msPrev = prevTotal ? (p / prevTotal) * 100 : null;     // share before
    return {
      brand: b, mfr: brandMfr.get(b) || "", vol: v,
      growth: p ? ((v - p) / p) * 100 : null,                    // volume growth
      ms, dms: msPrev != null ? ms - msPrev : null,              // share change (pts)
    };
  });

  // deltaHTML (guidelines.js) draws the little ▲/▼ coloured deltas
  document.querySelector("#uk-brand-table tbody").innerHTML = rows.map((r) => `
    <tr>
      <td><strong>${esc(r.brand)}</strong></td>
      <td>${esc(r.mfr)}</td>
      <td class="num">${fmtMetricUK(r.vol)}</td>
      <td class="num">${r.growth == null ? "—" : deltaHTML(r.growth, 0, "%")}</td>
      <td class="num"><strong>${r.ms.toFixed(1)}%</strong></td>
      <td class="num">${r.dms == null ? "—" : deltaHTML(r.dms, 0, "%")}</td>
    </tr>`).join("");
}

/* ---------------------------------------------------------------------------
   11b. CHART: MAT year-on-year (combo — grouped bars + a growth line)
   For every brand (or product) it draws two bars side by side — last 12
   months (MAT CY) vs the 12 before that (MAT PY) — plus a growth line on a
   SECOND y-axis.
     - Brands / Products toggle  → which dimension the bars group by
     - Actuals / MS% toggle      → bars are volumes, or each item's market share
   This visual is always MAT-vs-prior-MAT; it ignores the Period dropdown on
   purpose (that's what "MAT PY / MAT CY" means), but it does respect every
   slicer and the Metric dropdown.
   Chart.js "combo": the top-level type is "bar"; the growth dataset overrides
   its own type to "line" and points at a separate axis (yAxisID: "y1").
--------------------------------------------------------------------------- */
// Turn a "#rrggbb" colour into an rgba() string with the given opacity — used
// to draw the prior-year bars as a faded version of each brand's own colour.
function withAlpha(hex, a) {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16),
        g = parseInt(h.slice(2, 4), 16),
        b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function renderUKMatYoY() {
  const metric = ukState.metric;
  const isMS = ukState.matValue === "ms";
  const dim = ukState.matDim;                          // brand | product
  const months = DATA.meta.months;
  const cy = months.slice(-12);                        // MAT CY = last 12 months
  const py = months.slice(-24, -12);                   // MAT PY = the 12 before
  const cySet = new Set(cy), pySet = new Set(py);

  // rows in each window that pass every UK slicer (the bar numerators)
  const cyRows = DATA.performance.filter((r) => cySet.has(r.date) && ukMatches(r, null));
  const pyRows = DATA.performance.filter((r) => pySet.has(r.date) && ukMatches(r, null));
  const cyBy = sumBy(cyRows, (r) => r[dim], metric);   // dim -> CY total
  const pyBy = sumBy(pyRows, (r) => r[dim], metric);   // dim -> PY total

  // whole-market totals for MS% (ignore brand+manufacturer, like the trend)
  const marketTotal = (set) =>
    DATA.performance.filter((r) => set.has(r.date) && ukMatchesMarket(r))
      .reduce((s, r) => s + r[metric], 0);
  const cyMarket = isMS ? marketTotal(cySet) : 0;
  const pyMarket = isMS ? marketTotal(pySet) : 0;

  // one group per dimension value, biggest CY first
  const keys = [...new Set([...cyBy.keys(), ...pyBy.keys()])]
    .sort((a, b) => (cyBy.get(b) || 0) - (cyBy.get(a) || 0));

  // bar value = volume, or share of the market in MS% mode
  const cyVal = (k) => (isMS ? (cyMarket ? ((cyBy.get(k) || 0) / cyMarket) * 100 : 0) : (cyBy.get(k) || 0));
  const pyVal = (k) => (isMS ? (pyMarket ? ((pyBy.get(k) || 0) / pyMarket) * 100 : 0) : (pyBy.get(k) || 0));
  // growth line: actuals = % change; MS% = change in share points (CY − PY).
  // In actuals mode, skip items with a negligible prior-year base — their %
  // growth is unstable (a new brand shows +2900% and flattens the axis for
  // everyone). The bars still show; only the misleading line point is dropped.
  const totalPY = [...pyBy.values()].reduce((s, v) => s + v, 0);
  const growth = (k) => {
    if (isMS) return cyVal(k) - pyVal(k);
    const p = pyBy.get(k) || 0;
    if (!p || p < totalPY * 0.005) return null;
    return (((cyBy.get(k) || 0) - p) / p) * 100;
  };
  // growth is always expressed in % — as a percentage change in Actuals mode,
  // and as the change in MS% (share points) in MS% mode
  const growthUnit = "%";
  // every bar is labelled; when crowded (>8 items) the labels rotate vertical
  // and shrink so they still fit between the narrow grouped bars
  const fewKeys = keys.length <= 8;
  const barLabel = (color, weight) => ({
    display: true, // global default is off, so opt in explicitly
    anchor: "end", align: "top", offset: 1, color,
    font: { size: fewKeys ? 9 : 8, weight },
    rotation: fewKeys ? 0 : -90,
    formatter: (v) => (isMS ? v.toFixed(1) + "%" : fmtNum(v)),
  });

  $("uk-mat-hint").textContent =
    `— MAT CY (${monthLabel(cy[0])}–${monthLabel(cy[cy.length - 1])}) vs ` +
    `MAT PY (${monthLabel(py[0])}–${monthLabel(py[py.length - 1])}), ` +
    (isMS ? "bars = market share %, line = Δ share %" : "bars = volume, line = growth %");

  upsertChart("uk-chart-mat", {
    type: "bar",                                        // default for the bar datasets
    data: {
      labels: keys,
      datasets: [
        {
          // prior year = each item's brand/product colour, faded
          type: "bar", label: "MAT PY", yAxisID: "y", order: 3,
          data: keys.map(pyVal), borderRadius: 6,
          backgroundColor: keys.map((k, i) => withAlpha(colorFor(k, dim, i), 0.4)),
          datalabels: barLabel(themeInkSoft(), "600"),
        },
        {
          // current year = the same brand/product colour, solid
          type: "bar", label: "MAT CY", yAxisID: "y", order: 3,
          data: keys.map(cyVal), borderRadius: 6,
          backgroundColor: keys.map((k, i) => colorFor(k, dim, i)),
          datalabels: barLabel(themeInk(), "700"),
        },
        {
          type: "line", label: "Growth (" + growthUnit + ")", yAxisID: "y1", order: 1,
          data: keys.map(growth), borderColor: GROWTH_COLOR, backgroundColor: GROWTH_COLOR,
          borderWidth: 2, tension: 0.3, pointRadius: 3, pointHoverRadius: 5, spanGaps: false,
          datalabels: {
            display: true,
            align: "top", offset: 4, color: growthLabelColor(), font: { size: 9, weight: "700" },
            formatter: (v) => (v == null ? null : (v >= 0 ? "+" : "") + v.toFixed(1) + growthUnit),
          },
        },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      layout: { padding: { top: 18 } },                // headroom for labels
      interaction: { mode: "index", intersect: false },
      plugins: {
        // bars are coloured per brand/product, so a normal legend swatch would
        // just show the first brand. Give a custom legend that explains the
        // convention instead: PY = faded, CY = solid, plus the growth line.
        legend: {
          position: "bottom",
          labels: {
            boxWidth: 12, usePointStyle: true,
            generateLabels: (chart) => [
              { text: "MAT PY (faded)", fillStyle: "rgba(100,116,139,0.4)", strokeStyle: "rgba(100,116,139,0.4)", pointStyle: "rect", datasetIndex: 0, hidden: !chart.isDatasetVisible(0) },
              { text: "MAT CY (solid)", fillStyle: themeInkSoft(), strokeStyle: themeInkSoft(), pointStyle: "rect", datasetIndex: 1, hidden: !chart.isDatasetVisible(1) },
              { text: "Growth (" + growthUnit + ")", fillStyle: GROWTH_COLOR, strokeStyle: GROWTH_COLOR, pointStyle: "line", datasetIndex: 2, hidden: !chart.isDatasetVisible(2) },
            ],
          },
        },
        tooltip: {
          callbacks: {
            label: (c) => {
              if (c.dataset.type === "line")
                return ` Growth: ${c.parsed.y == null ? "n/a" : (c.parsed.y >= 0 ? "+" : "") + c.parsed.y.toFixed(1) + growthUnit}`;
              return ` ${c.dataset.label}: ${isMS ? c.parsed.y.toFixed(1) + "%" : fmtMetricUK(c.parsed.y)}`;
            },
          },
        },
      },
      scales: {
        // left axis = the bars (volumes or share %)
        y: { beginAtZero: true, position: "left",
             title: { display: true, text: isMS ? "Market share" : "Volume" },
             ticks: { callback: (v) => (isMS ? v + "%" : fmtNum(v)) } },
        // right axis = the growth line, its own scale, no gridlines of its own
        y1: { position: "right", grid: { drawOnChartArea: false },
              title: { display: true, text: "Growth (" + growthUnit + ")" },
              ticks: { callback: (v) => (v >= 0 ? "+" : "") + v + growthUnit } },
        x: { grid: { display: false } },
      },
    },
  });
}

/* ---------------------------------------------------------------------------
   12. MASTER RENDER — called whenever any UK control changes and every time
   the user navigates onto this page.
--------------------------------------------------------------------------- */
function renderUK() {
  saveFilters();          // remember everything in localStorage
  refreshUKSlicers();     // cross-filter the six slicers off each other
  const win = ukWindows();
  const cur = ukRows(win.cur);
  const prev = ukRows(win.prev);
  $("uk-caption").textContent =
    `${win.label}: ${windowLabel(win.cur)}` +
    (win.prev.length ? `  ·  compared with ${win.vs}: ${windowLabel(win.prev)}` : "");
  renderUKKPIs(win, cur, prev);
  renderUKRegion(win, cur, prev);
  renderUKTrend();
  renderUKCatMix();
  renderUKMovers(win, cur, prev);
  renderUKMatYoY();
  renderUKBrandTable(win, cur, prev);
}

/* ---------------------------------------------------------------------------
   13. ONE-TIME SETUP — fills the slicers with options and attaches listeners.
   Runs once at start-up (called from main.js after the data has loaded).
--------------------------------------------------------------------------- */
function setupUK() {
  // initial option lists (cross-filtering narrows them later)
  setMselOptions("ukCategory", DATA.meta.categories);
  setMselOptions("ukRegion", DATA.meta.regions);
  setMselOptions("ukicb", DATA.meta.icbs);
  setMselOptions("ukccg", DATA.meta.ccgs);
  setMselOptions("ukhdm", [...HDM_ICBS.keys()].sort());
  setMselOptions("ukmanufacturer", DATA.meta.manufacturers);
  setMselOptions("ukbrand", DATA.meta.brands);

  // Period + Metric are plain <select>s: copy the choice into ukState, redraw
  for (const [id, key] of [["uk-period", "period"], ["uk-metric", "metric"]]) {
    $(id).addEventListener("change", () => {
      ukState[key] = $(id).value;
      renderUK();
    });
  }

  // Category-mix MS%/Actuals toggle: highlight the clicked button, redraw
  document.querySelectorAll("#uk-cat-toggle button").forEach((btn) =>
    btn.addEventListener("click", () => {
      document.querySelectorAll("#uk-cat-toggle button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      ukState.catMode = btn.dataset.mode;
      saveFilters();
      renderUKCatMix();   // only this one chart depends on the toggle
    })
  );

  // Monthly-trend dimension toggle (By brand / By product / By manufacturer)
  document.querySelectorAll("#uk-trend-toggle button").forEach((btn) =>
    btn.addEventListener("click", () => {
      document.querySelectorAll("#uk-trend-toggle button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      ukState.trendDim = btn.dataset.mode;
      saveFilters();
      renderUKTrend();    // only the trend chart depends on these toggles
    })
  );

  // Monthly-trend value toggle (Actuals / MS%)
  document.querySelectorAll("#uk-trend-value-toggle button").forEach((btn) =>
    btn.addEventListener("click", () => {
      document.querySelectorAll("#uk-trend-value-toggle button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      ukState.trendValue = btn.dataset.mode;
      saveFilters();
      renderUKTrend();
    })
  );

  // MAT year-on-year dimension toggle (Brands / Products)
  document.querySelectorAll("#uk-mat-toggle button").forEach((btn) =>
    btn.addEventListener("click", () => {
      document.querySelectorAll("#uk-mat-toggle button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      ukState.matDim = btn.dataset.mode;
      saveFilters();
      renderUKMatYoY();  // only the MAT combo chart depends on these toggles
    })
  );

  // MAT year-on-year value toggle (Actuals / MS%)
  document.querySelectorAll("#uk-mat-value-toggle button").forEach((btn) =>
    btn.addEventListener("click", () => {
      document.querySelectorAll("#uk-mat-value-toggle button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      ukState.matValue = btn.dataset.mode;
      saveFilters();
      renderUKMatYoY();
    })
  );

  // Clear all: empty every UK slicer + reset the selects and the toggle
  $("uk-clear").addEventListener("click", () => {
    for (const k of UK_SLICERS) {
      SEL[k].clear();
      updateMselUI(k);
    }
    ukState.period = "mat";
    ukState.metric = "factored_units";
    ukState.catMode = "ms";
    ukState.trendDim = "brand";
    ukState.trendValue = "actual";
    ukState.matDim = "brand";
    ukState.matValue = "actual";
    $("uk-period").value = "mat";
    $("uk-metric").value = "factored_units";
    document.querySelectorAll("#uk-cat-toggle button")
      .forEach((b) => b.classList.toggle("active", b.dataset.mode === "ms"));
    document.querySelectorAll("#uk-trend-toggle button")
      .forEach((b) => b.classList.toggle("active", b.dataset.mode === "brand"));
    document.querySelectorAll("#uk-trend-value-toggle button")
      .forEach((b) => b.classList.toggle("active", b.dataset.mode === "actual"));
    document.querySelectorAll("#uk-mat-toggle button")
      .forEach((b) => b.classList.toggle("active", b.dataset.mode === "brand"));
    document.querySelectorAll("#uk-mat-value-toggle button")
      .forEach((b) => b.classList.toggle("active", b.dataset.mode === "actual"));
    renderUK();
  });
}
