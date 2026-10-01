// How much work does the wall do per minute once everything is playing?
const fs = require('fs');
const src = fs.readFileSync(process.argv[2], 'utf8');

let now = 1700000000000;
const timers = [];
const SEL = {};
let domScans = 0;                      // every querySelectorAll across an app document
let rectCalls = 0;

function fakeDoc() {
  const video = {
    tagName: 'VIDEO', paused: false, muted: true, volume: 0, readyState: 4, networkState: 1,
    currentTime: 0, videoWidth: 1280, videoHeight: 720, isConnected: true, controls: false,
    style: { cssText: '' }, play: () => Promise.resolve(),
    getBoundingClientRect: () => { rectCalls++; return { width: 1000, height: 560, left: 20, top: 40 }; }
  };
  return {
    body: { tag: 'body' }, documentElement: { style: {} }, location: { pathname: '/' },
    querySelectorAll: (sel) => { domScans++; SEL[sel] = (SEL[sel]||0)+1; return /video/.test(sel) ? [video] : []; },
    querySelector: () => null, elementFromPoint: () => null
  };
}

function makeEl(tag) {
  const o = { tag, style: {}, id: '', className: '',
    classList: { add(){}, remove(){}, toggle(){}, contains: () => false },
    children: [], appendChild(){}, addEventListener(){}, removeEventListener(){},
    replaceChild(){}, remove(){}, querySelector: () => null, querySelectorAll: () => [],
    getBoundingClientRect: () => ({ width: 400, height: 300, left: 0, top: 0 }),
    setAttribute(){}, getAttribute: () => null, textContent: '', innerHTML: '',
    clientWidth: 760, clientHeight: 420 };
  if (tag === 'iframe') { o.contentDocument = fakeDoc(); o.contentWindow = {}; }
  return o;
}

const stub = {
  NW_LOGO: '', NW_AVATARS: {}, NW_QR: '',
  chrome: { runtime: { onMessage: { addListener(){} }, sendMessage(){}, lastError: null },
            storage: { local: { get(k, cb){ cb({}); }, set(o, cb){ cb && cb(); } } } },
  location: { hash: '#wallGrid' },
  window: { top: 1, self: 1, addEventListener(){}, innerWidth: 1800, innerHeight: 1000 },
  document: { readyState: 'complete', createElement: makeEl, documentElement: makeEl('html'),
    head: makeEl('head'), body: makeEl('body'), getElementById: () => null,
    querySelector: () => null, querySelectorAll: () => [], addEventListener(){}, title: '' },
  setInterval: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
  clearInterval: () => {}, setTimeout: (fn) => { try { fn(); } catch (e) {} return 0; },
  Date: class extends Date { constructor(...a) { super(...(a.length ? a : [now])); } static now() { return now; } }
};
const names = Object.keys(stub);
new Function(...names, src)(...names.map(n => stub[n]));
const tick = timers.find(t => t.ms === 1200);

for (let i = 0; i < 60; i++) { now += 1200; tick.fn(); }   // settle, tiles go live
const scansBefore = domScans, rectsBefore = rectCalls;
Object.keys(SEL).forEach(k => delete SEL[k]);
for (let i = 0; i < 50; i++) { now += 1200; tick.fn(); }   // one more minute, everything playing
const scansPerMin = domScans - scansBefore;
const rectsPerMin = rectCalls - rectsBefore;

let fail = 0;
const check = (label, cond, detail) => { if (!cond) { fail++; console.log('FAIL  ' + label + (detail ? '  ' + detail : '')); } else console.log('PASS  ' + label + (detail ? '  ' + detail : '')); };

console.log('selectors this minute:', JSON.stringify(SEL));
console.log('per minute with four tiles playing: ' + scansPerMin + ' app DOM scans, ' + rectsPerMin + ' layout reads');
check('app DOM scans stay low once playing', scansPerMin <= 60, '(' + scansPerMin + '/min)');
check('frames are sized to the tile, not a fixed 1500', /FRAME_FIT/.test(src) && /frameSize\(\)/.test(src));
check('the video element is cached between passes', /function mediaFor/.test(src));
check('dialog sweeps are time based, not every few ticks', /DIALOG_CHECK_MS/.test(src) && !/DIALOG_CHECK_EVERY/.test(src));

console.log(fail ? `\n${fail} FAILING` : '\nall passing');
process.exit(fail ? 1 : 0);
