// The wall must build once and show nothing of Noorio's own page while tiles come up.
const fs = require('fs');
const src = fs.readFileSync(process.argv[2], 'utf8');

function boot(opts) {
  let now = 1700000000000;
  const timers = [];
  const grids = [];                                  // one entry per buildWall that reached the DOM
  const store = {};
  if (opts.saved) store['nw-cams'] = JSON.stringify(opts.saved);

  const video = {
    tagName: 'VIDEO', paused: !opts.playing, muted: true, volume: 0, readyState: 4,
    currentTime: 0, videoWidth: 1280, videoHeight: 720, isConnected: true, controls: false,
    style: { cssText: '' }, play() { return { catch(){} }; },
    getBoundingClientRect: () => ({ width: 1000, height: 560, left: 20, top: 40 })
  };

  const leaf = (text, cls) => ({
    tagName: 'DIV', className: cls, children: [], textContent: text, style: {},
    getBoundingClientRect: () => ({ width: 120, height: 20, left: 0, top: 0 }),
    getAttribute: () => null, querySelectorAll: () => [], querySelector: () => null
  });
  function sidebar(names) {                          // "All devices" heading plus one label per camera card
    const labels = names.map(n => leaf(n, 'card-name'));
    const heading = leaf('All devices', 'sidebar-head');
    const thumbs = names.map(() => ({ tagName: 'IMG', children: [], textContent: '' }));
    const container = {
      tagName: 'DIV', children: [heading].concat(labels), textContent: '',
      querySelectorAll: (sel) => /img|canvas|video|svg/.test(sel) ? thumbs : [heading].concat(labels)
    };
    heading.parentElement = container;
    container.parentElement = null;
    return { heading, labels, container };
  }
  const bar = sidebar(opts.sidebar || []);
  const started = now;
  const sidebarUp = () => !opts.sidebarAfter || (now - started) >= opts.sidebarAfter * 1000;

  const doc = {
    body: { tag: 'body' }, documentElement: { style: {} }, location: { pathname: '/' },
    querySelectorAll: (sel) => {
      if (/video/.test(sel) && /canvas/.test(sel)) return [video];
      if (/img|canvas|video|svg/.test(sel)) return [];
      if (/div/.test(sel)) return sidebarUp() ? [bar.heading].concat(bar.labels) : [];
      if (/play/.test(sel)) return [];
      return [];
    },
    querySelector: () => null, elementFromPoint: () => null
  };

  const makeEl = (tag) => {
    const classes = new Set();
    const o = { tag, style: {}, id: '', className: '', kids: [],
      classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c),
                   toggle(c, on) { on ? classes.add(c) : classes.delete(c); },
                   contains: (c) => classes.has(c) },
      has: (c) => classes.has(c),
      children: [], appendChild(c) { o.kids.push(c); if (c && c.id === 'nw-grid') grids.push(c); },
      addEventListener(){}, removeEventListener(){}, replaceChild(){}, remove(){},
      querySelector: () => null, querySelectorAll: () => [],
      getBoundingClientRect: () => ({ width: 400, height: 300, left: 0, top: 0 }),
      setAttribute(){}, getAttribute: () => null, textContent: '', innerHTML: '',
      clientWidth: 760, clientHeight: 420 };
    if (tag === 'iframe') {
      o.contentDocument = doc;
      o.contentWindow = { PointerEvent: function(){}, MouseEvent: function(){} };
      let s = ''; Object.defineProperty(o, 'src', { get: () => s, set: (v) => { s = v; } });
    }
    return o;
  };

  const html = makeEl('html');
  const stub = {
    NW_LOGO: '', NW_AVATARS: {}, NW_QR: '',
    chrome: { runtime: { onMessage: { addListener(){} }, sendMessage(){}, lastError: null },
              storage: { local: { get(k, cb) { cb({}); }, set(o, cb) { cb && cb(); } } } },
    localStorage: { getItem: (k) => (k in store ? store[k] : null),
                    setItem: (k, v) => { store[k] = v; } },
    location: { hash: '#wallGrid' },
    window: { top: 1, self: 1, addEventListener(){}, innerWidth: 1800, innerHeight: 1000,
              PointerEvent: function(){}, MouseEvent: function(){} },
    document: { readyState: 'complete', createElement: makeEl, documentElement: html,
      head: makeEl('head'), body: makeEl('body'), getElementById: () => null,
      querySelector: () => null, querySelectorAll: () => [], addEventListener(){}, title: '' },
    setInterval: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearInterval: () => {}, setTimeout: (fn) => { try { fn(); } catch (e) {} return 0; },
    Date: class extends Date { constructor(...a) { super(...(a.length ? a : [now])); } static now() { return now; } }
  };
  const names = Object.keys(stub);
  new Function(...names, src)(...names.map(n => stub[n]));

  const tick = timers.find(t => t.ms === 1200);
  const run = (seconds) => { for (let i = 0; i < seconds / 1.2; i++) { now += 1200; tick.fn(); } };
  const tileEls = () => (grids[0] ? grids[0].kids.filter(k => k.className === 'nw-tile') : []);
  const covers = () => tileEls()
    .map(t => t.kids.filter(k => k.className === 'nw-cover')[0]).filter(Boolean);
  return { grids, run, covers, store, tiles: () => tileEls().length, tileEls };
}

let fail = 0;
const check = (label, cond, detail) => {
  if (!cond) { fail++; console.log('FAIL  ' + label + (detail ? '  ' + detail : '')); }
  else console.log('PASS  ' + label + (detail ? '  ' + detail : ''));
};

// 1. the list it found last time is the list it builds with, so there is nothing to correct
const remembered = boot({ saved: ['Olivia', 'Benjamin', 'Meredith'],
                          sidebar: ['Benjamin', 'olivia ', 'Meredith'], playing: true });
check('it builds from the camera list it remembered', remembered.tiles() === 3,
      '(' + remembered.tiles() + ' tiles)');
remembered.run(40);
check('a matching list does not rebuild the wall', remembered.grids.length === 1,
      '(' + remembered.grids.length + ' build' + (remembered.grids.length === 1 ? '' : 's') + ')');

// 2. a camera that really is new, found before anything is playing: rebuild is worth it
const added = boot({ saved: ['Olivia', 'Benjamin'],
                     sidebar: ['Olivia', 'Benjamin', 'Meredith'], playing: false });
added.run(25);
check('a genuinely new camera rebuilds, once', added.grids.length === 2,
      '(' + added.grids.length + ' builds)');
check('and the new list is remembered for next time',
      JSON.parse(added.store['nw-cams'] || '[]').length === 3);

// 3. the camera list is found while the covers are still up, even with video already playing
const playing = boot({ saved: ['Olivia', 'Benjamin'],
                       sidebar: ['Olivia', 'Benjamin', 'Meredith'], playing: true });
playing.run(25);
check('a missing camera is picked up on the first pass, not the next open', playing.grids.length === 2,
      '(' + playing.grids.length + ' builds)');

// 4. a sidebar that only appears much later must not restart a settled wall
const late = boot({ saved: ['Olivia', 'Benjamin'], sidebar: ['Olivia', 'Benjamin', 'Meredith'],
                    playing: true, sidebarAfter: 70 });
late.run(150);
check('a list change found later never interrupts running video', late.grids.length === 1,
      '(' + late.grids.length + ' build)');
check('it still remembers the change for the next open',
      JSON.parse(late.store['nw-cams'] || '[]').length === 3);

// 4. the curtain: Noorio's sidebar and account page must never be on screen
const curtain = boot({ saved: ['Olivia', 'Benjamin'], sidebar: ['Olivia', 'Benjamin'], playing: true });
const covers = curtain.covers();
check('every tile gets exactly one cover', covers.length === 2, '(' + covers.length + ' covers)');
check('the cover sits over the frame, not under it', curtain.tileEls().every(function (t) {
  return t.kids.findIndex(k => k.className === 'nw-cover') >
         t.kids.findIndex(k => k.className === 'nw-stage');
}));
curtain.run(12);
check('the cover lifts once the video is cropped and playing',
      covers.length === 2 && covers.every(c => c.has('nw-off')));

const stuck = boot({ saved: ['Olivia', 'Benjamin'], sidebar: ['Olivia', 'Benjamin'], playing: false });
stuck.run(12);
const stuckCovers = stuck.covers();
check('a tile that has not started stays covered, so Noorio never shows',
      stuckCovers.length === 2 && stuckCovers.every(c => !c.has('nw-off')));

console.log(fail ? `\n${fail} FAILING` : '\nall passing');
process.exit(fail ? 1 : 0);
