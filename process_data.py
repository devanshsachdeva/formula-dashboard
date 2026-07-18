"""
Read and merge the two source Excel workbooks into a dashboard-ready payload.

The RAW EXCEL FILES are the source of truth. Drop updated workbooks into
data/ (same file names) and the app re-reads them on the next request/refresh
— nothing is cached to JSON.

Sources (override with env vars GL_XLSX / PERF_XLSX):
  - data/GL Dataset Base.xlsx   guidelines per APC / CCG-PCO
  - data/Performance.xlsx       monthly prescribing performance (PivotTable1 sheet)

Merge key: GL "APC"  <->  Performance "ICB"  (70 values, 1:1 match)

build() returns a dict with:
  - performance : ICB x Category x Brand x Month aggregates, enriched with GL status
  - guidelines  : ICB-level guideline summary (Mixed where sub-CCGs differ)
  - gl_detail   : full CCG/PCO-level guideline rows for the table
  - meta        : dimension lists for the filter dropdowns
"""

import json
import os
import re
from datetime import datetime

import pandas as pd

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")

GL_XLSX = os.environ.get("GL_XLSX", os.path.join(DATA_DIR, "GL Dataset Base.xlsx"))
PERF_XLSX = os.environ.get("PERF_XLSX", os.path.join(DATA_DIR, "Performance.xlsx"))
# ICB -> HDM ownership. When present, this workbook OVERRIDES the HDM column
# of the GL workbook everywhere (slicers, tables, tracker) — it is the single
# source of truth for who owns which ICB.
HDM_XLSX = os.environ.get("HDM_XLSX", os.path.join(DATA_DIR, "Updated ICB HDM Structure.xlsx"))

# spots where the structure file spells an ICB differently from the
# performance/GL workbooks (structure-file spelling -> dashboard spelling)
HDM_ICB_ALIASES = {
    "LEICS LEICESTERSHIRE & RUT ICS": "LEICS LEICSTSH & RUT ICS",
}


def load_hdm_structure() -> dict:
    """UPPERCASE ICB -> HDM from the Updated ICB HDM Structure workbook.
    The file mixes region header rows (e.g. 'Scotland') between the ICB rows;
    those simply never match an ICB name so they fall away harmlessly.
    Returns {} when the file is absent — the GL workbook's own HDM column is
    then used as a fallback."""
    if not os.path.exists(HDM_XLSX):
        return {}
    df = pd.read_excel(HDM_XLSX)
    df = df.iloc[:, :2]
    df.columns = ["ICB", "HDM"]
    df = df.dropna(subset=["ICB", "HDM"])
    out = {}
    for _, r in df.iterrows():
        icb = str(r["ICB"]).strip().upper()
        icb = HDM_ICB_ALIASES.get(icb, icb)
        out[icb] = str(r["HDM"]).strip()
    return out

# Ireland monthly sell-out data (optional — the Ireland page shows a
# placeholder when the file is absent).
IE_XLSX = os.environ.get("IE_XLSX", os.path.join(DATA_DIR, "Ireland Data.xlsx"))
# Brick ID -> Account Plan mapping (real file). The join key is the numeric
# brick ID — the 4-char prefix of the Mini Brick column ("0001" -> 1) — matched
# against this file's `Id` column. Columns: Id | Account Plan.
IE_PLANS_XLSX = os.environ.get("IE_PLANS_XLSX", os.path.join(DATA_DIR, "Account Plans Ireland.xlsx"))

# Optional export target for `python3 process_data.py` (the server does not use it)
OUT_JSON = os.path.join(DATA_DIR, "dashboard_data.json")

# Worksheet that holds the unaggregated performance rows
PERF_SHEET = os.environ.get("PERF_SHEET", "PivotTable1")


def summarise(series: pd.Series) -> str:
    """Collapse a per-CCG column to one ICB-level value, flagging disagreement."""
    vals = sorted(set(str(v).strip() for v in series.dropna() if str(v).strip()))
    if not vals:
        return ""
    if len(vals) == 1:
        return vals[0]
    return "Mixed: " + " | ".join(vals)


def load_guidelines() -> tuple[pd.DataFrame, pd.DataFrame]:
    gl = pd.read_excel(GL_XLSX)
    gl.columns = [str(c).strip() for c in gl.columns]
    # Tolerate blank / partially-filled rows a user may leave behind when
    # editing: coerce APC to string and drop rows with no APC value.
    # The APC column in the workbook is an Excel formula
    #   =IF(ICS in {NORTHERN IRELAND HSCB, WELSH ASSEMBLY}, CCG-PCO, ICS)
    # pandas reads Excel's cached result. If a save tool dropped the cache
    # (APC comes back blank), reconstruct it from the same logic so the merge
    # key survives however the file was edited.
    apc = gl["APC"].astype("object")
    needs_fill = apc.isna() | apc.astype(str).str.strip().isin(["", "nan", "None"])
    if needs_fill.any() and {"ICS", "CCG - PCO STHA"}.issubset(gl.columns):
        special = {"NORTHERN IRELAND HSCB", "WELSH ASSEMBLY"}
        rebuilt = gl.apply(
            lambda r: r["CCG - PCO STHA"] if str(r["ICS"]).strip() in special else r["ICS"],
            axis=1,
        )
        apc = apc.where(~needs_fill, rebuilt)
    gl["APC"] = apc.astype(str).str.strip()
    gl = gl[~gl["APC"].isin(["", "nan", "None"])].copy()

    for col in ("Latest Published Date", "Next Review Date"):
        gl[col] = pd.to_datetime(gl[col], errors="coerce").dt.strftime("%Y-%m-%d")

    detail_cols = [
        "APC", "ICS", "CCG - PCO STHA", "GL Followed", "HDM",
        "Latest Published Date", "Next Review Date", "GL URL",
        "EHF GL", "EHF 1st Line", "EHF 2nd Line",
        "AAF GL", "AAF 1st Line", "AAF 2nd Line",
    ]
    detail = gl[detail_cols].fillna("").rename(columns={"APC": "ICB"})

    summary = (
        gl.groupby("APC")
        .agg(
            ehf_gl=("EHF GL", summarise),
            ehf_first=("EHF 1st Line", summarise),
            ehf_second=("EHF 2nd Line", summarise),
            aaf_gl=("AAF GL", summarise),
            aaf_first=("AAF 1st Line", summarise),
            aaf_second=("AAF 2nd Line", summarise),
            hdm=("HDM", summarise),
            gl_followed=("GL Followed", summarise),
            latest_published=("Latest Published Date", "max"),
            next_review=("Next Review Date", "min"),
            n_ccgs=("CCG - PCO STHA", "nunique"),
        )
        .reset_index()
        .rename(columns={"APC": "ICB"})
    )

    # Override HDM ownership from the Updated ICB HDM Structure workbook — it
    # is the single source of truth when present. ICBs it doesn't cover keep
    # the GL workbook's original HDM as a fallback.
    hdm_map = load_hdm_structure()
    if hdm_map:
        detail["HDM"] = [
            hdm_map.get(str(i).upper(), old) for i, old in zip(detail["ICB"], detail["HDM"])
        ]
        summary["hdm"] = [
            hdm_map.get(str(i).upper(), old) for i, old in zip(summary["ICB"], summary["hdm"])
        ]

    return summary, detail


def load_performance() -> pd.DataFrame:
    perf = pd.read_excel(
        PERF_XLSX,
        sheet_name=PERF_SHEET,
        usecols=[
            "NHS Region", "ICB", "PCO", "CATEGORY", "BRAND", "MANUFACTURER",
            "Client Line", "EXCLUSIVE GL", "DATE", "Units", "Values", "Factored Units",
        ],
    )
    # Drop blank rows and normalise the merge key / dimensions to strings so
    # hand-edited workbooks (stray empty rows, mixed types) don't break parsing.
    # PCO is the sub-ICB prescribing unit — surfaced in the app as "CCG".
    perf = perf.dropna(subset=["ICB", "DATE", "CATEGORY", "BRAND"]).copy()
    perf["PCO"] = perf["PCO"].fillna(perf["ICB"])  # rows without a PCO fall back to the ICB
    for col in ("NHS Region", "ICB", "PCO", "CATEGORY", "BRAND", "MANUFACTURER", "Client Line", "EXCLUSIVE GL"):
        perf[col] = perf[col].astype(str).str.strip()
    perf["DATE"] = pd.to_datetime(perf["DATE"], errors="coerce")
    perf = perf.dropna(subset=["DATE"])
    # exclude the OTHER bucket (Pregestimil, Elecare) from performance entirely
    perf = perf[perf["BRAND"] != "OTHER"]

    agg = (
        perf.groupby(
            ["DATE", "NHS Region", "ICB", "PCO", "CATEGORY", "BRAND", "MANUFACTURER", "Client Line", "EXCLUSIVE GL"],
            as_index=False,
        )[["Units", "Values", "Factored Units"]]
        .sum()
        .rename(
            columns={
                "NHS Region": "region",
                "ICB": "icb",
                "PCO": "ccg",
                "CATEGORY": "category",
                "BRAND": "brand",
                "MANUFACTURER": "manufacturer",
                "Client Line": "product",
                "EXCLUSIVE GL": "exclusive_gl",
                "DATE": "date",
                "Units": "units",
                "Values": "value",
                "Factored Units": "factored_units",
            }
        )
    )
    agg["date"] = pd.to_datetime(agg["date"]).dt.strftime("%Y-%m-%d")
    for col in ("units", "value", "factored_units"):
        agg[col] = agg[col].round(2)
    return agg


# ---------------------------------------------------------------------------
# Ireland performance data
#
# data/Ireland Data.xlsx — monthly sell-out rows:
#   Mini Brick | Brick | County | Province | Market | Product | Month |
#   Euro RRP | Units
# The Mini Brick cell is alphanumeric ("0001 1 LETTERKENNY"): the first 4
# characters are the numeric brick ID (kept as a separate ID column, used to
# merge the Account Plan mapping), and the trailing words are the mini brick
# name proper ("LETTERKENNY") — the leading numbers never surface in the UI.
# ---------------------------------------------------------------------------

# Product -> (brand, manufacturer), following the same families the UK page
# uses so the shared colour scheme applies unchanged.
IE_PRODUCT_BRANDS = {
    "APTAMIL PEPTI": ("PEPTI", "NUTRICIA"),
    "NEOCATE": ("NEOCATE", "NUTRICIA"),
    "NUTRAMIGEN PURAMNO": ("PURAMINO", "MJN"),
    "NUTRAMIGEN": ("NUTRAMIGEN", "MJN"),
    "ALL OTHER BABY MILKS": ("OTHER", "OTHER"),
}

# Price per tin, per product — TO BE PROVIDED. When filled in, the backend
# computes value = units x price (a corrected value column) instead of the
# workbook's Euro RRP. Leave a product out to fall back to Euro RRP for it.
#   e.g. IE_TIN_PRICES = {"NUTRAMIGEN LGG": 19.50, "NEOCATE LCP": 38.20, ...}
IE_TIN_PRICES: dict = {}

# Tin weight (grams) per product, used to convert tins -> Factored Units (KGs):
#   factored_units = units (tins) x grams / 1000
# Rules for resolving a product's tin weight, in order:
#   1. a size in the product name wins   ("… 400G" -> 400, "… 800G" -> 800)
#   2. MJN products are 400g (a fixed rule from the brand)
#   3. an explicit override in IE_TIN_GRAMS below
#   4. otherwise unknown -> the row's factored_units is left as 0 and the
#      product is reported in build() so the missing sizes can be filled in.
# Fill these in once confirmed (grams per tin):
IE_TIN_GRAMS = {
    # "NEOCATE LCP": 400,
    # "NEOCATE JUNIOR": 400,
    # "NEOCATE SYNEO": 400,
    # "APTAMIL PEPTI SYNE": 800,
    # "APTAMIL PEPTI JR": 800,
    # "ALL OTHER BABY MILKS": 800,   # mixed bucket — a nominal average
}

_IE_SIZE_RE = re.compile(r"(\d+)\s*G(?![A-Za-z])")


def ie_tin_grams(product: str, manufacturer: str):
    """Grams per tin for a product, or None when unknown (see rules above)."""
    m = _IE_SIZE_RE.search(str(product).upper())
    if m:
        return int(m.group(1))
    if product in IE_TIN_GRAMS:
        return IE_TIN_GRAMS[product]
    if manufacturer == "MJN":
        return 400  # MJN tins are 400g
    return None

# The single HDM who owns all of Ireland (used by the RLS login gate; the
# Ireland page itself intentionally has NO HDM filter).
IE_HDM = "Celine Jordan"


def _ie_brand_mfr(product: str) -> tuple:
    p = product.upper()
    for prefix, bm in IE_PRODUCT_BRANDS.items():
        if p.startswith(prefix):
            return bm
    return ("OTHER", "OTHER")


def load_ie_plans() -> dict:
    """Brick ID (int) -> Account Plan name, from the Id | Account Plan file."""
    if not os.path.exists(IE_PLANS_XLSX):
        return {}
    df = pd.read_excel(IE_PLANS_XLSX)
    df.columns = [str(c).strip().upper() for c in df.columns]
    if "ID" not in df.columns or "ACCOUNT PLAN" not in df.columns:
        return {}
    out = {}
    for _, r in df.dropna(subset=["ID", "ACCOUNT PLAN"]).iterrows():
        try:
            key = int(float(str(r["ID"]).strip()))
        except ValueError:
            continue
        out[key] = str(r["ACCOUNT PLAN"]).strip()
    return out


def load_ireland():
    """Ireland rows ready for the dashboard, or None when the file is absent."""
    if not os.path.exists(IE_XLSX):
        return None
    ie = pd.read_excel(IE_XLSX)
    ie.columns = [str(c).strip() for c in ie.columns]
    ie = ie.dropna(subset=["Mini Brick", "Product", "Month"]).copy()

    mb = ie["Mini Brick"].astype(str).str.strip()
    # ID = the numeric 4-char prefix ("0001 1 LETTERKENNY" -> "0001")
    ie["ID"] = mb.str[:4]
    # mini brick name = the words after the "#### #" prefix ("LETTERKENNY")
    ie["mini_brick"] = mb.str.replace(r"^\d{4}\s+\d+\s*", "", regex=True).str.strip()
    # brick name without its numeric prefix ("0001-DONEGAL" -> "DONEGAL")
    ie["brick"] = (
        ie["Brick"].astype(str).str.replace(r"^\d+\s*-\s*", "", regex=True).str.strip()
    )

    for col in ("County", "Province", "Product"):
        ie[col] = ie[col].astype(str).str.strip()
    ie["Month"] = pd.to_datetime(ie["Month"], errors="coerce")
    ie = ie.dropna(subset=["Month"])

    brands = ie["Product"].map(lambda p: _ie_brand_mfr(p))
    ie["brand"] = brands.map(lambda t: t[0])
    ie["manufacturer"] = brands.map(lambda t: t[1])

    # value column: corrected tin pricing when provided, Euro RRP otherwise
    def _value(r):
        price = IE_TIN_PRICES.get(r["Product"])
        return r["Units"] * price if price is not None else r["Euro RRP"]

    ie["value"] = ie.apply(_value, axis=1)

    # Factored Units (KGs) = tins x tin weight. Unknown-weight products get 0
    # (and are reported by build_ireland so the missing sizes can be added).
    ie["_grams"] = ie.apply(lambda r: ie_tin_grams(r["Product"], r["manufacturer"]), axis=1)
    ie["factored_units"] = ie.apply(
        lambda r: r["Units"] * r["_grams"] / 1000.0 if r["_grams"] else 0.0, axis=1
    )

    # Account Plan merge — join the numeric brick ID ("0001" -> 1) to the
    # Id | Account Plan file. Bricks with no listed plan get "No Plan".
    plans = load_ie_plans()

    def _plan(bid):
        try:
            return plans.get(int(bid), "No Plan")
        except (ValueError, TypeError):
            return "No Plan"

    ie["account_plan"] = ie["ID"].map(_plan)

    agg = (
        ie.groupby(
            ["Month", "ID", "mini_brick", "brick", "County", "Province",
             "Product", "brand", "manufacturer", "account_plan"],
            as_index=False,
        )[["Units", "value", "factored_units"]]
        .sum()
        .rename(columns={
            "Month": "date", "ID": "id", "County": "county",
            "Province": "province", "Product": "product", "Units": "units",
        })
    )
    agg["date"] = pd.to_datetime(agg["date"]).dt.strftime("%Y-%m-%d")
    for col in ("units", "value", "factored_units"):
        agg[col] = agg[col].round(2)
    # remember which products still have no tin weight (KGs shows 0 for them)
    agg.attrs["kg_unknown"] = sorted(
        ie.loc[ie["_grams"].isna(), "Product"].unique().tolist()
    )
    return agg


def build_ireland():
    """The `ireland` payload key: rows + slicer option lists, or None."""
    agg = load_ireland()
    if agg is None:
        return None
    uniq = lambda col: sorted(agg[col].unique())
    return {
        "hdm": IE_HDM,
        "performance": agg.to_dict(orient="records"),
        "kg_unknown": agg.attrs.get("kg_unknown", []),
        "meta": {
            "months": uniq("date"),
            "provinces": uniq("province"),
            "counties": uniq("county"),
            "bricks": uniq("brick"),
            "mini_bricks": uniq("mini_brick"),
            "products": uniq("product"),
            "brands": uniq("brand"),
            "manufacturers": uniq("manufacturer"),
            "account_plans": uniq("account_plan"),
        },
    }


def source_signature() -> tuple:
    """(path, mtime, size) for each source file — used to detect edits."""
    sig = []
    paths = [GL_XLSX, PERF_XLSX]
    if os.path.exists(EVENTS_XLSX):
        paths.append(EVENTS_XLSX)
    if os.path.exists(HDM_XLSX):
        paths.append(HDM_XLSX)  # editing the HDM structure hot-reloads too
    for p in (IE_XLSX, IE_PLANS_XLSX):
        if os.path.exists(p):
            paths.append(p)  # Ireland data + account plans hot-reload too
    for path in paths:
        st = os.stat(path)  # raises FileNotFoundError with a clear message
        sig.append((path, st.st_mtime, st.st_size))
    return tuple(sig)


# ---------------------------------------------------------------------------
# Manual guideline events (historical & future interval markers)
#
# data/GL Events.xlsx is a simple flat workbook the user can edit in Excel —
# one row per event: ICB | Date | Category | Description. Events become
# interval boundaries in the change tracker: historical dates split the
# performance timeline retrospectively; future dates are shown as upcoming
# markers and start splitting once data reaches them. The dashboard's
# "Add interval marker" form appends rows to this same file.
# ---------------------------------------------------------------------------

EVENTS_XLSX = os.path.join(DATA_DIR, "GL Events.xlsx")
EVENT_HEADERS = [
    "ICB", "Date", "Category", "Description", "Added", "Source",
    "Published Date", "Next Review Date",
]
EVENT_CATEGORIES = {"EHF", "AAF", "RICE", "ALL"}

# labels used when writing auto-detected changes into the events register
EVENT_FIELD_LABELS = {
    "ehf_gl": "EHF GL", "ehf_first": "EHF 1st line", "ehf_second": "EHF 2nd line",
    "aaf_gl": "AAF GL", "aaf_first": "AAF 1st line", "aaf_second": "AAF 2nd line",
    "gl_followed": "GL followed", "hdm": "HDM",
    "latest_published": "Published", "next_review": "Next review",
}


def ensure_events_file() -> None:
    if os.path.exists(EVENTS_XLSX):
        return
    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.title = "Events"
    ws.append(EVENT_HEADERS)
    for col, width in zip("ABCDEFGH", (28, 12, 10, 60, 18, 10, 14, 16)):
        ws.column_dimensions[col].width = width
    wb.save(EVENTS_XLSX)


def _events_sheet(wb):
    ws = wb["Events"] if "Events" in wb.sheetnames else wb.active
    # migrate older files: append any missing headers (Source, Published Date,
    # Next Review Date) in EVENT_HEADERS order so positional appends line up
    existing = [str(c.value).strip() for c in ws[1] if c.value]
    col = len(existing) + 1
    for h in EVENT_HEADERS:
        if h not in existing:
            ws.cell(row=1, column=col, value=h)
            existing.append(h)
            col += 1
    return ws


def load_events() -> list:
    ensure_events_file()
    try:
        ev = pd.read_excel(EVENTS_XLSX, sheet_name="Events")
    except ValueError:  # sheet renamed — fall back to the first sheet
        ev = pd.read_excel(EVENTS_XLSX)
    if ev.empty:
        return []
    ev.columns = [str(c).strip() for c in ev.columns]
    for col in ("ICB", "Date", "Description"):
        if col not in ev.columns:
            return []
    ev["Date"] = pd.to_datetime(ev["Date"], errors="coerce")
    ev = ev.dropna(subset=["Date"])
    ev["ICB"] = ev["ICB"].astype(str).str.strip()
    ev = ev[~ev["ICB"].isin(["", "nan", "None"])]

    def _date(v):
        d = pd.to_datetime(v, errors="coerce")
        return "" if pd.isna(d) else d.strftime("%Y-%m-%d")

    out = []
    for r in ev.to_dict(orient="records"):
        # Auto rows are the Excel record of changes the app already tracks in
        # gl_history — skip them here so timelines/intervals don't double-count.
        if _clean(r.get("Source")).upper() == "AUTO":
            continue
        cat = _clean(r.get("Category")).upper() or "ALL"
        out.append({
            "icb": r["ICB"],
            "date": r["Date"].strftime("%Y-%m-%d"),
            "category": cat if cat in EVENT_CATEGORIES else "ALL",
            "description": _clean(r.get("Description")),
            "published": _date(r.get("Published Date")),
            "review": _date(r.get("Next Review Date")),
        })
    out.sort(key=lambda e: e["date"])
    return out


def append_event(icb: str, date: str, category: str, description: str,
                 published: str = "", review: str = "") -> None:
    ensure_events_file()
    from openpyxl import load_workbook

    wb = load_workbook(EVENTS_XLSX)
    ws = _events_sheet(wb)
    ws.append([icb, date, category, description,
               datetime.now().strftime("%Y-%m-%d %H:%M"), "Manual",
               published, review])
    wb.save(EVENTS_XLSX)


def record_auto_events(records: list) -> None:
    """Mirror auto-detected guideline changes into the events workbook so the
    Excel file is a durable register of GL updates (new publish/review dates,
    status changes). Marked Source=Auto; the app itself reads these changes
    from gl_history, so Auto rows are record-keeping only."""
    if not records:
        return
    ensure_events_file()
    from openpyxl import load_workbook

    try:
        wb = load_workbook(EVENTS_XLSX)
        ws = _events_sheet(wb)
        stamp = datetime.now().strftime("%Y-%m-%d %H:%M")
        for r in records:
            ws.append([r["icb"], r["date"], r["category"], r["description"], stamp, "Auto",
                       r.get("published", ""), r.get("review", "")])
        wb.save(EVENTS_XLSX)
    except Exception as e:  # e.g. file locked by Excel — never break the build
        print(f"warning: could not write auto GL events to {EVENTS_XLSX}: {e}")


def _change_category(changes: list) -> str:
    fields = {c["field"] for c in changes}
    ehf = any(f.startswith("ehf_") for f in fields)
    aaf = any(f.startswith("aaf_") for f in fields)
    if ehf and not aaf:
        return "EHF"
    if aaf and not ehf:
        return "AAF"
    return "ALL"


def _change_description(version: int, changes: list) -> str:
    parts = [
        f'{EVENT_FIELD_LABELS.get(c["field"], c["field"])}: {c["old"] or "—"} → {c["new"] or "—"}'
        for c in changes
    ]
    return f"GL updated (v{version}): " + "; ".join(parts)


# ---------------------------------------------------------------------------
# Guideline change tracker
#
# The GL workbook is a snapshot — it carries no version history. So the app
# keeps its own append-only log in data/gl_history.json: every time the Excel
# is re-read, each ICB's guideline state is compared against the last recorded
# version and any difference is stored as a new version with a field-level
# diff. Do not delete this file — it IS the change history.
# ---------------------------------------------------------------------------

HISTORY_JSON = os.path.join(DATA_DIR, "gl_history.json")

# NOTE: "hdm" is intentionally NOT tracked — HDM ownership comes from its own
# structure workbook (Updated ICB HDM Structure.xlsx) and is org reference
# data, not a guideline change; tracking it would flood the register whenever
# territories are reshuffled.
TRACKED_FIELDS = [
    "ehf_gl", "ehf_first", "ehf_second",
    "aaf_gl", "aaf_first", "aaf_second",
    "gl_followed", "latest_published", "next_review",
]


def _clean(v) -> str:
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return ""
    return str(v).strip()


def update_history(gl_summary: pd.DataFrame) -> dict:
    """Compare current guideline state per ICB against the stored history and
    append a new version (with diff) for every ICB whose state changed."""
    history = {}
    if os.path.exists(HISTORY_JSON):
        try:
            with open(HISTORY_JSON) as fh:
                history = json.load(fh)
        except (json.JSONDecodeError, OSError):
            history = {}

    now = datetime.now()
    now_iso = now.isoformat(timespec="seconds")
    today = now.strftime("%Y-%m-%d")
    dirty = False
    auto_events = []  # mirrored into the GL Events workbook as the Excel record

    for row in gl_summary.to_dict(orient="records"):
        icb = row["ICB"]
        state = {f: _clean(row.get(f)) for f in TRACKED_FIELDS}
        versions = history.setdefault(icb, [])

        if not versions:
            # baseline version: effective from the workbook's published date
            versions.append({
                "version": 1,
                "detected_at": now_iso,
                "effective_date": state["latest_published"] or today,
                "state": state,
                "changes": [],
            })
            dirty = True
            continue

        last = versions[-1]["state"]
        changes = [
            {"field": f, "old": last.get(f, ""), "new": state[f]}
            for f in TRACKED_FIELDS
            if last.get(f, "") != state[f]
        ]
        if changes:
            # if the workbook's published date moved, that is the change's
            # effective date; otherwise date it from when we detected it
            eff = (
                state["latest_published"]
                if state["latest_published"] != last.get("latest_published", "")
                and state["latest_published"]
                else today
            )
            version = len(versions) + 1
            versions.append({
                "version": version,
                "detected_at": now_iso,
                "effective_date": eff,
                "state": state,
                "changes": changes,
            })
            auto_events.append({
                "icb": icb,
                "date": eff,
                "category": _change_category(changes),
                "description": _change_description(version, changes),
                "published": state["latest_published"],
                "review": state["next_review"],
            })
            dirty = True

    if dirty:
        with open(HISTORY_JSON, "w") as fh:
            json.dump(history, fh, indent=1)
    record_auto_events(auto_events)
    return history


def build() -> dict:
    for path in (GL_XLSX, PERF_XLSX):
        if not os.path.exists(path):
            raise FileNotFoundError(
                f"Source workbook not found: {path}\n"
                "Drop the Excel file into the data/ folder (or set GL_XLSX / PERF_XLSX)."
            )
    gl_summary, gl_detail = load_guidelines()
    perf = load_performance()

    merged = perf.merge(
        gl_summary[["ICB", "ehf_gl", "aaf_gl"]].rename(columns={"ICB": "icb"}),
        on="icb",
        how="left",
    )
    # guideline status relevant to the row's own category
    merged["gl_status"] = merged.apply(
        lambda r: r["ehf_gl"] if r["category"] == "EHF"
        else (r["aaf_gl"] if r["category"] == "AAF" else ""),
        axis=1,
    )
    merged = merged.drop(columns=["ehf_gl", "aaf_gl"])

    payload = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "sources": {"guidelines": GL_XLSX, "performance": PERF_XLSX},
        "meta": {
            "regions": sorted(merged["region"].unique()),
            "icbs": sorted(merged["icb"].unique()),
            "ccgs": sorted(merged["ccg"].unique()),
            "categories": sorted(merged["category"].unique()),
            "brands": sorted(merged["brand"].unique()),
            "products": sorted(merged["product"].unique()),
            "manufacturers": sorted(merged["manufacturer"].unique()),
            "months": sorted(merged["date"].unique()),
        },
        "performance": merged.to_dict(orient="records"),
        "guidelines": gl_summary.to_dict(orient="records"),
        "gl_detail": gl_detail.to_dict(orient="records"),
        "gl_history": update_history(gl_summary),
        "gl_events": load_events(),
        "ireland": build_ireland(),  # None when data/Ireland Data.xlsx is absent
    }
    return payload


def main() -> str:
    payload = build()
    os.makedirs(os.path.dirname(OUT_JSON), exist_ok=True)
    with open(OUT_JSON, "w") as fh:
        json.dump(payload, fh)
    print(
        f"Wrote {OUT_JSON}: {len(payload['performance'])} performance rows, "
        f"{len(payload['guidelines'])} ICBs, {len(payload['gl_detail'])} GL detail rows"
    )
    return OUT_JSON


if __name__ == "__main__":
    main()
