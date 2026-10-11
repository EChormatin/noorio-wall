// Dragging a tile into position: does the offset do anything, stay inside the picture, and survive?
const fs = require('fs');
const src = fs.readFileSync(process.argv[2], 'utf8');

const panDelta = new Function('rotation', 'dx', 'dy',
  src.slice(src.indexOf('function panDelta(rotation, dx, dy)'), src.indexOf('function log()')) +
  '\nreturn panDelta(rotation, dx, dy);');

const cropBody = src.slice(src.indexOf('  function crop(p) {'), src.indexOf('  function doc_of(p) {'));
const cropFn = new Function('p', 'FIT', 'FRAME_W', 'FRAME_H', 'layoutStage', 'mediaFor',
  cropBody + '\nreturn crop(p);');

const FRAME = { w: 1100, h: 700 };
const TILE = { w: 760, h: 420 };
const VIDEO = { left: 0, top: 0, width: 1100, height: 700 };     // fills the frame, so there is slack to drag into

function freshPane(panX, panY) {
  return {
    panX: panX || 0, panY: panY || 0, rotation: 0,
    frame: { width: FRAME.w, height: FRAME.h, offsetWidth: FRAME.w, offsetHeight: FRAME.h,
             style: {}, contentDocument: { documentElement: { style: {} } } }
  };
}
function place(p, tile) {
  tile = tile || TILE;
  const vid = { tagName: 'VIDEO', videoWidth: 1920, videoHeight: 1080, getBoundingClientRect: () => VIDEO };
  const ok = cropFn(p, 'cover', 1500, 950, () => ({ w: tile.w, h: tile.h }), () => vid);
  if (!ok) return null;
  const s = parseFloat(p.frame.style.transform.replace(/[^0-9.]/g, ''));
  return { s, left: parseFloat(p.frame.style.left), top: parseFloat(p.frame.style.top) };
}
const covered = (r, tile) => {
  tile = tile || TILE;
  return r.left <= 0.01 && r.top <= 0.01 &&
         r.left + FRAME.w * r.s >= tile.w - 0.01 &&
         r.top + FRAME.h * r.s >= tile.h - 0.01;
};

let fail = 0;
const check = (label, cond, detail) => {
  if (!cond) { fail++; console.log('FAIL  ' + label + (detail ? '  ' + detail : '')); }
  else console.log('PASS  ' + label + (detail ? '  ' + detail : ''));
};

// 1. a drag on screen has to mean the same thing however the tile is turned
const d0 = panDelta(0, 10, -4), d90 = panDelta(90, 10, -4);
const d180 = panDelta(180, 10, -4), d270 = panDelta(270, 10, -4);
check('upright: a drag is itself', d0.x === 10 && d0.y === -4);
check('on its side at 90: dragging up moves the picture up', d90.x === -4 && d90.y === -10);
check('upside down: a drag is reversed', d180.x === -10 && d180.y === 4);
check('on its side at 270', d270.x === 4 && d270.y === 10);
check('a saved angle outside 0-359 still maps', panDelta(450, 10, -4).x === -4);

// 2. a saved offset actually moves the picture
const middle = place(freshPane(0, 0));
const raised = place(freshPane(0, -0.08));                       // dragged up by 8% of the tile
check('a saved offset moves the picture', raised && middle && raised.top < middle.top - 1,
      raised ? '(top ' + middle.top.toFixed(1) + ' -> ' + raised.top.toFixed(1) + ')' : '');
check('and the tile is still covered', raised && covered(raised));

const TALL = { w: 400, h: 420 };                                 // slack runs sideways in a narrow tile
const tallMiddle = place(freshPane(0, 0), TALL);
const tallShifted = place(freshPane(0.06, 0), TALL);
check('sideways too, and the picture follows the drag',
      tallShifted && tallShifted.left > tallMiddle.left + 1 && covered(tallShifted, TALL),
      tallShifted ? '(left ' + tallMiddle.left.toFixed(1) + ' -> ' + tallShifted.left.toFixed(1) + ')' : '');

const noSlack = freshPane(0.06, 0);                              // a tile with no slack to give must refuse it
place(noSlack);
check('a tile with nothing to spare keeps no sideways offset', noSlack.panX === 0);

// 3. dragging past the edge of the picture must not open a black gap
[[0, -5], [0, 5], [-5, 0], [5, 0], [3, -3]].forEach(function (off) {
  const p = freshPane(off[0], off[1]);
  const r = place(p);
  check('a wild drag of ' + off.join(',') + ' stays inside the picture', r && covered(r));
  check('  and only what is reachable is kept', Math.abs(p.panX) <= 5 && Math.abs(p.panY) <= 5 &&
        Math.abs(p.panX) < Math.abs(off[0]) + 0.001 && Math.abs(p.panY) < Math.abs(off[1]) + 0.001);
});

// 4. after being pushed to the stop, a drag the other way responds at once
const atStop = freshPane(0, -5);
place(atStop);
const stopped = atStop.panY;
atStop.panY += 0.05;                                             // a small drag back down
const back = place(atStop);
check('dragging back off the stop responds immediately', atStop.panY > stopped && back && covered(back));

// 5. centring clears it
const reset = freshPane(0, -0.08);
place(reset);
reset.panX = 0; reset.panY = 0;
const centred = place(reset);
check('centring puts it back', Math.abs(centred.top - middle.top) < 0.01);

console.log(fail ? `\n${fail} FAILING` : '\nall passing');
process.exit(fail ? 1 : 0);
