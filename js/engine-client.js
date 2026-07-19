/*
 * engine-client.js — Promise-based client for the gnubg engine Web Worker.
 *
 * Usage:
 *   import { GnubgEngine } from './engine-client.js';
 *   const engine = new GnubgEngine('/engine/engine.worker.js');
 *   await engine.init();
 *   await engine.setPosition('4HPwATDgc/ABMA');            // gnubg Position ID
 *   const moves = await engine.analyzeMove(3, 1, 2);       // die1, die2, ply
 *   const cube  = await engine.analyzeCube(2);
 *   const evaln = await engine.evaluate(2);
 *
 * This file is GPLv3, part of the gnubg WASM engine distribution.
 */

export class GnubgEngine {
  constructor(workerUrl) {
    this.worker = new Worker(workerUrl);
    this.pending = new Map();
    this.nextId = 1;
    this.worker.onmessage = (e) => {
      const { id, ok, result, error } = e.data;
      const entry = this.pending.get(id);
      if (!entry) return;
      this.pending.delete(id);
      if (ok) entry.resolve(result);
      else entry.reject(new Error(error));
    };
  }

  _send(msg) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage(Object.assign({ id }, msg));
    });
  }

  /** Loads WASM + neural net weights. Resolves when engine is ready. */
  init() {
    return this._send({ cmd: 'init' });
  }

  /** Set position from a gnubg Position ID (board from on-roll player's view). */
  setPosition(posId) {
    return this._send({ cmd: 'setPosition', posId });
  }

  /** Set cube/score state from a gnubg Match ID. Returns { dice } if encoded. */
  setMatchId(matchId) {
    return this._send({ cmd: 'setMatchId', matchId });
  }

  /**
   * Set cube state explicitly (money game default when never called):
   * { nCube, owner (-1 centred / 0 on-roll / 1 opponent), matchTo,
   *   score0, score1, crawford, jacoby }
   */
  setCube(cube) {
    return this._send({ cmd: 'setCube', cube });
  }

  /** Ranked chequer plays: { moves: [{move, equity, diff, probs}], totalMoves }. */
  analyzeMove(die1, die2, ply = 2) {
    return this._send({ cmd: 'analyzeMove', die1, die2, ply });
  }

  /** Cube decision: { decision, equities: {optimal,noDouble,doubleTake,doublePass}, probs }. */
  analyzeCube(ply = 2) {
    return this._send({ cmd: 'analyzeCube', ply });
  }

  /** Static evaluation: { equity, cubefulEquity, probs }. */
  evaluate(ply = 2) {
    return this._send({ cmd: 'evaluate', ply });
  }

  /** Round-trip the current position: { posId }. */
  getPosition() {
    return this._send({ cmd: 'getPosition' });
  }

  destroy() {
    this.worker.terminate();
    this.pending.clear();
  }
}
