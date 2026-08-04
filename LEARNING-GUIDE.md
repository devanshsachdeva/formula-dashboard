# Learning Guide — how this dashboard is built

A plain-English walkthrough of the code. Read it top to bottom once, then use
it as a reference. Every code snippet below is real code from this project.

---

## 1. The big picture

```
Excel files (data/)  →  Python (Flask)  →  one JSON payload  →  JavaScript  →  charts
```

1. **Excel is the database.** `GL Dataset Base.xlsx`, `Performance.xlsx` and
   `GL Events.xlsx` live in `data/`. You edit them; nothing else stores data.
2. **Python reads the Excel.** `process_data.py` opens the workbooks with
   pandas, cleans them, merges guidelines onto performance (on ICB = APC),
   and hands back one big dictionary. `app.py` is a tiny web server (Flask)
   that serves that dictionary as JSON at the address `/api/data`. It re-reads
   the Excel automatically whenever a file's "last modified" time changes.
3. **The browser does everything else.** One HTML page (`static/index.html`),
   one stylesheet (`static/css/style.css`) and five JavaScript files draw all
   pages, filters, and charts from that single JSON payload.

### The JavaScript files (load order matters)

| File | Role |
|---|---|
| `js/shared.js` | Things every page needs: colours, the global `DATA` and `SEL` objects, the slicer component, data loading, number formatting. Loaded **first**. |
| `js/guidelines.js` | Everything on the Guidelines page. Also defines `upsertChart()`, `pointLabels()` and `deltaHTML()` which the UK page borrows. |
| `js/uk.js` | Everything on the UK Performance page. |
| `js/ireland.js` | Placeholder for the Ireland page (pattern documented inside). |
| `js/main.js` | Page navigation + start-up. Loaded **last** because it starts the app. |

They are plain scripts sharing one global scope: a function defined in
`shared.js` can be called from `uk.js` because, by the time any code *runs*,
all five files have loaded.

---

## 2. How a chart is created (Chart.js basics)

Every chart in the app is made by the **Chart.js** library (loaded from a CDN
in `index.html`). The recipe is always the same three ingredients:

```html
<!-- 1. a canvas in the HTML — the empty rectangle the chart is painted on -->
<div class="chart-wrap tall"><canvas id="uk-chart-region"></canvas></div>
```

```js
// 2. data + options passed to new Chart(...)
new Chart(canvas, {
  type: "bar",              // what kind of chart: "bar", "line", "doughnut"…
  data: { labels, datasets }, // WHAT to draw
  options: { ... },           // HOW to draw it
});
```

You can't draw two charts on one canvas, so we never call `new Chart`
directly — we use a helper that destroys the old chart first:

```js
function upsertChart(id, config) {
  if (charts[id]) {          // is there already a chart on this canvas?
    charts[id].destroy();    //   yes → remove it completely
    delete charts[id];
  }
  charts[id] = new Chart($(id).getContext("2d"), config); // draw the new one
}
```
`charts` is a plain object acting as a registry: `{"uk-chart-region": <Chart>}`.
`$(id)` is our one-line shortcut for `document.getElementById(id)`.

### Walkthrough: the "Volume by NHS region" bar chart (uk.js)

```js
function renderUKRegion(win, cur, prev) {
  const metric = ukState.metric;                        // "factored_units", "value"…
  const curBy  = sumBy(cur,  (r) => r.region, metric);  // Map: region -> total now
  const prevBy = sumBy(prev, (r) => r.region, metric);  // Map: region -> total before
  const entries = [...curBy.entries()].sort((a, b) => b[1] - a[1]); // biggest first
```
- `sumBy(rows, keyFn, metric)` walks every row and adds up `row[metric]`
  per key. It returns a `Map`, which is like a dictionary.
- `[...curBy.entries()]` turns the Map into an array of `[region, total]`
  pairs so we can sort it. `b[1] - a[1]` sorts descending by the total.

```js
  upsertChart("uk-chart-region", {
    type: "bar",
    data: {
      labels: entries.map(([k]) => k),      // the bar names (region names)
      datasets: [{
        data: entries.map(([, v]) => v),    // the bar lengths (the totals)
        backgroundColor: "#4338ca",         // one colour — single series
        borderRadius: 4,                    // rounded bar ends
```
- `labels` and `datasets[0].data` must line up index by index: label #3
  belongs to value #3.
- `entries.map(([k]) => k)` is "for each pair, keep only the first item".

```js
    options: {
      indexAxis: "y",                       // flip the chart: horizontal bars
      responsive: true,                     // resize with the card
      maintainAspectRatio: false,           // fill the card's height
      plugins: {
        legend: { display: false },         // one series → a legend is noise
        tooltip: { callbacks: { label: (c) => { /* custom hover text */ } } },
      },
      scales: {
        x: { beginAtZero: true, ticks: { callback: (v) => fmtNum(v) } },
      },
    },
  });
}
```
- `scales.x.ticks.callback` lets us re-format the axis numbers
  (648000 → "648.0k"). Chart.js calls it for every tick value.
- `tooltip.callbacks.label` replaces the default hover text with ours —
  here we append the growth vs the prior period.

**Line charts** differ only in `type: "line"` and a few style options:
`tension: 0.25` (smooth curves), `pointRadius: 0` (no dots),
`fill: false` (line, not area). **Stacked bars** (category mix) add
`stacked: true` to *both* axes, which makes each dataset pile on top of the
previous instead of drawing side by side.

---

## 3. How the labels were added

Chart.js does not print values on charts by itself. That is done by a small
add-on called **chartjs-plugin-datalabels**. Three steps made it work:

**Step 1 — load and register the plugin** (top of `shared.js`):
```js
Chart.register(ChartDataLabels);                        // tell Chart.js it exists
Chart.defaults.set("plugins.datalabels", { display: false }); // OFF by default
```
We default it to *off* so a chart only gets labels when we explicitly ask —
otherwise every chart would suddenly be covered in numbers.

**Step 2 — a reusable "label style" for line charts** (`guidelines.js`):
```js
function pointLabels(color, isMS) {
  return {
    display: (c) => (c.dataset.data[c.dataIndex] || 0) > 0, // hide labels on zero
    align: "top",          // put the text above the point
    offset: 2,             // 2px gap between point and text
    clamp: true,           // never draw outside the chart area
    color,                 // same colour as the line it belongs to
    font: { size: 9, weight: "600" },
    formatter: (v) => (isMS ? v.toFixed(0) + "%" : fmtNum(v)), // "42%" or "1.5k"
  };
}
```
- `display` can be a function: the plugin calls it per point, so we can skip
  zeros. `c.dataset.data[c.dataIndex]` is "the value at this point".
- `formatter` converts the raw number into the printed text.

Every line dataset then simply says:
```js
datalabels: pointLabels(colorFor(m, "manufacturer", i), true),
```

**Step 3 — bar-end labels** (region bars, ICB movers, top ICBs):
```js
datalabels: {
  display: true,
  anchor: "end",   // attach the label to the END of the bar (its tip)
  align: "end",    // and place it beyond that point (just outside the bar)
  offset: 2, clamp: true,
  color: "#1a2333",
  font: { size: 10, weight: "700" },
  formatter: (v) => fmtNum(v),
},
```
`anchor` = where on the bar the label attaches; `align` = which direction it
moves from there. `end`+`end` = "just past the tip". Because the text sits
outside the bar, the chart needs breathing room:
`layout: { padding: { right: 48 } }`.

**Labels inside stacked segments** (category mix) add one trick — only show
the label if the segment is big enough to fit it:
```js
display: (ctx) => {
  const v = ctx.dataset.data[ctx.dataIndex];
  if (isMS) return v >= 6;                 // MS% mode: segment ≥ 6 percentage points
  const t = qTotal.get(quarters[ctx.dataIndex]) || 0;
  return t && v / t >= 0.08;               // Actuals: segment ≥ 8% of its bar
},
```

---

## 4. How the slicers were built

A slicer is our custom multi-select dropdown (Chart.js has nothing to do with
it — it's plain HTML + JavaScript). Three pieces work together.

### Piece 1 — the HTML skeleton (`index.html`)

```html
<div class="msel" id="ms-ukbrand">
  <button type="button" class="msel-btn">All brands</button>       <!-- what you click -->
  <button type="button" class="msel-clear" hidden>&times;</button>  <!-- the little × -->
  <div class="msel-panel" hidden></div>                             <!-- the checkbox list -->
</div>
```
The `id` is always `ms-` + the slicer's key. The panel starts `hidden` and
empty — JavaScript fills it with checkboxes.

### Piece 2 — the state: one `Set` per slicer (`shared.js`)

```js
const SEL = {
  brand: new Set(),      // Guidelines page
  ukbrand: new Set(),    // UK page — completely separate
  ...
};
```
A `Set` is a bag of unique values. **The rule of the whole app:** an empty
Set means "no filter"; otherwise a row passes only if its value is in the Set.
That rule appears in every filter function as one line:

```js
(!SEL.ukbrand.size || SEL.ukbrand.has(r.brand))
```
Read it as: "either nothing is ticked (size 0 → allow all), or this row's
brand is one of the ticked ones."

### Piece 3 — the component logic (`shared.js`)

`setMselOptions(key, options)` (re)builds the checkbox list:

```js
function setMselOptions(key, options) {
  const el = mselEl(key);                       // the ms-<key> element
  el._optionList = options;                     // remember for "Select all"
  for (const v of [...SEL[key]])                // drop ticks that no longer exist
    if (!options.includes(v)) SEL[key].delete(v);
  const panel = el.querySelector(".msel-panel");
  panel.innerHTML =
    `<div class="msel-actions">…Select all / Clear buttons…</div>` +
    options.map((o) =>
      `<label class="msel-opt">
         <input type="checkbox" value="${esc(o)}" ${SEL[key].has(o) ? "checked" : ""}>
         <span>${esc(o)}</span>
       </label>`).join("");
```
- We build the checkboxes as an HTML string and inject it with `innerHTML` —
  each option is a `<label>` wrapping a checkbox (clicking the text ticks it).
- `esc()` escapes `< > &` so a value can never break the HTML.

Then each checkbox gets a change listener:
```js
  panel.querySelectorAll("input").forEach((cb) =>
    cb.addEventListener("change", () => {
      if (cb.checked) SEL[key].add(cb.value);   // tick   → add to the Set
      else SEL[key].delete(cb.value);           // untick → remove from the Set
      updateMselUI(key);                        // fix the button label
      onFilterChange(key);                      // redraw the right page
    })
  );
```

`updateMselUI(key)` keeps the closed button honest:
```js
el.querySelector(".msel-btn").textContent =
  n === 0 ? "All brands" : n === 1 ? [...SEL[key]][0] : n + " selected";
```
…and greys out the × when there is nothing to clear.

`initMsels()` handles opening/closing: clicking the button toggles the panel,
and one listener on the whole document closes every panel when you click
anywhere that is *not* inside a slicer:
```js
document.addEventListener("click", (e) => {
  if (!e.target.closest(".msel")) closeAllMsels();
});
```

### Cross-filtering (the Power-BI behaviour)

Each slicer's option list = the values still reachable under what the OTHER
slicers allow. The core idea is one function (`uk.js`):

```js
function ukAvailableOptions(key) {
  const rows = DATA.performance.filter((r) => ukMatches(r, key)); // all slicers EXCEPT key
  return [...new Set(rows.map((r) => r[UK_FIELD[key]]))];         // unique values left
}
```
Why "except key"? If Brand filtered itself, ticking NUTRAMIGEN would remove
every other brand from its own list and you could never widen the selection.

`refreshUKSlicers()` runs this for all six slicers on every change, with two
safeguards: it skips the panel currently open (so your scroll position never
jumps mid-click), and it unions in your ticked values so a selection is never
silently removed.

---

## 5. Periods and growth (MAT / QTR / YTD)

`DATA.meta.months` is every month in the data, oldest first. A period is just
two slices of that array:

```js
const lastN = (n) => months.slice(-n);          // newest n months  (current window)
const prevN = (n) => months.slice(-2 * n, -n);  // the n before them (comparison window)
// MAT  = lastN(12) vs prevN(12)
// QTR  = lastN(3)  vs prevN(3)
```
Growth on the KPI cards is then simply
`(currentTotal - previousTotal) / previousTotal * 100`, and `growthHTML()`
turns it into the coloured ▲ / ▼ text.

---

## 6. Pages and navigation (`main.js`)

There is only ONE HTML file. Each "page" is a `<section>` that starts
`hidden`. The address's hash (`#/uk`) picks the page:

```js
function currentPage() {
  const h = location.hash.replace(/^#\/?/, "");   // "#/uk" -> "uk"
  return ["uk", "ireland", "guidelines"].includes(h) ? h : "home";
}
window.addEventListener("hashchange", showPage);  // browser fires this on every # change
```
`showPage()` hides everything except the current section and — crucially —
re-draws that page's charts: a chart created while its canvas is hidden
measures 0×0 pixels, so we always rebuild on entry.

---

## 7. Recipes

**Add a new chart to the UK page**
1. `index.html`: add a card with a new `<canvas id="uk-chart-XYZ">`.
2. `uk.js`: write `renderUKXYZ()` — filter rows, aggregate with `sumBy`,
   call `upsertChart("uk-chart-XYZ", {...})`.
3. Add the call to `renderUK()`. Done — every slicer now drives it.

**Add a new slicer to the UK page**
1. `index.html`: copy an existing `.msel` block, id `ms-ukSOMETHING`.
2. `shared.js`: add `ukSOMETHING: new Set()` to `SEL`, and an entry to
   `MSEL_DEFS` with its placeholder text.
3. `uk.js`: add `"ukSOMETHING"` to `UK_SLICERS` and its row-field to
   `UK_FIELD`; add a `setMselOptions("ukSOMETHING", …)` line in `setupUK()`.
   Cross-filtering, the × button, Select all/Clear, persistence and
   re-rendering all come for free.

**Build the Ireland page** — follow the plan written at the top of
`ireland.js`: new data source in Python first, then copy the `uk.js` pattern.

---

## 8. The UK Monthly trend & Category mix (added later — worth studying)

### The Monthly trend with two toggles (`uk.js`, section 8)

The old "Manufacturer MS% trend" grew into a general **Monthly trend** driven
by two toggle groups in the card header:

```html
<div class="toggle" id="uk-trend-toggle">          <!-- WHICH lines -->
  <button data-mode="brand" class="active">By brand</button>
  <button data-mode="product">By product</button>
  <button data-mode="manufacturer">By manufacturer</button>
</div>
<div class="toggle" id="uk-trend-value-toggle">    <!-- WHAT the y-axis means -->
  <button data-mode="actual" class="active">Actuals</button>
  <button data-mode="ms">MS%</button>
</div>
```

Two tiny state fields remember the choice: `ukState.trendDim` and
`ukState.trendValue`. The clever bit is that ONE render function handles all
six combinations, because the dimension is just a column name:

```js
const dim = ukState.trendDim;                 // "brand" | "product" | "manufacturer"
const keys = [...sumBy(rows, (r) => r[dim], metric).entries()]  // r[dim] !
  .sort((a, b) => b[1] - a[1]).map(([k]) => k);
```

`r[dim]` means "read whichever column the toggle names" — switch the toggle
and the same code groups by a different column. No duplicated chart code.

### The MS% denominator rule (the most common share-maths bug)

```js
const denomRows = isMS ? DATA.performance.filter(ukMatchesMarket) : rows;
```

`ukMatchesMarket` applies every slicer EXCEPT brand and manufacturer. Why:
market share must be "brand ÷ whole market", not "brand ÷ itself". If the
denominator honoured the brand slicer, ticking one brand would draw a flat
100% line. Tick NUTRAMIGEN and you correctly see its products at their real
shares (11.4%, 5.7%, 0.5%) instead.

### Why the Category mix is quarterly

36 monthly bars were too thin to label. `quarterKey("2025-03-01")` returns
`"2025-Q1"`, so aggregating by it turns 36 months into 13 readable quarters —
wide enough for a label inside every segment. The MS%/Actuals toggle reuses
the same pattern as the trend: one `ukState.catMode` field + one re-render.

### Layout: which card is wide?

A card spans the full row when it has the `wide` class (`.grid-2` is a
two-column grid; `.chart-card.wide` sets `grid-column: 1 / -1`):

- Volume by region → `wide` (long names need room)
- Monthly trend → `wide` (36 labelled points need room)
- Category mix + ICB movers → no class → they sit side by side, half each.
