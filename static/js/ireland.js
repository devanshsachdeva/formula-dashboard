/* ============================================================================
   ireland.js — everything on the IRELAND PERFORMANCE page (#/ireland)
   ----------------------------------------------------------------------------
   Mirrors uk.js, but reads DATA.ireland (built by the backend from
   data/Ireland Data.xlsx). Key differences from the UK page:
     - Geography: Province · County · Mini Brick (no NHS regions/ICBs/CCGs).
       The Mini Brick names have their numeric prefix stripped by the backend
       ("0001 1 LETTERKENNY" -> "LETTERKENNY"); the 4-digit prefix lives on
       as the row's `id`, which joins the Account Plan mapping.
     - Account Plan slicer (from data/Ireland Account Plans.xlsx — a dummy
       file is generated until the real mapping is provided).
     - NO HDM slicer: all of Ireland belongs to one HDM (Celine Jordan),
       enforced by the RLS gate, so a filter would be meaningless.
     - Metrics: Units (tins) and Value (€). The € value currently comes from
       the workbook's Euro RRP; once per-tin prices are provided the backend
       computes a corrected value column (IE_TIN_PRICES in process_data.py).
   ========================================================================== */

/* ---------------------------------------------------------------------------
   1. PAGE STATE
--------------------------------------------------------------------------- */
const ieState = {
  period: "mat",        // mat | qtr | ytd | all
  metric: "units",      // units (tins) | value (€)
  trendDim: "brand",    // brand | product | manufacturer
  trendValue: "actual", // actual | ms
  matDim: "brand",      // brand | product
  matValue: "actual",   // actual | ms
  leagueDim: "brand",   // League table: brand | product
};

// The slicer keys this page owns (SEL sets in shared.js, ms-… ids in HTML).
const IE_SLICERS = ["ieCategory", "ieManufacturer", "iebrand", "ieproduct", "ieprovince", "iecounty", "iebrick", "ieminibrick", "ieplan"];

// Which column of an Ireland row each slicer checks against.
const IE_FIELD = {
  ieCategory: "category",
  ieManufacturer: "manufacturer",
  iebrand: "brand",
  ieproduct: "product",
  ieprovince: "province",
  iecounty: "county",
  iebrick: "brick",
  ieminibrick: "mini_brick",
  ieplan: "account_plan",
};

// quick guard: is Ireland data present and visible under the current RLS?
function ieData() {
  return DATA && DATA.ireland ? DATA.ireland : null;
}

/* ---------------------------------------------------------------------------
   COLOUR RESOLUTION — keep products/brands/manufacturers on the report's
   scheme. Brands & manufacturers already resolve via the shared colorFor()
   (NUTRICIA purple, MJN blue, PEPTI/NEOCATE purples, PURAMINO cyan). Ireland
   product names (e.g. "APTAMIL PEPTI 1 POWDER 400G", "NUTRAMIGEN LGG") aren't
   in the global PRODUCT_COLORS map, so instead of falling back to random
   colours they inherit their BRAND's colour, spread across light→dark shades
   so tins of the same brand stay distinguishable but on-family.
--------------------------------------------------------------------------- */
let IE_PRODUCT_COLOR = new Map();

function _lightenHex(hex, amt) {
  const h = hex.replace("#", "");
  let r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  r = Math.round(r + (255 - r) * amt);
  g = Math.round(g + (255 - g) * amt);
  b = Math.round(b + (255 - b) * amt);
  return "#" + [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

function ieBuildProductColors() {
  const ie = ieData();
  IE_PRODUCT_COLOR = new Map();
  if (!ie) return;
  const prodBrand = new Map();
  for (const r of ie.performance) if (!prodBrand.has(r.product)) prodBrand.set(r.product, r.brand);
  const byBrand = new Map(); // brand -> sorted product list
  [...prodBrand.entries()].sort((a, b) => a[0].localeCompare(b[0])).forEach(([p, brand]) => {
    if (!byBrand.has(brand)) byBrand.set(brand, []);
    byBrand.get(brand).push(p);
  });
  for (const [brand, prods] of byBrand) {
    const base = BRAND_COLORS[brand] || "#64748b";
    const n = prods.length;
    prods.forEach((p, i) => {
      // an explicit global colour (e.g. NEOCATE LCP/SYNEO/JUNIOR) always wins
      const amt = n > 1 ? (i / (n - 1)) * 0.5 : 0; // 0 → base, up to 50% lighter
      IE_PRODUCT_COLOR.set(p, PRODUCT_COLORS[p] || _lightenHex(base, amt));
    });
  }
}

// Ireland-aware colour: products resolve to their brand-family shade; brands,
// manufacturers and categories defer to the shared scheme.
function ieColorFor(key, dim, i) {
  if (dim === "product") return IE_PRODUCT_COLOR.get(key) || colorFor(key, dim, i);
  return colorFor(key, dim, i);
}

/* ---------------------------------------------------------------------------
   2. TIME WINDOWS — same maths as ukWindows, on the Ireland month list
--------------------------------------------------------------------------- */
function ieWindows() {
  const months = ieData().meta.months;
  const lastN = (n) => months.slice(-n);
  const prevN = (n) => months.slice(-2 * n, -n);
  if (ieState.period === "qtr")
    return { cur: lastN(3), prev: prevN(3), label: "Rolling QTR", vs: "prior QTR" };
  if (ieState.period === "ytd") {
    const year = months[months.length - 1].slice(0, 4);
    const cur = months.filter((m) => m.startsWith(year));
    const prevYear = String(Number(year) - 1);
    const mm = new Set(cur.map((m) => m.slice(5, 7)));
    const prev = months.filter((m) => m.startsWith(prevYear) && mm.has(m.slice(5, 7)));
    return { cur, prev, label: "YTD " + year, vs: "YTD " + prevYear };
  }
  if (ieState.period === "all")
    return { cur: months, prev: [], label: "All data", vs: "" };
  return { cur: lastN(12), prev: prevN(12), label: "MAT", vs: "prior MAT" };
}

/* ---------------------------------------------------------------------------
   3. ROW FILTERING
--------------------------------------------------------------------------- */
function ieMatches(r, excludeKey) {
  for (const k of IE_SLICERS) {
    if (k === excludeKey) continue;
    if (SEL[k].size && !SEL[k].has(r[IE_FIELD[k]])) return false;
  }
  return true;
}

function ieRows(win) {
  const set = new Set(win);
  return ieData().performance.filter((r) => set.has(r.date) && ieMatches(r, null));
}

// MS% denominator: the whole market in scope — geography + account plan
// filters apply, but brand/manufacturer/product are IGNORED so a brand's
// share is measured against everything sold there (incl. ALL OTHER BABY
// MILKS), not against itself.
function ieMatchesMarket(r) {
  // geography + account plan + category define the market; brand/mfr/product
  // are ignored so a brand's share is measured against its whole category
  for (const k of ["ieCategory", "ieprovince", "iecounty", "iebrick", "ieminibrick", "ieplan"])
    if (SEL[k].size && !SEL[k].has(r[IE_FIELD[k]])) return false;
  return true;
}

/* ---------------------------------------------------------------------------
   4. SLICER CROSS-FILTERING — identical pattern to the other pages
--------------------------------------------------------------------------- */
let _ieLastSig = null;

function ieAvailableOptions(key) {
  const rows = ieData().performance.filter((r) => ieMatches(r, key));
  return [...new Set(rows.map((r) => r[IE_FIELD[key]]))];
}

function refreshIESlicers() {
  const sig = IE_SLICERS.map((k) => [...SEL[k]].sort().join(",")).join("|");
  if (sig === _ieLastSig) return;
  _ieLastSig = sig;
  const openPanel = document.querySelector(".msel-panel:not([hidden])");
  const openKey = openPanel ? openPanel.closest(".msel").id.replace("ms-", "") : null;
  for (const k of IE_SLICERS) {
    if (k === openKey) continue;
    setMselOptions(k, [...new Set([...ieAvailableOptions(k), ...SEL[k]])].sort());
  }
}

/* ---------------------------------------------------------------------------
   5. SMALL HELPERS
--------------------------------------------------------------------------- */
function ieScopeLabel() {
  const bits = [];
  for (const k of IE_SLICERS)
    if (SEL[k].size) bits.push([...SEL[k]].sort().join(" + "));
  return bits.length ? bits.join(" · ") : "all of Ireland";
}

function fmtMetricIE(n) {
  return (ieState.metric === "value" ? "€" : "") + fmtNum(n) +
    (ieState.metric === "units" ? " tins" : ieState.metric === "factored_units" ? " KGs" : "");
}

/* ---------------------------------------------------------------------------
   6. KPI CARDS — Volume (tins) / Value (€) fixed accents; Top manufacturer
   and Top brand follow the shared brand colour scheme. The OTHER bucket
   (ALL OTHER BABY MILKS) stays in the data as market context but is
   excluded from the "Top …" rankings — it isn't a real brand.
--------------------------------------------------------------------------- */
function renderIEKPIs(win, cur, prev) {
  const metric = ieState.metric;
  const sum = (rows, m) => rows.reduce((s, r) => s + r[m], 0);

  const volCur = sum(cur, "units"), volPrev = sum(prev, "units");
  const valCur = sum(cur, "value"), valPrev = sum(prev, "value");

  const ranked = (dim) =>
    [...sumBy(cur.filter((r) => r[dim] !== "OTHER"), (r) => r[dim], metric).entries()]
      .sort((a, b) => b[1] - a[1]);
  const total = sum(cur, metric); // incl. OTHER — the true market denominator
  const byMfr = ranked("manufacturer"), byBrand = ranked("brand");
  const topMfr = byMfr[0], topBrand = byBrand[0];

  $("ie-kpis").innerHTML = `
    <div class="card kpi">
      <span class="kpi-label">Volume — ${win.label}</span>
      <span class="kpi-value">${fmtNum(volCur)} tins</span>
      ${growthHTML(volCur, volPrev, win.vs)}
      <span class="kpi-sub">${esc(ieScopeLabel())}</span>
    </div>
    <div class="card kpi">
      <span class="kpi-label">Value — ${win.label}</span>
      <span class="kpi-value">€${fmtNum(valCur)}</span>
      ${growthHTML(valCur, valPrev, win.vs)}
      <span class="kpi-sub">${esc(ieScopeLabel())}</span>
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

  const cards = $("ie-kpis").querySelectorAll(".kpi");
  applyKpiAccent(cards[0], KPI_VOLUME_COLOR); // fixed teal (aggregate)
  applyKpiAccent(cards[1], KPI_VALUE_COLOR);  // fixed olive (aggregate)
  applyKpiAccent(cards[2], topMfr ? colorFor(topMfr[0], "manufacturer", 0) : null);
  applyKpiAccent(cards[3], topBrand ? colorFor(topBrand[0], "brand", 0) : null);
}

/* ---------------------------------------------------------------------------
   7. CHART: Volume by province — with the same auto ICB-style fallback the
   UK region chart has: when only ONE province is in scope, drop a level and
   show its counties instead of a single lonely bar.
--------------------------------------------------------------------------- */
function renderIERegion(win, cur, prev) {
  const metric = ieState.metric;

  const provCur = sumBy(cur, (r) => r.province, metric);
  const byCounty = provCur.size <= 1;
  const dimOf = (r) => (byCounty ? r.county : r.province);
  const curBy = byCounty ? sumBy(cur, (r) => r.county, metric) : provCur;
  const prevBy = sumBy(prev, dimOf, metric);
  const entries = [...curBy.entries()].sort((a, b) => b[1] - a[1]);

  const heading = $("ie-chart-region").closest(".card").querySelector("h2");
  if (heading) {
    const scopeNote = byCounty && provCur.size === 1 ? ` — ${esc([...provCur.keys()][0])}` : "";
    heading.innerHTML =
      (byCounty ? "Volume by county" : "Volume by province") +
      ` <span class="hint">(selected period, with growth vs comparison period${scopeNote})</span>`;
  }

  upsertChart("ie-chart-region", {
    type: "bar",
    data: {
      labels: entries.map(([k]) => k),
      datasets: [{
        data: entries.map(([, v]) => v),
        backgroundColor: "#4f46e5",
        borderRadius: 6,
        datalabels: {
          display: true, anchor: "end", align: "end", offset: 2, clamp: true,
          color: themeInk(), font: { size: 10, weight: "700" },
          formatter: (v) => fmtNum(v),
        },
      }],
    },
    options: {
      indexAxis: "y",
      responsive: true, maintainAspectRatio: false,
      layout: { padding: { right: 48 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (c) => {
              const key = entries[c.dataIndex][0];
              const p = prevBy.get(key) || 0;
              const g = p ? (((c.parsed.x - p) / p) * 100).toFixed(1) + "% vs " + win.vs : "no comparison";
              return ` ${fmtMetricIE(c.parsed.x)} (${g})`;
            },
          },
        },
      },
      scales: { x: { beginAtZero: true, ticks: { callback: (v) => fmtNum(v) } } },
    },
  });
}

/* ---------------------------------------------------------------------------
   8. CHART: Monthly trend — lines per brand / product / manufacturer,
   Actuals or MS% (share of the whole in-scope market per month).
--------------------------------------------------------------------------- */
function renderIETrend() {
  const metric = ieState.metric;
  const win = ieWindows();
  const months = win.cur;
  const dim = ieState.trendDim;
  const isMS = ieState.trendValue === "ms";
  const rows = ieRows(months);

  const keys = [...sumBy(rows, (r) => r[dim], metric).entries()]
    .sort((a, b) => b[1] - a[1]).map(([k]) => k);

  const cell = new Map();
  for (const r of rows)
    cell.set(r.date + " " + r[dim], (cell.get(r.date + " " + r[dim]) || 0) + r[metric]);

  const monthSet = new Set(months);
  const monthTotal = new Map();
  const denomRows = isMS
    ? ieData().performance.filter((r) => monthSet.has(r.date) && ieMatchesMarket(r))
    : rows;
  for (const r of denomRows)
    monthTotal.set(r.date, (monthTotal.get(r.date) || 0) + r[metric]);

  $("ie-trend-hint").textContent = isMS ? `(monthly ${dim} MS% of the in-scope market)` : "";

  upsertChart("ie-chart-trend", {
    type: "line",
    data: {
      labels: months.map(monthLabel),
      datasets: keys.map((k, i) => ({
        label: k,
        data: months.map((mo) => {
          const v = cell.get(mo + " " + k) || 0;
          if (!isMS) return v;
          const t = monthTotal.get(mo) || 0;
          return t ? (v / t) * 100 : 0;
        }),
        borderColor: ieColorFor(k, dim, i),
        backgroundColor: ieColorFor(k, dim, i),
        borderWidth: 2, tension: 0.3, pointRadius: 2.5,
        datalabels: {
          display: true, align: "top", offset: 2,
          color: ieColorFor(k, dim, i), font: { size: 8.5, weight: "600" },
          formatter: (v) => (isMS ? v.toFixed(0) + "%" : fmtNum(v)),
        },
      })),
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "bottom", labels: { boxWidth: 12, usePointStyle: true } },
        tooltip: {
          callbacks: {
            label: (c) =>
              ` ${c.dataset.label}: ` +
              (isMS ? "MS% " + c.parsed.y.toFixed(1) + "%" : fmtMetricIE(c.parsed.y)),
          },
        },
      },
      scales: {
        y: { beginAtZero: true, grace: "8%", ticks: { callback: (v) => (isMS ? v + "%" : fmtNum(v)) } },
        x: { grid: { display: false } },
      },
    },
  });
}

/* ---------------------------------------------------------------------------
   9. CHART: Top 15 bricks (selected period, horizontal bars)
--------------------------------------------------------------------------- */
function renderIEMiniBricks(win, cur) {
  const metric = ieState.metric;
  const by = [...sumBy(cur, (r) => r.brick, metric).entries()]
    .sort((a, b) => b[1] - a[1]).slice(0, 15);

  upsertChart("ie-chart-bricks", {
    type: "bar",
    data: {
      labels: by.map(([k]) => k),
      datasets: [{
        data: by.map(([, v]) => v),
        backgroundColor: "#4f46e5",
        borderRadius: 6,
        datalabels: {
          display: true, anchor: "end", align: "end", offset: 2, clamp: true,
          color: themeInk(), font: { size: 10, weight: "700" },
          formatter: (v) => fmtNum(v),
        },
      }],
    },
    options: {
      indexAxis: "y",
      responsive: true, maintainAspectRatio: false,
      layout: { padding: { right: 48 } },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (c) => ` ${fmtMetricIE(c.parsed.x)}` } },
      },
      scales: { x: { beginAtZero: true, ticks: { callback: (v) => fmtNum(v) } } },
    },
  });
}

/* ---------------------------------------------------------------------------
   10. CHART: MAT year-on-year — grouped PY/CY bars per brand or product with
   the report-wide orange growth line (same conventions as the UK chart).
--------------------------------------------------------------------------- */
function renderIEMatYoY() {
  const metric = ieState.metric;
  const isMS = ieState.matValue === "ms";
  const dim = ieState.matDim;
  const months = ieData().meta.months;
  const cy = months.slice(-12);
  const py = months.slice(-24, -12);
  const cySet = new Set(cy), pySet = new Set(py);

  const cyRows = ieData().performance.filter((r) => cySet.has(r.date) && ieMatches(r, null));
  const pyRows = ieData().performance.filter((r) => pySet.has(r.date) && ieMatches(r, null));
  const cyBy = sumBy(cyRows, (r) => r[dim], metric);
  const pyBy = sumBy(pyRows, (r) => r[dim], metric);

  const marketTotal = (set) =>
    ieData().performance.filter((r) => set.has(r.date) && ieMatchesMarket(r))
      .reduce((s, r) => s + r[metric], 0);
  const cyMarket = isMS ? marketTotal(cySet) : 0;
  const pyMarket = isMS ? marketTotal(pySet) : 0;

  const keys = [...new Set([...cyBy.keys(), ...pyBy.keys()])]
    .sort((a, b) => (cyBy.get(b) || 0) - (cyBy.get(a) || 0));

  const cyVal = (k) => (isMS ? (cyMarket ? ((cyBy.get(k) || 0) / cyMarket) * 100 : 0) : (cyBy.get(k) || 0));
  const pyVal = (k) => (isMS ? (pyMarket ? ((pyBy.get(k) || 0) / pyMarket) * 100 : 0) : (pyBy.get(k) || 0));
  const totalPY = [...pyBy.values()].reduce((s, v) => s + v, 0);
  const growth = (k) => {
    if (isMS) return cyVal(k) - pyVal(k);
    const p = pyBy.get(k) || 0;
    if (!p || p < totalPY * 0.005) return null;
    return (((cyBy.get(k) || 0) - p) / p) * 100;
  };
  const fewKeys = keys.length <= 8;
  const barLabel = (color, weight) => ({
    display: true,
    anchor: "end", align: "top", offset: 1, color,
    font: { size: fewKeys ? 9 : 8, weight },
    rotation: fewKeys ? 0 : -90,
    formatter: (v) => (isMS ? v.toFixed(1) + "%" : fmtNum(v)),
  });

  $("ie-mat-hint").textContent =
    `— MAT CY (${monthLabel(cy[0])}–${monthLabel(cy[cy.length - 1])}) vs ` +
    `MAT PY (${monthLabel(py[0])}–${monthLabel(py[py.length - 1])}), ` +
    (isMS ? "bars = market share %, line = Δ share %" : "bars = volume, line = growth %");

  upsertChart("ie-chart-mat", {
    type: "bar",
    data: {
      labels: keys,
      datasets: [
        {
          type: "bar", label: "MAT PY", yAxisID: "y", order: 3,
          data: keys.map(pyVal), borderRadius: 6,
          backgroundColor: keys.map((k, i) => withAlpha(ieColorFor(k, dim, i), 0.4)),
          datalabels: barLabel(themeInkSoft(), "600"),
        },
        {
          type: "bar", label: "MAT CY", yAxisID: "y", order: 3,
          data: keys.map(cyVal), borderRadius: 6,
          backgroundColor: keys.map((k, i) => ieColorFor(k, dim, i)),
          datalabels: barLabel(themeInk(), "700"),
        },
        {
          type: "line", label: "Growth (%)", yAxisID: "y1", order: 1,
          data: keys.map(growth), borderColor: GROWTH_COLOR, backgroundColor: GROWTH_COLOR,
          borderWidth: 2, tension: 0.3, pointRadius: 3, pointHoverRadius: 5, spanGaps: false,
          datalabels: {
            display: true,
            align: "top", offset: 4, color: growthLabelColor(), font: { size: 9, weight: "700" },
            formatter: (v) => (v == null ? null : (v >= 0 ? "+" : "") + v.toFixed(1) + "%"),
          },
        },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      layout: { padding: { top: 18 } },
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          position: "bottom",
          labels: {
            boxWidth: 12, usePointStyle: true,
            generateLabels: (chart) => [
              { text: "MAT PY (faded)", fillStyle: "rgba(100,116,139,0.4)", strokeStyle: "rgba(100,116,139,0.4)", pointStyle: "rect", datasetIndex: 0, hidden: !chart.isDatasetVisible(0) },
              { text: "MAT CY (solid)", fillStyle: themeInkSoft(), strokeStyle: themeInkSoft(), pointStyle: "rect", datasetIndex: 1, hidden: !chart.isDatasetVisible(1) },
              { text: "Growth (%)", fillStyle: GROWTH_COLOR, strokeStyle: GROWTH_COLOR, pointStyle: "line", datasetIndex: 2, hidden: !chart.isDatasetVisible(2) },
            ],
          },
        },
        tooltip: {
          callbacks: {
            label: (c) => {
              if (c.dataset.type === "line")
                return ` Growth: ${c.parsed.y == null ? "n/a" : (c.parsed.y >= 0 ? "+" : "") + c.parsed.y.toFixed(1) + "%"}`;
              return ` ${c.dataset.label}: ${isMS ? c.parsed.y.toFixed(1) + "%" : fmtMetricIE(c.parsed.y)}`;
            },
          },
        },
      },
      scales: {
        y: { beginAtZero: true, position: "left",
             title: { display: true, text: isMS ? "Market share" : "Volume" },
             ticks: { callback: (v) => (isMS ? v + "%" : fmtNum(v)) } },
        y1: { position: "right", grid: { drawOnChartArea: false },
              title: { display: true, text: "Growth (%)" },
              ticks: { callback: (v) => (v >= 0 ? "+" : "") + v + "%" } },
        x: { grid: { display: false },
             ticks: { maxRotation: 45, minRotation: 0, autoSkip: false, font: { size: 10 } } },
      },
    },
  });
}

/* ---------------------------------------------------------------------------
   11. TABLE: league — Brands or Products (switch), with volume / growth / MS%
--------------------------------------------------------------------------- */
function renderIEProductTable(win, cur, prev) {
  const metric = ieState.metric;
  const byProduct = ieState.leagueDim === "product";
  const dim = byProduct ? "product" : "brand";

  // headers follow the Brands / Products switch
  $("ie-league-head").innerHTML = byProduct
    ? `<th>Product</th><th>Brand</th><th>Manufacturer</th>
       <th class="num">Volume</th><th class="num">&Delta; vs prior</th>
       <th class="num">MS%</th><th class="num">&Delta; MS%</th>`
    : `<th>Brand</th><th>Manufacturer</th>
       <th class="num">Volume</th><th class="num">&Delta; vs prior</th>
       <th class="num">MS%</th><th class="num">&Delta; MS%</th>`;

  const meta = new Map(); // dim key -> row sample (for brand/manufacturer)
  for (const r of cur) if (!meta.has(r[dim])) meta.set(r[dim], r);

  const curBy = sumBy(cur, (r) => r[dim], metric);
  const prevBy = sumBy(prev, (r) => r[dim], metric);
  const curTotal = [...curBy.values()].reduce((s, v) => s + v, 0);
  const prevTotal = [...prevBy.values()].reduce((s, v) => s + v, 0);

  const rows = [...curBy.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => {
    const pv = prevBy.get(k) || 0;
    const ms = curTotal ? (v / curTotal) * 100 : 0;
    const pms = prevTotal ? (pv / prevTotal) * 100 : 0;
    return { k, v, pv, ms, dms: ms - pms };
  });

  const arrow = (x) =>
    x > 0.05 ? `<span class="growth up">▲ +${x.toFixed(1)}%</span>`
    : x < -0.05 ? `<span class="growth down">▼ ${x.toFixed(1)}%</span>`
    : `<span class="growth flat">▬ 0.0%</span>`;

  $("ie-product-table").querySelector("tbody").innerHTML = rows.map((r) => {
    const m = meta.get(r.k) || {};
    const growthPct = r.pv ? ((r.v - r.pv) / r.pv) * 100 : null;
    const mid = byProduct
      ? `<td><span style="color:${colorFor(m.brand, "brand", 0)};font-weight:700">${esc(m.brand || "")}</span></td>
         <td>${esc(m.manufacturer || "")}</td>`
      : `<td>${esc(m.manufacturer || "")}</td>`;
    return `<tr>
      <td><strong>${esc(r.k)}</strong></td>
      ${mid}
      <td class="num">${fmtMetricIE(r.v)}</td>
      <td class="num">${growthPct == null ? '<span class="growth flat">n/a</span>' : arrow(growthPct)}</td>
      <td class="num"><strong>${r.ms.toFixed(1)}%</strong></td>
      <td class="num">${arrow(r.dms)}</td>
    </tr>`;
  }).join("");
}

/* ---------------------------------------------------------------------------
   12. MASTER RENDER
--------------------------------------------------------------------------- */
function renderIreland() {
  const placeholder = $("ie-placeholder");
  const main = $("ie-main");
  if (!placeholder || !main) return;
  const ie = DATA ? DATA.ireland : null;
  placeholder.hidden = !!ie;
  main.hidden = !ie;
  if (!ie) {
    $("ie-placeholder-msg").innerHTML = RLS_HDM
      ? "Ireland is outside your access scope — it belongs to " +
        "<strong>Celine Jordan</strong>. Switch access via the badge in the header."
      : "Drop <strong>Ireland Data.xlsx</strong> into the data folder to light this page up.";
    return;
  }
  saveFilters();
  ieBuildProductColors();   // product→brand-family colours for this dataset
  refreshIESlicers();
  const win = ieWindows();
  const cur = ieRows(win.cur);
  const prev = ieRows(win.prev);
  let caption =
    `${win.label}: ${windowLabel(win.cur)}` +
    (win.prev.length ? `  ·  compared with ${win.vs}: ${windowLabel(win.prev)}` : "");
  // KGs is derived from tins × tin weight; warn if some tin sizes are unknown
  if (ieState.metric === "factored_units" && ie.kg_unknown && ie.kg_unknown.length) {
    caption += `  ·  ⚠ KGs excludes products with no confirmed tin size: ${ie.kg_unknown.join(", ")}`;
  }
  $("ie-caption").textContent = caption;
  renderIEKPIs(win, cur, prev);
  renderIERegion(win, cur, prev);
  renderIETrend();
  renderIEMiniBricks(win, cur);
  renderIEMatYoY();
  renderIEProductTable(win, cur, prev);
}

/* ---------------------------------------------------------------------------
   13. ONE-TIME SETUP — called from main.js once the data has loaded
--------------------------------------------------------------------------- */
function setupIreland() {
  const ie = DATA ? DATA.ireland : null;
  if (ie) {
    setMselOptions("ieCategory", ie.meta.categories);
    setMselOptions("ieManufacturer", ie.meta.manufacturers);
    setMselOptions("iebrand", ie.meta.brands);
    setMselOptions("ieproduct", ie.meta.products);
    setMselOptions("ieprovince", ie.meta.provinces);
    setMselOptions("iecounty", ie.meta.counties);
    setMselOptions("iebrick", ie.meta.bricks);
    setMselOptions("ieminibrick", ie.meta.mini_bricks);
    setMselOptions("ieplan", ie.meta.account_plans);
  }

  for (const [id, key] of [["ie-period", "period"], ["ie-metric", "metric"]]) {
    $(id).addEventListener("change", () => {
      ieState[key] = $(id).value;
      renderIreland();
    });
  }

  document.querySelectorAll("#ie-trend-toggle button").forEach((btn) =>
    btn.addEventListener("click", () => {
      document.querySelectorAll("#ie-trend-toggle button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      ieState.trendDim = btn.dataset.mode;
      saveFilters();
      renderIETrend();
    })
  );

  document.querySelectorAll("#ie-trend-value-toggle button").forEach((btn) =>
    btn.addEventListener("click", () => {
      document.querySelectorAll("#ie-trend-value-toggle button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      ieState.trendValue = btn.dataset.mode;
      saveFilters();
      renderIETrend();
    })
  );

  document.querySelectorAll("#ie-mat-toggle button").forEach((btn) =>
    btn.addEventListener("click", () => {
      document.querySelectorAll("#ie-mat-toggle button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      ieState.matDim = btn.dataset.mode;
      saveFilters();
      renderIEMatYoY();
    })
  );

  document.querySelectorAll("#ie-mat-value-toggle button").forEach((btn) =>
    btn.addEventListener("click", () => {
      document.querySelectorAll("#ie-mat-value-toggle button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      ieState.matValue = btn.dataset.mode;
      saveFilters();
      renderIEMatYoY();
    })
  );

  document.querySelectorAll("#ie-league-toggle button").forEach((btn) =>
    btn.addEventListener("click", () => {
      document.querySelectorAll("#ie-league-toggle button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      ieState.leagueDim = btn.dataset.mode;
      saveFilters();
      const win = ieWindows();
      renderIEProductTable(win, ieRows(win.cur), ieRows(win.prev));
    })
  );

  $("ie-clear").addEventListener("click", () => {
    for (const k of IE_SLICERS) {
      SEL[k].clear();
      updateMselUI(k);
    }
    ieState.period = "mat";
    ieState.metric = "units";
    ieState.trendDim = "brand";
    ieState.trendValue = "actual";
    ieState.matDim = "brand";
    ieState.matValue = "actual";
    ieState.leagueDim = "brand";
    $("ie-period").value = "mat";
    $("ie-metric").value = "units";
    document.querySelectorAll("#ie-trend-toggle button")
      .forEach((b) => b.classList.toggle("active", b.dataset.mode === "brand"));
    document.querySelectorAll("#ie-trend-value-toggle button")
      .forEach((b) => b.classList.toggle("active", b.dataset.mode === "actual"));
    document.querySelectorAll("#ie-mat-toggle button")
      .forEach((b) => b.classList.toggle("active", b.dataset.mode === "brand"));
    document.querySelectorAll("#ie-mat-value-toggle button")
      .forEach((b) => b.classList.toggle("active", b.dataset.mode === "actual"));
    document.querySelectorAll("#ie-league-toggle button")
      .forEach((b) => b.classList.toggle("active", b.dataset.mode === "brand"));
    renderIreland();
  });
}
