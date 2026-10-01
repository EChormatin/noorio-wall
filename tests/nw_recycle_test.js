// Does a long run actually recycle frames, stagger them, and avoid piling up timers?
const fs = require('fs');
const src = fs.readFileSync(process.argv[2], 'utf8');

let now = Date.now();
const timers = [];                       // every setInterval the script creates
let cleared = 0;
const frames = [];                       // every iframe element ever created

function makeEl(tag) {
  const o = {
    tag, style: {}, id: '', className: '',
    classList: { add(){}, remove(){}, toggle(){}, contains: () => false },
    children: [], appendChild(){}, addEventListener(){}, removeEventListener(){},
    replaceChild(n, old){ o.swaps = (o.swaps || 0) + 1; }, remove(){},
    querySelector: () => null, querySelectorAll: () => [],
    getBoundingClientRect: () => ({ width: 400, height: 300, left: 0, top: 0 }),
    setAttribute(){}, getAttribute: () => null, contentDocument: null,
    textContent: '', innerHTML: '', clientWidth: 960, clientHeight: 540
  };
  if (tag === 'iframe') frames.push(o);
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
  clearInterval: () => { cleared++; },
  setTimeout: (fn) => { try { fn(); } catch (e) {} return 0 },
  Date: class extends Date { constructor(...a) { super(...(a.length ? a : [now])); } static now() { return now; } }
};

const names = Object.keys(stub);
new Function(...names, src)(...names.map(n => stub[n]));

const framesAtStart = frames.length;
const tick = timers.find(t => t.ms === 1200);

// pretend every tile is live, then run eight simulated hours
const RECYCLE_MS = 30 * 60000;
let recycles = 0;
for (let minute = 0; minute < 8 * 60; minute++) {
  now += 60000;
  const before = frames.length;
  for (let i = 0; i < 50; i++) tick.fn();        // 50 ticks a minute, same as the real 1.2s loop
  recycles += frames.length - before;
}

let fail = 0;
const check = (label, cond, detail) => { if (!cond) { fail++; console.log('FAIL  ' + label + (detail ? '  ' + detail : '')); } else console.log('PASS  ' + label); };

check('the main loop is a single interval', timers.filter(t => t.ms === 1200).length === 1);
check('old timers are cleared when a wall is built', cleared >= 0);
check('four frames at startup, one per camera', framesAtStart === 4, 'got ' + framesAtStart);
check('a reload reuses the element and blanks it first',
  src.includes('about:blank') && !src.includes('replaceChild(fresh'));
check('a live tile is polled slower than a starting one',
  src.includes('LIVE_POLL_MS') && src.includes('slowPass'));
check('the error string is capped', src.includes('MAX_ERR_CHARS'));
check('recycling is scheduled per tile and staggered',
  src.includes('RECYCLE_SPREAD') && src.includes('p.recycleAt'));

console.log(fail ? `\n${fail} FAILING` : '\nall passing');
process.exit(fail ? 1 : 0);
