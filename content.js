// Noorio Wall: one page showing every camera, built on top of webclient.noorio.com itself.
//
// Same-origin is the whole trick: the frames share your login, and this script can reach inside them to
// pick a camera, find the video, and crop the frame to it. A grid served from disk gets four login screens.
//
// All cameras start at once. A tile that has not started within START_TIMEOUT_MS reloads itself and tries
// again, because a camera that loses the race on one attempt usually wins on the next.

const AUTO_DISCOVER = true;       // read the camera list from Noorio in the background and rebuild if it differs
const SIDEBAR_HEADING = "All devices";   // the sidebar heading the discovery anchors on
const FALLBACK_CAMS = ["Olivia", "Benjamin", "Olivia (Liquids)", "Benjamin (Liquids)"];  // used only if discovery fails
const LOAD_STAGGER_MS = 400;      // small offset between frame loads, four app copies at once is a lot
const FRAME_FIT = true;           // size each frame to its tile instead of always rendering 1500x950
const FRAME_SCALE = 1.25;         // a little headroom above the tile size, for crop quality
const FRAME_MIN_W = 900;          // the app needs some width or its layout changes
const FRAME_MAX_W = 1500;
const FRAME_W = 1500;             // internal width each frame renders at before cropping
const FRAME_H = 950;              // internal height each frame renders at before cropping
const FIT = "cover";              // "cover" fills the tile and crops, "contain" letterboxes
const START_TIMEOUT_MS = 40000;   // reload a tile that has not started within this, retries often succeed
const STALL_SECONDS = 60;         // reload a live tile if its clock stops advancing this long
const STALL_GRACE_MS = 25000;     // ignore stall checks this long after a frame loads
const RECYCLE_MINUTES = 30;       // replace each tile's frame this often, so a day-long stream cannot eat the tab
const RECYCLE_SPREAD = true;      // offset the recycles so only one tile is ever reloading
const RELOAD_COOLDOWN_MS = 300000;    // a single tile may not reload more often than this
const RELOAD_GAP_MS = 20000;          // never two reloads anywhere on the wall inside this window
const BLANK_PAUSE_MS = 400;           // let the old document go before loading the next one
const MAX_RELOADS_PER_HOUR = 10;      // hard ceiling across the whole wall, churn is what kills the tab
const MAX_START_ATTEMPTS = 2;         // after this many failed starts, stop reloading and ask for a click
const PLAY_CLICK_INTERVAL_MS = 2000;  // once a play button exists, retry it this often until the video runs
const PLAY_CLICK_MAX = 15;            // plenty of attempts, the button often appears late
const AUTO_CONTINUE = true;       // dismiss Noorio's "long duration streaming" reminder automatically
const CONTINUE_LABELS = ["Continue", "continue"];        // the keep-streaming button
const SUPPRESS_LABEL = "No more pop-up prompts";         // the checkbox that stops the dialog coming back
const DISCOVER_EVERY_MS = 10000;  // how often to look for the camera list
const DISCOVER_GIVEUP_MS = 120000;// and when to stop looking, rather than scanning every app forever
const DIALOG_CHECK_MS = 30000;    // the dialog and mute sweeps walk the whole app DOM, so keep them rare
const SHOW_PROMO = true;          // the "learn more" bar in the bottom right corner
const PROMO_TEXT = "Learn more about our research at chorylab.com";
const PROMO_URL = "https://www.chorylab.com";
const STATUS_RAIL_W = 270;        // width of the left rail when the grid has no spare cell
const SHOW_STATUS_PANEL = true;   // fill an empty grid cell with what is running and what is reserved
const STATUS_FIRST_DELAY_MS = 20000;  // leave the cameras alone while they start, then fetch lab status
const STATUS_REFRESH_MS = 180000; // re-ask the background for lab status every three minutes
const ICS_MAX_CHARS = 400000;     // only the tail of a calendar feed matters, and some are huge
const STATUS_MAX_ROWS = 3;        // keep the panel small, it has to fit one tile
const ROTATE_STORE = "nw-rotation";   // localStorage key holding {cameraName: degrees}
const MUTE_ALL = true;            // mute every media element in every frame
const CLICK_SOUND_BUTTON = true;  // also press Noorio's own speaker control so its icon shows muted
const SOUND_CLICK_MAX = 2;        // cap, so a misread icon cannot toggle back and forth            // muted video may autoplay, unmuted may not
const POLL_MS = 1200;             // main loop interval while a tile is still coming up
const LIVE_POLL_MS = 6000;        // a tile that is playing needs far less checking, and this is most of the CPU
const MAX_ERR_CHARS = 200;        // lastErr is appended to, so cap it or it grows all day
const SHOW_BANNER = true;         // Chory Lab header bar across the top, B toggles
const BANNER_H = 46;              // header height in pixels
const BANNER_TITLE = "Robot Cameras";   // text next to the wordmark
const SHOW_HUD = true;            // per-tile labels, L toggles
const DEBUG = true;               // console logging

var WALL_GEN = 0;
var NW_TIMERS = [];               // every interval the wall owns, so a rebuild can stop them
var NW_RELOAD_LOG = [];           // when frames were replaced, to keep churn inside a budget
var NW_LAST_RELOAD = 0;
var NW_PHASE = "loading";         // where boot got to, shown on the holding card and in any failure                 // var, not let: hoisted, so load order can never put it in a temporal dead zone

if (window.top === window.self && /wallGrid/.test(location.hash)) { bootWall(); }

// Runs at document_start, before Noorio's app has painted anything. Paint our own background
// immediately, then build the grid as soon as there is a DOM to build it in. Waiting for
// document_idle meant staring at Noorio's white shell while its app booted.
function bootWall() {
  paintBackdrop();
  bootSay("starting");

  window.addEventListener("error", function (e) {                     // anything thrown anywhere, while we are still booting
    if (document.getElementById("nw-boot") && !document.getElementById("nw-grid")) {
      bootFail((e && e.message) || "script error");
    }
  });
  const go = function () {
    bootSay("building");
    try { startWall(); }
    catch (e) { bootFail((e && e.message) || String(e)); throw e; }   // never leave a blank navy page
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", go, { once: true });
  } else {
    go();
  }
  setTimeout(function () {                                            // nothing on screen after this means it failed quietly
    if (!document.getElementById("nw-grid")) {
      bootFail("the wall did not finish starting (last step: " + NW_PHASE + ")");
    }
  }, 10000);
}

function bootFail(message) {
  log("boot failed:", message);
  let boot = document.getElementById("nw-boot");
  if (!boot) {
    boot = document.createElement("div");
    boot.id = "nw-boot";
    (document.body || document.documentElement).appendChild(boot);
  }
  boot.dataset.failed = "1";
  boot.textContent = "";
  boot.style.flexDirection = "column";
  boot.style.gap = "14px";
  boot.style.textTransform = "none";
  boot.style.color = "#ccd8ec";
  boot.style.padding = "24px";
  boot.style.textAlign = "center";

  const h = document.createElement("div");
  h.textContent = "The camera wall did not start";
  h.style.cssText = "font-size:20px;color:#fff;letter-spacing:.01em;";
  const why = document.createElement("div");
  why.textContent = message || "unknown error";
  why.style.cssText = "font-size:13px;color:#8294b3;max-width:520px;";
  const again = document.createElement("button");
  again.textContent = "Reload";
  again.style.cssText = "font:inherit;font-size:14px;cursor:pointer;background:#1272b8;color:#fff;" +
                        "border:1px solid #1272b8;border-radius:2px;padding:9px 20px;letter-spacing:.02em;";
  again.onclick = function () { location.reload(); };
  [h, why, again].forEach(function (el) { boot.appendChild(el); });
}

function bootSay(phase) {                                             // the card says where it got to, not just a logo
  NW_PHASE = phase;
  const boot = document.getElementById("nw-boot");
  if (boot && !boot.dataset.failed) boot.textContent = "Chory Lab robot cameras \u00b7 " + phase;
  log("phase:", phase);
}

function paintBackdrop() {
  const st = document.createElement("style");
  st.id = "nw-boot-style";
  st.textContent =
    "html,body{background:#0d1730 !important;}" +
    "#nw-boot{position:fixed;inset:0;z-index:2147483646;background:#0d1730;display:flex;" +
    "align-items:center;justify-content:center;color:#5d7399;letter-spacing:.08em;" +
    "font-family:'Jost','Century Gothic','Futura',sans-serif;font-size:13px;text-transform:uppercase;}";
  (document.head || document.documentElement).appendChild(st);
  const boot = document.createElement("div");
  boot.id = "nw-boot";
  boot.textContent = "Chory Lab robot cameras";
  (document.body || document.documentElement).appendChild(boot);
}

function startWall() {
  const fromHash = decodeURIComponent((location.hash.match(/cams=([^&]*)/) || [])[1] || "")
    .split("||").map(function (s) { return s.trim(); }).filter(Boolean);
  buildWall(fromHash.length ? fromHash : FALLBACK_CAMS);              // never block on discovery, show something now
}

// Reads the device list out of a frame that is already loaded. No hidden probe, no splash screen.
//
// The sidebar mixes camera names with status captions like "Device off" and "Device upgrading".
// Names share one CSS class across every card, statuses share a different one, so the reliable
// signal is: drop known status wording, group the remaining labels by class, take the biggest group.
const STATUS_PATTERNS = [
  /^device\b/i, /^offline$/i, /^off$/i, /^online$/i, /^upgrading$/i, /^updating$/i,
  /^sleeping$/i, /^standby$/i, /^charging$/i, /^low battery$/i, /^no signal$/i, /^live$/i
];

function looksLikeStatus(t) {
  return STATUS_PATTERNS.some(function (re) { return re.test(t); });
}

function readDeviceNames(doc) {
  const leaves = Array.from(doc.querySelectorAll("div,span,p,li,a"))
    .filter(function (e) { return e.children.length === 0 && e.textContent.trim(); });
  const heading = leaves.filter(function (e) { return e.textContent.trim() === SIDEBAR_HEADING; })[0];
  if (!heading) return [];

  let container = heading.parentElement;                              // climb to the element holding the camera cards
  for (let i = 0; i < 4 && container && container.parentElement; i++) {
    if (container.querySelectorAll("img,canvas,video,svg").length >= 1) break;
    container = container.parentElement;
  }
  if (!container) return [];

  const groups = {};                                                  // className -> labels, in DOM order
  Array.from(container.querySelectorAll("div,span,p,li,a")).forEach(function (e) {
    if (e.children.length) return;
    const t = e.textContent.trim();
    if (!t || t === SIDEBAR_HEADING) return;
    if (t.length > 40) return;                                        // names are short, body copy is not
    if (/^[0-9\s:.\-]+$/.test(t)) return;                            // timestamps and counters
    if (looksLikeStatus(t)) return;                                   // "Device off", "Device upgrading", ...
    const cls = ((e.className && e.className.baseVal) || e.className || "").trim() || "(none)";
    if (!groups[cls]) groups[cls] = [];
    if (groups[cls].indexOf(t) === -1) groups[cls].push(t);
  });

  let best = [];
  Object.keys(groups).forEach(function (cls) {
    if (groups[cls].length > best.length) best = groups[cls];         // the class used by every camera card
  });
  return best;
}

// Columns are camera families: "Olivia" sits above "Olivia (Liquids)", one family per column.
function layoutForCameras(cams) {
  const groups = [];
  const index = {};
  cams.forEach(function (name) {
    const base = name.split(" (")[0].trim();
    if (!(base in index)) { index[base] = groups.length; groups.push({ base: base, items: [] }); }
    groups[index[base]].items.push(name);
  });
  groups.forEach(function (g) {
    g.items.sort(function (a, b) {                                    // the bare name first, variants after it
      if (a === g.base) return -1;
      if (b === g.base) return 1;
      return a.localeCompare(b);
    });
  });
  const rows = groups.reduce(function (m, g) { return Math.max(m, g.items.length); }, 1);
  const placed = [];
  groups.forEach(function (g, col) {
    g.items.forEach(function (name, row) { placed.push({ name: name, col: col + 1, row: row + 1 }); });
  });
  return { cols: groups.length, rows: rows, placed: placed };
}

function log() { if (DEBUG) console.log("[noorio-wall]", ...arguments); }

function buildWall(cams) {
  if (!cams || !cams.length) { log("no cameras to show"); return; }
  const gen = ++WALL_GEN;                                             // anything from an earlier build stops here
  const oldGrid = document.getElementById("nw-grid");
  if (oldGrid) oldGrid.remove();                                      // rebuilding after discovery
  const layout = layoutForCameras(cams);
  const cols = layout.cols, rows = layout.rows;
  log("building wall for", cams, cols + " columns x " + rows + " rows");
  document.title = "Noorio Wall";

  const style = document.createElement("style");
  style.textContent =
    "html,body{margin:0!important;padding:0!important;width:100%!important;height:100%!important;" +
    "overflow:hidden!important;background:#000!important;}" +
    "#nw-bar{position:fixed;top:0;left:0;right:0;height:" + BANNER_H + "px;z-index:2147483647;" +
    "display:flex;align-items:center;gap:16px;padding:0 18px;background:#16244d;color:#fff;" +
    "box-shadow:0 1px 0 rgba(255,255,255,.06);font-family:'Jost','Century Gothic','Futura',sans-serif;}" +
    "#nw-bar img{height:24px;width:auto;display:block;}" +
    "#nw-bar .nw-fallback{font-size:17px;font-weight:500;letter-spacing:.06em;color:#fff;}" +
    "#nw-bar .nw-rule{width:1px;height:20px;background:rgba(255,255,255,.22);}" +
    "#nw-bar .nw-title{font-size:15px;font-weight:400;letter-spacing:.02em;color:#ccd8ec;}" +
    "#nw-bar .nw-spacer{flex:1;}" +
    "#nw-bar .nw-live{display:flex;align-items:center;gap:7px;font-size:12.5px;letter-spacing:.08em;" +
    "text-transform:uppercase;color:#7fb2e5;}" +
    "#nw-bar .nw-dot{width:7px;height:7px;border-radius:50%;background:#7fb2e5;}" +
    "#nw-bar .nw-clock{font-size:13.5px;color:#ccd8ec;font-variant-numeric:tabular-nums;}" +
    "#nw-bar .nw-help{font:inherit;font-size:13px;letter-spacing:.02em;color:#dbe6f6;cursor:pointer;" +
    "background:none;border:1px solid rgba(255,255,255,.34);border-radius:2px;padding:5px 12px;" +
    "transition:background .25s,border-color .25s,color .25s;}" +
    "#nw-bar .nw-help:hover,#nw-bar .nw-help.open{background:rgba(127,178,229,.16);" +
    "border-color:#7fb2e5;color:#fff;}" +
    "#nw-keys{position:fixed;right:18px;z-index:2147483647;min-width:230px;padding:12px 14px;" +
    "background:#0d1730;border-top:2px solid #1272b8;color:#ccd8ec;" +
    "font-family:'Jost','Century Gothic','Futura',sans-serif;font-size:14px;" +
    "box-shadow:0 14px 40px rgba(8,15,35,.45);}" +
    "#nw-keys .nw-row{display:flex;align-items:center;gap:12px;padding:5px 0;}" +
    "#nw-keys kbd{display:inline-block;min-width:22px;text-align:center;background:rgba(255,255,255,.1);" +
    "border:1px solid rgba(255,255,255,.2);border-radius:3px;padding:2px 6px;color:#fff;" +
    "font-family:ui-monospace,Menlo,monospace;font-size:12px;}" +
    "#nw-grid{position:fixed;inset:0;display:grid;gap:2px;background:#222;z-index:2147483646;}" +
    "#nw-grid .nw-tile{position:relative;overflow:hidden;background:#0b0f1a;}" +
    "#nw-grid .nw-tile iframe{background:#0b0f1a;}" +
    "#nw-grid .nw-stage{position:absolute;left:50%;top:50%;overflow:hidden;}" +
    "#nw-grid .nw-tile iframe{position:absolute;border:0;transform-origin:0 0;}" +
    "#nw-grid .nw-rot{position:absolute;right:10px;bottom:10px;z-index:6;cursor:pointer;" +
    "display:flex;align-items:center;gap:6px;padding:5px 10px;border-radius:999px;" +
    "background:rgba(13,23,48,.68);border:1px solid rgba(255,255,255,.16);color:#dbe6f6;" +
    "font-family:'Jost','Century Gothic','Futura',sans-serif;font-size:12.5px;letter-spacing:.02em;" +
    "opacity:0;transition:opacity .2s;-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);}" +
    "#nw-grid .nw-tile:hover .nw-rot{opacity:1;}" +
    "#nw-grid .nw-rot.nw-on{opacity:1;color:#fff;border-color:#7fb2e5;}" +
    "#nw-grid .nw-tile.nw-lastcell .nw-rot{bottom:58px;}" +            // keep clear of the promo bar
    "#nw-promo{position:fixed;right:0;bottom:0;z-index:2147483647;display:flex;align-items:center;gap:9px;" +
    "padding:11px 18px;background:#16244d;color:#dbe6f6;text-decoration:none;" +
    "border-top:1px solid rgba(255,255,255,.14);border-left:1px solid rgba(255,255,255,.14);" +
    "border-top-left-radius:4px;box-shadow:0 -4px 20px rgba(8,15,35,.35);" +
    "font-family:'Jost','Century Gothic','Futura',sans-serif;font-size:14px;letter-spacing:.015em;" +
    "transition:background .25s,color .25s;}" +
    "#nw-promo:hover{background:#1c3160;color:#fff;}" +
    "#nw-promo .nw-mark{width:7px;height:7px;border-radius:50%;background:#7fb2e5;flex:none;}" +
    "#nw-grid .nw-hud{position:absolute;left:14px;top:14px;z-index:5;display:flex;align-items:center;" +
    "gap:12px;padding:6px 22px 6px 6px;border-radius:999px;background:rgba(13,23,48,.74);" +
    "border:1px solid rgba(255,255,255,.16);box-shadow:0 6px 18px rgba(8,15,35,.4);" +
    "-webkit-backdrop-filter:blur(7px);backdrop-filter:blur(7px);color:#fff;" +
    "font-family:'Jost','Century Gothic','Futura',sans-serif;font-size:19px;font-weight:500;" +
    "letter-spacing:.015em;line-height:1;}" +
    "#nw-grid .nw-hud.nw-noavatar{padding:10px 22px;}" +
    "#nw-grid .nw-hud img{width:40px;height:40px;border-radius:50%;object-fit:cover;display:block;" +
    "border:1px solid rgba(255,255,255,.28);}" +
    "#nw-grid.nw-nohud .nw-hud{display:none;}" +
    "#nw-info{position:relative;overflow:auto;background:#0d1730;padding:18px 18px 14px;" +
    "font-family:'Jost','Century Gothic','Futura',sans-serif;color:#ccd8ec;}" +
    "#nw-info h3{margin:0 0 8px;font-size:12.5px;font-weight:500;letter-spacing:.14em;" +
    "text-transform:uppercase;color:#7fb2e5;}" +
    "#nw-info .nw-sect{margin-bottom:16px;}" +
    "#nw-info .nw-item{border-left:3px solid #1272b8;padding:2px 0 2px 10px;margin-bottom:10px;}" +
    "#nw-info .nw-t{font-size:15px;color:#fff;font-weight:500;display:flex;align-items:center;gap:7px;}" +
    "#nw-info .nw-dot{width:8px;height:8px;border-radius:50%;background:#3fbf6f;flex:none;}" +
    "#nw-info .nw-m{font-size:13px;color:#9fb0cc;line-height:1.45;margin-top:2px;}" +
    "#nw-info .nw-none{font-size:13px;color:#8294b3;font-style:italic;}" +
    "#nw-info .nw-foot{font-size:11.5px;color:#6b7d9c;letter-spacing:.02em;}" +
    "#nw-info .nw-qr{margin-top:16px;padding-top:14px;border-top:1px solid rgba(255,255,255,.12);" +
    "display:flex;align-items:center;gap:12px;}" +
    "#nw-info .nw-qr img{width:84px;height:84px;display:block;border-radius:3px;background:#fff;padding:4px;}" +
    "#nw-info .nw-qr .nw-qrtext{min-width:0;}" +
    "#nw-info .nw-qr .nw-qrlabel{font-size:14px;color:#fff;font-weight:500;line-height:1.3;}" +
    "#nw-info .nw-qr .nw-qrurl{font-size:12px;color:#7fb2e5;margin-top:4px;word-break:break-all;}" +
    "#nw-info.nw-rail{padding:16px 14px 12px;}" +
    "#nw-info.nw-rail h3{font-size:11.5px;letter-spacing:.12em;}" +
    "#nw-info.nw-rail .nw-t{font-size:14px;}" +
    "#nw-info.nw-rail .nw-m{font-size:12px;}" +
    "#nw-info.nw-rail .nw-sect{margin-bottom:13px;}" +
    "#nw-info.nw-rail .nw-qr{gap:10px;margin-top:12px;padding-top:12px;}" +
    "#nw-info.nw-rail .nw-qr img{width:70px;height:70px;}" +
    "#nw-info.nw-rail .nw-qr .nw-qrlabel{font-size:13px;}" +
    "#nw-info.nw-rail .nw-qr .nw-qrurl{font-size:11px;}";
  document.documentElement.appendChild(style);

  let bar = document.getElementById("nw-bar");
  if (SHOW_BANNER && !bar) {
    bar = document.createElement("div");
    bar.id = "nw-bar";
    const logo = document.createElement("img");
    logo.src = (typeof NW_LOGO === "string") ? NW_LOGO : "";
    logo.alt = "Chory Lab";
    logo.onerror = function () {                                      // if the image will not render, fall back to type
      const t = document.createElement("span");
      t.className = "nw-fallback";
      t.textContent = "CHORY LAB";
      bar.replaceChild(t, logo);
    };
    const rule = document.createElement("div"); rule.className = "nw-rule";
    const title = document.createElement("div"); title.className = "nw-title"; title.textContent = BANNER_TITLE;
    const spacer = document.createElement("div"); spacer.className = "nw-spacer";
    const live = document.createElement("div"); live.className = "nw-live";
    const dot = document.createElement("span"); dot.className = "nw-dot";
    const liveText = document.createElement("span"); liveText.textContent = "Live";
    live.appendChild(dot); live.appendChild(liveText);
    const help = document.createElement("button");
    help.className = "nw-help";
    help.type = "button";
    help.textContent = "Shortcuts";
    help.title = "Keyboard shortcuts";
    help.addEventListener("click", function (e) { e.stopPropagation(); toggleKeys(); });

    const clock = document.createElement("div"); clock.className = "nw-clock";
    function tickClock() {
      clock.textContent = new Date().toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
    }
    tickClock();
    setInterval(tickClock, 20000);
    [logo, rule, title, spacer, live, help, clock].forEach(function (el) { bar.appendChild(el); });
    document.documentElement.appendChild(bar);
  }

  let gapSlot = null;                                                 // a spare cell in the grid, if the families are uneven
  if (SHOW_STATUS_PANEL) {
    const taken = {};
    layout.placed.forEach(function (sl) { taken[sl.col + ":" + sl.row] = true; });
    for (let r = 1; r <= rows && !gapSlot; r++) {
      for (let c = 1; c <= cols && !gapSlot; c++) { if (!taken[c + ":" + r]) gapSlot = { col: c, row: r }; }
    }
  }
  const railMode = SHOW_STATUS_PANEL && !gapSlot;                     // every cell is full, so the panel goes beside the grid
  const colShift = railMode ? 1 : 0;

  const grid = document.createElement("div");
  grid.id = "nw-grid";
  if (SHOW_BANNER) grid.style.top = BANNER_H + "px";                  // sit under the header
  grid.style.gridTemplateColumns = railMode
    ? STATUS_RAIL_W + "px repeat(" + cols + ", 1fr)"
    : "repeat(" + cols + ", 1fr)";
  grid.style.gridTemplateRows = "repeat(" + rows + ", 1fr)";
  if (!SHOW_HUD) grid.classList.add("nw-nohud");
  document.documentElement.appendChild(grid);
  bootSay("grid built");
  const boot = document.getElementById("nw-boot");
  if (boot) boot.remove();                                            // grid is on screen, holding card no longer needed

  const panes = layout.placed.map(function (slot) {
    const name = slot.name;
    const tile = document.createElement("div");
    tile.className = "nw-tile";
    tile.style.gridColumn = String(slot.col + colShift);              // family column, so pairs stay stacked
    tile.style.gridRow = String(slot.row);
    const stage = document.createElement("div");                      // the thing that rotates, the frame sits inside it
    stage.className = "nw-stage";
    const frame = makeFrame();
    frame.width = frameSize().w;
    frame.height = frameSize().h;
    if (LOAD_STAGGER_MS) {                                            // all at once still, just not the same millisecond
      setTimeout(function () { frame.src = "/"; }, layout.placed.indexOf(slot) * LOAD_STAGGER_MS);
    } else {
      frame.src = "/";
    }
    stage.appendChild(frame);
    const hud = document.createElement("div");
    hud.className = "nw-hud";
    const avatarSrc = (typeof NW_AVATARS === "object" && NW_AVATARS) ? NW_AVATARS[name.split(" ")[0]] : null;
    if (avatarSrc) {
      const av = document.createElement("img");
      av.src = avatarSrc;
      av.alt = "";
      av.onerror = function () { av.remove(); hud.classList.add("nw-noavatar"); };
      hud.appendChild(av);
    } else {
      hud.classList.add("nw-noavatar");                               // no picture for this camera, keep the padding even
    }
    const hudText = document.createElement("span");
    hudText.textContent = name + ": loading";
    hud.appendChild(hudText);
    const rot = document.createElement("div");
    rot.className = "nw-rot";
    rot.title = "Rotate this camera";
    rot.addEventListener("click", function (e) { e.stopPropagation(); rotatePane(name); });

    tile.appendChild(stage);
    tile.appendChild(hud);
    tile.appendChild(rot);
    grid.appendChild(tile);
    return { name: name, tile: tile, stage: stage, frame: frame, hud: hud, hudText: hudText, rot: rot,
             rotation: 0,                                             // replaced by applySavedRotations once storage answers
             state: "loading",                                        // loading -> selecting -> starting -> live, retried on timeout
             turnStarted: Date.now(), cropped: false,
             lastTime: -1, lastAdvance: 0, everPlayed: false,
             playClicks: 0, lastPlayClick: 0, lastReload: 0, soundClicks: 0, lastErr: "",
             recycleAt: 0, startAttempts: 0, vid: null };
  });


  function mediaFor(p) {                                              // cache it, each lookup walks the whole app DOM
    if (p.vid && p.vid.isConnected) {
      const r = p.vid.getBoundingClientRect();
      if (r.width > 120 && r.height > 90) return p.vid;
    }
    const doc = doc_of(p);
    p.vid = doc && doc.body ? media(doc) : null;
    return p.vid;
  }

  function media(doc) {
    const nodes = Array.from(doc.querySelectorAll("video, canvas")).filter(function (n) {
      const r = n.getBoundingClientRect();
      return r.width > 120 && r.height > 90;
    });
    if (!nodes.length) return null;
    return nodes.sort(function (a, b) {
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      return (rb.width * rb.height) - (ra.width * ra.height);
    })[0];
  }

  function cardByName(doc, name) {
    const leaves = Array.from(doc.querySelectorAll("div,span,p,li,a"))
      .filter(function (e) { return e.children.length === 0 && e.textContent.trim() === name; });
    if (!leaves.length) return null;
    let el = leaves[0];
    for (let i = 0; i < 6 && el.parentElement; i++) {
      el = el.parentElement;
      if (el.querySelector("img,svg,canvas,video")) return el;
    }
    return leaves[0].parentElement;
  }

  function realClick(win, el) {
    const r = el.getBoundingClientRect();
    const o = { bubbles: true, cancelable: true, view: win,
                clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
    ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach(function (t) {
      el.dispatchEvent(t.startsWith("pointer") ? new win.PointerEvent(t, o) : new win.MouseEvent(t, o));
    });
  }

  function invokeFrameworkHandler(el, stopAt) {                       // call the app's own onClick as a plain function
    for (let node = el; node && node !== stopAt; node = node.parentElement) {
      const keys = Object.keys(node);
      const rk = keys.find(function (k) {
        return k.indexOf("__reactProps$") === 0 || k.indexOf("__reactEventHandlers$") === 0;
      });
      if (rk && node[rk] && typeof node[rk].onClick === "function") {
        try {
          node[rk].onClick({ target: node, currentTarget: node, nativeEvent: {},
                             stopPropagation: function () {}, preventDefault: function () {} });
          return "react";
        } catch (e) { log("react handler threw", e && e.message); }
      }
      const v3 = node.__vueParentComponent;                           // Vue 3
      if (v3 && v3.props && typeof v3.props.onClick === "function") {
        try { v3.props.onClick({}); return "vue3"; } catch (e) { log("vue3 handler threw", e && e.message); }
      }
      const v2 = node.__vue__;                                        // Vue 2
      if (v2 && typeof v2.$emit === "function") {
        try { v2.$emit("click"); return "vue2"; } catch (e) { log("vue2 handler threw", e && e.message); }
      }
    }
    return null;
  }

  function findPlayButton(doc, vid) {                                 // the round play control the app draws over a paused feed
    const r = vid.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const cands = Array.from(doc.querySelectorAll('[class*="play"],[class*="Play"],[class*="start"],button,svg,i,span'))
      .filter(function (e) {
        const b = e.getBoundingClientRect();
        if (b.width < 18 || b.width > 180 || b.height < 18 || b.height > 180) return false;
        return Math.abs(b.left + b.width / 2 - cx) < 140 && Math.abs(b.top + b.height / 2 - cy) < 140;
      });
    if (cands.length) return cands[0];
    const at = doc.elementFromPoint(cx, cy);                          // whatever sits over the middle of the video
    return (at && at.tagName !== "VIDEO") ? at : null;
  }

  function clickPlayOverlay(p, doc, vid, target) {
    if (!target) { return; }
    const how = invokeFrameworkHandler(target, doc.body);             // preferred: call the handler, do not fake an event
    if (how) {
      log("invoked", how, "handler for", p.name);
      p.lastErr = ((p.lastErr || "") + " [handler:" + how + "]").slice(-MAX_ERR_CHARS);
    } else {
      log("no framework handler found, dispatching events for", p.name, target.tagName, target.className);
      p.lastErr = ((p.lastErr || "") + " [no handler, dispatched]").slice(-MAX_ERR_CHARS);
      realClick(p.frame.contentWindow, target);
    }
  }

  function muteEverything(doc) {                                      // covers extra audio or video elements the player creates
    Array.from(doc.querySelectorAll("video, audio")).forEach(function (m) {
      if (!m.muted) m.muted = true;
      if (m.volume !== 0) m.volume = 0;
    });
  }

  function muteViaPlayerButton(p, doc) {                              // make the app's own icon agree, not just the element
    if (!CLICK_SOUND_BUTTON || p.soundClicks >= SOUND_CLICK_MAX) return;
    p.soundClicks++;                                                  // count the attempt, found or not, so this ends
    const cands = Array.from(doc.querySelectorAll(
      '[class*="volume"],[class*="sound"],[class*="mute"],[class*="audio"],' +
      '[aria-label*="ute"],[aria-label*="ound"],[title*="ute"],[title*="ound"]'));
    for (const el of cands) {
      const tag = ((el.className && el.className.baseVal) || el.className || "") + " " +
                  (el.getAttribute("aria-label") || "") + " " + (el.getAttribute("title") || "");
      if (/muted|mute-on|off|close|silent|slash/i.test(tag)) continue;  // already showing muted, leave it
      const r = el.getBoundingClientRect();
      if (r.width < 12 || r.width > 80 || r.height < 12 || r.height > 80) continue;
      log("pressing the player mute control for", p.name, tag.trim());
      if (!invokeFrameworkHandler(el, doc.body)) realClick(p.frame.contentWindow, el);
      return;
    }
  }

  function looksSignedOut(doc) {                                      // a password field means Noorio is showing its login page
    return !!doc.querySelector('input[type="password"]');
  }

  function showSignedOut() {
    if (document.getElementById("nw-signedout")) return;
    log("Noorio is signed out, showing the sign-in panel");
    const top = (SHOW_BANNER && bar && bar.style.display !== "none") ? BANNER_H : 0;
    const box = document.createElement("div");
    box.id = "nw-signedout";
    box.style.cssText = "position:fixed;left:0;right:0;bottom:0;top:" + top + "px;z-index:2147483647;" +
                        "background:#0d1730;color:#ccd8ec;display:flex;flex-direction:column;" +
                        "align-items:center;justify-content:center;gap:18px;text-align:center;padding:24px;" +
                        "font-family:'Jost','Century Gothic','Futura',sans-serif;";
    const h = document.createElement("div");
    h.textContent = "Signed out of Noorio";
    h.style.cssText = "font-size:26px;font-weight:500;color:#fff;letter-spacing:.01em;";
    const sub = document.createElement("div");
    sub.textContent = "The cameras need a Noorio session. Sign in, tick Remember me, then open the wall again.";
    sub.style.cssText = "font-size:15px;max-width:460px;line-height:1.5;";
    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:12px;margin-top:6px;";

    const signin = document.createElement("button");
    signin.textContent = "Sign in to Noorio";
    signin.style.cssText = "font:inherit;font-size:15px;cursor:pointer;background:#1272b8;color:#fff;" +
                           "border:1px solid #1272b8;border-radius:2px;padding:10px 22px;letter-spacing:.02em;";
    signin.onclick = function () { location.href = "/"; };            // leave the grid, show the real full size login page

    const retry = document.createElement("button");
    retry.textContent = "Try again";
    retry.style.cssText = "font:inherit;font-size:15px;cursor:pointer;background:none;color:#dbe6f6;" +
                          "border:1px solid rgba(255,255,255,.34);border-radius:2px;padding:10px 22px;letter-spacing:.02em;";
    retry.onclick = function () {                                     // already signed in elsewhere? reload the frames
      box.remove();
      panes.forEach(function (p) { p.lastReload = 0; reloadPane(p, "retry after sign in"); });
    };

    row.appendChild(signin); row.appendChild(retry);
    [h, sub, row].forEach(function (el) { box.appendChild(el); });
    document.documentElement.appendChild(box);
  }

  function dismissReminder(p, doc) {                                  // tick "no more prompts", then press Continue
    if (!AUTO_CONTINUE) return false;
    const leaves = Array.from(doc.querySelectorAll("button,div,span,a,p,label"))
      .filter(function (e) { return e.children.length === 0; });

    const suppress = leaves.filter(function (e) { return e.textContent.trim() === SUPPRESS_LABEL; })[0];
    if (suppress) {                                                   // the checkbox sits next to its label
      let box = null;
      let scope = suppress.parentElement;
      for (let i = 0; i < 3 && scope && !box; i++) {
        box = scope.querySelector('input[type="checkbox"]') ||
              scope.querySelector('[class*="checkbox"],[class*="check-box"]');
        scope = scope.parentElement;
      }
      if (box) {
        const already = (box.checked === true) || /checked|active|selected/i.test(box.className || "");
        if (!already) {
          log("ticking 'no more pop-up prompts' for", p.name);
          invokeFrameworkHandler(box, doc.body) || realClick(p.frame.contentWindow, box);
        }
      }
    }

    const cont = leaves.filter(function (e) {
      return CONTINUE_LABELS.indexOf(e.textContent.trim()) !== -1;
    })[0];
    if (!cont) return false;
    log("dismissing the streaming reminder for", p.name);
    if (!invokeFrameworkHandler(cont, doc.body)) realClick(p.frame.contentWindow, cont);
    return true;
  }

  function frameSize() {                                              // pixels we actually need, not a fixed 1500x950
    if (!FRAME_FIT) return { w: FRAME_W, h: FRAME_H };
    const vw = (window.innerWidth || 1600) - (railMode ? STATUS_RAIL_W : 0);
    const vh = (window.innerHeight || 900) - (SHOW_BANNER ? BANNER_H : 0);
    let w = Math.round((vw / Math.max(1, cols)) * FRAME_SCALE);
    w = Math.max(FRAME_MIN_W, Math.min(FRAME_MAX_W, w));
    const h = Math.round(w * (FRAME_H / FRAME_W));
    return { w: w, h: h };
  }

  function makeFrame() {
    const f = document.createElement("iframe");
    const size = frameSize();
    f.width = size.w;
    f.height = size.h;
    f.allow = "autoplay; fullscreen";
    f.style.background = "#0b0f1a";                                   // the iframe's own white is what used to flash
    return f;
  }

  function applySavedRotations() {                                    // extension storage survives anything the app does
    try {
      chrome.storage.local.get([ROTATE_STORE], function (got) {
        const all = (got && got[ROTATE_STORE]) || {};
        let any = false;
        panes.forEach(function (p) {
          const deg = (all[p.name] | 0) % 360;
          if (deg !== p.rotation) { p.rotation = deg; any = true; }
          layoutStage(p);
        });
        if (any) { log("restored saved rotations", all); panes.forEach(function (p) { crop(p); }); }
      });
    } catch (e) { log("could not read rotations", e && e.message); }
  }

  function saveRotation(name, deg) {
    try {
      chrome.storage.local.get([ROTATE_STORE], function (got) {
        const all = (got && got[ROTATE_STORE]) || {};
        if (deg) all[name] = deg; else delete all[name];
        const payload = {}; payload[ROTATE_STORE] = all;
        chrome.storage.local.set(payload, function () { log("saved rotation", name, deg); });
      });
    } catch (e) { log("could not save rotation", e && e.message); }
  }

  function rotatePane(name) {
    const p = panes.filter(function (x) { return x.name === name; })[0];
    if (!p) return;
    p.rotation = (p.rotation + 90) % 360;
    saveRotation(name, p.rotation);
    log("rotated", name, "to", p.rotation);
    layoutStage(p);
    crop(p);
  }

  function layoutStage(p) {                                           // size the stage to the tile, swapped when on its side
    const tw = p.tile.clientWidth, th = p.tile.clientHeight;
    const turned = (p.rotation === 90 || p.rotation === 270);
    const sw = turned ? th : tw;                                      // the stage is what the video fills
    const sh = turned ? tw : th;
    p.stage.style.width = sw + "px";
    p.stage.style.height = sh + "px";
    p.stage.style.transform = "translate(-50%, -50%) rotate(" + p.rotation + "deg)";
    p.rot.textContent = p.rotation ? "Rotate " + p.rotation + "\u00b0" : "Rotate";
    p.rot.classList.toggle("nw-on", !!p.rotation);
    return { w: sw, h: sh };
  }

  function crop(p) {
    const doc = p.frame.contentDocument;
    const vid = mediaFor(p);
    if (!vid) return false;
    const r = vid.getBoundingClientRect();
    if (r.width < 120 || r.height < 90) return false;

    const dims = layoutStage(p);                                      // rotation changes which side the video fills
    const tw = dims.w, th = dims.h;
    const fw = Number(p.frame.width) || p.frame.offsetWidth || FRAME_W;
    const fh = Number(p.frame.height) || p.frame.offsetHeight || FRAME_H;

    // Only the part of the video inside the frame's own viewport is actually painted. Scaling to
    // the full rect when the video overflows left the frame's edge inside the tile, which showed
    // as a black bar down the side.
    const vx = Math.max(0, r.left), vy = Math.max(0, r.top);
    const vw = Math.min(r.left + r.width, fw) - vx;
    const vh = Math.min(r.top + r.height, fh) - vy;
    if (vw < 100 || vh < 80) return false;

    let s = FIT === "cover" ? Math.max(tw / vw, th / vh) : Math.min(tw / vw, th / vh);
    if (FIT === "cover") s = Math.max(s, tw / fw, th / fh);           // the frame must cover the tile too

    let left = -vx * s + (FIT === "cover" ? (tw - vw * s) / 2 : 0);
    let top = -vy * s + (FIT === "cover" ? (th - vh * s) / 2 : 0);
    if (FIT === "cover") {                                            // never let an edge of the frame come inside the tile
      left = Math.min(0, Math.max(left, tw - fw * s));
      top = Math.min(0, Math.max(top, th - fh * s));
    }

    p.frame.style.transform = "scale(" + s + ")";
    p.frame.style.left = left + "px";
    p.frame.style.top = top + "px";
    doc.documentElement.style.overflow = "hidden";
    return true;
  }

  function doc_of(p) {
    try { return p.frame.contentDocument; } catch (e) { return null; }
  }

  function showHint(p, text) {
    let h = p.tile.querySelector(".nw-hint");
    if (!h) {
      h = document.createElement("div");
      h.className = "nw-hint";
      h.style.cssText = "position:absolute;left:50%;top:62%;transform:translateX(-50%);z-index:6;" +
                        "background:rgba(0,0,0,.72);color:#fff;font:13px Arial,Helvetica,sans-serif;" +
                        "padding:5px 11px;border-radius:5px;pointer-events:none;";
      p.tile.appendChild(h);
    }
    h.textContent = text;
  }

  function clearHint(p) {
    const h = p.tile.querySelector(".nw-hint");
    if (h) h.remove();
  }

  function drive(p) {                                                 // bring one pane up, independently of the others
    const doc = doc_of(p);
    if (!doc || !doc.body) { p.hudText.textContent = p.name + ": loading"; return; }

    if (looksSignedOut(doc)) {                                        // no session, no point waiting for a camera list
      p.state = "signedout";
      p.hudText.textContent = p.name + ": signed out";
      showSignedOut();
      return;
    }

    const elapsed = Date.now() - p.turnStarted;
    const vid = media(doc);

    if (!vid) {
      const card = cardByName(doc, p.name);
      if (card) {
        p.state = "selecting";
        p.hudText.textContent = p.name + ": selecting (" + Math.round(elapsed / 1000) + "s)";
        realClick(p.frame.contentWindow, card.querySelector("img,svg,canvas") || card);
      } else {
        p.hudText.textContent = p.name + ": waiting for list (" + Math.round(elapsed / 1000) + "s)";
      }
      if (elapsed > START_TIMEOUT_MS) {
        if (p.startAttempts < MAX_START_ATTEMPTS) { p.startAttempts++; reloadPane(p, "retrying"); }
        else { p.state = "stuck"; p.hudText.textContent = p.name + ": not responding"; showHint(p, "click the play button"); }
      }
      return;
    }

    crop(p);                                                          // show the frame as soon as there is one
    if (vid.tagName === "VIDEO") {
      if (MUTE_ALL) { vid.muted = true; vid.volume = 0; }
      if (vid.paused) {
        p.state = "starting";
        vid.play().catch(function (e) { p.lastErr = (e && e.name) || "unknown"; });

        const btn = findPlayButton(doc, vid);                         // the button often appears late, once other tiles settle
        if (btn && Date.now() - (p.lastPlayClick || 0) > PLAY_CLICK_INTERVAL_MS && p.playClicks < PLAY_CLICK_MAX) {
          p.playClicks++;
          p.lastPlayClick = Date.now();
          clickPlayOverlay(p, doc, vid, btn);                         // press it the moment it exists, then keep pressing
          p.hudText.textContent = p.name + ": pressing play (" + p.playClicks + ")";
        } else {
          p.hudText.textContent = p.name + (btn ? ": play button up" : ": starting") +
                              " (" + Math.round(elapsed / 1000) + "s)";
        }
        if (p.playClicks >= PLAY_CLICK_MAX) showHint(p, "click the play button");
        if (elapsed > START_TIMEOUT_MS && p.playClicks >= PLAY_CLICK_MAX) reloadPane(p, "retrying");
        return;
      }
    }

    p.state = "live";
    p.cropped = true;
    p.everPlayed = true;
    p.lastAdvance = Date.now();
    p.hudText.textContent = p.name;
    clearHint(p);
    if (RECYCLE_MINUTES > 0 && !p.recycleAt) {                        // stale frames are what fill the tab up
      const spread = RECYCLE_SPREAD ? (panes.indexOf(p) * RECYCLE_MINUTES * 60000 / Math.max(1, panes.length)) : 0;
      p.recycleAt = Date.now() + RECYCLE_MINUTES * 60000 + spread;
    }
  }

  function reloadAllowed(p, why) {
    const now = Date.now();
    if (now - p.lastReload < RELOAD_COOLDOWN_MS) { log("skip reload of", p.name, "- tile cooldown"); return false; }
    if (now - NW_LAST_RELOAD < RELOAD_GAP_MS) { log("skip reload of", p.name, "- another tile just reloaded"); return false; }
    NW_RELOAD_LOG = NW_RELOAD_LOG.filter(function (t) { return now - t < 3600000; });
    if (NW_RELOAD_LOG.length >= MAX_RELOADS_PER_HOUR) {
      log("reload budget spent, leaving", p.name, "alone");
      return false;
    }
    return true;
  }

  function reloadPane(p, why) {
    if (!reloadAllowed(p, why)) return;
    const now = Date.now();
    p.lastReload = now;
    NW_LAST_RELOAD = now;
    NW_RELOAD_LOG.push(now);
    log("reloading", p.name, "because", why);
    p.hudText.textContent = p.name + ": " + why;
    p.state = "loading"; p.cropped = false; p.playClicks = 0; p.soundClicks = 0;
    p.startAttempts = p.startAttempts || 0;
    p.vid = null;
    p.lastTime = -1; p.everPlayed = false; p.lastErr = "";
    p.turnStarted = Date.now();
    p.recycleAt = 0;

    // Reuse the element and blank it first. Creating a new iframe each time left the old
    // document attached to its own timers and sockets, which is what filled the tab in minutes.
    // about:blank forces the old document to be torn down before the next one loads.
    p.frame.style.transform = ""; p.frame.style.left = ""; p.frame.style.top = "";
    try { p.frame.src = "about:blank"; } catch (e) { log("blanking failed", e && e.message); }
    const frame = p.frame;
    setTimeout(function () { if (frame === p.frame) frame.src = "/"; }, BLANK_PAUSE_MS);
  }

  function maintain(p) {                                              // keep an already-live tile healthy
    if (p.recycleAt && Date.now() > p.recycleAt) {                    // scheduled recycle, one tile at a time
      if (reloadAllowed(p, "refreshing")) { reloadPane(p, "refreshing"); return; }
      p.recycleAt = Date.now() + 5 * 60000;                           // budget busy, try again in five minutes
    }
    const doc = doc_of(p);
    if (!doc || !doc.body) return;
    if (looksSignedOut(doc)) { p.state = "signedout"; p.hudText.textContent = p.name + ": signed out"; showSignedOut(); return; }
    const vid = mediaFor(p);
    if (!vid) { reloadPane(p, "lost video"); return; }
    if (!p.cropped) p.cropped = crop(p);
    if (vid.tagName !== "VIDEO") return;
    if (MUTE_ALL) vid.muted = true;
    if (vid.paused) { vid.play().catch(function () {}); return; }
    if (Date.now() - p.lastAdvance < STALL_GRACE_MS) return;
    if (STALL_SECONDS <= 0) return;
    if (vid.networkState === 2) { p.lastAdvance = Date.now(); return; }
    const t = vid.currentTime;
    if (t !== p.lastTime) { p.lastTime = t; p.lastAdvance = Date.now(); return; }
    if (Date.now() - p.lastAdvance > STALL_SECONDS * 1000) reloadPane(p, "stalled");
  }

  let infoBox = null;
  if (SHOW_STATUS_PANEL) {
    {
      infoBox = document.createElement("div");
      infoBox.id = "nw-info";
      if (gapSlot) {
        infoBox.style.gridColumn = String(gapSlot.col + colShift);
        infoBox.style.gridRow = String(gapSlot.row);
      } else {
        infoBox.classList.add("nw-rail");                             // thin column down the left of the cameras
        infoBox.style.gridColumn = "1";
        infoBox.style.gridRow = "1 / -1";
      }
      infoBox.innerHTML = "<div class='nw-sect'><h3>Running now</h3>" +
                          "<div class='nw-none'>checking...</div></div>";
      grid.appendChild(infoBox);
      log(gapSlot ? "status panel in the spare cell at column " + gapSlot.col + ", row " + gapSlot.row
                  : "status panel as a " + STATUS_RAIL_W + "px rail, the grid has no spare cell");
    }
  }

  if (SHOW_PROMO && !document.getElementById("nw-promo")) {
    const promo = document.createElement("a");
    promo.id = "nw-promo";
    promo.href = PROMO_URL;
    promo.target = "_blank";
    promo.rel = "noopener";
    const mark = document.createElement("span");
    mark.className = "nw-mark";
    const txt = document.createElement("span");
    txt.textContent = PROMO_TEXT;
    promo.appendChild(mark);
    promo.appendChild(txt);
    document.documentElement.appendChild(promo);
  }

  panes.forEach(function (p, i) {                                     // bottom right tile shares that corner with the bar
    const sl = layout.placed[i];
    if (SHOW_PROMO && sl && sl.col === cols && sl.row === rows) p.tile.classList.add("nw-lastcell");
  });

  function fmtWhen(d) {
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    if (sameDay) return "today " + time;
    const tom = new Date(now.getTime() + 86400000);
    if (d.toDateString() === tom.toDateString()) return "tomorrow " + time;
    return d.toLocaleDateString([], { weekday: "short", month: "numeric", day: "numeric" }) + " " + time;
  }

  function renderStatus(data) {
    if (!infoBox) return;
    try { renderStatusInner(data); }
    catch (e) {
      log("status panel failed", e && e.message);
      infoBox.innerHTML = "<div class='nw-sect'><h3>Running now</h3>" +
                          "<div class='nw-none'>Status unavailable</div></div>";
    }
  }

  function renderStatusInner(data) {
    const runs = (data && data.runs) || [];
    const next = ((data && data.reservations) || []).map(function (e) {
      return { robot: e.robot, summary: e.summary, active: e.active,  // dates arrive as strings over the message channel
               start: e.start ? new Date(e.start) : null,
               end: e.end ? new Date(e.end) : null };
    });
    const esc = function (t) { const d = document.createElement("div"); d.textContent = t; return d.innerHTML; };

    let html = "<div class='nw-sect'><h3>Running now</h3>";
    if (!runs.length) {
      html += "<div class='nw-none'>" + (data && data.haveTracker ? "Nothing running" : "Tracker unavailable") + "</div>";
    } else {
      runs.forEach(function (r) {
        const bits = [r.method, r.user ? "run by " + r.user : "",
                      r.hours != null ? r.hours.toFixed(1) + "h elapsed" : ""].filter(Boolean);
        html += "<div class='nw-item'><div class='nw-t'><span class='nw-dot'></span>" + esc(r.robot) + "</div>" +
                "<div class='nw-m'>" + esc(bits.join(" \u00b7 ")) + (r.folder ? "<br>" + esc(r.folder) : "") +
                "</div></div>";
      });
    }
    html += "</div>";

    const active = next.filter(function (e) { return e.active; });    // reserved and under way, but nothing running
    const later = next.filter(function (e) { return !e.active; });

    if (active.length) {                                              // its own section, only when there is one
      html += "<div class='nw-sect'><h3>In progress</h3>";
      active.forEach(function (e) {
        const when = e.end ? "until " + fmtWhen(e.end) : "started";
        html += "<div class='nw-item' style='border-left-color:#7fb2e5'>" +
                "<div class='nw-t'>" + esc(e.robot) + "</div>" +
                "<div class='nw-m'>" + esc(when) + (e.summary ? " \u00b7 " + esc(e.summary) : "") +
                "</div></div>";
      });
      html += "</div>";
    }

    html += "<div class='nw-sect'><h3>Reserved next</h3>";
    if (!later.length) {
      html += "<div class='nw-none'>Nothing reserved</div>";
    } else {
      later.forEach(function (e) {
        html += "<div class='nw-item' style='border-left-color:#4b5f85'>" +
                "<div class='nw-t'>" + esc(e.robot) + "</div>" +
                "<div class='nw-m'>" + esc(fmtWhen(e.start)) + (e.summary ? " \u00b7 " + esc(e.summary) : "") +
                "</div></div>";
      });
    }
    html += "</div><div class='nw-foot'>updated " +
            new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) + "</div>";

    if (typeof NW_QR === "string" && NW_QR) {                         // preprint pointer, scannable from across the bench
      const label = (typeof NW_QR_LABEL === "string" && NW_QR_LABEL) || "Check out our preprint";
      const url = (typeof NW_QR_URL === "string" && NW_QR_URL) || "";
      const shown = url.replace(/^https?:\/\//, "");
      html += "<div class='nw-qr'><img src='" + NW_QR + "' alt='" + esc(label) + "'>" +
              "<div class='nw-qrtext'><div class='nw-qrlabel'>" + esc(label) + "</div>" +
              "<div class='nw-qrurl'>" + esc(shown) + "</div></div></div>";
    }
    infoBox.innerHTML = html;
  }

  function refreshStatus() {
    if (!infoBox) return;
    try {
      chrome.runtime.sendMessage({ action: "labStatus" }, function (data) {
        if (chrome.runtime.lastError) { log("status fetch failed", chrome.runtime.lastError.message); return; }
        renderStatus(data);
      });
    } catch (e) { log("status request threw", e && e.message); }
  }

  if (infoBox) {                                                      // cameras first, status after they settle
    setTimeout(function () {
      refreshStatus();
      NW_TIMERS.push(setInterval(refreshStatus, STATUS_REFRESH_MS));
    }, STATUS_FIRST_DELAY_MS);
  }

  let discovered = !AUTO_DISCOVER;                                    // skip if discovery is switched off
  const discoverStarted = Date.now();
  function tryDiscover() {
    if (discovered) return;
    if (Date.now() - discoverStarted > DISCOVER_GIVEUP_MS) {          // never scan the apps forever
      discovered = true;
      log("camera discovery gave up, keeping the list we have");
      return;
    }
    for (const p of panes) {
      const doc = doc_of(p);
      if (!doc || !doc.body) continue;
      const names = readDeviceNames(doc);
      if (!names.length || names.length > 12) continue;               // a huge list means the read went wrong
      discovered = true;
      const same = names.length === cams.length &&
                   names.every(function (n) { return cams.indexOf(n) !== -1; });
      log("discovered cameras:", names, same ? "(same as shown)" : "(rebuilding)");
      if (!same) setTimeout(function () { buildWall(names); }, 50);   // rebuild with the real list
      return;
    }
  }

  let tickCount = 0;
  function tick() {
    if (gen !== WALL_GEN) return;                                     // a newer wall has taken over
    tickCount++;
    const slowPass = (tickCount % Math.max(1, Math.round(LIVE_POLL_MS / POLL_MS))) !== 0;
    if (!discovered && tickCount % Math.max(1, Math.round(DISCOVER_EVERY_MS / POLL_MS)) === 0) tryDiscover();
    const scanDialogs = AUTO_CONTINUE &&
      (tickCount % Math.max(1, Math.round(DIALOG_CHECK_MS / POLL_MS)) === 0);
    panes.forEach(function (p) {
      if (scanDialogs) {
        const doc = doc_of(p);
        if (doc && doc.body) {
          try { dismissReminder(p, doc); } catch (e) { log("dialog scan failed", e && e.message); }
          try { muteEverything(doc); muteViaPlayerButton(p, doc); } catch (e) { log("mute pass failed", e && e.message); }
        }
      }
      if (p.state === "live") { if (!slowPass) maintain(p); }         // playing tiles are checked every LIVE_POLL_MS
      else if (p.state === "stuck") {                                 // left alone on purpose, but take it back if it starts
        if (!slowPass) {
          const d = doc_of(p);
          const v = d && d.body ? media(d) : null;
          if (v && v.tagName === "VIDEO" && !v.paused) { p.state = "live"; p.hudText.textContent = p.name; clearHint(p); }
        }
      }
      else if (p.state === "signedout") {                             // recover by itself once a session exists again
        const d = doc_of(p);
        if (d && d.body && !looksSignedOut(d)) {
          const box = document.getElementById("nw-signedout");
          if (box) box.remove();
          p.state = "loading"; p.turnStarted = Date.now();
        }
      }
      else drive(p);
    });
  }

  const KEYS = [
    ["F", "Fullscreen"],
    ["B", "Hide or show this header"],
    ["L", "Hide or show camera labels"],
    ["R", "Restart all cameras"],
    ["D", "Diagnostics"]
  ];

  function toggleKeys() {
    const open = document.getElementById("nw-keys");
    const btn = document.querySelector("#nw-bar .nw-help");
    if (open) { open.remove(); if (btn) btn.classList.remove("open"); return; }
    const box = document.createElement("div");
    box.id = "nw-keys";
    box.style.top = (SHOW_BANNER && bar && bar.style.display !== "none" ? BANNER_H + 8 : 8) + "px";
    KEYS.forEach(function (k) {
      const row = document.createElement("div");
      row.className = "nw-row";
      const key = document.createElement("kbd"); key.textContent = k[0];
      const label = document.createElement("span"); label.textContent = k[1];
      row.appendChild(key); row.appendChild(label);
      box.appendChild(row);
    });
    box.addEventListener("click", function (e) { e.stopPropagation(); });
    document.documentElement.appendChild(box);
    if (btn) btn.classList.add("open");
  }

  document.addEventListener("click", function () {                    // click anywhere else to dismiss
    const open = document.getElementById("nw-keys");
    if (open) toggleKeys();
  });

  function diagnose() {
    const lines = panes.map(function (p) {
      const doc = doc_of(p);
      if (!doc || !doc.body) return p.name + " [" + p.state + "]: no document";
      const all = Array.from(doc.querySelectorAll("video, canvas")).map(function (n) {
        const r = n.getBoundingClientRect();
        return n.tagName.toLowerCase() + " " + Math.round(r.width) + "x" + Math.round(r.height);
      });
      const v = media(doc);
      if (!v) return p.name + " [" + p.state + "]: no media | path " + doc.location.pathname +
                     " | elements: " + (all.join(", ") || "none");
      let info = p.name + " [" + p.state + "]: " + v.tagName.toLowerCase();
      if (v.tagName === "VIDEO") {
        info += " paused=" + v.paused + " muted=" + v.muted + " ready=" + v.readyState +
                " net=" + v.networkState + " t=" + v.currentTime.toFixed(1) +
                " " + v.videoWidth + "x" + v.videoHeight +
                " src=" + (v.currentSrc ? v.currentSrc.slice(0, 36) : (v.srcObject ? "srcObject" : "none"));
      }
      if (p.lastErr) info += " | err=" + p.lastErr;
      return info + " | all: " + all.join(", ");
    });
    let box = document.getElementById("nw-diag");
    if (box) { box.remove(); return; }
    box = document.createElement("div");
    box.id = "nw-diag";
    box.style.cssText = "position:fixed;left:12px;top:12px;right:12px;z-index:2147483647;background:rgba(0,0,0,.9);" +
                        "color:#0f0;font:12px ui-monospace,Menlo,monospace;padding:12px 14px;border-radius:6px;" +
                        "white-space:pre-wrap;line-height:1.6;";
    box.textContent = "NOORIO WALL DIAGNOSTICS  (D closes)\n\n" + lines.join("\n\n");
    document.documentElement.appendChild(box);
    log("diagnostics:\n" + lines.join("\n"));
  }

  document.addEventListener("keydown", function (e) {
    const k = e.key.toLowerCase();
    if (e.key === "Escape" && document.getElementById("nw-keys")) { toggleKeys(); return; }
    if (e.key === "?" || k === "h") { toggleKeys(); return; }
    if (k === "d") diagnose();
    if (k === "l") grid.classList.toggle("nw-nohud");
    if (k === "b" && bar) {                                           // hide the header for a clean full-bleed wall
      const hidden = bar.style.display === "none";
      bar.style.display = hidden ? "" : "none";
      grid.style.top = hidden ? BANNER_H + "px" : "0px";
      setTimeout(function () { panes.forEach(function (p) { if (p.cropped) crop(p); }); }, 60);
    }
    if (k === "f") {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(function () {});
      else document.exitFullscreen();
    }
    if (k === "r") {                                                  // full restart, sequential again
      panes.forEach(function (p) { p.lastReload = 0; reloadPane(p, "manual restart"); });
    }
  });

  window.addEventListener("resize", function () {
    panes.forEach(function (p) { layoutStage(p); if (p.cropped) crop(p); });
  });

  panes.forEach(layoutStage);
  applySavedRotations();                                              // bring back each camera's saved angle

  NW_TIMERS.forEach(clearInterval);                                   // a rebuild must not leave the old loops running
  NW_TIMERS.length = 0;
  NW_TIMERS.push(setInterval(tick, POLL_MS));
  tick();

  log("wall built. D diagnostics, L labels, B banner, F fullscreen, R restart");
}
