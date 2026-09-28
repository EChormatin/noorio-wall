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

chrome.action.onClicked.addListener(openWall);                        // the toolbar button is the only way in

