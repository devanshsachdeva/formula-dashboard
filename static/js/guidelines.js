/* ============================================================================
   guidelines.js — everything on the GUIDELINES page (#/guidelines)
   ----------------------------------------------------------------------------
   Sections in this file, top to bottom:
   1. CROSS-FILTERING  — each slicer's option list is recomputed from what
                         the OTHER slicers allow (Power-BI style).
   2. PERIOD WINDOWS   — turns "MAT / QTR / YTD / Custom" into two lists of
                         months: the current window and the comparison window.
   3. ROW FILTERING    — rowsFor() picks the performance rows that match the
                         current slicers + period.
   4. KPI CARDS        — the EHF/AAF/RICE cards with growth and top-brand MS%.
   5. CHARTS           — upsertChart() (create-or-replace a Chart.js chart),
                         the interval-band + marker plugins, point labels,
                         monthly trend, category MS% bars, donuts, top ICBs,
                         first-line exclusive trend, exclusive table.
                         NOTE: upsertChart() and pointLabels() are defined
                         here but the UK page uses them too.
   6. CHANGE TRACKER   — version history, interval performance, explorer.
   7. GUIDELINES TABLE — the sortable/searchable register.
   8. PERSISTENCE      — saves every filter to localStorage so a page reload
                         puts you back where you were.
   9. SETUP + RENDER   — wires all the controls once, and render() redraws
                         every component when anything changes.
   ========================================================================== */
// ---------- slicer cross-filtering ----------
// Every slicer constrains the others: a slicer's available options are the
// values still reachable under all the OTHER slicers' current selections
// (its own selection is ignored so you can always widen it). Selected values
// are never pruned, so choices stick even if they'd yield no rows.

const ALL_SLICERS = ["category", "region", "icb", "ccg", "manufacturer", "brand", "hdm"];
let _lastSelSig = null;

function selSignature() {
  return ALL_SLICERS.map((k) => [...SEL[k]].sort().join(",")).join("|");
}

/** Performance rows matching every slicer EXCEPT `excludeKey`. */
function rowsMatching(excludeKey) {
  const useHdm = excludeKey !== "hdm" && SEL.hdm.size;
  const hu = useHdm ? hdmICBUnion() : null;
  return DATA.performance.filter(
    (r) =>
      (excludeKey === "category" || !SEL.category.size || SEL.category.has(r.category)) &&
      (excludeKey === "region" || !SEL.region.size || SEL.region.has(r.region)) &&
      (excludeKey === "icb" || !SEL.icb.size || SEL.icb.has(r.icb)) &&
      (excludeKey === "ccg" || !SEL.ccg.size || SEL.ccg.has(r.ccg)) &&
      (excludeKey === "manufacturer" || !SEL.manufacturer.size || SEL.manufacturer.has(r.manufacturer)) &&
      (excludeKey === "brand" || !SEL.brand.size || SEL.brand.has(r.brand)) &&
      (!hu || hu.has(r.icb))
  );
}

function availableOptions(key) {
  const rows = rowsMatching(key);
  if (key === "hdm") {
    const icbs = new Set(rows.map((r) => r.icb));
    return [...HDM_ICBS.keys()].filter((h) => {
      for (const i of HDM_ICBS.get(h)) if (icbs.has(i)) return true;
      return false;
    });
  }
  return [...new Set(rows.map((r) => r[key]))];
}

/** Rebuild every slicer's option list from the current cross-filter, unless
 *  nothing changed. Skips the panel the user currently has open (its own
 *  option list doesn't depend on its own selection, so it can't be stale). */
function refreshSlicersIfChanged() {
  const sig = selSignature();
  if (sig === _lastSelSig) return;
  _lastSelSig = sig;
  const openPanel = document.querySelector(".msel-panel:not([hidden])");
  const openKey = openPanel ? openPanel.closest(".msel").id.replace("ms-", "") : null;
  for (const key of ALL_SLICERS) {
    if (key === openKey) continue;
    const avail = availableOptions(key);
    // union with current selection so a chosen value is never pruned
    setMselOptions(key, [...new Set([...avail, ...SEL[key]])].sort());
  }
}

/** Select exactly one ICB (drill-down) or clear if it is already the sole selection. */
function drillToICB(icb) {
  if (SEL.icb.size === 1 && SEL.icb.has(icb)) SEL.icb.clear();
  else {
    SEL.icb.clear();
    SEL.icb.add(icb);
  }
  updateMselUI("icb");
  render();
}

// ---------- period windows (MAT / Rolling QTR / YTD) ----------

function periodWindows() {
  const months = DATA.meta.months; // sorted ascending
  const mode = singles.period();
  const latest = months[months.length - 1];

  const lastN = (n) => months.slice(-n);
  const prevN = (n) => months.slice(-2 * n, -n);

  if (mode === "mat") return { cur: lastN(12), prev: prevN(12), label: "MAT", vs: "prior MAT" };
  if (mode === "qtr") return { cur: lastN(3), prev: prevN(3), label: "Rolling QTR", vs: "prior QTR" };
  if (mode === "ytd") {
    const year = latest.slice(0, 4);
    const cur = months.filter((m) => m.startsWith(year));
    const prevYear = String(Number(year) - 1);
    const curMM = new Set(cur.map((m) => m.slice(5, 7)));
    const prev = months.filter((m) => m.startsWith(prevYear) && curMM.has(m.slice(5, 7)));
    return { cur, prev, label: "YTD " + year, vs: "YTD " + prevYear };
  }
  if (mode === "custom") {
    const from = $("f-from").value, to = $("f-to").value;
    const cur = months.filter((m) => m >= from && m <= to);
    const start = months.indexOf(cur[0]);
    const prev = start > 0 ? months.slice(Math.max(0, start - cur.length), start) : [];
    return { cur, prev, label: "Custom", vs: "preceding period" };
  }
  return { cur: months, prev: [], label: "All data", vs: "" };
}

function windowLabel(win) {
  if (!win.length) return "no data";
  return monthLabel(win[0]) + " – " + monthLabel(win[win.length - 1]);
}

// ---------- filtering ----------

function rowsFor(win, { ignoreCategory = false, ignoreBrandDims = false } = {}) {
  const set = new Set(win);
  const hu = hdmICBUnion();
  return DATA.performance.filter(
    (r) =>
      set.has(r.date) &&
      (!SEL.region.size || SEL.region.has(r.region)) &&
      (!SEL.icb.size || SEL.icb.has(r.icb)) &&
      (!SEL.ccg.size || SEL.ccg.has(r.ccg)) &&
      (!hu || hu.has(r.icb)) &&
      (ignoreCategory || !SEL.category.size || SEL.category.has(r.category)) &&
      (ignoreBrandDims ||
        ((!SEL.manufacturer.size || SEL.manufacturer.has(r.manufacturer)) &&
          (!SEL.brand.size || SEL.brand.has(r.brand))))
  );
}

// ---------- per-category KPI cards ----------

function renderCatCards(win) {
  const metric = singles.metric();
  const cur = rowsFor(win.cur, { ignoreCategory: true });
  const prev = rowsFor(win.prev, { ignoreCategory: true });
  // MS% denominator: whole category market, ignoring brand/manufacturer filters
  const curMarket = rowsFor(win.cur, { ignoreCategory: true, ignoreBrandDims: true });

  $("period-caption").textContent =
    `${win.label}: ${windowLabel(win.cur)}` +
    (win.prev.length ? `  ·  compared with ${win.vs}: ${windowLabel(win.prev)}` : "");

  const container = $("cat-cards");
  container.querySelectorAll(".cat-card").forEach((el) => el.remove());
  const glCard = container.querySelector(".gl-kpi");

  const catOrder = ["EHF", "AAF", "RICE"].filter((c) => DATA.meta.categories.includes(c))
    .concat(DATA.meta.categories.filter((c) => !["EHF", "AAF", "RICE"].includes(c)));

  for (const cat of catOrder) {
    const curRows = cur.filter((r) => r.category === cat);
    const prevRows = prev.filter((r) => r.category === cat);
    const curTotal = curRows.reduce((s, r) => s + r[metric], 0);
    const prevTotal = prevRows.reduce((s, r) => s + r[metric], 0);

    const byBrand = [...sumBy(curRows, (r) => r.brand, metric).entries()].sort((a, b) => b[1] - a[1]);
    const top = byBrand[0];
    const marketTotal = curMarket
      .filter((r) => r.category === cat)
      .reduce((s, r) => s + r[metric], 0);
    const ms = top && marketTotal ? ((top[1] / marketTotal) * 100).toFixed(1) : null;
    const active = SEL.category.has(cat);

    const card = document.createElement("div");
    card.className = "card kpi cat-card" + (active ? " active" : "");
    // top colour shade auto-follows the category's LEADING brand (MJN-blue,
    // Nutricia-purple, Nestlé-pink…), falling back to the category colour.
    const accent = top ? colorFor(top[0], "brand", 0) : (CAT_COLORS[cat] || "#94a3b8");
    applyKpiAccent(card, accent);
    card.innerHTML = `
      ${active ? `<button class="card-clear" title="Clear ${cat} filter">&times;</button>` : ""}
      <span class="kpi-label">${cat} — ${win.label}</span>
      <span class="kpi-value">${fmtMetric(curTotal)}</span>
      ${growthHTML(curTotal, prevTotal, win.vs)}
      <span class="kpi-sub">${top ? `Top brand: ${top[0]} — MS% ${ms}%` : "no data"}</span>`;
    card.title = `Click to ${active ? "remove" : "add"} ${cat} ${active ? "from" : "to"} the category filter (multi-select)`;
    card.addEventListener("click", () => {
      if (SEL.category.has(cat)) SEL.category.delete(cat);
      else SEL.category.add(cat);
      render();
    });
    const clearBtn = card.querySelector(".card-clear");
    if (clearBtn)
      clearBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        SEL.category.delete(cat);
        render();
      });
    container.insertBefore(card, glCard);
  }

  // guideline changes card
  const icbs = visibleICBs();
  const curSet = new Set(win.cur.map((m) => m.slice(0, 7)));
  const changed = DATA.guidelines.filter(
    (g) => icbs.has(g.ICB) && g.latest_published && curSet.has(g.latest_published.slice(0, 7))
  );
  const today = new Date().toISOString().slice(0, 10);
  const overdue = DATA.guidelines.filter(
    (g) => icbs.has(g.ICB) && g.next_review && g.next_review < today && g.next_review < FAR_FUTURE
  );
  $("kpi-gl-changes").textContent = changed.length;
  $("kpi-gl-changes-sub").textContent = `guidelines published in ${win.label}`;
  $("kpi-gl-overdue").textContent = overdue.length + " reviews overdue";
}

// ---------- charts ----------

function upsertChart(id, config) {
  if (charts[id]) {
    charts[id].destroy();
    delete charts[id];
  }
  charts[id] = new Chart($(id).getContext("2d"), config);
  ensureCopyButton(id); // every visual gets a copy-as-image button
}

/** Guideline state active for an ICB at a given date (from the history log,
 *  falling back to the current workbook state). */
function activeStateFor(icb, dateISO) {
  const versions = DATA.gl_history?.[icb] || [];
  let state = versions.length ? versions[0].state : null;
  for (const v of versions) if (v.effective_date <= dateISO) state = v.state;
  if (!state) {
    const g = DATA.guidelines.find((x) => x.ICB === icb);
    state = g
      ? { ehf_gl: g.ehf_gl, ehf_first: g.ehf_first, aaf_gl: g.aaf_gl, aaf_first: g.aaf_first }
      : {};
  }
  return state;
}

/** Shaded guideline-interval bands for a months window, labelled with the
 *  exclusive / 1st-line product of the category the visuals follow. */
function bandsFor(icb, months, cat = explorerCategory()) {
  if (!icb || !months.length) return [];
  const last = months[months.length - 1];
  const bands = [];
  trackerIntervals(icb).forEach((iv, i) => {
    const s = iv.start < months[0] ? months[0] : iv.start;
    if ((iv.end && iv.end <= months[0]) || s > last) return; // outside window
    const startIdx = months.indexOf(s);
    if (startIdx < 0) return;
    const endIdx = iv.end ? (months.indexOf(iv.end) >= 0 ? months.indexOf(iv.end) : null) : null;
    const st = activeStateFor(icb, iv.start);
    const gl =
      cat === "EHF" ? [st.ehf_gl, st.ehf_first]
      : cat === "AAF" ? [st.aaf_gl, st.aaf_first]
      : [];
    bands.push({
      startIdx,
      endIdx,
      shade: i % 2,
      label: gl[0] ? `${cat} ${gl[0]}: ${gl[1] || "—"}` : cat === "RICE" ? "no GL for RICE" : "",
    });
  });
  return bands;
}

/* shaded background bands per guideline interval, product label at the top */
const intervalBandsPlugin = {
  id: "intervalBands",
  beforeDatasetsDraw(chart, _args, opts) {
    const bands = opts.bands || [];
    if (!bands.length) return;
    const { ctx, chartArea, scales } = chart;
    const px = (i) => scales.x.getPixelForValue(i);
    ctx.save();
    for (const b of bands) {
      const x0 = b.startIdx <= 0 ? chartArea.left : (px(b.startIdx - 1) + px(b.startIdx)) / 2;
      const x1 = b.endIdx == null ? chartArea.right : (px(b.endIdx - 1) + px(b.endIdx)) / 2;
      ctx.fillStyle = b.shade ? "rgba(37, 99, 235, 0.10)" : "rgba(37, 99, 235, 0.035)";
      ctx.fillRect(x0, chartArea.top, x1 - x0, chartArea.bottom - chartArea.top);
      if (b.startIdx > 0) {
        ctx.strokeStyle = "rgba(37, 99, 235, 0.45)";
        ctx.setLineDash([4, 3]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x0, chartArea.top);
        ctx.lineTo(x0, chartArea.bottom);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (b.label) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x0 + 2, chartArea.top, x1 - x0 - 4, 26);
        ctx.clip();
        ctx.fillStyle = "#1e40af";
        ctx.font = "700 10px -apple-system, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(b.label, (x0 + x1) / 2, chartArea.top + 14);
        ctx.restore();
      }
    }
    ctx.restore();
  },
};

/* per-point value labels for line charts */
function pointLabels(color, isMS) {
  return {
    display: (c) => (c.dataset.data[c.dataIndex] || 0) > 0,
    align: "top",
    offset: 2,
    clamp: true,
    color,
    font: { size: 9, weight: "600" },
    formatter: (v) => (isMS ? v.toFixed(0) + "%" : fmtNum(v)),
  };
}

/* vertical dashed markers for guideline publications/changes/events */
const glMarkerPlugin = {
  id: "glMarkers",
  afterDatasetsDraw(chart, _args, opts) {
    const marks = opts.marks || [];
    if (!marks.length) return;
    const { ctx, chartArea, scales } = chart;
    ctx.save();
    for (const m of marks) {
      const x = scales.x.getPixelForValue(m.index);
      ctx.strokeStyle = "#be185d";
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, chartArea.top);
      ctx.lineTo(x, chartArea.bottom);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#be185d";
      ctx.font = "600 10px sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(m.label, x + 4, chartArea.top + 10);
    }
    ctx.restore();
  },
};

function glMarksFor(months, icb = singleICB()) {
  if (!icb) return [];
  const monthIdx = new Map(months.map((m, i) => [m.slice(0, 7), i]));
  const marks = [];
  const seen = new Set();
  for (const g of DATA.gl_detail) {
    if (g.ICB !== icb || !g["Latest Published Date"]) continue;
    const ym = g["Latest Published Date"].slice(0, 7);
    if (seen.has(ym) || !monthIdx.has(ym)) continue;
    seen.add(ym);
    marks.push({ index: monthIdx.get(ym), label: "GL published" });
  }
  for (const v of DATA.gl_history?.[icb] || []) {
    if (!v.changes.length) continue;
    const ym = v.effective_date.slice(0, 7);
    if (seen.has(ym) || !monthIdx.has(ym)) continue;
    seen.add(ym);
    marks.push({ index: monthIdx.get(ym), label: "GL changed" });
  }
  for (const e of DATA.gl_events || []) {
    if (e.icb !== icb) continue;
    const ym = e.date.slice(0, 7);
    if (seen.has(ym) || !monthIdx.has(ym)) continue;
    seen.add(ym);
    marks.push({ index: monthIdx.get(ym), label: "Event" });
  }
  return marks;
}

function renderTrend(rows, win) {
  const metric = singles.metric();
  const months = win.cur;
  const isMS = trendValue === "ms";
  const dimMode = trendDim;
  const keyFn = (r) => r[dimMode];
  const keys = [...sumBy(rows, keyFn, metric).entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k);

  const cell = new Map();
  for (const r of rows) {
    const k = r.date + " " + keyFn(r);
    cell.set(k, (cell.get(k) || 0) + r[metric]);
  }
  // MS% denominator = the whole market in scope (region/ICB/HDM/category/period),
  // ignoring brand & manufacturer filters — so filtering to one brand shows its
  // true share instead of a flat 100% of itself.
  const monthTotal = new Map();
  const denomRows = isMS ? rowsFor(win.cur, { ignoreBrandDims: true }) : rows;
  for (const r of denomRows)
    monthTotal.set(r.date, (monthTotal.get(r.date) || 0) + r[metric]);

  const datasets = keys.map((k, i) => ({
    label: k,
    data: months.map((m) => {
      const v = cell.get(m + " " + k) || 0;
      if (!isMS) return v;
      const t = monthTotal.get(m) || 0;
      return t ? (v / t) * 100 : 0;
    }),
    backgroundColor: colorFor(k, dimMode, i),
    borderColor: colorFor(k, dimMode, i),
    fill: false,
    tension: 0.25,
    pointRadius: 0,
    pointHitRadius: 8,
    borderWidth: 2,
    datalabels: pointLabels(colorFor(k, dimMode, i), isMS),
  }));

  const selIcb = singleICB();
  $("trend-hint").textContent =
    (isMS ? `(monthly ${dimMode} MS% of ${catLabel()})` : "") +
    (selIcb ? " — shaded bands = guideline intervals" : "");

  upsertChart("chart-trend", {
    type: "line",
    data: { labels: months.map(monthLabel), datasets },
    plugins: [intervalBandsPlugin, glMarkerPlugin],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 14 } },
      interaction: { mode: "index", intersect: false },
      plugins: {
        intervalBands: { bands: bandsFor(selIcb, months) },
        glMarkers: { marks: glMarksFor(months) },
        legend: { position: "bottom", labels: { boxWidth: 12, usePointStyle: true } },
        tooltip: {
          callbacks: {
            label: (c) =>
              ` ${c.dataset.label}: ` +
              (isMS ? "MS% " + c.parsed.y.toFixed(1) + "%" : fmtMetric(c.parsed.y)),
          },
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          grace: "8%", // headroom so point labels don't clip; max auto-fits the data
          ticks: { callback: (v) => (isMS ? v + "%" : fmtMetric(v)) },
        },
        x: { grid: { display: false } },
      },
    },
  });
}

function msDatalabels(minPct) {
  return {
    display: (ctx) => ctx.dataset.data[ctx.dataIndex] >= minPct,
    color: "#fff",
    font: { weight: "700", size: 10 },
    formatter: (v) => v.toFixed(1) + "%",
  };
}

function renderCatMS(win) {
  // 100% stacked horizontal bars: brand MS% within each category (ignores category cards)
  const metric = singles.metric();
  const rows = rowsFor(win.cur, { ignoreCategory: true });
  const cats = DATA.meta.categories;
  const brands = [...sumBy(rows, (r) => r.brand, metric).entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k);

  const totals = new Map();
  const cell = new Map();
  for (const r of rows) {
    totals.set(r.category, (totals.get(r.category) || 0) + r[metric]);
    const k = r.category + " " + r.brand;
    cell.set(k, (cell.get(k) || 0) + r[metric]);
  }

  const datasets = brands.map((b, i) => ({
    label: b,
    data: cats.map((c) => {
      const t = totals.get(c) || 0;
      return t ? ((cell.get(c + " " + b) || 0) / t) * 100 : 0;
    }),
    backgroundColor: colorFor(b, "brand", i),
    datalabels: msDatalabels(5),
  }));

  upsertChart("chart-cat-ms", {
    type: "bar",
    data: { labels: cats, datasets },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom", labels: { boxWidth: 12, usePointStyle: true } },
        tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: MS% ${c.parsed.x.toFixed(1)}%` } },
      },
      scales: {
        x: { stacked: true, max: 100, ticks: { callback: (v) => v + "%" } },
        y: { stacked: true, grid: { display: false } },
      },
    },
  });
}

function renderDonut(id, rows, keyProp, colorMode) {
  const metric = singles.metric();
  const entries = [...sumBy(rows, (r) => r[keyProp], metric).entries()].sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, v]) => s + v, 0);
  upsertChart(id, {
    type: "doughnut",
    data: {
      labels: entries.map(([k]) => k),
      datasets: [
        {
          data: entries.map(([, v]) => v),
          backgroundColor: entries.map(([k], i) => colorFor(k, colorMode, i)),
          // shadcn-style ring: white gaps between rounded segments
          borderColor: "#ffffff",
          borderWidth: 2,
          borderRadius: 6,
          spacing: 2,
          datalabels: {
            display: (ctx) => total && (ctx.dataset.data[ctx.dataIndex] / total) * 100 >= 4,
            color: "#fff",
            font: { weight: "700", size: 11 },
            formatter: (v) => (total ? ((v / total) * 100).toFixed(1) + "%" : ""),
          },
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "62%", // wider centre hole = the modern thin-ring look
      plugins: {
        legend: { position: "right", labels: { boxWidth: 12, usePointStyle: true } },
        tooltip: {
          callbacks: {
            label: (c) => {
              const pct = total ? ((c.parsed / total) * 100).toFixed(1) : 0;
              return ` ${c.label}: ${fmtMetric(c.parsed)} — MS% ${pct}%`;
            },
          },
        },
      },
    },
  });
}

function renderTopICBs(rows) {
  const metric = singles.metric();
  const top = [...sumBy(rows, (r) => r.icb, metric).entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);
  upsertChart("chart-icbs", {
    type: "bar",
    data: {
      labels: top.map(([k]) => k),
      datasets: [
        {
          label: metric,
          data: top.map(([, v]) => v),
          backgroundColor: "#4f46e5",
          borderRadius: 6,
          datalabels: {
            display: true,
            anchor: "end",
            align: "end",
            offset: 2,
            clamp: true,
            color: themeInk(),
            font: { size: 10, weight: "700" },
            formatter: (v) => fmtNum(v),
          },
        },
      ],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { right: 44 } },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (c) => " " + fmtMetric(c.parsed.x) } },
      },
      scales: {
        x: { beginAtZero: true, ticks: { callback: (v) => fmtMetric(v) } },
      },
      onClick: (evt, els) => {
        if (els.length) drillToICB(top[els[0].index][0]);
      },
    },
  });
}

/* ICB MAT year-on-year — MJN EXCLUSIVES ONLY (combo: grouped bars + line).
   Scope: the ICBs where the selected category's guideline is Exclusive AND
   the designated 1st-line product is an MJN brand (Puramino for AAF,
   Nutramigen for EHF). Those ICBs sit on the X axis.
   For each ICB, two bars — MAT PY (faded) vs MAT CY (solid), coloured in the
   designated MJN brand's family colour — plus a growth line (%) on a second
   y-axis.
   Toggles: AAF / EHF (default AAF) and Actuals / MS%:
     Actuals → bars = the MJN product's volume in that ICB's category market
     MS%     → bars = the MJN product's share of that market; line = Δ share %
   Always MAT-vs-prior-MAT (ignores the Period filter) and respects the
   region/ICB/HDM slicers via visibleICBs(); brand/manufacturer/category
   slicers are ignored — the chart fixes its own category + brand focus. */
let icbMatCat = "AAF";      // AAF | EHF — which exclusivity network (default AAF)
let icbMatValue = "actual"; // actual | ms

/** ICBs where `cat`'s guideline is Exclusive to an MJN product ->
 *  the designated MJN brand(s) for that ICB. */
function mjnExclusiveICBs(cat) {
  const vis = visibleICBs();
  const map = new Map(); // icb -> Set(MJN brands designated 1st-line)
  for (const g of DATA.guidelines) {
    if (!vis.has(g.ICB)) continue;
    const status = ((cat === "EHF" ? g.ehf_gl : g.aaf_gl) || "").trim().toUpperCase();
    if (status !== "EXCLUSIVE") continue;
    const first = cat === "EHF" ? g.ehf_first : g.aaf_first;
    const mjn = brandsFromProduct(first).filter((b) => MJN_BRANDS.has(b));
    if (mjn.length) map.set(g.ICB, new Set(mjn));
  }
  return map;
}

function renderICBMatYoY() {
  const metric = singles.metric();
  const cat = icbMatCat;
  const isMS = icbMatValue === "ms";
  const months = DATA.meta.months;
  const cyMonths = months.slice(-12);                  // MAT CY = last 12 months
  const pyMonths = months.slice(-24, -12);             // MAT PY = the 12 before
  const cySet = new Set(cyMonths), pySet = new Set(pyMonths);

  const scope = mjnExclusiveICBs(cat);                 // icb -> designated MJN brand(s)

  // per ICB and window: the MJN product's volume + the whole category total
  const mjnOf = new Map(), totOf = new Map();          // "win icb" -> volume
  for (const r of DATA.performance) {
    if (r.category !== cat || !scope.has(r.icb)) continue;
    const win = cySet.has(r.date) ? "cy" : pySet.has(r.date) ? "py" : null;
    if (!win) continue;
    const kT = win + " " + r.icb;
    totOf.set(kT, (totOf.get(kT) || 0) + r[metric]);
    if (scope.get(r.icb).has(r.brand)) mjnOf.set(kT, (mjnOf.get(kT) || 0) + r[metric]);
  }

  // bar value per ICB: MJN volume, or MJN share of the ICB's category market
  const val = (win, k) => {
    const m = mjnOf.get(win + " " + k) || 0;
    if (!isMS) return m;
    const t = totOf.get(win + " " + k) || 0;
    return t ? (m / t) * 100 : 0;
  };
  // growth line (always %): volume growth, or the change in share
  const growth = (k) => {
    if (isMS) return val("cy", k) - val("py", k);
    const p = mjnOf.get("py " + k) || 0;
    return p ? (((mjnOf.get("cy " + k) || 0) - p) / p) * 100 : null;
  };

  // biggest current-year bar first
  const keys = [...scope.keys()].sort((a, b) => val("cy", b) - val("cy", a));
  // each ICB's bar takes its designated brand's colour (Puramino orange /
  // Nutramigen blue) — faded for PY, solid for CY
  const brandOf = (k) => [...scope.get(k)][0];
  const solid = keys.map((k) => BRAND_COLORS[brandOf(k)] || "#4338ca");
  const faded = solid.map((c) => withAlpha(c, 0.35));
  const products = [...new Set(keys.map(brandOf))].join(" / ") || "—";

  $("icb-mat-hint").textContent =
    `— ${keys.length} ICB${keys.length === 1 ? "" : "s"} where ${cat} is exclusive to ${products} · ` +
    `MAT CY (${monthLabel(cyMonths[0])}–${monthLabel(cyMonths[11])}) vs MAT PY (${monthLabel(pyMonths[0])}–${monthLabel(pyMonths[11])}) · ` +
    (isMS ? "bars = MJN MS%, line = Δ share %" : "bars = MJN volume, line = growth %") +
    " · click a bar to drill in";

  upsertChart("chart-icb-mat", {
    type: "bar",
    data: {
      labels: keys,
      datasets: [
        {
          type: "bar", label: "MAT PY", yAxisID: "y", order: 3,
          data: keys.map((k) => val("py", k)),
          backgroundColor: faded, borderRadius: 6,
          datalabels: {
            display: true, // global default is off, so opt in explicitly
            anchor: "end", align: "top", offset: 1, color: themeInkSoft(),
            font: { size: 9, weight: "600" },
            formatter: (v) => (isMS ? v.toFixed(1) + "%" : fmtNum(v)),
          },
        },
        {
          type: "bar", label: "MAT CY", yAxisID: "y", order: 3,
          data: keys.map((k) => val("cy", k)),
          backgroundColor: solid, borderRadius: 6,
          datalabels: {
            display: true,
            anchor: "end", align: "top", offset: 1, color: themeInk(),
            font: { size: 9, weight: "700" },
            formatter: (v) => (isMS ? v.toFixed(1) + "%" : fmtNum(v)),
          },
        },
        {
          // growth is always orange across the report
          type: "line", label: "Growth (%)", yAxisID: "y1", order: 1,
          data: keys.map(growth),
          borderColor: GROWTH_COLOR, backgroundColor: GROWTH_COLOR,
          borderWidth: 2, tension: 0.3, pointRadius: 3, pointHoverRadius: 5, spanGaps: false,
          datalabels: {
            display: true,
            align: "top", offset: 6, color: growthLabelColor(),
            font: { size: 9, weight: "700" },
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
        // bars are coloured per designated brand, so use a convention legend
        legend: {
          position: "bottom",
          labels: {
            boxWidth: 12, usePointStyle: true,
            generateLabels: (chart) => [
              { text: "MAT PY (faded)", fillStyle: "rgba(100,116,139,0.4)", strokeStyle: "rgba(100,116,139,0.4)", pointStyle: "rect", datasetIndex: 0, hidden: !chart.isDatasetVisible(0) },
              { text: "MAT CY (solid)", fillStyle: themeInkSoft(), strokeStyle: themeInkSoft(), pointStyle: "rect", datasetIndex: 1, hidden: !chart.isDatasetVisible(1) },
              { text: isMS ? "Δ share (%)" : "Growth (%)", fillStyle: GROWTH_COLOR, strokeStyle: GROWTH_COLOR, pointStyle: "line", datasetIndex: 2, hidden: !chart.isDatasetVisible(2) },
            ],
          },
        },
        tooltip: {
          callbacks: {
            title: (items) => items[0].label + " — " + brandOf(items[0].label) + " exclusive",
            label: (c) => {
              if (c.dataset.type === "line")
                return ` ${isMS ? "Δ share" : "Growth"}: ${c.parsed.y == null ? "n/a" : (c.parsed.y >= 0 ? "+" : "") + c.parsed.y.toFixed(1) + "%"}`;
              return ` ${c.dataset.label}: ${isMS ? c.parsed.y.toFixed(1) + "%" : fmtMetric(c.parsed.y)}`;
            },
          },
        },
      },
      scales: {
        y: { beginAtZero: true, position: "left",
             title: { display: true, text: isMS ? "MJN MS%" : (metric === "value" ? "MJN value" : "MJN volume") },
             ticks: { callback: (v) => (isMS ? v + "%" : fmtNum(v)) } },
        y1: { position: "right", grid: { drawOnChartArea: false },
              title: { display: true, text: isMS ? "Δ share (%)" : "Growth (%)" },
              ticks: { callback: (v) => (v >= 0 ? "+" : "") + v + "%" } },
        x: { grid: { display: false },
             ticks: { maxRotation: 60, minRotation: 45, autoSkip: false, font: { size: 10 } } },
      },
      onClick: (evt, els) => {
        if (els.length) drillToICB(keys[els[0].index]);
      },
    },
  });
}

function renderGLChart(rows) {
  // 100% stacked: brand MS% within each guideline status (row-level gl_status)
  const metric = singles.metric();
  const statuses = [...new Set(rows.map((r) => r.gl_status || "N/A (RICE)"))].sort();
  const brands = [...sumBy(rows, (r) => r.brand, metric).entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k);

  const totals = new Map();
  const cell = new Map();
  for (const r of rows) {
    const s = r.gl_status || "N/A (RICE)";
    totals.set(s, (totals.get(s) || 0) + r[metric]);
    const k = s + " " + r.brand;
    cell.set(k, (cell.get(k) || 0) + r[metric]);
  }

  const datasets = brands.map((b, i) => ({
    label: b,
    data: statuses.map((s) => {
      const t = totals.get(s) || 0;
      return t ? ((cell.get(s + " " + b) || 0) / t) * 100 : 0;
    }),
    backgroundColor: colorFor(b, "brand", i),
    datalabels: msDatalabels(6),
  }));

  upsertChart("chart-gl", {
    type: "bar",
    data: { labels: statuses, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom", labels: { boxWidth: 12, usePointStyle: true } },
        tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: MS% ${c.parsed.y.toFixed(1)}%` } },
      },
      scales: {
        x: { stacked: true, grid: { display: false } },
        y: { stacked: true, max: 100, ticks: { callback: (v) => v + "%" } },
      },
    },
  });
}

function renderGLTimeline() {
  const icbs = visibleICBs();
  const today = new Date().toISOString().slice(0, 10);
  const horizon = new Date(Date.now() + 730 * 864e5).toISOString().slice(0, 10);

  const pubs = new Map();
  const reviews = new Map();
  for (const g of DATA.guidelines) {
    if (!icbs.has(g.ICB)) continue;
    const p = g.latest_published;
    if (p && p <= today) pubs.set(quarterKey(p), (pubs.get(quarterKey(p)) || 0) + 1);
    const r = g.next_review;
    if (r && r < FAR_FUTURE && r <= horizon)
      reviews.set(quarterKey(r), (reviews.get(quarterKey(r)) || 0) + 1);
  }

  const allQ = [...new Set([...pubs.keys(), ...reviews.keys()])].sort();
  const nowQ = quarterKey(today);

  upsertChart("chart-gl-timeline", {
    type: "bar",
    data: {
      labels: allQ,
      datasets: [
        {
          label: "Guidelines published",
          data: allQ.map((q) => pubs.get(q) || 0),
          backgroundColor: "#4f46e5",
          borderRadius: 6,
        },
        {
          label: "Reviews falling due",
          data: allQ.map((q) => reviews.get(q) || 0),
          backgroundColor: allQ.map((q) => (q < nowQ ? "#dc2626" : "#f59e0b")),
          borderRadius: 6,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom", labels: { boxWidth: 12, usePointStyle: true } },
        tooltip: {
          callbacks: {
            afterBody: (items) =>
              items.some((i) => i.datasetIndex === 1 && i.label < nowQ && i.parsed.y > 0)
                ? "Red = review date already passed (overdue)"
                : "",
          },
        },
      },
      scales: {
        y: { beginAtZero: true, ticks: { stepSize: 1 } },
        x: { grid: { display: false } },
      },
    },
  });
}

// ---------- exclusive 1st-line performance table ----------

// GL product names -> performance BRAND keys (incl. known typos)
const PRODUCT_ALIASES = { ALTEHRA: "ALTHERA" };

function brandsFromProduct(text) {
  if (!text) return [];
  const t = String(text).toUpperCase();
  const out = new Set();
  for (const b of Object.keys(BRAND_COLORS)) if (b !== "OTHER" && t.includes(b)) out.add(b);
  for (const [alias, b] of Object.entries(PRODUCT_ALIASES)) if (t.includes(alias)) out.add(b);
  return [...out];
}

/** Contiguous spans where the category's guideline was "Exclusive" for one
 *  ICB, merging adjacent intervals whose 1st-line product didn't change. */
function exclusiveSpans(icb, cat) {
  const spans = [];
  let cur = null;
  for (const iv of trackerIntervals(icb)) {
    const st = activeStateFor(icb, iv.start);
    const status = ((cat === "EHF" ? st.ehf_gl : st.aaf_gl) || "").trim().toUpperCase();
    const product = (cat === "EHF" ? st.ehf_first : st.aaf_first) || "";
    const isExcl = status === "EXCLUSIVE";
    if (isExcl && cur && cur.product === product) {
      cur.end = iv.end;
    } else {
      if (cur) spans.push(cur);
      cur = isExcl ? { start: iv.start, end: iv.end, product } : null;
    }
  }
  if (cur) spans.push(cur);
  return spans;
}

let exclSort = { key: "ms", dir: 1 }; // lowest MS% first — worst conversion on top
let exclProduct = null;     // selected exclusive first-line brand, e.g. "NUTRAMIGEN"
let exclDim = "brand";      // brand | product — the "even with products" level
let exclTrendValue = "ms";  // ms | actual

/** Brands that are an exclusive 1st-line somewhere (within the region/HDM/ICB
 *  filters) -> { cat, icbs:Set(icb) }. Drives the First-line product filter. */
function exclusiveFirstLineBrands() {
  const vis = visibleICBs();
  const map = new Map();
  for (const g of DATA.guidelines) {
    if (!vis.has(g.ICB)) continue;
    for (const cat of ["EHF", "AAF"]) {
      const status = ((cat === "EHF" ? g.ehf_gl : g.aaf_gl) || "").trim().toUpperCase();
      if (status !== "EXCLUSIVE") continue;
      const first = cat === "EHF" ? g.ehf_first : g.aaf_first;
      for (const b of brandsFromProduct(first)) {
        if (!map.has(b)) map.set(b, { cat, icbs: new Set() });
        map.get(b).icbs.add(g.ICB);
      }
    }
  }
  return map;
}

/** Aggregated guideline publish / change markers across a set of ICBs.
 *  Counts unique ICBs per month (the GL workbook has one row per CCG, so an
 *  ICB with 5 CCGs must still count once). */
function exclMarks(scope, months) {
  const idx = new Map(months.map((m, i) => [m.slice(0, 7), i]));
  const byMonth = new Map(); // ym -> Set(icb)
  const add = (ym, icb) => {
    if (!idx.has(ym)) return;
    if (!byMonth.has(ym)) byMonth.set(ym, new Set());
    byMonth.get(ym).add(icb);
  };
  for (const g of DATA.gl_detail) {
    if (!scope.has(g.ICB) || !g["Latest Published Date"]) continue;
    add(g["Latest Published Date"].slice(0, 7), g.ICB);
  }
  for (const [icb, vers] of Object.entries(DATA.gl_history || {})) {
    if (!scope.has(icb)) continue;
    for (const v of vers)
      if (v.changes.length) add(v.effective_date.slice(0, 7), icb);
  }
  return [...byMonth.entries()].map(([ym, icbs]) => ({
    index: idx.get(ym),
    label: icbs.size > 1 ? `GL ×${icbs.size} ICBs` : "GL update",
    icbs: [...icbs].sort(),
  }));
}

function renderExclusiveTrend() {
  const brandsExcl = exclusiveFirstLineBrands();

  // (re)populate the First-line product filter (cross-filtered by global slicers)
  const sel = $("excl-product");
  const entries = [...brandsExcl.entries()].sort(
    (a, b) => a[1].cat.localeCompare(b[1].cat) || b[1].icbs.size - a[1].icbs.size
  );
  sel.innerHTML = entries
    .map(
      ([b, info]) =>
        `<option value="${esc(b)}">${esc(b)} — ${info.cat} exclusive (${info.icbs.size} ICB${info.icbs.size === 1 ? "" : "s"})</option>`
    )
    .join("");
  if (!brandsExcl.has(exclProduct)) exclProduct = entries.length ? entries[0][0] : null;
  if (exclProduct) sel.value = exclProduct;

  if (!exclProduct) {
    if (charts["chart-excl-trend"]) { charts["chart-excl-trend"].destroy(); delete charts["chart-excl-trend"]; }
    $("excl-trend-hint").textContent = "";
    $("excl-trend-caption").textContent = "No exclusive first-line products under the current filters.";
    return;
  }

  const { cat, icbs: scope } = brandsExcl.get(exclProduct);
  const isMS = exclTrendValue === "ms";
  const isProd = exclDim === "product";
  const metric = singles.metric();
  const months = DATA.meta.months;

  const keyFn = isProd ? (r) => r.product : (r) => r.brand;
  // which line(s) belong to the selected first-line brand (highlighted + compliance)
  const selectedKeys = isProd
    ? new Set(DATA.meta.products.filter((p) => PRODUCT_BRAND.get(p) === exclProduct))
    : new Set([exclProduct]);

  const rows = DATA.performance.filter((r) => r.category === cat && scope.has(r.icb));

  $("excl-trend-hint").textContent =
    `(${cat} ${isProd ? "product" : "brand"} ${isMS ? "share" : "volumes"} in the ${scope.size} ICB${scope.size === 1 ? "" : "s"} where ${exclProduct} is the exclusive 1st-line)`;

  const cell = new Map();       // "month key" -> metric
  const monthTotal = new Map(); // month -> category total
  const compNum = new Map();    // month -> selected-brand volume (compliance numerator)
  for (const r of rows) {
    const k = keyFn(r);
    cell.set(r.date + " " + k, (cell.get(r.date + " " + k) || 0) + r[metric]);
    monthTotal.set(r.date, (monthTotal.get(r.date) || 0) + r[metric]);
    if (r.brand === exclProduct) compNum.set(r.date, (compNum.get(r.date) || 0) + r[metric]);
  }

  const keys = [...sumBy(rows, keyFn, metric).entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k);

  const datasets = keys.map((k, i) => {
    const hi = selectedKeys.has(k);
    const col = colorFor(k, isProd ? "product" : "brand", i);
    return {
      label: k,
      data: months.map((m) => {
        const v = cell.get(m + " " + k) || 0;
        if (!isMS) return v;
        const t = monthTotal.get(m) || 0;
        return t ? (v / t) * 100 : 0;
      }),
      borderColor: col,
      backgroundColor: col,
      fill: false,
      tension: 0.25,
      pointRadius: 0,
      pointHitRadius: 8,
      borderWidth: hi ? 3.5 : 1.5,
      // every line is labelled (the focus brand's lines are drawn thicker)
      datalabels: pointLabels(col, isMS),
    };
  });

  // compliance overlay: selected brand's aggregate share (MS% + product mode,
  // where the brand is split across client lines so an aggregate line helps)
  if (isMS && isProd) {
    datasets.unshift({
      label: `${exclProduct} (total, compliance)`,
      data: months.map((m) => {
        const t = monthTotal.get(m) || 0;
        return t ? ((compNum.get(m) || 0) / t) * 100 : 0;
      }),
      borderColor: themeContrast(),
      backgroundColor: themeContrast(),
      borderDash: [6, 3],
      borderWidth: 3,
      fill: false,
      tension: 0.25,
      pointRadius: 0,
      pointHitRadius: 8,
      datalabels: { display: false },
    });
  }

  // headline compliance = selected brand's share over the whole window
  const totAll = [...monthTotal.values()].reduce((s, v) => s + v, 0);
  const totBrand = [...compNum.values()].reduce((s, v) => s + v, 0);
  const compPct = totAll ? (totBrand / totAll) * 100 : 0;
  $("excl-trend-caption").innerHTML =
    `Scope: <strong>${scope.size} ICB${scope.size === 1 ? "" : "s"}</strong> where <strong>${esc(exclProduct)}</strong> is the exclusive ${cat} 1st-line. ` +
    `Over the full window it holds <strong>${compPct.toFixed(1)}% MS%</strong> of the ${cat} market in those ICBs` +
    (compPct < 50 ? ` — competitors out-prescribe the mandated product.` : `.`) +
    (isProd && isMS ? ` Dashed line = ${esc(exclProduct)} total (all its client lines).` : ``) +
    ` Pink dashed verticals mark guideline publish / change months.`;

  const marks = exclMarks(scope, months);
  const marksByIndex = new Map(marks.map((m) => [m.index, m]));

  upsertChart("chart-excl-trend", {
    type: "line",
    data: { labels: months.map(monthLabel), datasets },
    plugins: [glMarkerPlugin],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 14 } },
      interaction: { mode: "index", intersect: false },
      plugins: {
        glMarkers: { marks },
        legend: { position: "bottom", labels: { boxWidth: 12, usePointStyle: true } },
        tooltip: {
          callbacks: {
            label: (c) =>
              ` ${c.dataset.label}: ` +
              (isMS ? "MS% " + c.parsed.y.toFixed(1) + "%" : fmtMetric(c.parsed.y)),
            // months with a GL marker also list which ICBs updated
            footer: (items) => {
              const m = items.length ? marksByIndex.get(items[0].dataIndex) : null;
              if (!m) return "";
              return ["Guideline updated:", ...m.icbs.map((i) => "• " + i)];
            },
          },
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          grace: "8%",
          ticks: { callback: (v) => (isMS ? v + "%" : fmtMetric(v)) },
        },
        x: { grid: { display: false } },
      },
    },
  });
}


function renderExclTable() {
  const metric = singles.metric();
  const icbs = visibleICBs();
  const cats = ["EHF", "AAF"].filter((c) => !SEL.category.size || SEL.category.has(c));
  const months = DATA.meta.months;

  const rows = [];
  for (const g of DATA.guidelines) {
    if (!icbs.has(g.ICB)) continue;
    for (const cat of cats) {
      for (const span of exclusiveSpans(g.ICB, cat)) {
        const brands = brandsFromProduct(span.product);
        const perf = DATA.performance.filter(
          (r) =>
            r.icb === g.ICB &&
            r.category === cat &&
            r.date >= span.start &&
            (!span.end || r.date < span.end)
        );
        const total = perf.reduce((s, r) => s + r[metric], 0);
        const prod = perf
          .filter((r) => brands.includes(r.brand))
          .reduce((s, r) => s + r[metric], 0);
        const nM = new Set(perf.map((r) => r.date)).size;
        const endIdx = span.end ? months.indexOf(span.end) - 1 : months.length - 1;
        rows.push({
          icb: g.ICB,
          cat,
          product: span.product || "—",
          from: span.start,
          window: monthLabel(span.start) + " – " + monthLabel(months[Math.max(endIdx, 0)]),
          months: nM,
          actual: prod,
          avg: nM ? prod / nM : 0,
          ms: brands.length && total ? (prod / total) * 100 : null,
          mapped: brands.length > 0,
        });
      }
    }
  }

  rows.sort((a, b) => {
    const k = exclSort.key;
    const av = a[k] ?? -1, bv = b[k] ?? -1;
    return av < bv ? -exclSort.dir : av > bv ? exclSort.dir : 0;
  });

  const msBadge = (r) => {
    if (!r.mapped) return '<span class="hint">n/a — product not matched to a brand</span>';
    if (r.ms == null) return '<span class="hint">no data</span>';
    const cls = r.ms >= 80 ? "exclusive" : r.ms >= 50 ? "due-soon" : "overdue";
    return `<span class="badge ${cls}">${r.ms.toFixed(1)}%</span>`;
  };

  const tbody = document.querySelector("#excl-table tbody");
  tbody.innerHTML = rows.length
    ? rows
        .map(
          (r) => `
        <tr data-icb="${esc(r.icb)}">
          <td class="icb-cell">${esc(r.icb)}</td>
          <td><span class="badge all">${r.cat}</span></td>
          <td><strong>${esc(r.product)}</strong></td>
          <td>${r.window}</td>
          <td class="num">${r.months}</td>
          <td class="num">${r.mapped ? fmtMetric(r.actual) : "—"}</td>
          <td class="num">${r.mapped ? fmtNum(r.avg) : "—"}</td>
          <td>${msBadge(r)}</td>
        </tr>`
        )
        .join("")
    : `<tr><td colspan="8" class="hint">No exclusive 1st-line products under the current filters.</td></tr>`;

  tbody.querySelectorAll("tr[data-icb]").forEach((tr) =>
    tr.addEventListener("click", () => drillToICB(tr.dataset.icb))
  );
}

// ---------- ICB change tracker ----------

const FIELD_LABELS = {
  ehf_gl: "EHF GL", ehf_first: "EHF 1st line", ehf_second: "EHF 2nd line",
  aaf_gl: "AAF GL", aaf_first: "AAF 1st line", aaf_second: "AAF 2nd line",
  gl_followed: "GL followed", hdm: "HDM",
  latest_published: "Published date", next_review: "Next review",
};

/** Interval boundaries for an ICB: workbook publication dates + tracked
 *  change dates + manual events that fall inside the data's month range. */
function trackerIntervals(icb) {
  const months = DATA.meta.months;
  const first = months[0], last = months[months.length - 1];
  const bounds = new Map(); // monthStart -> label
  for (const g of DATA.gl_detail) {
    if (g.ICB !== icb || !g["Latest Published Date"]) continue;
    const m = g["Latest Published Date"].slice(0, 7) + "-01";
    if (m > first && m <= last && !bounds.has(m)) bounds.set(m, "GL published " + g["Latest Published Date"]);
  }
  for (const v of DATA.gl_history?.[icb] || []) {
    if (!v.changes.length) continue;
    const m = v.effective_date.slice(0, 7) + "-01";
    if (m > first && m <= last)
      bounds.set(m, "GL changed " + v.effective_date + " (v" + v.version + ")");
  }
  for (const e of DATA.gl_events || []) {
    if (e.icb !== icb) continue;
    const m = e.date.slice(0, 7) + "-01";
    if (m > first && m <= last && !bounds.has(m))
      bounds.set(
        m,
        (e.category !== "ALL" ? e.category + " " : "") + "event " + e.date + ": " + e.description
      );
  }
  const cuts = [...bounds.keys()].sort();
  const starts = [first, ...cuts];
  return starts.map((s, i) => ({
    start: s,
    end: i + 1 < starts.length ? starts[i + 1] : null, // exclusive
    label:
      i === 0
        ? cuts.length
          ? "Before " + monthLabel(starts[1])
          : "Full data range — no guideline changes in this window"
        : bounds.get(s),
    name:
      monthLabel(s) +
      " – " +
      (i + 1 < starts.length
        ? monthLabel(months[months.indexOf(starts[i + 1]) - 1])
        : monthLabel(months[months.length - 1])),
  }));
}

/** Per-category performance stats for one ICB inside [start, end). */
function intervalStats(icb, start, end) {
  const rows = DATA.performance.filter(
    (r) => r.icb === icb && r.date >= start && (!end || r.date < end)
  );
  const metric = singles.metric();
  const out = {};
  for (const cat of DATA.meta.categories) {
    const catRows = rows.filter((r) => r.category === cat);
    const total = catRows.reduce((s, r) => s + r[metric], 0);
    const nMonths = new Set(catRows.map((r) => r.date)).size;
    const byBrand = [...sumBy(catRows, (r) => r.brand, metric).entries()].sort((a, b) => b[1] - a[1]);
    const top = byBrand[0];
    out[cat] = {
      avg: nMonths ? total / nMonths : 0,
      months: nMonths,
      topBrand: top ? top[0] : null,
      topMS: top && total ? (top[1] / total) * 100 : 0,
      shares: Object.fromEntries(byBrand.map(([b, v]) => [b, total ? (v / total) * 100 : 0])),
    };
  }
  return out;
}

function deltaHTML(cur, prev, unit = "") {
  if (prev == null || !isFinite(prev)) return "";
  const d = cur - prev;
  const cls = d > 0.05 ? "up" : d < -0.05 ? "down" : "flat";
  const arrow = d > 0.05 ? "▲" : d < -0.05 ? "▼" : "▬";
  return `<span class="delta ${cls}">${arrow}${Math.abs(d).toFixed(1)}${unit}</span>`;
}

// brand -> manufacturer, for naming who exclusivity was won from / lost to
const BRAND_MFR = {
  NEOCATE: "Nutricia", PEPTI: "Nutricia",
  NUTRAMIGEN: "MJN", PURAMINO: "MJN",
  ALTHERA: "Nestlé", ALFAMINO: "Nestlé",
  ARIZE: "Abbott",
};
const MJN_BRANDS = new Set(["NUTRAMIGEN", "PURAMINO"]);

/** Exclusive wins/losses for MJN products, derived from the tracked history:
 *  a WIN when a change makes an MJN product the exclusive 1st line, a LOSS
 *  when MJN-exclusive stops being so — with the counterparty in each case. */
function mjnExclusiveMoves() {
  const moves = [];
  const isMJNExcl = (status, product) =>
    (status || "").trim().toUpperCase() === "EXCLUSIVE" &&
    brandsFromProduct(product).some((b) => MJN_BRANDS.has(b));
  const sideLabel = (status, product) => {
    const s = (status || "—").trim();
    if (s.toUpperCase() === "EXCLUSIVE") {
      const mfrs = [...new Set(brandsFromProduct(product).map((b) => BRAND_MFR[b] || b))];
      return `${product || "—"}${mfrs.length ? " (" + mfrs.join("/") + ")" : ""}`;
    }
    return s + (product ? ": " + product : "");
  };

  for (const [icb, versions] of Object.entries(DATA.gl_history || {})) {
    for (let i = 1; i < versions.length; i++) {
      const prev = versions[i - 1].state, cur = versions[i].state, v = versions[i];
      for (const cat of ["EHF", "AAF"]) {
        const oS = cat === "EHF" ? prev.ehf_gl : prev.aaf_gl;
        const oP = cat === "EHF" ? prev.ehf_first : prev.aaf_first;
        const nS = cat === "EHF" ? cur.ehf_gl : cur.aaf_gl;
        const nP = cat === "EHF" ? cur.ehf_first : cur.aaf_first;
        if (oS === nS && oP === nP) continue;
        const was = isMJNExcl(oS, oP), now = isMJNExcl(nS, nP);
        if (was === now) continue;
        moves.push({
          icb, cat,
          date: v.effective_date,
          version: v.version,
          type: now ? "WIN" : "LOSS",
          product: now ? nP : oP,
          counterparty: now ? sideLabel(oS, oP) : sideLabel(nS, nP),
        });
      }
    }
  }
  moves.sort((a, b) => (a.date < b.date ? 1 : -1));
  return moves;
}

function mjnMovesHTML() {
  const icbs = visibleICBs();
  const moves = mjnExclusiveMoves().filter(
    (m) => icbs.has(m.icb) && (!SEL.category.size || SEL.category.has(m.cat))
  );
  const wins = moves.filter((m) => m.type === "WIN").length;
  const losses = moves.length - wins;

  const body = moves.length
    ? `<div class="table-wrap" style="max-height:280px">
        <table>
          <thead><tr>
            <th>Date</th><th>ICB / APC</th><th>Category</th><th></th>
            <th>MJN product</th><th>Won from / lost to</th>
          </tr></thead>
          <tbody>
            ${moves
              .map(
                (m) => `
              <tr data-icb="${esc(m.icb)}">
                <td>${m.date}</td>
                <td class="icb-cell">${esc(m.icb)}</td>
                <td><span class="badge all">${m.cat}</span></td>
                <td><span class="badge ${m.type === "WIN" ? "exclusive" : "overdue"}">${m.type}</span></td>
                <td><strong>${esc(m.product || "—")}</strong></td>
                <td>${m.type === "WIN" ? "won from" : "lost to"} <strong>${esc(m.counterparty)}</strong></td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>`
    : `<p class="hint">No exclusive wins or losses recorded yet — this fills in automatically as
       guideline changes are detected in the base GL workbook (tracking began ${
         Object.values(DATA.gl_history || {})[0]?.[0]?.detected_at?.slice(0, 10) || "recently"
       }).</p>`;

  return `
    <div class="mjn-moves">
      <h3>MJN exclusive wins &amp; losses
        <span class="hint">${moves.length ? `${wins} win${wins === 1 ? "" : "s"} · ${losses} loss${losses === 1 ? "" : "es"}` : "(from tracked guideline changes)"}</span>
      </h3>
      ${body}
    </div>`;
}

function renderTrackerSummary() {
  const icbs = visibleICBs();
  const hist = DATA.gl_history || {};
  const rows = DATA.guidelines
    .filter((g) => icbs.has(g.ICB))
    .map((g) => {
      const versions = hist[g.ICB] || [];
      const changes = versions.filter((v) => v.changes.length);
      const lastChange = changes.length ? changes[changes.length - 1] : null;
      const nEvents = (DATA.gl_events || []).filter((e) => e.icb === g.ICB).length;
      return { g, nChanges: changes.length, nEvents, lastChange };
    })
    .sort((a, b) => {
      const as = a.nChanges + a.nEvents, bs = b.nChanges + b.nEvents;
      if (bs !== as) return bs - as;
      const ad = a.lastChange?.effective_date || "";
      const bd = b.lastChange?.effective_date || "";
      return bd < ad ? -1 : bd > ad ? 1 : a.g.ICB < b.g.ICB ? -1 : 1;
    });

  $("tracker-hint").textContent =
    "— changes detected since tracking began; click an ICB to see its versions and interval performance";
  $("tracker-body").innerHTML = `
    ${mjnMovesHTML()}
    <div class="table-wrap">
      <table class="tracker-summary">
        <thead><tr>
          <th>ICB / APC</th>
          <th>EHF GL</th><th>EHF 1st line</th><th>EHF 2nd line</th>
          <th>AAF GL</th><th>AAF 1st line</th><th>AAF 2nd line</th>
          <th>Changes tracked</th><th>Last change</th><th>Fields changed</th><th>Next review</th>
        </tr></thead>
        <tbody>
          ${rows
            .map(
              ({ g, nChanges, nEvents, lastChange }) => `
            <tr data-icb="${esc(g.ICB)}">
              <td class="icb-cell">${esc(g.ICB)}</td>
              <td>${glBadge(g.ehf_gl)}</td>
              <td>${esc(g.ehf_first || "")}</td>
              <td>${esc(g.ehf_second || "")}</td>
              <td>${glBadge(g.aaf_gl)}</td>
              <td>${esc(g.aaf_first || "")}</td>
              <td>${esc(g.aaf_second || "")}</td>
              <td class="${nChanges || nEvents ? "change-count" : "no-changes"}">${
                [nChanges ? nChanges + " change" + (nChanges > 1 ? "s" : "") : "",
                 nEvents ? nEvents + " event" + (nEvents > 1 ? "s" : "") : ""]
                  .filter(Boolean).join(" · ") || "—"
              }</td>
              <td>${lastChange ? lastChange.effective_date : '<span class="no-changes">no changes yet</span>'}</td>
              <td>${lastChange ? esc(lastChange.changes.map((c) => FIELD_LABELS[c.field] || c.field).join(", ")) : ""}</td>
              <td>${dateCell(g.next_review)}</td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>`;

  $("tracker-body")
    .querySelectorAll("tbody tr[data-icb]")
    .forEach((tr) =>
      tr.addEventListener("click", () => {
        drillToICB(tr.dataset.icb);
        $("tracker-card").scrollIntoView({ behavior: "smooth", block: "start" });
      })
    );
}

function renderTrackerDetail(icb) {
  const versions = DATA.gl_history?.[icb] || [];
  const events = (DATA.gl_events || []).filter((e) => e.icb === icb);
  const intervals = trackerIntervals(icb);
  const cats = ["EHF", "AAF", "RICE"].filter((c) => DATA.meta.categories.includes(c));
  const metricName = singles.metric() === "value" ? "£" : singles.metric() === "units" ? "units" : "KGs";
  const lastMonth = DATA.meta.months[DATA.meta.months.length - 1];

  // merge auto-detected versions and manual events into one timeline
  const items = [
    ...versions.map((v) => ({ kind: "version", date: v.effective_date, v })),
    ...events.filter((e) => e.date <= lastMonth).map((e) => ({ kind: "event", date: e.date, e })),
  ].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const itemHTML = (it) => {
    if (it.kind === "event") {
      const e = it.e;
      const dates =
        e.published || e.review
          ? `<div class="state-line hint">${[
              e.published ? "Published → " + e.published : "",
              e.review ? "next review → " + e.review : "",
            ].filter(Boolean).join(" · ")}</div>`
          : "";
      return `
      <div class="version-item event">
        <div class="version-head">Event${e.category !== "ALL" ? " — " + e.category : ""}<span class="version-date">${e.date}</span></div>
        <div class="state-line">${esc(e.description)}</div>
        ${dates}
      </div>`;
    }
    const v = it.v;
    if (!v.changes.length) {
      const s = v.state;
      return `
      <div class="version-item baseline">
        <div class="version-head">v${v.version} — Baseline<span class="version-date">recorded ${v.detected_at.slice(0, 10)}</span></div>
        <div class="state-line">EHF: ${glBadge(s.ehf_gl)} ${esc(s.ehf_first || "")}</div>
        <div class="state-line">AAF: ${glBadge(s.aaf_gl)} ${esc(s.aaf_first || "")}</div>
        <div class="state-line hint">Published ${esc(s.latest_published || "—")} · next review ${esc(s.next_review || "—")}</div>
      </div>`;
    }
    return `
    <div class="version-item">
      <div class="version-head">v${v.version} — Changed<span class="version-date">effective ${v.effective_date} · detected ${v.detected_at.slice(0, 10)}</span></div>
      ${v.changes
        .map(
          (c) => `
        <div class="diff-row">
          <span class="diff-field">${FIELD_LABELS[c.field] || c.field}:</span>
          <span class="diff-old">${esc(c.old || "—")}</span><span class="diff-arrow">→</span><span class="diff-new">${esc(c.new || "—")}</span>
        </div>`
        )
        .join("")}
    </div>`;
  };

  const versionHTML = items.length
    ? items.map(itemHTML).join("")
    : '<p class="hint">No history recorded yet for this ICB.</p>';

  // upcoming markers: future-dated events + scheduled review
  const g = DATA.guidelines.find((x) => x.ICB === icb);
  const today = new Date().toISOString().slice(0, 10);
  const review = g && g.next_review && g.next_review < FAR_FUTURE ? g.next_review : null;
  const upcoming = [
    ...events
      .filter((e) => e.date > lastMonth)
      .map((e) => ({
        date: e.date,
        text: (e.category !== "ALL" ? e.category + " — " : "") + e.description,
        note: "will split intervals once data reaches this date",
      })),
    ...(review
      ? [{
          date: review,
          text: review < today ? "Guideline review OVERDUE" : "Guideline review due",
          note: review < today ? "review date has passed — chase for the updated guideline" : "",
        }]
      : []),
  ].sort((a, b) => (a.date < b.date ? -1 : 1));
  const upcomingHTML = upcoming.length
    ? `<h3 style="margin-top:16px">Upcoming &amp; reminders</h3>
       <div class="version-list">${upcoming
         .map(
           (u) => `
         <div class="version-item upcoming">
           <div class="version-head">${u.date}</div>
           <div class="state-line">${esc(u.text)}${u.note ? ` <span class="hint">(${u.note})</span>` : ""}</div>
         </div>`
         )
         .join("")}</div>`
    : "";

  // interval markers are maintained in the events workbook, not in the UI
  const sourceNoteHTML = `
    <p class="hint" style="margin:0 0 14px">
      Interval markers come from <code>data/GL Events.xlsx</code> — add a row there
      (ICB | Date | Category | Description | … | Published Date | Next Review Date) and reload.
      Past dates split the intervals below; future dates appear under Upcoming.
      Auto-detected guideline changes are recorded in the same sheet with their new publish/review dates.
    </p>`;

  // interval performance table
  const stats = intervals.map((iv) => ({ iv, s: intervalStats(icb, iv.start, iv.end) }));
  const intervalHTML = `
    <div class="table-wrap">
      <table class="interval-table">
        <thead><tr>
          <th>Interval</th><th>Trigger</th>
          ${cats.map((c) => `<th class="num">${c} avg ${metricName}/mo</th><th>${c} top brand (MS%)</th>`).join("")}
        </tr></thead>
        <tbody>
          ${stats
            .map(({ iv, s }, i) => {
              const prev = i > 0 ? stats[i - 1].s : null;
              const st = activeStateFor(icb, iv.start);
              return `
              <tr>
                <td><strong>${iv.name}</strong></td>
                <td class="hint">${esc(iv.label)}</td>
                ${cats
                  .map((c) => {
                    const cur = s[c];
                    const pr = prev ? prev[c] : null;
                    const avgDeltaPct =
                      pr && pr.avg ? ((cur.avg - pr.avg) / pr.avg) * 100 : null;
                    const msPrev = pr && cur.topBrand ? pr.shares[cur.topBrand] ?? null : null;
                    const glFirst =
                      c === "EHF" ? st.ehf_first : c === "AAF" ? st.aaf_first : "";
                    return `
                    <td class="num">${cur.months ? fmtNum(cur.avg) : "—"}${
                      avgDeltaPct != null ? deltaHTML(avgDeltaPct, 0, "%") : ""
                    }</td>
                    <td>${
                      cur.topBrand
                        ? `${esc(cur.topBrand)} <strong>${cur.topMS.toFixed(1)}%</strong>${
                            msPrev != null ? deltaHTML(cur.topMS, msPrev, "%") : ""
                          }`
                        : "—"
                    }${glFirst ? `<div class="hint">GL 1st: ${esc(glFirst)}</div>` : ""}</td>`;
                  })
                  .join("")}
              </tr>`;
            })
            .join("")}
        </tbody>
      </table>
    </div>
    <p class="hint" style="margin:8px 2px 0">
      Intervals are split at guideline publication dates and tracked changes.
      Δ% on avg volume compares with the previous interval; Δ% on MS compares the same brand's MS% with the previous interval.
    </p>`;

  const explorerCat = explorerCategory();
  const catNote =
    SEL.category.size === 0
      ? " (defaulting to EHF — click a category card to switch)"
      : SEL.category.size > 1
      ? ` (showing ${explorerCat} — first of the selected categories)`
      : "";
  $("tracker-hint").textContent = "— " + icb;
  $("tracker-body").innerHTML = `
    ${sourceNoteHTML}
    <div class="tracker-grid">
      <div class="tracker-col">
        <h3>Guideline version history &amp; events</h3>
        <div class="version-list">${versionHTML}</div>
        ${upcomingHTML}
      </div>
      <div class="tracker-col">
        <h3>Performance by guideline interval</h3>
        ${intervalHTML}
      </div>
    </div>
    <div class="explorer-block">
      <div class="explorer-head">
        <h3>Interval explorer — ${explorerCat}
          <span class="hint">shaded bands = guideline intervals, band label = ${explorerCat} guideline product${catNote}</span>
        </h3>
        <div class="toggle" id="explorer-toggle">
          <button data-mode="actual" class="${explorerMode === "actual" ? "active" : ""}">Actuals</button>
          <button data-mode="ms" class="${explorerMode === "ms" ? "active" : ""}">MS%</button>
        </div>
      </div>
      <div class="chart-wrap tall"><canvas id="chart-intervals"></canvas></div>
    </div>`;

  document.querySelectorAll("#explorer-toggle button").forEach((btn) =>
    btn.addEventListener("click", () => {
      document.querySelectorAll("#explorer-toggle button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      explorerMode = btn.dataset.mode;
      saveFilters();
      renderIntervalExplorer(icb, explorerCategory());
    })
  );

  renderIntervalExplorer(icb, explorerCat);
}

/** Full-range brand lines for one ICB + category, with guideline-interval
 *  bands shaded behind. Switchable between actual volumes and monthly MS%. */
function renderIntervalExplorer(icb, cat) {
  const metric = singles.metric();
  const isMS = explorerMode === "ms";
  const months = DATA.meta.months;
  const rows = DATA.performance.filter((r) => r.icb === icb && r.category === cat);
  const brands = [...sumBy(rows, (r) => r.brand, metric).entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k);

  const cell = new Map();
  const monthTotal = new Map();
  for (const r of rows) {
    const k = r.date + " " + r.brand;
    cell.set(k, (cell.get(k) || 0) + r[metric]);
    monthTotal.set(r.date, (monthTotal.get(r.date) || 0) + r[metric]);
  }

  const datasets = brands.map((b, i) => ({
    label: b,
    data: months.map((m) => {
      const v = cell.get(m + " " + b) || 0;
      if (!isMS) return v;
      const t = monthTotal.get(m) || 0;
      return t ? (v / t) * 100 : 0;
    }),
    borderColor: colorFor(b, "brand", i),
    backgroundColor: colorFor(b, "brand", i),
    fill: false,
    tension: 0.25,
    pointRadius: 0,
    pointHitRadius: 8,
    borderWidth: 2,
    datalabels: pointLabels(colorFor(b, "brand", i), isMS),
  }));

  upsertChart("chart-intervals", {
    type: "line",
    data: { labels: months.map(monthLabel), datasets },
    plugins: [intervalBandsPlugin, glMarkerPlugin],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 14 } },
      interaction: { mode: "index", intersect: false },
      plugins: {
        intervalBands: { bands: bandsFor(icb, months) },
        glMarkers: { marks: glMarksFor(months) },
        legend: { position: "bottom", labels: { boxWidth: 12, usePointStyle: true } },
        tooltip: {
          callbacks: {
            label: (c) =>
              ` ${c.dataset.label}: ` +
              (isMS ? "MS% " + c.parsed.y.toFixed(1) + "%" : fmtMetric(c.parsed.y)),
          },
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          grace: "8%", // headroom for point labels; max auto-fits the data
          ticks: { callback: (v) => (isMS ? v + "%" : fmtMetric(v)) },
        },
        x: { grid: { display: false } },
      },
    },
  });
}

function renderTracker() {
  const icb = singleICB();
  $("tracker-back").hidden = !icb;
  if (icb) {
    renderTrackerDetail(icb);
  } else {
    if (charts["chart-intervals"]) {
      charts["chart-intervals"].destroy();
      delete charts["chart-intervals"];
    }
    renderTrackerSummary();
  }
}

// ---------- guidelines table ----------

function glBadge(text) {
  if (!text) return "";
  const t = text.toUpperCase();
  let cls = "all";
  if (t.startsWith("MIXED")) cls = "mixed";
  else if (t.includes("EXCLUSIVE")) cls = "exclusive";
  else if (t.includes("JOINT")) cls = "joint";
  return `<span class="badge ${cls}">${text}</span>`;
}

function changeStatus(g, curSet) {
  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date(Date.now() + 90 * 864e5).toISOString().slice(0, 10);
  if (g.latest_published && curSet.has(g.latest_published.slice(0, 7)))
    return { rank: 0, html: `<span class="badge exclusive">Updated this period</span>` };
  if (g.next_review && g.next_review < FAR_FUTURE && g.next_review < today)
    return { rank: 1, html: `<span class="badge overdue">Review overdue</span>` };
  if (g.next_review && g.next_review < soon)
    return { rank: 2, html: `<span class="badge due-soon">Review due &le;90d</span>` };
  if (!g.next_review || g.next_review >= FAR_FUTURE)
    return { rank: 4, html: `<span class="badge all">No review scheduled</span>` };
  return { rank: 3, html: `<span class="badge ok-date">Current</span>` };
}

function dateCell(iso) {
  if (!iso) return "";
  if (iso >= FAR_FUTURE) return '<span class="hint">—</span>';
  return iso;
}

function renderGLTable(win) {
  const q = $("gl-search").value.trim().toLowerCase();
  const icbs = visibleICBs();
  const curSet = new Set(win.cur.map((m) => m.slice(0, 7)));

  let rows = DATA.guidelines.filter((g) => {
    if (!icbs.has(g.ICB)) return false;
    if (!q) return true;
    return [g.ICB, g.hdm, g.gl_followed, g.ehf_gl, g.aaf_gl, g.ehf_first, g.aaf_first]
      .join(" ")
      .toLowerCase()
      .includes(q);
  });

  rows = rows
    .map((g) => ({ ...g, _cs: changeStatus(g, curSet) }))
    .sort((a, b) => {
      if (glSort.key === "change_status") return (a._cs.rank - b._cs.rank) * glSort.dir;
      const av = a[glSort.key] || "";
      const bv = b[glSort.key] || "";
      return av < bv ? -glSort.dir : av > bv ? glSort.dir : 0;
    });

  const selected = singleICB();
  const tbody = document.querySelector("#gl-table tbody");
  tbody.innerHTML = rows
    .map(
      (g) => `
      <tr class="${g.ICB === selected ? "selected" : ""}">
        <td class="icb-cell" data-icb="${esc(g.ICB)}">${esc(g.ICB)}${g.n_ccgs > 1 ? ` <span class="hint">(${g.n_ccgs} CCGs)</span>` : ""}</td>
        <td>${glBadge(g.ehf_gl)}</td>
        <td>${esc(g.ehf_first || "")}</td>
        <td>${glBadge(g.aaf_gl)}</td>
        <td>${esc(g.aaf_first || "")}</td>
        <td>${esc(g.hdm || "")}</td>
        <td>${dateCell(g.latest_published)}</td>
        <td>${dateCell(g.next_review)}</td>
        <td>${g._cs.html}</td>
      </tr>`
    )
    .join("");

  tbody.querySelectorAll(".icb-cell").forEach((td) => {
    td.addEventListener("click", () => drillToICB(td.dataset.icb));
  });
}

// ---------- filter persistence (survive page reloads) ----------

function saveFilters() {
  try {
    const state = {
      period: $("f-period").value,
      metric: $("f-metric").value,
      from: $("f-from").value,
      to: $("f-to").value,
      sel: Object.fromEntries(Object.entries(SEL).map(([k, s]) => [k, [...s]])),
      trendDim,
      trendValue,
      explorerMode,
      exclProduct,
      exclDim,
      exclTrendValue,
      icbMatCat,
      icbMatValue,
      ukPeriod: ukState.period,
      ukMetric: ukState.metric,
      ukCatMode: ukState.catMode,
      ukTrendDim: ukState.trendDim,
      ukTrendValue: ukState.trendValue,
      ukMatDim: ukState.matDim,
      ukMatValue: ukState.matValue,
      ukLeagueDim: ukState.leagueDim,
      iePeriod: ieState.period,
      ieMetric: ieState.metric,
      ieTrendDim: ieState.trendDim,
      ieTrendValue: ieState.trendValue,
      ieMatDim: ieState.matDim,
      ieMatValue: ieState.matValue,
      ieLeagueDim: ieState.leagueDim,
    };
    localStorage.setItem("dashboard-filters", JSON.stringify(state));
  } catch (_) { /* private mode etc. — ignore */ }
}

function restoreFilters() {
  try {
    const state = JSON.parse(localStorage.getItem("dashboard-filters") || "{}");
    for (const [id, key] of [["f-period", "period"], ["f-metric", "metric"], ["f-from", "from"], ["f-to", "to"]]) {
      const v = state[key];
      if (v != null && [...$(id).options].some((o) => o.value === v)) $(id).value = v;
    }
    for (const k of Object.keys(SEL)) {
      SEL[k] = new Set(state.sel?.[k] || []);
    }
    if (state.trendDim) trendDim = state.trendDim;
    if (state.trendValue) trendValue = state.trendValue;
    // migrate the old single-mode key ("ms" used to be a dimension)
    if (!state.trendDim && state.trendMode)
      state.trendMode === "ms" ? (trendValue = "ms") : (trendDim = state.trendMode);
    if (state.explorerMode) explorerMode = state.explorerMode;
    if (state.exclProduct) exclProduct = state.exclProduct;
    if (state.exclDim) exclDim = state.exclDim;
    if (state.exclTrendValue) exclTrendValue = state.exclTrendValue;
    if (state.icbMatCat) {
      icbMatCat = state.icbMatCat;
      document.querySelectorAll("#icb-mat-cat-toggle button")
        .forEach((b) => b.classList.toggle("active", b.dataset.cat === icbMatCat));
    }
    if (state.icbMatValue) {
      icbMatValue = state.icbMatValue;
      document.querySelectorAll("#icb-mat-value-toggle button")
        .forEach((b) => b.classList.toggle("active", b.dataset.mode === icbMatValue));
    }
    if (state.ukPeriod) { ukState.period = state.ukPeriod; $("uk-period").value = state.ukPeriod; }
    if (state.ukMetric) { ukState.metric = state.ukMetric; $("uk-metric").value = state.ukMetric; }
    if (state.ukCatMode) {
      ukState.catMode = state.ukCatMode;
      document.querySelectorAll("#uk-cat-toggle button")
        .forEach((b) => b.classList.toggle("active", b.dataset.mode === ukState.catMode));
    }
    if (state.ukTrendDim) {
      ukState.trendDim = state.ukTrendDim;
      document.querySelectorAll("#uk-trend-toggle button")
        .forEach((b) => b.classList.toggle("active", b.dataset.mode === ukState.trendDim));
    }
    if (state.ukTrendValue) {
      ukState.trendValue = state.ukTrendValue;
      document.querySelectorAll("#uk-trend-value-toggle button")
        .forEach((b) => b.classList.toggle("active", b.dataset.mode === ukState.trendValue));
    }
    if (state.ukMatDim) {
      ukState.matDim = state.ukMatDim;
      document.querySelectorAll("#uk-mat-toggle button")
        .forEach((b) => b.classList.toggle("active", b.dataset.mode === ukState.matDim));
    }
    if (state.ukMatValue) {
      ukState.matValue = state.ukMatValue;
      document.querySelectorAll("#uk-mat-value-toggle button")
        .forEach((b) => b.classList.toggle("active", b.dataset.mode === ukState.matValue));
    }
    if (state.ukLeagueDim) {
      ukState.leagueDim = state.ukLeagueDim;
      document.querySelectorAll("#uk-league-toggle button")
        .forEach((b) => b.classList.toggle("active", b.dataset.mode === ukState.leagueDim));
    }
    if (state.iePeriod) { ieState.period = state.iePeriod; $("ie-period").value = state.iePeriod; }
    if (state.ieMetric) { ieState.metric = state.ieMetric; $("ie-metric").value = state.ieMetric; }
    if (state.ieTrendDim) {
      ieState.trendDim = state.ieTrendDim;
      document.querySelectorAll("#ie-trend-toggle button")
        .forEach((b) => b.classList.toggle("active", b.dataset.mode === ieState.trendDim));
    }
    if (state.ieTrendValue) {
      ieState.trendValue = state.ieTrendValue;
      document.querySelectorAll("#ie-trend-value-toggle button")
        .forEach((b) => b.classList.toggle("active", b.dataset.mode === ieState.trendValue));
    }
    if (state.ieMatDim) {
      ieState.matDim = state.ieMatDim;
      document.querySelectorAll("#ie-mat-toggle button")
        .forEach((b) => b.classList.toggle("active", b.dataset.mode === ieState.matDim));
    }
    if (state.ieMatValue) {
      ieState.matValue = state.ieMatValue;
      document.querySelectorAll("#ie-mat-value-toggle button")
        .forEach((b) => b.classList.toggle("active", b.dataset.mode === ieState.matValue));
    }
    if (state.ieLeagueDim) {
      ieState.leagueDim = state.ieLeagueDim;
      document.querySelectorAll("#ie-league-toggle button")
        .forEach((b) => b.classList.toggle("active", b.dataset.mode === ieState.leagueDim));
    }

    document.querySelectorAll(".custom-range").forEach((el) => (el.hidden = $("f-period").value !== "custom"));
    document
      .querySelectorAll("#trend-toggle button")
      .forEach((b) => b.classList.toggle("active", b.dataset.mode === trendDim));
    document
      .querySelectorAll("#trend-value-toggle button")
      .forEach((b) => b.classList.toggle("active", b.dataset.mode === trendValue));
    document
      .querySelectorAll("#excl-dim-toggle button")
      .forEach((b) => b.classList.toggle("active", b.dataset.dim === exclDim));
    document
      .querySelectorAll("#excl-val-toggle button")
      .forEach((b) => b.classList.toggle("active", b.dataset.mode === exclTrendValue));

    // rebuild option lists so pruning + checkbox state reflect the restored SEL
    setMselOptions("category", DATA.meta.categories);
    setMselOptions("region", DATA.meta.regions);
    setMselOptions("hdm", [...HDM_ICBS.keys()].sort());
    setMselOptions("manufacturer", DATA.meta.manufacturers);
    setMselOptions("brand", DATA.meta.brands);
    setMselOptions("icb", icbListForDropdown());
    setMselOptions("ccg", DATA.meta.ccgs);
  } catch (_) { /* ignore corrupt state */ }
}

// ---------- filters setup ----------

function setupFilters() {
  initMsels();
  setMselOptions("category", DATA.meta.categories);
  setMselOptions("region", DATA.meta.regions);
  setMselOptions("icb", DATA.meta.icbs);
  setMselOptions("ccg", DATA.meta.ccgs);
  setMselOptions("manufacturer", DATA.meta.manufacturers);
  setMselOptions("brand", DATA.meta.brands);
  setMselOptions("hdm", [...HDM_ICBS.keys()].sort());

  const months = DATA.meta.months;
  const from = $("f-from"), to = $("f-to");
  from.innerHTML = to.innerHTML = "";
  for (const m of months) {
    from.add(new Option(monthLabel(m), m));
    to.add(new Option(monthLabel(m), m));
  }
  from.value = months[0];
  to.value = months[months.length - 1];

  $("f-period").addEventListener("change", () => {
    const custom = singles.period() === "custom";
    document.querySelectorAll(".custom-range").forEach((el) => (el.hidden = !custom));
    render();
  });
  for (const id of ["f-metric", "f-from", "f-to"]) $(id).addEventListener("change", render);

  $("clear-filters").addEventListener("click", () => {
    for (const k of ALL_SLICERS) SEL[k].clear(); // guidelines slicers only
    $("f-metric").value = "factored_units";
    $("f-period").value = "mat";
    trendDim = "brand";
    trendValue = "actual";
    explorerMode = "actual";
    icbMatCat = "AAF";
    icbMatValue = "actual";
    document.querySelectorAll("#icb-mat-cat-toggle button")
      .forEach((b) => b.classList.toggle("active", b.dataset.cat === "AAF"));
    document.querySelectorAll("#icb-mat-value-toggle button")
      .forEach((b) => b.classList.toggle("active", b.dataset.mode === "actual"));
    document.querySelectorAll(".custom-range").forEach((el) => (el.hidden = true));
    document
      .querySelectorAll("#trend-toggle button")
      .forEach((b) => b.classList.toggle("active", b.dataset.mode === "brand"));
    document
      .querySelectorAll("#trend-value-toggle button")
      .forEach((b) => b.classList.toggle("active", b.dataset.mode === "actual"));
    setMselOptions("icb", DATA.meta.icbs);
    for (const def of MSEL_DEFS) updateMselUI(def.key);
    from.value = months[0];
    to.value = months[months.length - 1];
    $("gl-search").value = "";
    render();
  });

  $("gl-search").addEventListener("input", () => renderGLTable(periodWindows()));

  document.querySelectorAll("#trend-toggle button").forEach((btn) =>
    btn.addEventListener("click", () => {
      document.querySelectorAll("#trend-toggle button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      trendDim = btn.dataset.mode;
      saveFilters();
      const win = periodWindows();
      renderTrend(rowsFor(win.cur), win);
    })
  );

  document.querySelectorAll("#trend-value-toggle button").forEach((btn) =>
    btn.addEventListener("click", () => {
      document.querySelectorAll("#trend-value-toggle button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      trendValue = btn.dataset.mode;
      saveFilters();
      const win = periodWindows();
      renderTrend(rowsFor(win.cur), win);
    })
  );

  document.querySelectorAll("#gl-table thead th").forEach((th) =>
    th.addEventListener("click", () => {
      const key = th.dataset.sort;
      glSort.dir = glSort.key === key ? -glSort.dir : 1;
      glSort.key = key;
      renderGLTable(periodWindows());
    })
  );

  document.querySelectorAll("#excl-table thead th").forEach((th) =>
    th.addEventListener("click", () => {
      const key = th.dataset.sort;
      exclSort.dir = exclSort.key === key ? -exclSort.dir : 1;
      exclSort.key = key;
      renderExclTable();
    })
  );

  $("excl-product").addEventListener("change", () => {
    exclProduct = $("excl-product").value;
    saveFilters();
    renderExclusiveTrend();
  });
  document.querySelectorAll("#excl-dim-toggle button").forEach((btn) =>
    btn.addEventListener("click", () => {
      document.querySelectorAll("#excl-dim-toggle button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      exclDim = btn.dataset.dim;
      saveFilters();
      renderExclusiveTrend();
    })
  );
  document.querySelectorAll("#excl-val-toggle button").forEach((btn) =>
    btn.addEventListener("click", () => {
      document.querySelectorAll("#excl-val-toggle button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      exclTrendValue = btn.dataset.mode;
      saveFilters();
      renderExclusiveTrend();
    })
  );

  // ICB MAT year-on-year (MJN exclusives): AAF/EHF + Actuals/MS% toggles
  document.querySelectorAll("#icb-mat-cat-toggle button").forEach((btn) =>
    btn.addEventListener("click", () => {
      document.querySelectorAll("#icb-mat-cat-toggle button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      icbMatCat = btn.dataset.cat;
      saveFilters();
      renderICBMatYoY();   // only this chart depends on these toggles
    })
  );
  document.querySelectorAll("#icb-mat-value-toggle button").forEach((btn) =>
    btn.addEventListener("click", () => {
      document.querySelectorAll("#icb-mat-value-toggle button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      icbMatValue = btn.dataset.mode;
      saveFilters();
      renderICBMatYoY();
    })
  );

  $("tracker-back").addEventListener("click", () => {
    SEL.icb.clear();
    updateMselUI("icb");
    render();
  });

  $("refresh-btn").addEventListener("click", refreshData);
}

// ---------- main ----------

function render() {
  saveFilters();
  refreshSlicersIfChanged();  // cross-filter every slicer off the others
  updateMselUI("category"); // cards and the Category dropdown share SEL.category
  const win = periodWindows();
  const rows = rowsFor(win.cur);
  renderCatCards(win);
  renderTrend(rows, win);
  renderCatMS(win);
  renderDonut("chart-share", rows, "brand", "brand");
  renderDonut("chart-mfr", rows, "manufacturer", "manufacturer");
  renderTopICBs(rows);
  renderICBMatYoY();
  // temporarily hidden along with their cards in index.html — uncomment both to restore
  // renderGLChart(rows);
  // renderGLTimeline();
  renderExclusiveTrend();
  renderExclTable();
  renderTracker();
  renderGLTable(win);
}
