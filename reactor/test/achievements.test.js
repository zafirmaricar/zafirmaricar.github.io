// Run with: node --test reactor/test/*.test.js
// Every achievement is played for real: the simulator is driven the way a
// player would, and the tracker looks at it ten times a second like the page.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Sim = require('../js/sim.js');
const Scenarios = require('../js/scenarios.js');
const Achievements = require('../js/achievements.js');

// Run `seconds` of plant time, checking like the page does: ten times a
// second at normal speed, or once a minute of plant time when `fast`
// (×3600 shows a minute per frame).
function play(tr, s, seconds, opts) {
  opts = opts || {};
  const every = opts.fast ? 60 : 0.1;
  const end = s.t + seconds;
  while (s.t < end - 1e-9) {
    Sim.advance(s, Math.min(every, end - s.t));
    if (opts.each) opts.each(s);
    tr.check(s, 1);
  }
  return s;
}

function start(tr, id) {
  tr.startRun();
  return Scenarios.start(id);
}

function got(tr) { return Object.keys(tr.got).sort(); }

test('the list has unique ids, a known group and both texts', () => {
  const ids = {};
  Achievements.LIST.forEach((a) => {
    assert.ok(!ids[a.id], 'duplicate ' + a.id);
    ids[a.id] = true;
    assert.ok(Achievements.GROUPS[a.group], a.id + ' group');
    assert.ok(a.hint && a.done && a.name, a.id + ' text');
    if (a.scenario) assert.strictEqual(Scenarios.byId(a.scenario).id, a.scenario, a.id + ' scenario');
  });
  assert.strictEqual(Achievements.LIST.length, 18);
});

test('ten minutes at steady full power unlocks nothing', () => {
  const tr = new Achievements.Tracker();
  play(tr, start(tr, 'full'), 600);
  assert.deepStrictEqual(got(tr), []);
});

test('Big red button: SCRAM', () => {
  const tr = new Achievements.Tracker();
  const s = start(tr, 'full');
  play(tr, s, 2);
  Sim.scram(s);
  let dump = 0;
  play(tr, s, 60, { each: (s) => { dump = Math.max(dump, s.dumpValve); } });
  // The turbine trips behind the reactor and the bypass opens, but that
  // isn't Nowhere to go: the turbine has to trip first.
  assert.ok(s.turbineTripped && dump > 0.2, 'bypass opened to ' + dump);
  assert.deepStrictEqual(got(tr), ['scram']);
});

test('Autopilot: the rods follow a 37 MW load cut', () => {
  const tr = new Achievements.Tracker();
  const s = start(tr, 'full');
  s.in.loadDemand = 40;
  play(tr, s, 600);
  assert.ok(tr.got.autopilot);
});

test('Going critical, then Power to the people, from Cold start', () => {
  const tr = new Achievements.Tracker();
  const s = start(tr, 'cold');
  s.in.shutdownOut = true;
  play(tr, s, 15);
  assert.ok(!tr.got.critical, 'not with the control rods still in');
  s.in.rodTarget = 0.33;
  play(tr, s, 60);
  assert.ok(tr.got.critical, 'critical');
  play(tr, s, 1500);
  assert.ok(Sim.resetTurbine(s), 'turbine reset');
  s.in.loadDemand = 77;
  s.in.rodAuto = true;
  play(tr, s, 900);
  assert.ok(tr.got.online, 'on line at ' + s.mwe.toFixed(1) + ' MWe');
});

test('Hot fuel brake: the sandbox spike turns round on its own', () => {
  const tr = new Achievements.Tracker();
  play(tr, start(tr, 'sandbox'), 60);
  assert.ok(tr.got.doppler);
  assert.ok(!tr.got.period && !tr.got.overload, 'no real trips with the protection off');
});

test('Steady hands: 50% on manual rods for 2 minutes', () => {
  const tr = new Achievements.Tracker();
  const s = start(tr, 'full');
  s.in.loadDemand = 36;
  play(tr, s, 900);
  s.in.rodAuto = false;
  play(tr, s, 110);
  assert.ok(!tr.got.steady, 'not before 2 minutes');
  play(tr, s, 20);
  assert.ok(tr.got.steady, 'power ' + s.powerFrac);
});

test('Look, no pumps: natural circulation for 5 minutes', () => {
  const tr = new Achievements.Tracker();
  play(tr, start(tr, 'pump'), 320);
  assert.ok(tr.got.natcirc);
});

test('Afterglow: decay heat under 1% a few hours after a trip', () => {
  const tr = new Achievements.Tracker();
  const s = start(tr, 'turbine');
  play(tr, s, 60);
  assert.ok(s.tripped && !tr.got.afterglow);
  play(tr, s, 4 * 3600, { fast: true });
  assert.ok(tr.got.afterglow, 'heat ' + s.powerFrac);
});

test('Afterglow needs a trip from real power', () => {
  const tr = new Achievements.Tracker();
  const s = start(tr, 'cold');
  Sim.scram(s);
  play(tr, s, 3600, { fast: true });
  assert.ok(!tr.got.afterglow);
});

test('Overload: diluting the boron trips on high power', () => {
  const tr = new Achievements.Tracker();
  const s = start(tr, 'full');
  s.in.rodAuto = false;
  s.in.boronTarget = 500;
  play(tr, s, 60);
  assert.strictEqual(s.tripCause, 'power');
  assert.ok(tr.got.overload);
});

test('Too fast: rods pulled quickly at low power', () => {
  const tr = new Achievements.Tracker();
  const s = start(tr, 'cold');
  s.in.shutdownOut = true;
  play(tr, s, 15);
  s.in.rodTarget = 0.5;
  play(tr, s, 120);
  assert.ok(tr.got.period);
});

test('Running dry: feed pump off at full power', () => {
  const tr = new Achievements.Tracker();
  const s = start(tr, 'full');
  s.in.feedPumpOn = false;
  play(tr, s, 90);
  assert.ok(tr.got.dry);
});

test('Nowhere to go and Lights out come from their scenarios', () => {
  const tr = new Achievements.Tracker();
  play(tr, start(tr, 'turbine'), 30);
  assert.ok(tr.got.bypass, 'bypass');
  play(tr, start(tr, 'blackout'), 10);
  assert.ok(tr.got.blackout, 'blackout');
});

test('Walk away safe: 72 hours of blackout', () => {
  const tr = new Achievements.Tracker();
  const s = start(tr, 'blackout');
  play(tr, s, 60);
  play(tr, s, 71 * 3600, { fast: true });
  assert.ok(!tr.got.walkaway, 'not before 72 hours');
  play(tr, s, 3600, { fast: true });
  assert.ok(tr.got.walkaway);
});

test('Walk away safe starts over when the grid comes back', () => {
  const tr = new Achievements.Tracker();
  const s = start(tr, 'blackout');
  play(tr, s, 40 * 3600, { fast: true });
  Sim.setOffsitePower(s, true);
  play(tr, s, 60);
  Sim.setOffsitePower(s, false);
  play(tr, s, 40 * 3600, { fast: true });
  assert.ok(!tr.got.walkaway);
});

test('Close call: SCRAM by hand after the sandbox would have tripped', () => {
  const tr = new Achievements.Tracker();
  const s = start(tr, 'sandbox');
  play(tr, s, 30, { each: (s) => { if (s.wouldTrip && !s.tripped) Sim.scram(s); } });
  assert.ok(tr.got.closecall);
  assert.ok(!tr.got.meltdown);
});

test('a SCRAM with the protection on is not a close call', () => {
  const tr = new Achievements.Tracker();
  const s = start(tr, 'full');
  Sim.scram(s);
  play(tr, s, 5);
  assert.ok(tr.got.scram && !tr.got.closecall);
});

test('Meltdown: boron out and the pump off in the sandbox', () => {
  const tr = new Achievements.Tracker();
  const s = start(tr, 'sandbox');
  play(tr, s, 30);
  s.in.boronTarget = 0;
  s.in.pumpOn = false;
  play(tr, s, 600);
  assert.ok(s.damage, 'core damaged');
  assert.ok(tr.got.meltdown);
});

test('Trip collector counts five different trip causes, then Chief operator', () => {
  const tr = new Achievements.Tracker();
  // Manual, high power, low level, turbine and low flow.
  let s = start(tr, 'full');
  Sim.scram(s);
  play(tr, s, 2);
  s = start(tr, 'full');
  s.in.rodAuto = false;
  s.in.boronTarget = 500;
  play(tr, s, 60);
  s = start(tr, 'full');
  s.in.feedPumpOn = false;
  play(tr, s, 90);
  s = start(tr, 'turbine');
  play(tr, s, 30);
  assert.strictEqual(tr.tripCount(), 4);
  assert.ok(!tr.got.collector);
  s = start(tr, 'pump');
  play(tr, s, 30);
  assert.ok(tr.got.collector, 'trips ' + Object.keys(tr.trips).join(','));
  assert.ok(!tr.got.chief);
  // Everything else, then the gold one.
  Achievements.LIST.forEach((a) => { if (a.id !== 'chief' && !tr.got[a.id]) tr.got[a.id] = 1; });
  play(tr, start(tr, 'full'), 1);
  assert.ok(tr.got.chief);
});

test('progress survives a save and load, and junk is ignored', () => {
  const tr = new Achievements.Tracker();
  const s = start(tr, 'full');
  Sim.scram(s);
  play(tr, s, 1);
  tr.seen.scram = true;
  const copy = new Achievements.Tracker(JSON.parse(JSON.stringify(tr.save())));
  assert.deepStrictEqual(got(copy), ['scram']);
  assert.deepStrictEqual(Object.keys(copy.trips), ['manual']);
  assert.ok(copy.seen.scram);
  const junk = new Achievements.Tracker({ got: { nope: 1, scram: 'yes', dry: 5 }, trips: [3, 'flow'], seen: { dry: true, overload: true } });
  assert.deepStrictEqual(got(junk), ['dry']);
  assert.deepStrictEqual(Object.keys(junk.trips), ['flow']);
  assert.deepStrictEqual(Object.keys(junk.seen), ['dry']);
  new Achievements.Tracker('garbage');
  new Achievements.Tracker(null);
});
