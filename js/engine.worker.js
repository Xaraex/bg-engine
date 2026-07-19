/*
 * engine.worker.js — Web Worker wrapper around the gnubg WASM module.
 *
 * Message protocol (client -> worker):
 *   { id, cmd: 'init' }
 *   { id, cmd: 'setPosition', posId }
 *   { id, cmd: 'setMatchId', matchId }
 *   { id, cmd: 'setCube', cube: { nCube, owner, matchTo, score0, score1, crawford, jacoby } }
 *   { id, cmd: 'analyzeMove', die1, die2, ply }
 *   { id, cmd: 'analyzeCube', ply }
 *   { id, cmd: 'evaluate', ply }
 *   { id, cmd: 'getPosition' }
 *
 * Replies (worker -> client):
 *   { id, ok: true, result }
 *   { id, ok: false, error }
 *
 * This file is GPLv3, part of the gnubg WASM engine distribution.
 */

/* global importScripts, createGnubgModule */

importScripts('gnubg-engine.js');

var Module = null;
var api = null;

function initModule() {
  return createGnubgModule({
    print: function () {},
    printErr: function () {},
    locateFile: function (path) {
      return path;
    }
  }).then(function (mod) {
    Module = mod;
    Module._start();
    api = {
      setPosition: Module.cwrap('web_set_position', 'number', ['string']),
      setMatchId: Module.cwrap('web_set_matchid', 'number', ['string']),
      setCube: Module.cwrap('web_set_cube', 'number',
        ['number', 'number', 'number', 'number', 'number', 'number', 'number']),
      analyzeMove: Module.cwrap('web_analyze_move', 'string', ['number', 'number', 'number']),
      analyzeCube: Module.cwrap('web_analyze_cube', 'string', ['number']),
      evaluate: Module.cwrap('web_evaluate', 'string', ['number']),
      getPosition: Module.cwrap('web_get_position', 'string', [])
    };
  });
}

function parseJsonResult(str) {
  var obj = JSON.parse(str);
  if (obj.error) {
    throw new Error(obj.error);
  }
  return obj;
}

function handle(msg) {
  switch (msg.cmd) {
    case 'init':
      return initModule().then(function () { return { ready: true }; });
    case 'setPosition':
      if (api.setPosition(msg.posId) !== 0) {
        throw new Error('invalid position id: ' + msg.posId);
      }
      return { ok: true };
    case 'setMatchId': {
      var dice = api.setMatchId(msg.matchId);
      if (dice < 0) {
        throw new Error('invalid match id: ' + msg.matchId);
      }
      return { dice: dice ? [Math.floor(dice / 10), dice % 10] : null };
    }
    case 'setCube': {
      var c = msg.cube;
      if (api.setCube(c.nCube, c.owner, c.matchTo || 0, c.score0 || 0,
                      c.score1 || 0, c.crawford ? 1 : 0, c.jacoby ? 1 : 0) !== 0) {
        throw new Error('invalid cube state');
      }
      return { ok: true };
    }
    case 'analyzeMove':
      return parseJsonResult(api.analyzeMove(msg.die1, msg.die2, msg.ply));
    case 'analyzeCube':
      return parseJsonResult(api.analyzeCube(msg.ply));
    case 'evaluate':
      return parseJsonResult(api.evaluate(msg.ply));
    case 'getPosition':
      return { posId: api.getPosition() };
    default:
      throw new Error('unknown command: ' + msg.cmd);
  }
}

self.onmessage = function (e) {
  var msg = e.data;
  Promise.resolve()
    .then(function () {
      if (msg.cmd !== 'init' && !api) {
        throw new Error('engine not initialised — send init first');
      }
      return handle(msg);
    })
    .then(function (result) {
      self.postMessage({ id: msg.id, ok: true, result: result });
    })
    .catch(function (err) {
      self.postMessage({ id: msg.id, ok: false, error: String(err && err.message || err) });
    });
};
