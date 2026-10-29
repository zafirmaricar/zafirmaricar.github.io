// Run with: node --test reactor/test
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Sim = require('../js/sim.js');
const Scenarios = require('../js/scenarios.js');

const C = Sim.C;

function run(s, seconds, each) {
  const end = s.t + seconds;
  while (s.t < end - 1e-9) {
    Sim.advance(s, Math.min(1, end - s.t));
    if (each) each(s);
  }
  return s;
}

function finite(s) {
  for (const k in s) {
    const v = s[k];
    if (typeof v === 'number' && !Number.isFinite(v) && v !== Infinity) return k;
    if (v && (v instanceof Float64Array || Array.isArray(v))) {
      for (let i = 0; i < v.length; i++) if (typeof v[i] === 'number' && !Number.isFinite(v[i])) return k + '[' + i + ']';
    }
  }
  return null;
}

test('full power holds steady for 10 minutes', () => {
  const s = run(Sim.create(), 600);
  assert.ok(Math.abs(s.powerFrac - 1) < 0.01, 'power ' + s.powerFrac);
  assert.ok(Math.abs(s.pP - C.P_PRIMARY) < 0.5, 'pressure ' + s.pP);
  assert.ok(Math.abs(s.tAvg - C.T_FULL) < 0.3, 'Tavg ' + s.tAvg);
  assert.ok(Math.abs(s.mwe - 77) < 0.5, 'MWe ' + s.mwe);
  assert.ok(Math.abs(s.pS - C.P_STEAM_FULL) < 1, 'steam ' + s.pS);
  assert.strictEqual(s.tripped, false);
});

test('heat in equals heat out within 1% at steady state', () => {
  const s = run(Sim.create(), 300);
  const out = s.mwe * 1e6 / C.GEN_EFF + s.qCond;
  assert.ok(Math.abs(s.qSg - s.pTh) / s.pTh < 0.01, 'core ' + s.pTh + ' vs steam generator ' + s.qSg);
  assert.ok(Math.abs(out - s.qSg) / s.qSg < 0.01, 'steam generator ' + s.qSg + ' vs turbine + condenser ' + out);
});

test('a SCRAM takes fission power under 10% within 5 s', () => {
  const s = Sim.create();
  Sim.scram(s);
  run(s, 5);
  assert.ok(s.n < 0.1, 'n ' + s.n);
  assert.ok(s.rodX === 0 && s.rodY === 0, 'rods in');
  // Decay heat carries on: about 6% at first, a little over 2% after 10 minutes.
  run(s, 595);
  assert.ok(s.powerFrac > 0.018 && s.powerFrac < 0.03, 'decay heat ' + s.powerFrac);
});

// Low power with the turbine off line: the dumps hold the steam pressure, so
// only the fuel and coolant temperatures can stop the rise.
function lowPower() {
  const s = Scenarios.start('cold');
  s.in.shutdownOut = true;
  run(s, 15);
  s.in.rodTarget = 0.33;
  return run(s, 1500);
}

test('a +100 pcm rod step settles instead of running away', () => {
  const s = lowPower();
  const x1 = s.rodX;
  // Find the bank position worth 100 pcm more.
  let lo = x1, hi = 1;
  for (let i = 0; i < 50; i++) {
    const m = (lo + hi) / 2;
    if (Sim.rodWorth(m, 1) - Sim.rodWorth(x1, 1) < 100 * C.PCM) lo = m; else hi = m;
  }
  const p1 = s.powerFrac;
  s.in.rodTarget = lo;
  let minPeriod = Infinity;
  run(s, 600, (s) => { if (s.period > 0) minPeriod = Math.min(minPeriod, s.period); });
  const p2 = s.powerFrac;
  run(s, 60);
  assert.strictEqual(s.tripped, false, 'tripped on ' + s.tripCause);
  assert.ok(minPeriod > 10, 'period ' + minPeriod);
  assert.ok(p2 > 1.2 * p1 && p2 < 3 * p1, 'power from ' + p1 + ' to ' + p2);
  assert.ok(Math.abs(s.powerFrac - p2) < 0.002, 'still drifting: ' + p2 + ' -> ' + s.powerFrac);
  assert.ok(Math.abs(s.rho) < 2 * C.PCM, 'feedback cancels the step: ' + s.rho / C.PCM + ' pcm');
});

test('the same step at 94% power trips on high power', () => {
  const s = Sim.create();
  s.in.rodAuto = false;
  s.in.rodTarget = 0.6;
  run(s, 400);
  const x1 = s.rodX;
  let lo = x1, hi = 1;
  for (let i = 0; i < 50; i++) {
    const m = (lo + hi) / 2;
    if (Sim.rodWorth(m, 1) - Sim.rodWorth(x1, 1) < 100 * C.PCM) lo = m; else hi = m;
  }
  s.in.rodTarget = lo;
  run(s, 30);
  assert.strictEqual(s.tripCause, 'power');
});

test('load follows the turbine with rods on automatic', () => {
  const s = Sim.create();
  s.in.loadDemand = 40;
  let peak = 0;
  run(s, 400);
  assert.ok(Math.abs(s.mwe - 40) < 0.5, 'MWe ' + s.mwe);
  assert.ok(s.powerFrac > 0.45 && s.powerFrac < 0.6, 'power ' + s.powerFrac);
  s.in.loadDemand = 77;
  run(s, 500, (s) => { peak = Math.max(peak, s.n); });
  assert.strictEqual(s.tripped, false);
  assert.ok(peak < 1.06, 'overshoot ' + peak);
  assert.ok(Math.abs(s.mwe - 77) < 0.5, 'MWe ' + s.mwe);
  assert.ok(Math.abs(s.tAvg - C.T_FULL) < 1, 'Tavg ' + s.tAvg);
});

test('turbine trip: the bypass opens, the reactor trips and nothing lifts', () => {
  const s = Scenarios.start('turbine');
  let maxSteam = 0, bypass = 0;
  run(s, 300, (s) => { maxSteam = Math.max(maxSteam, s.pS); bypass = Math.max(bypass, s.dumpValve); });
  assert.strictEqual(s.tripCause, 'turbine');
  assert.ok(Math.abs(s.tripT - 5) < 0.1, 'trip at ' + s.tripT);
  assert.ok(bypass > 0.1, 'bypass ' + bypass);
  assert.ok(maxSteam < 85, 'steam safety valves lifted at ' + maxSteam);
  assert.strictEqual(s.damage, null);
});

test('pump failure: low-flow trip, then natural circulation', () => {
  const s = Scenarios.start('pump');
  run(s, 600);
  assert.strictEqual(s.tripCause, 'flow');
  assert.ok(s.flowFrac > 0.02 && s.flowFrac < 0.08, 'natural circulation ' + s.flowFrac);
  assert.ok(s.tHot - s.tCold > 5, 'hot leg above cold leg');
  assert.ok(s.tHot < 320, 'hot leg ' + s.tHot);
  assert.strictEqual(s.damage, null);
});

test('station blackout: the pool keeps the core safe for 72 hours', () => {
  const s = Scenarios.start('blackout');
  run(s, 60);
  assert.strictEqual(s.tripCause, 'powerLoss');
  assert.ok(s.dhrsOn, 'passive cooling on');
  let maxClad = 0;
  run(s, 72 * 3600 - 60, (s) => { maxClad = Math.max(maxClad, s.tClad); });
  assert.strictEqual(s.damage, null);
  assert.ok(maxClad < 400, 'cladding ' + maxClad);
  assert.ok(s.tHot < 160, 'hot leg after 72 h ' + s.tHot);
  assert.ok(s.tPool > 60, 'pool warmed to ' + s.tPool);
  assert.ok(s.poolMass > 0.5 * C.M_POOL, 'pool left ' + s.poolMass);
});

test('fast-forward steps agree with real-time steps once shut down', () => {
  const a = Sim.create(), b = Sim.create();
  Sim.setOffsitePower(a, false);
  Sim.setOffsitePower(b, false);
  run(a, 300);
  run(b, 300);
  assert.ok(Sim.quiet(a), 'quiet after the trip');
  Sim.advance(a, 3600);                 // takes 0.5 s steps
  while (b.t < a.t - 1e-9) Sim.step(b, Math.min(1 / 60, a.t - b.t));
  assert.ok(Math.abs(a.tHot - b.tHot) < 1, a.tHot + ' vs ' + b.tHot);
  assert.ok(Math.abs(a.pS - b.pS) < 1, a.pS + ' vs ' + b.pS);
});

test('cold start: shutdown rods out, control rods up, power climbs and settles', () => {
  const s = Scenarios.start('cold');
  assert.ok(s.n < 1e-7, 'starts shut down at ' + s.n);
  s.in.shutdownOut = true;
  run(s, 15);
  s.in.rodTarget = 0.33;
  run(s, 1500);
  assert.strictEqual(s.tripped, false);
  assert.ok(s.powerFrac > 0.03 && s.powerFrac < 0.2, 'power ' + s.powerFrac);
  assert.ok(Math.abs(s.rho) < 5 * C.PCM, 'critical: ' + s.rho / C.PCM + ' pcm');
  // Then on line and up to full load on automatic.
  assert.ok(Sim.resetTurbine(s), 'turbine reset');
  s.in.loadDemand = 77;
  s.in.rodAuto = true;
  run(s, 900);
  assert.strictEqual(s.tripped, false);
  assert.ok(Math.abs(s.mwe - 77) < 0.5, 'MWe ' + s.mwe);
});

test('rods pulled too fast from low power trip on short period', () => {
  const s = Scenarios.start('cold');
  s.in.shutdownOut = true;
  run(s, 15);
  s.in.rodTarget = 0.5;
  run(s, 120);
  assert.strictEqual(s.tripCause, 'period');
  assert.ok(s.n < 0.05, 'caught at ' + s.n);
});

test('sandbox: Doppler feedback caps the spike without protection', () => {
  const s = Scenarios.start('sandbox');
  run(s, 600);
  assert.strictEqual(s.tripped, false);
  assert.ok(s.peakPower > 1.5, 'spike ' + s.peakPower);
  assert.ok(s.n < 1, 'settles at ' + s.n);
  assert.strictEqual(s.wouldTrip, 'period');
  assert.strictEqual(s.damage, null);
});

test('with protection off, diluting the boron melts the core', () => {
  const s = Sim.create();
  Sim.setProtection(s, false);
  s.in.rodAuto = false;
  s.in.boronTarget = 0;
  run(s, 300);
  assert.ok(s.damage, 'core damaged');
  assert.strictEqual(s.wouldTrip, 'power');
  assert.ok(s.wouldTripT < s.damage.t);
});

test('with protection on, the same dilution trips on high power', () => {
  const s = Sim.create();
  s.in.boronTarget = 0;
  run(s, 300);
  assert.strictEqual(s.tripCause, 'power');
  assert.strictEqual(s.damage, null);
});

test('a trip resets once the rods are in and nothing is out of limits', () => {
  const s = Sim.create();
  Sim.scram(s);
  assert.strictEqual(Sim.resetTrip(s), false, 'not with rods still falling');
  run(s, 120);
  assert.ok(Sim.canResetTrip(s), 'reset allowed: ' + Sim.activeTrips(s).join(','));
  assert.ok(Sim.resetTrip(s));
  assert.strictEqual(s.tripped, false);
});

test('every scenario runs 10 minutes without NaNs', () => {
  for (const sc of Scenarios.LIST) {
    const s = Scenarios.start(sc.id);
    run(s, 600, (s) => {
      const bad = finite(s);
      assert.strictEqual(bad, null, sc.id + ': ' + bad + ' at ' + s.t);
    });
  }
});
