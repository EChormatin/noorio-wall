// A tile that is playing, then pauses because the stream ended. Does the wall get it back?
const fs = require('fs');
const src = fs.readFileSync(process.argv[2], 'utf8');

let now = 1700000000000;
const timers = [];
const events = [];                       // what the wall did about it
let domScans = 0;

function makeVideo() {
  return {
    tagName: 'VIDEO', paused: false, muted: true, volume: 0, readyState: 4, networkState: 1,
    currentTime: 0, videoWidth: 1280, videoHeight: 720, isConnected: true, controls: false,
    style: { cssText: '' },
    play() { return { catch(){} }; },
    getBoundingClientRect: () => ({ width: 1000, height: 560, left: 20, top: 40 })
  };
}

function fakeDoc(video) {
  const playBtn = {
    tagName: 'DIV', className: 'play-button', isConnected: true, style: {},
    getBoundingClientRect: () => ({ width: 60, height: 60, left: 490, top: 290 }),
    dispatchEvent(){ events.push({ t: now, what: 'clicked play' }); },
    getAttribute: () => null, parentElement: null, children: []
  };
  return {
    body: { tag: 'body' }, documentElement: { style: {} }, location: { pathname: '/' },
    querySelectorAll: (sel) => {
      domScans++;
      if (/video/.test(sel)) return [video];
      if (/play/.test(sel)) return video.paused ? [playBtn] : [];
      return [];
    },
    querySelector: () => null,
    elementFromPoint: () => (video.paused ? playBtn : null)
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
  if (tag === 'iframe') {
    const v = makeVideo();
    o.video = v;
    o.contentDocument = fakeDoc(v);
    o.contentWindow = { PointerEvent: function(){}, MouseEvent: function(){} };
    let src = '';
    Object.defineProperty(o, 'src', { get: () => src, set: (val) => { src = val; if (val === '/') events.push({ t: now, what: 'reloaded' }); } });
    frames.push(o);
  }
  return o;
}
const frames = [];

const stub = {
  NW_LOGO: '', NW_AVATARS: {}, NW_QR: '',
  chrome: { runtime: { onMessage: { addListener(){} }, sendMessage(){}, lastError: null },
            storage: { local: { get(k, cb){ cb({}); }, set(o, cb){ cb && cb(); } } } },
  location: { hash: '#wallGrid' },
  window: { top: 1, self: 1, addEventListener(){}, innerWidth: 1800, innerHeight: 1000,
            PointerEvent: function(){}, MouseEvent: function(){} },
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

const run = (seconds) => { for (let i = 0; i < seconds / 1.2; i++) { now += 1200; tick.fn(); } };

run(120);                                   // settle, everything playing
const scansWhilePlaying = domScans;
run(60);
const scansPerMinPlaying = domScans - scansWhilePlaying;

frames.forEach(f => { f.video.paused = true; });   // every stream ends, play buttons come back
const pausedAt = now;
events.length = 0;
run(400);                                   // nearly seven minutes of being paused

const firstClick = events.find(e => e.what === 'clicked play');
const firstReload = events.find(e => e.what === 'reloaded');

let fail = 0;
const check = (label, cond, detail) => { if (!cond) { fail++; console.log('FAIL  ' + label + (detail ? '  ' + detail : '')); } else console.log('PASS  ' + label + (detail ? '  ' + detail : '')); };

check('it presses play once a tile pauses', !!firstClick,
      firstClick ? '(after ' + Math.round((firstClick.t - pausedAt) / 1000) + 's)' : '');
check('it does not wait longer than 15s to try', firstClick && (firstClick.t - pausedAt) <= 15000);
check('it reloads a tile that will not resume, once the cooldown allows', !!firstReload,
      firstReload ? '(after ' + Math.round((firstReload.t - pausedAt) / 1000) + 's)' : '');
check('playing tiles stay cheap to watch', scansPerMinPlaying <= 60, '(' + scansPerMinPlaying + ' scans/min)');

// and it must notice when the stream comes back
frames.forEach(f => { f.video.paused = false; });
events.length = 0;
run(30);
check('no further clicks once it resumes', !events.some(e => e.what === 'clicked play'));

console.log(fail ? `\n${fail} FAILING` : '\nall passing');
process.exit(fail ? 1 : 0);
