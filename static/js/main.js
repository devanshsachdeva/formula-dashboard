/* ============================================================================
   main.js — page navigation and app start-up. Must be the LAST <script>.
   ----------------------------------------------------------------------------
   The app is a single HTML file with several <section> "pages". The part of
   the web address after # (the "hash", e.g. #/uk) says which page to show.
   showPage() hides every page except the current one and re-draws its charts
   (a chart drawn while its canvas is hidden gets a size of 0, so we always
   redraw on entry). init() shows the landing page instantly, then loads the
   data in the background and wires up all controls.
   ========================================================================== */
// ---------- page navigation (hash routing) ----------

function currentPage() {
  const h = location.hash.replace(/^#\/?/, "");
  return ["uk", "ireland", "guidelines"].includes(h) ? h : "home";
}

// Every fresh visit should open on the landing page — drop any deep-link hash
// (e.g. a bookmarked #/uk or one left over from a reload) so the report always
// starts at Home. Later in-app navigation via the nav bar still works normally.
function forceLandingPage() {
  if (location.hash) {
    history.replaceState(null, "", location.pathname + location.search);
  }
}

// A "session" is one browser tab session (sessionStorage is cleared when the
// tab/window is closed). On the first load of a new session we wipe the saved
// filter state so everyone starts clean; within the same session, reloads keep
// their filters via localStorage as before.
function isNewSession() {
  try {
    if (sessionStorage.getItem("dashboard-session")) return false;
    sessionStorage.setItem("dashboard-session", "1");
    return true;
  } catch (_) {
    return false; // private mode etc. — behave like a continuing session
  }
}

function resetSavedFilters() {
  try {
    localStorage.removeItem("dashboard-filters");
  } catch (_) { /* ignore */ }
}

function showPage() {
  const p = currentPage();
  $("page-landing").hidden = p !== "home";
  $("page-uk").hidden = p !== "uk";
  $("page-ireland").hidden = p !== "ireland";
  const onDash = p === "guidelines";
  $("dashboard").hidden = !(onDash && DATA);
  $("loading").hidden = !(onDash && !DATA);
  // the data-refresh tools (build timestamp + Refresh button) live in the
  // header and are shown on EVERY page once the data has loaded
  $("header-tools").hidden = !DATA;
  document
    .querySelectorAll("#top-nav a")
    .forEach((a) => a.classList.toggle("active", a.dataset.page === p));
  // charts need visible canvases to size correctly — rebuild on entry
  if (onDash && DATA) render();
  if (p === "uk" && DATA) renderUK();
  if (p === "ireland" && DATA) renderIreland();
  // toggles on a page that was hidden had zero-width buttons — re-measure the
  // sliding thumbs now that this page's controls are visible
  if (typeof positionAllToggleThumbs === "function") positionAllToggleThumbs();
}

window.addEventListener("hashchange", showPage);

// Headroom.js — the sticky navbar hides on scroll-down and springs back on
// scroll-up. Applied to the shared header, so it works on every page.
function initHeadroom() {
  const header = document.querySelector("header");
  if (!header || typeof Headroom === "undefined") return;
  new Headroom(header, {
    offset: 80,       // don't react until scrolled past the header height
    tolerance: 6,     // ignore tiny scroll jitters
    classes: { pinned: "headroom--pinned", unpinned: "headroom--unpinned", top: "headroom--top", notTop: "headroom--not-top" },
  }).init();
}

// ---------- RLS login gate ----------
let _booted = false;

// build the page controls once (after an access scope is chosen)
function bootDashboard() {
  if (_booted) return;
  setupFilters();
  restoreFilters();
  setupUK();
  setupIreland();
  initToggleThumbs(); // animated sliding pill on every segmented toggle
  _booted = true;
}

// Clear every filter on every page at once (from the header button). Reuses
// each page's own "Clear all" logic so the reset stays in sync with per-page
// defaults, then persists the cleared state via their render/saveFilters.
function clearAllFilters() {
  const uk = document.getElementById("uk-clear");
  const ie = document.getElementById("ie-clear");
  const gl = document.getElementById("clear-filters");
  if (uk) uk.click();
  if (ie) ie.click();
  if (gl) gl.click();
}

function updateRlsBadge() {
  const badge = document.getElementById("rls-badge");
  if (!badge) return;
  badge.hidden = false;
  badge.textContent = (RLS_HDM ? "🔒 " + RLS_HDM : "🔓 All ICBs");
}

function showRlsGate() {
  const sel = document.getElementById("rls-select");
  sel.innerHTML =
    '<option value="ALL">All ICBs (admin — full access)</option>' +
    allHdms().map((h) => `<option value="${h.replace(/"/g, "&quot;")}">${h}</option>`).join("");
  if (RLS_HDM) sel.value = RLS_HDM;
  document.getElementById("rls-gate").hidden = false;
}

function confirmRls() {
  const val = document.getElementById("rls-select").value;
  localStorage.setItem("dashboard-rls", val);
  document.getElementById("rls-gate").hidden = true;
  if (_booted) {
    // scope already active and controls wired — reload for a clean re-scope
    location.reload();
    return;
  }
  applyRLS(val === "ALL" ? null : val);
  bootDashboard();
  updateRlsBadge();
  showPage();
}

(async function init() {
  initTheme(); // apply saved/OS dark-or-light before anything renders
  if (isNewSession()) resetSavedFilters(); // fresh session -> no leftover filters
  forceLandingPage();                       // always open on the landing page
  const tt = document.getElementById("theme-toggle");
  if (tt) tt.addEventListener("click", toggleTheme);
  document.getElementById("rls-continue").addEventListener("click", confirmRls);
  document.getElementById("rls-badge").addEventListener("click", showRlsGate);
  const clearBtn = document.getElementById("clear-all-filters");
  if (clearBtn) clearBtn.addEventListener("click", clearAllFilters);
  initHeadroom();
  showPage(); // landing appears immediately while data loads
  try {
    await loadData();
    const saved = localStorage.getItem("dashboard-rls"); // "ALL" | HDM name | null
    if (saved === null) {
      showRlsGate();   // first visit — pick access before anything renders
      return;
    }
    applyRLS(saved === "ALL" ? null : saved);
    bootDashboard();
    updateRlsBadge();
    showPage(); // reveal the (scoped) dashboard now that data is ready
  } catch (e) {
    $("loading").textContent = "Failed to load data: " + e.message;
    $("loading").hidden = currentPage() !== "guidelines";
  }
})();
