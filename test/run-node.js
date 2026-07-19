/*
 * run-node.js — sanity/validation harness for the gnubg WASM engine.
 *
 * Runs the engine directly in Node (no worker) and checks the best move
 * for reference positions against the gnubg/XG consensus best plays.
 *
 * Usage: node test/run-node.js [ply]   (default ply 2)
 */

'use strict';

const path = require('path');
const fs = require('fs');

// The emscripten 2.0.23 file-packager loader assumes a web page/worker;
// give it a location stub and hand it the .data package directly.
global.location = { pathname: '/' };

const createGnubgModule = require(path.join(__dirname, '..', 'dist', 'gnubg-engine.js'));

function loadDataPackage() {
  const p = path.join(__dirname, '..', 'dist', 'gnubg-engine.data');
  const buf = fs.readFileSync(p);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

// Standard backgammon starting position, player on roll = player 0.
const STARTING_POSITION = '4HPwATDgc/ABMA';

// Opening rolls with an undisputed best play (gnubg 2-ply & XG agree).
const OPENING_EXPECTATIONS = [
  { dice: [3, 1], best: '8/5 6/5' },
  { dice: [4, 2], best: '8/4 6/4' },
  { dice: [6, 1], best: '13/7 8/7' },
  { dice: [5, 3], best: '8/3 6/3' },
  { dice: [6, 5], best: '24/13' },
];

// Close calls: just print, don't assert.
const OPENING_INFORMATIONAL = [
  [2, 1], [4, 1], [5, 1], [3, 2], [5, 2], [6, 2], [4, 3], [6, 3], [5, 4], [6, 4],
];

function fmtProbs(p) {
  return `W ${(p.win * 100).toFixed(1)}% G ${(p.winG * 100).toFixed(1)}%/${(p.loseG * 100).toFixed(1)}%`;
}

async function main() {
  const ply = parseInt(process.argv[2] || '2', 10);
  const t0 = Date.now();

  const Module = await createGnubgModule({
    print: () => {},
    printErr: () => {},
    locateFile: (f) => path.join(__dirname, '..', 'dist', f),
    wasmBinary: fs.readFileSync(path.join(__dirname, '..', 'dist', 'gnubg-engine.wasm')),
    getPreloadedPackage: () => loadDataPackage(),
  });
  Module._start();

  const api = {
    setPosition: Module.cwrap('web_set_position', 'number', ['string']),
    analyzeMove: Module.cwrap('web_analyze_move', 'string', ['number', 'number', 'number']),
    analyzeCube: Module.cwrap('web_analyze_cube', 'string', ['number']),
    evaluate: Module.cwrap('web_evaluate', 'string', ['number']),
    getPosition: Module.cwrap('web_get_position', 'string', []),
  };

  const tInit = Date.now() - t0;
  console.log(`init: ${tInit} ms`);

  if (api.setPosition(STARTING_POSITION) !== 0) {
    throw new Error('failed to set starting position');
  }
  const roundTrip = api.getPosition();
  if (roundTrip !== STARTING_POSITION) {
    throw new Error(`position round-trip mismatch: ${roundTrip}`);
  }
  console.log(`position round-trip OK (${roundTrip})`);

  let failures = 0;
  let totalMs = 0;

  for (const { dice, best } of OPENING_EXPECTATIONS) {
    api.setPosition(STARTING_POSITION);
    const t = Date.now();
    const res = JSON.parse(api.analyzeMove(dice[0], dice[1], ply));
    const ms = Date.now() - t;
    totalMs += ms;
    if (res.error) throw new Error(res.error);
    const top = res.moves[0];
    const pass = top.move === best;
    if (!pass) failures++;
    console.log(
      `${pass ? 'PASS' : 'FAIL'} ${dice.join('-')}: ${top.move} (eq ${top.equity.toFixed(3)}, ` +
      `${fmtProbs(top.probs)}) [expect ${best}] ${ms} ms`
    );
  }

  for (const dice of OPENING_INFORMATIONAL) {
    api.setPosition(STARTING_POSITION);
    const t = Date.now();
    const res = JSON.parse(api.analyzeMove(dice[0], dice[1], ply));
    const ms = Date.now() - t;
    totalMs += ms;
    const top = res.moves[0];
    const second = res.moves[1];
    console.log(
      `info ${dice.join('-')}: ${top.move} (eq ${top.equity.toFixed(3)})` +
      (second ? ` | 2nd ${second.move} (${second.diff.toFixed(3)})` : '') + ` ${ms} ms`
    );
  }

  // Cube + eval smoke test on the opening position.
  api.setPosition(STARTING_POSITION);
  const cube = JSON.parse(api.analyzeCube(ply));
  console.log(`cube: ${cube.decision} (nd ${cube.equities.noDouble.toFixed(3)}, ` +
    `dt ${cube.equities.doubleTake.toFixed(3)}, dp ${cube.equities.doublePass.toFixed(3)})`);
  const ev = JSON.parse(api.evaluate(ply));
  console.log(`eval: equity ${ev.equity.toFixed(3)}, cubeful ${ev.cubefulEquity.toFixed(3)}, ${fmtProbs(ev.probs)}`);

  const n = OPENING_EXPECTATIONS.length + OPENING_INFORMATIONAL.length;
  console.log(`\navg analysis time @${ply}-ply: ${(totalMs / n).toFixed(0)} ms over ${n} rolls`);
  console.log(failures === 0 ? 'ALL EXPECTED-MOVE CHECKS PASSED' : `${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
