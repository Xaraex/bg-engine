# gnubg WASM engine

[GNU Backgammon](https://www.gnu.org/software/gnubg/) (gnubg) 1.05 compiled to
WebAssembly with [Emscripten](https://emscripten.org/), exposing a small
JSON-based analysis API for use in browsers (via a Web Worker) or Node.

Based on [hwatheod/gnubg-web](https://github.com/hwatheod/gnubg-web), an
Emscripten port of gnubg with a JavaScript UI. This fork strips the demo UI
and instead exports a minimal engine API: position setup, chequer-play
analysis, cube analysis and static evaluation, all with gnubg's neural nets
and cubeful evaluations.

## License

GPLv3 — see [COPYING](COPYING). This is a derivative work of GNU Backgammon
(GPLv3), © the GNU Backgammon authors. The Emscripten port scaffolding is by
[hwatheod](https://github.com/hwatheod/gnubg-web). Engine API additions
(`gnubg/web_api.c`, `js/`, `build_engine.sh`) are GPLv3 as well.

If you serve the compiled `.wasm`/`.js`/`.data` artifacts to browsers, the
GPL requires making this corresponding source available.

## Building

Requires Emscripten. The known-good toolchain is **emsdk 2.0.23** (newer
emsdks need source changes; not yet done).

```sh
# one-time toolchain setup
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk
./emsdk install 2.0.23
./emsdk activate 2.0.23
source ./emsdk_env.sh      # emsdk_env.bat / .ps1 on Windows

# build the engine
cd /path/to/this/repo
./build_engine.sh
```

Outputs in `dist/`:

| File | Purpose |
|---|---|
| `gnubg-engine.js` | Emscripten glue (MODULARIZE'd, `createGnubgModule`) |
| `gnubg-engine.wasm` | The engine |
| `gnubg-engine.data` | Preloaded assets: neural net weights (`gnubg.wd`), one-sided bearoff DB, match equity tables |
| `engine.worker.js` | Web Worker wrapping the module (message protocol) |
| `engine-client.js` | Promise-based client for the worker (ES module) |

The original gnubg-web demo build (text-command UI) is still available via
`./build.sh`.

## API

In a browser:

```js
import { GnubgEngine } from './engine-client.js';

const engine = new GnubgEngine('/engine/engine.worker.js');
await engine.init();                       // loads WASM + NN weights

await engine.setPosition('4HPwATDgc/ABMA'); // gnubg Position ID (on-roll perspective)
// optional: engine.setMatchId(...) or engine.setCube({...}) for cube/match state

const result = await engine.analyzeMove(3, 1, 2);  // die1, die2, plies (0..3)
// { moves: [ { move: "8/5 6/5", equity: 0.163, diff: 0,
//              probs: { win, winG, winBG, loseG, loseBG } }, ... ],
//   totalMoves: n }   — sorted best first, top 5, cubeful equities

const cube = await engine.analyzeCube(2);
// { decision: "No double, take", equities: { optimal, noDouble, doubleTake, doublePass }, probs }

const evaln = await engine.evaluate(2);
// { equity, cubefulEquity, probs }
```

Position state is engine-side: `setPosition` resets to a centred money-game
cube; `setCube`/`setMatchId` override it. Equities are always from the
perspective of the player on roll.

In Node (e.g. build-time precomputation):

```js
const createGnubgModule = require('./dist/gnubg-engine.js');
const Module = await createGnubgModule({ locateFile: f => `${__dirname}/dist/${f}` });
Module._start();
const analyzeMove = Module.cwrap('web_analyze_move', 'string', ['number','number','number']);
```

## Testing

```sh
node test/run-node.js       # validates opening-roll best moves at 2-ply
node test/run-node.js 0     # 0-ply (fast)
```

## What was changed relative to gnubg-web

- Added `gnubg/web_api.c` — JSON analysis API (`web_set_position`,
  `web_set_cube`, `web_set_matchid`, `web_analyze_move`, `web_analyze_cube`,
  `web_evaluate`, `web_get_position`).
- Added `build_engine.sh` — engine-only MODULARIZE'd build (no HTML UI).
- Added `js/engine.worker.js` + `js/engine-client.js` — worker wrapper and client.
- Added `test/run-node.js` — reference-position validation harness.

The upstream port's README is preserved as
[README.upstream.md](README.upstream.md) (what was removed from desktop
gnubg, glib build details, packaged data files).
