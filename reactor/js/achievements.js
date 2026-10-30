// Achievements: goals that walk a player round the plant, from a first SCRAM
// to a meltdown in the sandbox. Each one tests the plant as it runs, and some
// keep a little memory for the current run (how long something has held,
// what the power was before a trip). No DOM, so the tests drive the
// simulator to unlock every one.
(function (root) {
  'use strict';

  const GROUPS = {
    start: { name: 'Getting started', color: '#2f6fd6', ink: '#ffffff' },
    physics: { name: 'Reactor physics', color: '#137a5b', ink: '#ffffff' },
    protect: { name: 'Protection system', color: '#f0a020', ink: '#1b1300' },
    emergency: { name: 'Emergencies', color: '#7a4fe0', ink: '#ffffff' },
    sandbox: { name: 'Sandbox', color: '#c9302c', ink: '#ffffff' },
    gold: { name: 'Gold', color: '#ffd23f', ink: '#1b1300' }
  };

  const TRIPS_NEEDED = 5;     // different trip causes for the collector
  const HOLD_STEADY = 120;    // s at 50% power
  const PUMP_OFF = 300;       // s with the primary pump stopped
  const WALK_AWAY = 72 * 3600;

  // How long a condition has held this run, from a stamp kept in `m[key]`.
  function held(m, key, ok, t) {
    if (!ok) { m[key] = null; return 0; }
    if (m[key] == null) m[key] = t;
    return t - m[key];
  }

  // Each test sees the plant `s`, this run's memory `m` and the tracker.
  // `scenario` is where Try it starts.
  const LIST = [
    {
      id: 'scram', group: 'start', icon: 'button', name: 'Big red button', scenario: 'full',
      hint: 'Lift the cover and press SCRAM.',
      done: 'Every rod dropped in about 2 seconds. The chain reaction stopped, but the core still makes about 6% of its heat.',
      test: function (s) { return s.tripCause === 'manual'; }
    },
    {
      id: 'autopilot', group: 'start', icon: 'autopilot', name: 'Autopilot', scenario: 'full',
      hint: 'With the rods on automatic, move the turbine load by 30 MW and let the rods catch up.',
      done: 'The rods followed the load, holding the coolant at the right temperature as the demand changed.',
      test: function (s, m) {
        if (!s.in.rodAuto || s.tripped || s.turbineTripped) { m.apLo = m.apHi = null; return false; }
        m.apLo = m.apLo == null ? s.mwe : Math.min(m.apLo, s.mwe);
        m.apHi = m.apHi == null ? s.mwe : Math.max(m.apHi, s.mwe);
        return m.apHi - m.apLo >= 30 && Math.abs(s.mwe - s.in.loadDemand) < 1 && Math.abs(s.tAvg - s.tRef) < 1.5;
      }
    },
    {
      id: 'critical', group: 'start', icon: 'atom', name: 'Going critical', scenario: 'cold',
      hint: 'In Cold start, pull the shutdown rods, then raise the control rods until the power climbs by itself.',
      done: 'Critical: each fission now causes one more. Delayed neutrons keep the climb slow enough to control.',
      test: function (s, m) {
        if (s.nFiss < 1e-6 && s.rho < 0) m.wasShutDown = true;
        return !!m.wasShutDown && !s.tripped && s.rho > 0 && s.period > 0 && s.period < 1000;
      }
    },
    {
      id: 'online', group: 'start', icon: 'bulb', name: 'Power to the people', scenario: 'cold',
      hint: 'From a shutdown, bring the plant all the way to 77 MW and light up the whole town.',
      done: 'A full start-up: critical, heated up, turbine on line and the town at full power.',
      test: function (s, m) {
        if (s.mwe < 1) m.wasOffLine = true;
        return !!m.wasOffLine && !s.tripped && s.mwe >= 76.5;
      }
    },
    {
      id: 'doppler', group: 'physics', icon: 'thermo', name: 'Hot fuel brake', scenario: 'sandbox',
      hint: 'Run the Rod withdrawal sandbox and watch the power spike.',
      done: 'Hot fuel soaked up more neutrons and turned the surge around with no protection at all: Doppler feedback.',
      test: function (s) { return !s.in.protection && !s.tripped && !s.damage && s.peakPower > 1.5 && s.nFiss < 1; }
    },
    {
      id: 'steady', group: 'physics', icon: 'level', name: 'Steady hands', scenario: 'full',
      hint: 'With the rods on manual, hold the power at 50% (±2%) for 2 minutes.',
      done: 'Held by hand. Temperature feedback did half the work, pulling the power back to where you set it.',
      test: function (s, m) {
        const ok = !s.in.rodAuto && !s.tripped && Math.abs(s.powerFrac - 0.5) <= 0.02;
        return held(m, 'steadyT', ok, s.t) >= HOLD_STEADY;
      }
    },
    {
      id: 'natcirc', group: 'physics', icon: 'loop', name: 'Look, no pumps', scenario: 'pump',
      hint: 'Stop the primary pump and keep the core cooling for 5 minutes.',
      done: 'Hot water rose, cold water sank, and the loop kept turning at a few percent flow: natural circulation.',
      test: function (s, m) {
        const off = !s.in.pumpOn || !s.in.offsitePower;
        return held(m, 'pumpOffT', off, s.t) >= PUMP_OFF &&
          s.flowFrac > 0.01 && s.powerFrac > 0.005 && s.tHot < 330 && !s.damage;
      }
    },
    {
      id: 'afterglow', group: 'physics', icon: 'ember', name: 'Afterglow', scenario: 'turbine',
      hint: 'After a trip at power, wait for the core’s heat to fall below 1%. Try ×3600.',
      done: 'Decay heat takes about 3 hours to fall from 6% to 1%, which is why a shut-down core still needs cooling.',
      test: function (s, m) {
        if (!s.tripped) { m.lastHeat = s.powerFrac; m.tripHeat = null; return false; }
        if (m.tripHeat == null) m.tripHeat = m.lastHeat || 0;
        return m.tripHeat >= 0.2 && s.powerFrac < 0.01 && !s.damage;
      }
    },
    {
      id: 'overload', group: 'protect', icon: 'gauge', name: 'Overload', scenario: 'full',
      hint: 'Push the reactor past 110% power with the protection on.',
      done: 'The high-power trip dropped the rods before the fuel could overheat.',
      test: function (s) { return s.tripCause === 'power'; }
    },
    {
      id: 'period', group: 'protect', icon: 'bolt', name: 'Too fast', scenario: 'cold',
      hint: 'At low power, pull the control rods out quickly.',
      done: 'The short-period trip caught the power rising too fast while it was still small.',
      test: function (s) { return s.tripCause === 'period'; }
    },
    {
      id: 'dry', group: 'protect', icon: 'drop', name: 'Running dry', scenario: 'full',
      hint: 'At full power, stop the feed pump.',
      done: 'With no feedwater the steam generator boiled down in about a minute, and the low-level trip fired.',
      test: function (s) { return s.tripCause === 'sgLevel'; }
    },
    {
      id: 'collector', group: 'protect', icon: 'tally', name: 'Trip collector',
      hint: 'Trip the reactor five different ways.',
      done: 'Each trip guards against a different danger: power, period, pressure, flow, level, turbine or grid.',
      need: TRIPS_NEEDED,
      test: function (s, m, tr) { return tr.tripCount() >= TRIPS_NEEDED; }
    },
    {
      id: 'bypass', group: 'emergency', icon: 'steam', name: 'Nowhere to go', scenario: 'turbine',
      hint: 'Trip the turbine at power.',
      done: 'The bypass dumped the steam into the condenser while the reactor tripped.',
      // The turbine has to trip first: after a reactor trip the bypass opens anyway.
      test: function (s) {
        return s.turbineTripped && s.turbineCause !== 'Off line' && s.turbineCause !== 'Reactor trip' && s.dumpValve > 0.2;
      }
    },
    {
      id: 'blackout', group: 'emergency', icon: 'plug', name: 'Lights out', scenario: 'blackout',
      hint: 'Cut the grid.',
      done: 'The reactor tripped, the pumps stopped, passive cooling took over and the town went dark.',
      test: function (s) { return !s.in.offsitePower && s.dhrsOn; }
    },
    {
      id: 'walkaway', group: 'emergency', icon: 'clock', name: 'Walk away safe', scenario: 'blackout',
      hint: 'Leave a station blackout alone for 72 hours. Try ×3600.',
      done: 'With no power and nobody at the controls, the pool soaked up the decay heat for three days.',
      test: function (s, m) { return held(m, 'gridLostT', !s.in.offsitePower, s.t) >= WALK_AWAY && !s.damage; }
    },
    {
      id: 'closecall', group: 'sandbox', icon: 'hand', name: 'Close call', scenario: 'sandbox',
      hint: 'With the protection off, press SCRAM yourself after a trip should have fired.',
      done: 'You caught it before the core was damaged. The operator is the last line of defence.',
      test: function (s) {
        return !s.in.protection && s.tripCause === 'manual' && !!s.wouldTrip && s.wouldTripT <= s.tripT && !s.damage;
      }
    },
    {
      id: 'meltdown', group: 'sandbox', icon: 'trefoil', name: 'Meltdown', scenario: 'sandbox',
      hint: 'In the sandbox, keep pushing until the core is damaged.',
      done: 'This is what the protection system is for. The damage screen named the trip that would have saved it.',
      test: function (s) { return !!s.damage; }
    },
    {
      id: 'chief', group: 'gold', icon: 'trophy', name: 'Chief operator',
      hint: 'Unlock every other achievement.',
      done: 'You’ve seen everything this plant can do.',
      test: function (s, m, tr) {
        for (let i = 0; i < LIST.length; i++) if (LIST[i].id !== 'chief' && !tr.got[LIST[i].id]) return false;
        return true;
      }
    }
  ];

  function byId(id) {
    for (let i = 0; i < LIST.length; i++) if (LIST[i].id === id) return LIST[i];
    return null;
  }

  // What the player has unlocked (kept between visits) and this run's memory.
  function Tracker(saved) {
    this.got = {};    // id -> time it was unlocked (ms since 1970)
    this.trips = {};  // trip causes seen, for the collector
    this.seen = {};   // unlocked boxes the player has watched fill in
    this.m = {};
    if (saved) this.load(saved);
  }

  Tracker.prototype.load = function (o) {
    if (!o || typeof o !== 'object') return;
    const ok = function (id) { return !!byId(id); };
    if (o.got && typeof o.got === 'object') {
      for (const id in o.got) if (ok(id) && typeof o.got[id] === 'number') this.got[id] = o.got[id];
    }
    if (Array.isArray(o.trips)) o.trips.forEach(function (c) { if (typeof c === 'string') this.trips[c] = true; }, this);
    if (o.seen && typeof o.seen === 'object') {
      for (const id in o.seen) if (ok(id) && this.got[id]) this.seen[id] = true;
    }
  };

  Tracker.prototype.save = function () {
    return { v: 1, got: this.got, trips: Object.keys(this.trips), seen: this.seen };
  };

  // A new scenario: forget what this run has seen, keep what's unlocked.
  Tracker.prototype.startRun = function () { this.m = {}; };

  Tracker.prototype.tripCount = function () { return Object.keys(this.trips).length; };
  Tracker.prototype.count = function () { return Object.keys(this.got).length; };

  // Look at the plant; returns the achievements unlocked just now, in list
  // order. `changed` says whether anything worth saving moved.
  Tracker.prototype.check = function (s, now) {
    const fresh = [];
    this.changed = false;
    if (s.tripped && s.tripCause && !this.trips[s.tripCause]) {
      this.trips[s.tripCause] = true;
      this.changed = true;
    }
    for (let i = 0; i < LIST.length; i++) {
      const a = LIST[i];
      if (this.got[a.id]) continue;
      if (a.test(s, this.m, this)) {
        this.got[a.id] = now;
        fresh.push(a);
      }
    }
    if (fresh.length) this.changed = true;
    return fresh;
  };

  Tracker.prototype.reset = function () {
    this.got = {};
    this.trips = {};
    this.seen = {};
    this.m = {};
  };

  const api = { GROUPS: GROUPS, LIST: LIST, byId: byId, Tracker: Tracker, TRIPS_NEEDED: TRIPS_NEEDED };
  root.ReactorAchievements = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
