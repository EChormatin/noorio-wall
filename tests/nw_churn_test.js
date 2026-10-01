
// Worst case: frames that load a page but never produce a video. How many app instances do we build?
const fs = require('fs');
const src = fs.readFileSync(process.argv[2], 'utf8');

let now = 1700000000000;
const timers = [];
const frames = [];
const loads = [];                                   // every time a frame is pointed at the app

function fakeDoc() {                                   // a loaded page with no video and no camera list
  const d = {
    body: { tag: 'body' },
    documentElement: { style: {} },
    location: { pathname: '/' },
    querySelectorAll: () => [],
    querySelector: () => null,
    elementFromPoint: () => null
  };
  return d;
}

function makeEl(tag) {
  const o = { tag, style: {}, id: '', className: '',
    classList: { add(){}, remove(){}, toggle(){}, contains: () => false },
    children: [], appendChild(){}, addEventListener(){}, removeEventListener(){},
    replaceChild(){}, remove(){}, querySelector: () => null, querySelectorAll: () => [],
    getBoundingClientRect: () => ({ width: 400, height: 300, left: 0, top: 0 }),
    setAttribute(){}, getAttribute: () => null,
    textContent: '', innerHTML: '', clientWidth: 960, clientHeight: 540 };
  if (tag === 'iframe') {
    o.contentDocument = fakeDoc(); o.contentWindow = {};
    let src = '';
    Object.defineProperty(o, 'src', {                 // a load is a navigation to "/", not a new element
      get: () => src,
      set: (v) => { src = v; if (v === '/') loads.push(now); }
    });
    frames.push(o);
  }
  return o;
}

const stub = {
  NW_LOGO: '', NW_AVATARS: {}, NW_QR: '',
  chrome: { runtime: { onMessage: { addListener(){} }, sendMessage(){}, lastError: null },
            storage: { local: { get(k, cb){ cb({}); }, set(o, cb){ cb && cb(); } } } },
  location: { hash: '#wallGrid' },
  window: { top: 1, self: 1, addEventListener(){} },
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
const startLoads = loads.length;
const startFrames = frames.length;

const perHour = [];
for (let h = 0; h < 8; h++) {
  const before = loads.length;
  for (let m = 0; m < 60; m++) { now += 60000; for (let i = 0; i < 50; i++) tick.fn(); }
  perHour.push(loads.length - before);
}
const created = loads.length - startLoads;

let fail = 0;
const check = (label, cond, detail) => { if (!cond) { fail++; console.log('FAIL  ' + label + (detail ? '  ' + detail : '')); } else console.log('PASS  ' + label + (detail ? '  ' + detail : '')); };

console.log('app loads per hour: ' + perHour.join(', '));
check('one frame element per camera, reused forever', frames.length === 4, '(' + frames.length + ')');
check('the retry path really ran', created > 0, '(' + created + ' reloads over 8h)');
check('never more than the hourly ceiling', Math.max(...perHour) <= 10, '(peak ' + Math.max(...perHour) + '/h)');
check('churn settles rather than repeating forever', perHour[7] <= perHour[0], '(' + perHour[0] + ' then ' + perHour[7] + ')');
check('eight hours stays well under a hundred loads', created < 100, '(' + created + ')');

console.log(fail ? `\n${fail} FAILING` : '\nall passing');
process.exit(fail ? 1 : 0);
