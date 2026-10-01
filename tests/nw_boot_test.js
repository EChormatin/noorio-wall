// The two states the script can start in: mid-parse (document_start) and already parsed.
const fs = require('fs');
const src = fs.readFileSync(process.argv[2], 'utf8');

function run(readyState) {
  const events = {};
  const made = [];
  const el = (tag) => {
    const o = { tag, style: {}, classList: { add(){}, remove(){}, toggle(){} }, children: [],
      appendChild(c){ made.push(c && c.id ? c.id : (c && c.tag) || '?'); }, addEventListener(){},
      querySelector: () => null, querySelectorAll: () => [], remove(){ made.push('REMOVED:' + (o.id||'')); },
      getBoundingClientRect: () => ({ width: 0, height: 0, left: 0, top: 0 }),
      setAttribute(){}, getAttribute: () => null, replaceChild(){}, contentDocument: null,
      textContent: '', innerHTML: '', clientWidth: 960, clientHeight: 540 };
    return o;
  };
  const stub = {
    NW_LOGO: '', NW_AVATARS: {}, NW_QR: '',
    chrome: { runtime: { onMessage: { addListener(){} }, sendMessage(){}, lastError: null },
              storage: { local: { get(k,cb){cb({});}, set(o,cb){cb&&cb();} } } },
    location: { hash: '#wallGrid' },
    window: { top: 1, self: 1, addEventListener(){} },
    document: { readyState, createElement: el, documentElement: el('html'),
      head: readyState === 'loading' ? null : el('head'),              // head is often not there yet at document_start
      body: readyState === 'loading' ? null : el('body'),
      getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
      addEventListener(type, fn){ events[type] = fn; }, title: '' },
    setInterval: () => 0, setTimeout: () => 0, clearInterval: () => {}
  };
  const names = Object.keys(stub);
  new Function(...names, src)(...names.map(n => stub[n]));
  return { made, waited: Object.keys(events), fire: events['DOMContentLoaded'] };
}

let fail = 0;
const check = (label, cond) => { if (!cond) { fail++; console.log('FAIL  ' + label); } else console.log('PASS  ' + label); };

const early = run('loading');
check('at document_start it paints a backdrop before anything else', early.made.includes('nw-boot-style') && early.made.includes('nw-boot'));
check('at document_start it does not build the grid yet', !early.made.includes('nw-grid'));
check('at document_start it waits for DOMContentLoaded', early.waited.includes('DOMContentLoaded'));
early.fire();
check('the grid builds once the DOM is ready', early.made.includes('nw-grid'));

const late = run('complete');
check('on an already parsed page it paints and builds straight away', late.made.includes('nw-boot') && late.made.includes('nw-grid'));

console.log(fail ? `\n${fail} FAILING` : '\nall passing');
process.exit(fail ? 1 : 0);
