# Specialist Formula Dashboard

Live dashboard merging **GL Dataset Base.xlsx** (guidelines per APC/CCG) with
**Unaggreagted Performance (2) - Copy.xlsx** (monthly prescribing performance),
joined on `APC` ↔ `ICB` (70 ICBs, 1:1 match).

## Run

```bash
pip3 install -r requirements.txt
python3 app.py
# open http://localhost:5001
```

## The Excel files are the source of truth

The dashboard reads the **raw Excel workbooks** directly — there is no JSON
data file to keep in sync.

- Source files live in `data/`:
  - `data/GL Dataset Base.xlsx`
  - `data/Performance.xlsx`  (performance rows on the `PivotTable1` sheet)
- **To update the data**, just edit those workbooks (or drop in new versions
  with the same file names) and reload the page. The server notices the
  changed modified-time/size and re-reads the workbooks in memory on the next
  request — no restart, no rebuild step.
- The **Refresh data** button forces an immediate re-read (`POST /api/refresh`).
- Reading the ~48 MB performance workbook takes a few seconds; the result is
  held in memory and only re-read when a file actually changes.
- Robust to hand-editing: blank/partial rows are dropped, and the `APC` merge
  key (an Excel formula in the GL sheet) is reconstructed from `ICS`/`CCG-PCO`
  if a save tool strips the formula's cached value.
- Override the source paths if you keep the files elsewhere:
  `GL_XLSX=... PERF_XLSX=... PERF_SHEET=... python3 app.py`

## Structure

| File | Purpose |
|---|---|
| `process_data.py` | Reads both workbooks, aggregates performance to ICB × Category × Brand × Month, summarises guidelines to ICB level ("Mixed: …" where sub-CCGs differ), merges, writes `data/dashboard_data.json` |
| `app.py` | Flask server: static frontend + `/api/data` + `/api/refresh` |
| `static/` | Frontend: vanilla JS + Chart.js (CDN) |

## Dashboard features

### Period metrics (measured against Factored Units / KGs by default)
- **MAT** — Moving Annual Total, last 12 months vs the prior 12 months
- **Rolling QTR** — last 3 months vs the prior 3 months
- **YTD** — current year to latest month vs the same span of the prior year
- **All data** / **Custom** month range
- Each period card shows the total for the window plus growth % vs the
  comparison window (▲/▼).

### Category-separated KPIs
- One card each for **EHF**, **AAF**, **RICE** (accounted separately), showing
  the period total in KGs, growth vs the comparison period, and the top brand's
  MS%. Click a card to drill the whole dashboard into that category.

### MS% (market share) everywhere
- Brand & manufacturer donuts, the per-category 100%-stacked bars, and the
  guideline-status chart all carry on-chart **MS%** data labels.
- Trend chart has a dedicated **MS%** mode (monthly brand share, 0–100%).

### Guideline change tracking (by date intervals)
- **Guideline changes** KPI: how many guidelines were *published* inside the
  selected period, plus a count of overdue reviews.
- **Guideline change timeline** chart: publications per quarter (blue) and
  reviews falling due per quarter (amber upcoming / red overdue).
- On a single-ICB view, dashed markers on the trend line show when that ICB's
  guideline was published — so you can read prescribing shifts against changes.
- Guidelines table has a **Change status** column (Updated this period /
  Review overdue / Review due ≤90d / Current / No review scheduled), sortable.

### First-line exclusive performance trend
- **First-line product filter**: pick an exclusive 1st-line product (e.g.
  Nutramigen). The card scopes to the ICBs where that product is the exclusive
  1st-line (its category is implied) and plots how it competes there — e.g.
  Nutramigen vs Pepti vs Althera in EHF. The selected product's line is bold.
- **Brands / Products toggle**: compare at brand level, or drill to client
  lines (Nutramigen 1/2/3 vs Pepti 1/2/… ); in product+MS% mode a dashed
  black line shows the selected brand's aggregate share (compliance).
- **Actuals / MS%** toggle, dynamic y-axis.
- **Timing markers**: pink dashed verticals at guideline publish / change
  months across the scoped ICBs (labelled `GL ×N` when several coincide).
- Caption gives the scope size and the product's full-window compliance MS%,
  flagging when competitors out-prescribe the mandated product.
- The product filter is itself cross-filtered by the global region/HDM/ICB
  slicers. Uses the live guideline status, and OTHER is excluded throughout.

### Exclusive 1st-line performance table
- One row per ICB × category × exclusivity span: the exclusive 1st-line
  product, the window it was exclusive (from guideline intervals + tracked
  changes, merged while the product stayed the same), months of data, the
  product's actual volume (total & avg/mo) and its **MS%** of the ICB's
  category volume in that window.
- MS% badge: green ≥80%, amber 50–80%, red <50%. Sorted lowest-first by
  default so leakage (exclusive on paper, low share in practice) tops the
  list. All columns sortable; click a row to drill into the ICB.
- Respects region/HDM/ICB/category filters; uses the full exclusivity window
  (the period filter does not clip it). Product names are matched to
  performance brands (incl. the "Altehra" typo in the GL workbook).

### MJN exclusive wins & losses
- Panel at the top of the Change Tracker (all-ICBs view), derived from the
  tracked guideline history: a **WIN** when a change makes an MJN product
  (Nutramigen/Puramino) the exclusive 1st line — naming who it was won from
  (the previous exclusive product + manufacturer, or the previous Joint/ALL
  status); a **LOSS** when MJN exclusivity ends — naming who it was lost to.
- Respects the region/HDM/ICB/category filters; rows click through to the ICB.
- Fills in automatically as GL updates are detected (empty until the first
  tracked change).

### Other data rules
- The **OTHER** bucket (Pregestimil, Elecare) is excluded from performance
  entirely — all totals, MS% denominators, charts and tables.
- **Category** is also a dropdown filter in the top bar; it shares state with
  the category cards (selecting in either updates both).

### ICB Change Tracker
- The GL workbook is a snapshot with no version history, so the app keeps its
  own append-only log in `data/gl_history.json`: every time the Excel is
  re-read, each ICB's guideline state is diffed against the last recorded
  version and any change is stored (old → new per field, effective date,
  detection date). **Don't delete this file — it is the change history.**
- Tracker section (below the charts):
  - **All-ICBs view**: changes tracked per ICB, last change date, fields
    changed, next review. Click a row to drill in.
  - **Single-ICB view**: full version timeline (v1 baseline, then each change
    with red→green diffs) alongside a **performance-by-interval** table — the
    timeline is split at guideline publication dates and tracked changes, and
    each interval shows per-category avg volume/month (Δ% vs the previous
    interval) and top brand MS% (Δpt vs the previous interval).
- A change's effective date is the workbook's new published date when that
  moved, otherwise the date the change was detected.
- Single-ICB trend chart shows dashed markers at publications, changes and
  manual events.

### Auto-recorded GL updates in the events register
Every guideline change the app detects in the base GL workbook (new publish
date, next-review date, status/product changes) is also **appended as a row
to `data/GL Events.xlsx`** with `Source = Auto` and a readable description,
e.g. `GL updated (v2): EHF GL: Exclusive → Joint First Line; Published:
2023-07-01 → 2026-06-01; …`. The Excel file is therefore the durable,
human-readable register of all GL updates alongside your manual events
(`Source = Manual`). Auto rows are record-keeping only — the app reads those
changes from `gl_history.json`, so editing/deleting Auto rows in Excel never
affects the dashboard. Older event files are migrated (the Source column is
added) automatically.

### Manual interval markers (historical & future)
Auto-detection only sees changes from the day tracking began. To add
boundaries yourself — historical changes you know about, or planned/future
ones — **edit `data/GL Events.xlsx` in Excel** (the single source for
markers; there is no in-dashboard form). One row per event:
`ICB | Date | Category (EHF/AAF/RICE/ALL) | Description | Added | Source |
Published Date | Next Review Date`. Save, reload the page. (The file is
created automatically with headers; older files gain the newer columns
automatically.) Published/Next-review dates on a row are shown on the
tracker timeline; auto-recorded rows fill them from the detected change.

Behaviour:
- **Past dates** split the performance-by-interval table retrospectively and
  appear on the version timeline (amber dots) and as trend-chart markers.
- **Future dates** are listed under *Upcoming & reminders* (with the next
  scheduled guideline review, flagged if overdue) and start splitting the
  intervals automatically once the performance data reaches that month.
- Filters (incl. selected ICB) persist across page reloads via localStorage.

### Interval explorer & band highlights
- Selecting an ICB adds **shaded interval bands** to the Monthly trend chart
  and a dedicated **Interval explorer** chart in the tracker detail view
  (full data range, brand lines for the filtered category).
- Each band is labelled with the guideline's exclusive / 1st-line product for
  the category picked via the category cards (defaults to EHF), taken from the
  guideline state active in that interval.
- Line charts carry per-point value labels; dashed markers show guideline
  publications, tracked changes and manual events.

### Other
- **All dimension filters are multi-selects** (NHS region, ICB/APC,
  manufacturer, brand, HDM): checkbox dropdowns supporting any combination,
  each with its own × clear button. The category cards are multi-select too —
  click cards to combine EHF/AAF/RICE, and each active card has its own ×.
  "Clear all" resets everything at once.
- **Slicers cross-filter each other**: every slicer's available options are the
  values still reachable under the OTHER slicers' current selections (its own
  selection is ignored, so you can always widen it). E.g. picking Manufacturer =
  MJN limits Brand to Nutramigen/Puramino; picking Region = Wales limits ICB and
  HDM to Welsh entries. Already-selected values are never pruned, so choices
  stick even if they'd yield no rows. The panel you're actively editing isn't
  rebuilt under you (no scroll jump mid-selection).
- Drill-down views (tracker detail, interval bands/explorer) appear when
  exactly **one** ICB is selected.
- The Monthly trend has two independent toggles: dimension (**By brand /
  By product / By manufacturer / By category**) × value (**Actuals / MS%**) —
  every view is available as raw volumes or as monthly share (0–100%).
  "By product" is the Client Line level (Pepti 1, Neocate LCP, Nutramigen
  2-MJN, …, 18 lines), one level deeper than brand.
- The Interval explorer has the same **Actuals / MS%** switch: actual volumes
  or each brand's monthly share (0–100%) of the category.
- Metric select: Factored Units KGs / £ / units.
- Tracker summary table shows EHF/AAF 1st & 2nd line products per ICB, and
  the interval table shows the guideline's 1st-line product per interval.
- Top-15 ICBs bar (click a bar to drill in); click an ICB in the table to
  filter the whole dashboard.
- `2050-01-01` placeholder dates are treated as "no review scheduled".
