// With cover, the frame must always cover the tile: no gap at any edge.
const fs = require('fs');
const src = fs.readFileSync(process.argv[2], 'utf8');
const body = src.slice(src.indexOf('  function crop(p) {'), src.indexOf('  function doc_of(p) {'));

const crop = new Function('p', 'FIT', 'FRAME_W', 'FRAME_H', 'layoutStage', 'mediaFor', `
  ${body}
  return crop(p);
`);

function tryCase(label, frame, video, tile, intrinsic) {
  const p = {
    frame: { width: frame.w, height: frame.h, offsetWidth: frame.w, offsetHeight: frame.h,
             style: {}, contentDocument: { documentElement: { style: {} } } }
  };
  const vid = { tagName: 'VIDEO', getBoundingClientRect: () => video,
                videoWidth: intrinsic ? intrinsic.w : 0, videoHeight: intrinsic ? intrinsic.h : 0 };
  const ok = crop(p, 'cover', 1500, 950, () => ({ w: tile.w, h: tile.h }), () => vid);
  if (!ok) return { label, ok: false };
  const s = parseFloat(p.frame.style.transform.replace(/[^0-9.]/g, ''));
  const left = parseFloat(p.frame.style.left), top = parseFloat(p.frame.style.top);
  const covers = left <= 0.01 && top <= 0.01 &&
                 left + frame.w * s >= tile.w - 0.01 &&
                 top + frame.h * s >= tile.h - 0.01;

  // where the picture itself lands, which is what the viewer sees. Anything of the tile outside
  // it is one of the player's own black bars.
  let px = video.left, py = video.top, pw = video.width, ph = video.height;
  if (intrinsic) {
    const want = intrinsic.w / intrinsic.h, have = pw / ph;
    if (want > have + 0.01) { const h = pw / want; py += (ph - h) / 2; ph = h; }
    else if (want < have - 0.01) { const w = ph * want; px += (pw - w) / 2; pw = w; }
  }
  const picture = left + px * s <= 0.01 && top + py * s <= 0.01 &&
                  left + (px + pw) * s >= tile.w - 0.01 &&
                  top + (py + ph) * s >= tile.h - 0.01;
  return { label, ok: true, covers, picture, s, left, top, right: left + frame.w * s, tile };
}

const cases = [
  ['video sits inside the frame', { w: 1100, h: 700 }, { left: 40, top: 60, width: 1000, height: 560 }, { w: 760, h: 420 }],
  ['video overflows the right edge', { w: 1100, h: 700 }, { left: 40, top: 60, width: 1400, height: 780 }, { w: 760, h: 420 }],
  ['video starts off the left edge', { w: 1100, h: 700 }, { left: -120, top: 0, width: 1300, height: 700 }, { w: 760, h: 420 }],
  ['tall tile, wide video', { w: 1100, h: 700 }, { left: 0, top: 200, width: 1100, height: 300 }, { w: 400, h: 800 }],
  ['rotated tile, swapped sides', { w: 1100, h: 700 }, { left: 50, top: 50, width: 900, height: 500 }, { w: 420, h: 760 }],
  ['player pillarboxes a portrait camera', { w: 1100, h: 700 },
   { left: 0, top: 0, width: 1100, height: 620 }, { w: 760, h: 420 }, { w: 720, h: 1280 }],
  ['player letterboxes a wide camera', { w: 1100, h: 700 },
   { left: 0, top: 0, width: 1100, height: 700 }, { w: 760, h: 420 }, { w: 1920, h: 1080 }],
  ['pillarboxed picture in a tall tile', { w: 1100, h: 700 },
   { left: 20, top: 20, width: 1040, height: 660 }, { w: 400, h: 800 }, { w: 1080, h: 1920 }]
];

let fail = 0;
cases.forEach(([label, f, v, t, intr]) => {
  const r = tryCase(label, f, v, t, intr);
  if (!r.ok) { fail++; console.log('FAIL  ' + label + '  (crop refused)'); return; }
  if (!r.covers) { fail++; console.log('FAIL  ' + label + '  frame gap: left=' + r.left.toFixed(1) + ' right=' + r.right.toFixed(1) + ' needs ' + r.tile.w); }
  else if (!r.picture) { fail++; console.log('FAIL  ' + label + '  a black bar from the player is showing'); }
  else console.log('PASS  ' + label);
});

console.log(fail ? `\n${fail} FAILING` : '\nall passing');
process.exit(fail ? 1 : 0);
