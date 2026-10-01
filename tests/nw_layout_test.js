// Does the panel land in the right place for each camera count, and do tiles shift out of the rail's way?
const fs = require('fs');
const src = fs.readFileSync(process.argv[2], 'utf8');
const layoutFor = new Function('cams',
  src.slice(src.indexOf('function layoutForCameras(cams)'), src.indexOf('let WALL_GEN')) +
  '\nreturn layoutForCameras(cams);');

const STATUS_RAIL_W = 270;
function place(cams) {                                  // mirrors buildWall's decision, same order
  const layout = layoutFor(cams);
  const taken = {};
  layout.placed.forEach(sl => taken[sl.col + ':' + sl.row] = true);
  let gap = null;
  for (let r = 1; r <= layout.rows && !gap; r++)
    for (let c = 1; c <= layout.cols && !gap; c++) if (!taken[c + ':' + r]) gap = { col: c, row: r };
  const rail = !gap, shift = rail ? 1 : 0;
  return {
    cols: layout.cols, rows: layout.rows, rail,
    template: rail ? STATUS_RAIL_W + 'px repeat(' + layout.cols + ', 1fr)' : 'repeat(' + layout.cols + ', 1fr)',
    tiles: layout.placed.map(s => [s.name, s.col + shift, s.row]),
    panel: rail ? ['1', '1 / -1'] : [String(gap.col + shift), String(gap.row)]
  };
}

let fail = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fail++; console.log('FAIL  ' + label + '\n      got  ' + JSON.stringify(got) + '\n      want ' + JSON.stringify(want)); }
  else console.log('PASS  ' + label);
};

// four cameras, two full columns: no gap, so the rail
const four = place(['Olivia', 'Benjamin', 'Olivia (Liquids)', 'Benjamin (Liquids)']);
check('four cameras use the rail', [four.rail, four.panel], [true, ['1', '1 / -1']]);
check('four cameras shift right of the rail', four.tiles,
  [['Olivia', 2, 1], ['Olivia (Liquids)', 2, 2], ['Benjamin', 3, 1], ['Benjamin (Liquids)', 3, 2]]);
check('template leads with the rail width', four.template, '270px repeat(2, 1fr)');

// five cameras, Meredith alone: there is a gap, so no rail and no shift
const five = place(['Olivia', 'Benjamin', 'Meredith', 'Olivia (Liquids)', 'Benjamin (Liquids)']);
check('five cameras keep the spare cell', [five.rail, five.panel], [false, ['3', '2']]);
check('five cameras are not shifted', five.tiles.filter(t => t[0] === 'Olivia'), [['Olivia', 1, 1]]);
check('template has no rail column', five.template, 'repeat(3, 1fr)');

// one camera: single cell, no gap, so rail
const one = place(['Olivia']);
check('a single camera uses the rail', [one.rail, one.tiles], [true, [['Olivia', 2, 1]]]);

// six cameras in three full pairs
const six = place(['Olivia', 'Benjamin', 'Meredith', 'Olivia (Liquids)', 'Benjamin (Liquids)', 'Meredith (Liquids)']);
check('six cameras use the rail', six.rail, true);
check('six cameras fill three shifted columns', six.tiles.map(t => t[1]), [2, 2, 3, 3, 4, 4]);

console.log(fail ? `\n${fail} FAILING` : '\nall passing');
process.exit(fail ? 1 : 0);
