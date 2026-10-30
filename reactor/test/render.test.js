// Run with: node --test reactor/test/*.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Sim = require('../js/sim.js');
const Scenarios = require('../js/scenarios.js');
const Art = require('../js/art.js');
const Render = require('../js/render.js');

test('the background fills every pixel with an opaque colour', () => {
  const bg = Art.background().px;
  for (let i = 0; i < bg.length; i++) assert.strictEqual(bg[i] >>> 24, 255, 'pixel ' + i);
});

test('every part has a box inside the scene', () => {
  Art.PARTS.forEach((p) => {
    const [x, y, w, h] = p.box;
    assert.ok(x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= Art.W && y + h <= Art.H, p.id);
  });
});

test('every scenario draws frames without throwing, views on', () => {
  const r = new Render.Renderer();
  const f = new Uint32Array(Art.W * Art.H);
  for (const sc of Scenarios.LIST) {
    const s = Scenarios.start(sc.id);
    r.reset();
    for (let i = 0; i < 240; i++) {
      Sim.step(s, 1 / 60);
      r.draw(f, s, 1 / 60, { neutrons: true, highlight: 'sg', alarm: true, shake: i % 2 === 0, leaders: [{ from: [10, 10], to: [40, 40] }] });
    }
    for (let i = 0; i < f.length; i += 997) assert.strictEqual(f[i] >>> 24, 255, sc.id);
  }
});

test('a damaged core and a boiled-down pool still draw', () => {
  const r = new Render.Renderer();
  const f = new Uint32Array(Art.W * Art.H);
  const s = Sim.create();
  s.damage = { kind: 'melt', t: 0 };
  s.voidFrac = 0.4;
  s.poolMass = 0.5 * Sim.C.M_POOL;
  s.tPool = 100;
  s.dhrsOn = true; s.qDhrs = 4e6;
  for (let i = 0; i < 120; i++) r.draw(f, s, 1 / 60, {});
  assert.ok(r.p.n > 0, 'particles spawned');
});
