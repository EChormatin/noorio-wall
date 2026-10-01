// Toolbar button: opens the Noorio Wall in a new tab in the current window.
// Clicking the button again switches to that tab and restarts the wall instead of opening a second one.

const AUTO_DISCOVER = true;                                           // true: read the camera list from Noorio at load time
const CAM_NAMES = [                                                   // only used when AUTO_DISCOVER is false
  "Olivia",
  "Benjamin",
  "Olivia (Liquids)",
  "Benjamin (Liquids)"
];
const WALL_URL = "https://webclient.noorio.com/";                     // the grid is built on top of this page
const DEBUG = true;                                                   // log each step to the service worker console

function log() { if (DEBUG) console.log("[noorio-wall-bg]", ...arguments); }

function wallUrl() {
  if (AUTO_DISCOVER) return WALL_URL + "#wallGrid";                   // the page finds the cameras itself
  return WALL_URL + "#wallGrid&cams=" + encodeURIComponent(CAM_NAMES.join("||"));
}

async function findWallTab() {                                        // is a wall already open in this profile
  const tabs = await chrome.tabs.query({});
  for (const t of tabs) {
    if (t.url && t.url.indexOf("wallGrid") !== -1) return t;
  }
  return null;
}

async function openWall(tab) {
  const existing = await findWallTab();
  if (existing) {                                                     // already open: switch to it
    await chrome.windows.update(existing.windowId, { focused: true });
    await chrome.tabs.update(existing.id, { active: true, muted: true });   // browser-level mute, the page cannot override it
    try {
      const reply = await chrome.tabs.sendMessage(existing.id, { action: "restart" });
      if (reply && reply.ok) { log("restarted the cameras in place, no page reload"); return; }
    } catch (e) {
      log("wall page did not answer, falling back to a reload", e && e.message);
    }
    await chrome.tabs.reload(existing.id);                            // only if the in-page restart is unavailable
    return;
  }
  log("opening the wall in a new tab, muted");
  const created = await chrome.tabs.create({                                          // same window, next to the current tab
    url: wallUrl(),
    active: true,
    windowId: tab && tab.windowId ? tab.windowId : undefined,
    index: tab && typeof tab.index === "number" ? tab.index + 1 : undefined
  });
  try { await chrome.tabs.update(created.id, { muted: true }); }      // no audio from the wall, ever
  catch (e) { log("could not mute the tab", e && e.message); }
}

// The wall asks for lab status: the experiment tracker (public CSV) and the three robot
// calendars (public ICS). Fetching happens here because the content script is on
// webclient.noorio.com and these are other origins.
const TRACKER_CSV = "https://docs.google.com/spreadsheets/d/" +
  "1ffdqsKGGs3LSMRTHdqywheSt4YHwDCQ5NNCwR864B4g/export?format=csv&gid=0";
const ROBOT_CALENDARS = [                                             // same ids the equipment page uses
  { name: "Benjamin", id: "7bcbfb37f83965ebe68f6ccccd0191812829dd06eb3d14f32ab8d6599837483e@group.calendar.google.com" },
  { name: "Meredith", id: "1f7fd0a3d234e9c0b101ff14d25c122038c8e8d6a0b1937f40cfbcf307b6d1c7@group.calendar.google.com" },
  { name: "Olivia",   id: "e987a5ca5aa6595efea1060bd491567917853669a33fe192f578d3bdce77bbc0@group.calendar.google.com" }
];

async function textOrNull(url) {
  try {
    const r = await fetch(url, { credentials: "omit" });
    if (!r.ok) { log("fetch failed", r.status, url); return null; }
    return await r.text();
  } catch (e) { log("fetch threw", e && e.message, url); return null; }
}

const STATUS_MAX_ROWS = 3;        // keep the panel small, it has to fit one tile
const ICS_MAX_CHARS = 400000;     // only the tail of a calendar feed matters, and some are huge

// Minimal CSV reader: quoted fields, doubled quotes, commas and newlines inside quotes.
function parseCSV(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += c;
    } else if (c === '"') { quoted = true; }
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") { field += c; }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// "9-3-26 7:15 PM" is what the robots write, and new Date() will not take it.
function labDate(v) {
  const t = (v || "").trim();
  if (!t) return null;
  const m = t.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{2,4})(?:[ ,]+(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp])?)?/);
  if (m) {
    let [, mo, da, yr, hh, mi, ap] = m;
    yr = +yr; if (yr < 100) yr += 2000;
    let hour = hh ? +hh : 0;
    if (ap) { const pm = /p/i.test(ap); if (pm && hour < 12) hour += 12; if (!pm && hour === 12) hour = 0; }
    return new Date(yr, +mo - 1, +da, hour, mi ? +mi : 0);
  }
  const d = new Date(t);
  return isNaN(d.getTime()) ? null : d;
}

// Live runs out of the experiment tracker: a row that is not TERMINATED.
function runningNow(csv) {
  if (!csv) return [];
  const rows = parseCSV(csv);
  if (rows.length < 2) return [];
  const head = rows[0].map(function (h) { return h.trim().toLowerCase(); });
  const col = function (name) { return head.indexOf(name.toLowerCase()); };   // first match wins, headers repeat
  const iStart = col("Start Date"), iRobot = col("RobotID"), iUser = col("User");
  const iMethod = col("Method"), iFolder = col("Folder Name"), iTerm = col("TERMINATED");
  if (iRobot < 0) return [];
  const out = [];
  for (let r = rows.length - 1; r > 0 && out.length < STATUS_MAX_ROWS * 3; r--) {
    const row = rows[r];
    if (!row || !row.length) continue;
    const robot = (row[iRobot] || "").trim();
    if (!robot) continue;
    const term = iTerm >= 0 ? (row[iTerm] || "").trim() : "";
    if (term && !/^(no|false|0)$/i.test(term)) continue;               // anything in TERMINATED means finished
    const started = iStart >= 0 ? labDate(row[iStart]) : null;
    out.push({
      robot: robot,
      user: iUser >= 0 ? (row[iUser] || "").trim() : "",
      method: iMethod >= 0 ? (row[iMethod] || "").trim() : "",
      folder: iFolder >= 0 ? (row[iFolder] || "").trim() : "",
      started: started,
      hours: started ? (Date.now() - started.getTime()) / 3600000 : null
    });
  }
  return out.slice(0, STATUS_MAX_ROWS);
}

// Upcoming reservations out of a public Google Calendar ICS feed.
function icsDate(v) {
  const m = (v || "").match(/(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/);
  if (!m) return null;
  const [, y, mo, d, hh, mi, ss, z] = m;
  if (!hh) return new Date(+y, +mo - 1, +d);
  return z ? new Date(Date.UTC(+y, +mo - 1, +d, +hh, +mi, +ss))
           : new Date(+y, +mo - 1, +d, +hh, +mi, +ss);
}

function upcoming(cals) {
  const now = Date.now();
  const out = [];
  (cals || []).forEach(function (c) {
    if (!c || !c.ics) return;
    const raw = c.ics.length > ICS_MAX_CHARS ? c.ics.slice(-ICS_MAX_CHARS) : c.ics;
    const body = raw.replace(/\r\n[ \t]/g, "");                        // unfold wrapped ICS lines
    body.split("BEGIN:VEVENT").slice(1).forEach(function (chunk) {
      if (/RRULE:/.test(chunk)) return;                                // repeating events are not reservations here
      const start = icsDate((chunk.match(/\nDTSTART[^:]*:([^\r\n]+)/) || [])[1]);
      const end = icsDate((chunk.match(/\nDTEND[^:]*:([^\r\n]+)/) || [])[1]);
      const summary = ((chunk.match(/\nSUMMARY:([^\r\n]*)/) || [])[1] || "").trim();
      if (!start) return;
      const finish = end ? end.getTime() : start.getTime() + 3600000;  // no DTEND, assume an hour
      if (finish <= now) return;                                       // over and done with
      out.push({ robot: c.name, start: start, end: end, summary: summary,
                 active: start.getTime() <= now });                    // reserved and already under way
    });
  });
  out.sort(function (a, b) { return a.start - b.start; });
  return out.slice(0, STATUS_MAX_ROWS);
}


async function labStatus() {
  const csv = await textOrNull(TRACKER_CSV);
  const cals = await Promise.all(ROBOT_CALENDARS.map(async function (c) {
    const ics = await textOrNull("https://calendar.google.com/calendar/ical/" +
                                 encodeURIComponent(c.id) + "/public/basic.ics");
    return { name: c.name, ics: ics };
  }));
  let runs = [], reservations = [];
  try { runs = runningNow(csv); } catch (e) { log("tracker parse failed", e && e.message); }
  try { reservations = upcoming(cals); } catch (e) { log("calendar parse failed", e && e.message); }
  return { runs: runs, reservations: reservations,                    // parsed here so the wall never does this work
           haveTracker: !!csv, at: Date.now() };
}

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (msg && msg.action === "labStatus") {
    labStatus().then(sendResponse);
    return true;                                                      // keep the channel open for the async reply
  }
});

chrome.action.onClicked.addListener(openWall);                        // the toolbar button is the only way in

