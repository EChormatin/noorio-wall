# Noorio Wall

A Chrome extension that shows all four lab cameras in one window, live.

## Already installed on the robot computers

Both robot computers are signed into the chorylab.equipment Chrome profile with this extension
already loaded, so you do not need to install anything to use the wall there. The steps below are
only for putting it on your own machine.

## No audio, no microphone

The wall is video only. The whole tab is muted at the browser level, every video and audio element
in it is muted as well, and the wall presses Noorio's own speaker control so the icon shows muted
too. The two-way talk and microphone controls are not available in this view. This is deliberate, for privacy and legal reasons: please do not use
the audio or talk features in the Noorio app either.

## Getting updates

This extension lives at github.com/EChormatin/noorio-wall. Chrome does not auto-update an
extension loaded this way, so to pick up changes:

    cd ~/noorio-wall
    git pull

Then open `chrome://extensions` and click the reload arrow on Noorio Wall. If the wall tab is open,
close and reopen it.

If you installed from a zip rather than a clone, replace the folder contents with a fresh copy and
reload the same way.

## Install (one time, about a minute)

1. Unzip `noorio-wall-extension.zip` somewhere you will keep it. Chrome loads it from this
   folder every time it starts, so do not put it in Downloads and delete it later.
2. Open Chrome and go to `chrome://extensions`
3. Turn on **Developer mode**, top right
4. Click **Load unpacked** and choose the unzipped `noorio-wall-extension` folder
5. Click the puzzle-piece icon in the Chrome toolbar and pin **Noorio Wall** so the button stays visible

## Log into Noorio first

The wall shows the cameras through your own Noorio session. Go to
`https://webclient.noorio.com`, log in with the lab account, and tick **Remember me**.
If you skip this, the wall will just show Noorio's login page.

## Use

Click the Noorio Wall toolbar button. A tab opens with every camera tiled under a Chory Lab
header. Clicking the button again jumps back to that tab and restarts the cameras.

Keys inside the wall window:

- `F` fullscreen
- `B` hide or show the Chory Lab header
- `L` hide or show the camera name labels
- `R` restart all cameras
- `D` diagnostics, useful if something will not start
- `?` or the Shortcuts button in the header shows this list

## If it says "Signed out of Noorio"

The wall uses your own Noorio session, and sessions expire. When that happens every tile would
otherwise sit on a login form, so the wall shows a sign-in panel instead. Click "Sign in to Noorio",
log in with the lab account, tick Remember me, then open the wall again from the toolbar button.

If you signed in somewhere else in the meantime, "Try again" reloads the cameras without leaving
the page.

## If a tile does not start

Tiles that are slow show their status: "starting", "play button up", "pressing play (3)".
The wall presses the play button itself as soon as one appears. If a tile gives up after
15 tries it shows "click the play button" and you can click it directly.

## The streaming reminder

Noorio pops up a "long duration streaming will drain the battery" dialog every so often. The wall
watches for it, ticks "No more pop-up prompts" and presses Continue on its own, so the feeds keep
running unattended. If you ever want that back, set AUTO_CONTINUE to false in `content.js`.

## Rotating a camera

Hover a tile and a small Rotate control appears in its bottom right. Each click turns that camera
another 90 degrees, and the choice is remembered per camera, so a sideways-mounted camera stays
upright next time you open the wall.

## The status panel

When the grid has a gap, which happens when one robot family has fewer cameras than another, the
empty cell shows what is running now and what is reserved, the same information as the rail on
chorylab.com/equipment. Reservations include one already under way, which shows as "in progress",
not just ones that start later. Running runs come from the experiment tracker sheet, reservations from the
three robot calendars, both read without signing in. It refreshes every three minutes. Set
SHOW_STATUS_PANEL to false in `content.js` to leave the cell empty instead.

## Camera photos

Each label shows a small photo next to the camera name. They live in `avatars.js`, keyed by the
first word of the camera name, so "Olivia" and "Olivia (Liquids)" share one picture. A camera with
no entry there just shows its name.

## Adding a camera

Nothing to edit. The wall reads the camera list from Noorio each time it opens, so a camera added
to the account shows up on its own. It takes a few extra seconds at startup while it reads the list.

Layout follows the names. Each family gets a column, and variants stack underneath it, so "Olivia"
sits above "Olivia (Liquids)" and "Benjamin" above "Benjamin (Liquids)". Add a third camera family
and you get three columns. Add a "Benjamin (Waste)" and it lands under Benjamin.

To give a new camera a photo in its label, add an entry to `avatars.js` keyed by the first word of
its name. Without one it just shows the name.

If you ever want a fixed list instead, set `AUTO_DISCOVER` to false in `background.js` and edit
`CAM_NAMES` there, then reload the extension.

## Notes

Chrome will occasionally warn about extensions in developer mode. That is expected for an
extension installed this way rather than from the Chrome Web Store, and it is safe to dismiss.
