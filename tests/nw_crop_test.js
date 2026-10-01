// With cover, the frame must always cover the tile: no gap at any edge.
const fs = require('fs');
const src = fs.readFileSync(process.argv[2], 'utf8');
const body = src.slice(src.indexOf('  function crop(p) {'), src.indexOf('  function doc_of(p) {'));

const crop = new Function('p', 'FIT', 'FRAME_W', 'FRAME_H', 'layoutStage', 'mediaFor', `
  ${body}
  return crop(p);
`);

function tryCase(label, frame, video, tile) {
  const p = {
    frame: { width: frame.w, height: frame.h, offsetWidth: frame.w, offsetHeight: frame.h,
             style: {}, contentDocument: { documentElement: { style: {} } } }
  };
  const vid = { getBoundingClientRect: () => video };
  const ok = crop(p, 'cover', 1500, 950, () => ({ w: tile.w, h: tile.h }), () => vid);
  if (!ok) return { label, ok: false };
  const s = parseFloat(p.frame.style.transform.replace(/[^0-9.]/g, ''));
  const left = parseFloat(p.frame.style.left), top = parseFloat(p.frame.style.top);
  const covers = left <= 0.01 && top <= 0.01 &&
                 left + frame.w * s >= tile.w - 0.01 &&
                 top + frame.h * s >= tile.h - 0.01;
  return { label, ok: true, covers, s, left, top, right: left + frame.w * s, tile };
}

const cases = [
  ['video sits inside the frame', { w: 1100, h: 700 }, { left: 40, top: 60, width: 1000, height: 560 }, { w: 760, h: 420 }],
  ['video overflows the right edge', { w: 1100, h: 700 }, { left: 40, top: 60, width: 1400, height: 780 }, { w: 760, h: 420 }],
  ['video starts off the left edge', { w: 1100, h: 700 }, { left: -120, top: 0, width: 1300, height: 700 }, { w: 760, h: 420 }],
  ['tall tile, wide video', { w: 1100, h: 700 }, { left: 0, top: 200, width: 1100, height: 300 }, { w: 400, h: 800 }],
  ['rotated tile, swapped sides', { w: 1100, h: 700 }, { left: 50, top: 50, width: 900, height: 500 }, { w: 420, h: 760 }]
];

let fail = 0;
cases.forEach(([label, f, v, t]) => {
  const r = tryCase(label, f, v, t);
  if (!r.ok) { fail++; console.log('FAIL  ' + label + '  (crop refused)'); return; }
  if (!r.covers) { fail++; console.log('FAIL  ' + label + '  gap: left=' + r.left.toFixed(1) + ' right=' + r.right.toFixed(1) + ' needs ' + r.tile.w); }
  else console.log('PASS  ' + label);
});

console.log(fail ? `\n${fail} FAILING` : '\nall passing');
process.exit(fail ? 1 : 0);
