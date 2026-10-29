// The plant model behind the Pixel Nuclear Reactor page: a small modular
// reactor sized like NuScale's module (250 MW thermal, 77 MW electric, 138 bar
// primary), laid out as a loop like a classic PWR. Core, hot leg, steam
// generator, cold leg and pump, with a pressurizer, a turbine, a condenser,
// and a pool that takes the decay heat passively when the power goes out.
//
// It has no DOM, so Node runs it for the tests. Units are SI except
// temperatures (°C) and pressures (bar). Reactivity is in Δk/k; 1 pcm = 1e-5.
(function (root) {
  'use strict';

  // ---------------------------------------------------------------------------
  // Saturated water and steam: pressure (bar), temperature (°C), liquid and
  // vapour enthalpy (kJ/kg). Interpolated in log pressure.
  const SAT = [
    [0.05, 32.88, 137.8, 2561.5], [0.07, 39.0, 163.4, 2572.6], [0.1, 45.81, 191.8, 2584.6],
    [0.2, 60.06, 251.4, 2609.7], [0.3, 69.1, 289.2, 2625.3], [0.5, 81.33, 340.5, 2645.9],
    [1, 99.61, 417.5, 2675.0], [2, 120.2, 504.7, 2706.2], [5, 151.8, 640.1, 2748.1],
    [10, 179.9, 762.5, 2777.1], [20, 212.4, 908.5, 2798.3], [30, 233.9, 1008.3, 2803.2],
    [40, 250.4, 1087.4, 2800.8], [50, 263.9, 1154.5, 2794.2], [60, 275.6, 1213.9, 2784.6],
    [70, 285.8, 1267.4, 2772.6], [80, 295.0, 1317.1, 2758.7], [90, 303.3, 1363.7, 2742.9],
    [100, 311.0, 1408.1, 2725.5], [110, 318.1, 1450.9, 2706.3], [120, 324.7, 1491.9, 2685.4],
    [130, 330.9, 1531.4, 2662.5], [140, 336.7, 1571.1, 2637.9], [150, 342.2, 1610.2, 2610.0],
    [160, 347.4, 1649.7, 2580.2], [170, 352.3, 1690.0, 2547.4], [180, 357.0, 1732.0, 2509.5],
    [200, 365.7, 1826.6, 2412.1], [220, 373.7, 2011.0, 2195.0]
  ];
  const SAT_LNP = SAT.map(function (r) { return Math.log(r[0]); });
  const SAT_T = SAT.map(function (r) { return r[1]; });
  const SAT_HF = SAT.map(function (r) { return r[2] * 1000; });
  const SAT_HG = SAT.map(function (r) { return r[3] * 1000; });

  function interp(x, xs, ys) {
    const n = xs.length;
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 1;
    while (xs[i] < x) i++;
    const t = (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
    return ys[i - 1] + t * (ys[i] - ys[i - 1]);
  }
  function lnp(pBar) { return Math.log(Math.min(220, Math.max(0.05, pBar))); }
  function tsat(pBar) { return interp(lnp(pBar), SAT_LNP, SAT_T); }
  function psat(tC) { return Math.exp(interp(tC, SAT_T, SAT_LNP)); }
  function hf(pBar) { return interp(lnp(pBar), SAT_LNP, SAT_HF); }
  function hg(pBar) { return interp(lnp(pBar), SAT_LNP, SAT_HG); }
  // Liquid water enthalpy at a temperature (J/kg), pressure ignored.
  function hLiquid(tC) { return interp(tC, SAT_T, SAT_HF); }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function relax(v, target, dt, tau) { return target + (v - target) * Math.exp(-dt / tau); }

  // ---------------------------------------------------------------------------
  // Neutronics: six delayed-neutron groups for thermal fission of U-235.
  const BETA_I = [0.000215, 0.001424, 0.001274, 0.002568, 0.000748, 0.000273];
  const LAMBDA_I = [0.0124, 0.0305, 0.111, 0.301, 1.14, 3.01];
  const BETA = BETA_I.reduce(function (a, b) { return a + b; }, 0);
  const GEN_TIME = 2e-5;        // prompt neutron generation time (s)
  const SOURCE = 2.5e-5;        // start-up source, so a shut-down core still shows counts
  const PCM = 1e-5;

  const ROD_WORTH_CONTROL = 1800 * PCM;
  const ROD_WORTH_SHUTDOWN = 5500 * PCM;
  const BORON_WORTH = -8 * PCM;  // per ppm
  const DOPPLER = -3 * PCM;      // per °C of average fuel temperature
  const MODERATOR = -20 * PCM;   // per °C of average core water temperature
  const VOID = -12000 * PCM;     // per unit void fraction in the core
  const T_REF = 292;             // temperature the feedback terms are measured from
  const ROD_SPEED = 0.05;        // control bank speed by hand, fraction per second
  const ROD_AUTO_MAX = 0.004;    // ... and on automatic
  const ROD_GAIN = 0.0007;       // automatic speed per °C of error
  const ROD_MISMATCH = 100;      // °C of error per 100% gap between turbine draw and reactor power

  // Integral worth of a bank for a cosine flux shape: 0 fully in, 1 fully out.
  function rodShape(x) { return x - Math.sin(2 * Math.PI * x) / (2 * Math.PI); }

  // Decay heat: six groups fitted to 6.4% of power at shutdown, 1.5% after an
  // hour, 0.4% after a day and 0.3% after three days.
  const DH_A = [0.0252, 0.0153, 0.0106, 0.0090, 0.0014, 0.0027];
  const DH_TAU = [15, 200, 2500, 25000, 3e5, 3e6];
  const DH_SUM = DH_A.reduce(function (a, b) { return a + b; }, 0);

  // ---------------------------------------------------------------------------
  // Plant ratings and the primary loop.
  const P0 = 250e6;              // thermal power at 100% (W)
  const PE_NOM = 77e6;           // electric output at 100% (W)
  const DEMAND = 77;             // what the town draws (MWe)
  const GEN_EFF = 0.98;
  const CP = 5600;               // primary water heat capacity (J/kg K)
  const DT_CORE = 31;            // core temperature rise at full power and flow
  const W_NOM = P0 / (CP * DT_CORE);
  const T_NOLOAD = 292;          // average coolant temperature with no load
  const T_FULL = 307;            // ... and at full load
  const T_HOT_FULL = T_FULL + DT_CORE / 2;
  const T_COLD_FULL = T_FULL - DT_CORE / 2;
  const P_PRIMARY = 138;         // bar
  const N_HOT = 12, N_SG = 12, N_COLD = 16, N_LOOP = N_HOT + N_SG + N_COLD;
  const M_CELL = W_NOM * 12 / N_LOOP;   // water goes round the loop in 12 s at full flow
  const M_CORE = 1200;
  const M_PRIMARY = M_CELL * N_LOOP + M_CORE;
  const T_FUEL_FULL = 700;       // average fuel temperature at full power
  const UA_FUEL = P0 / (T_FUEL_FULL - T_FULL);
  const C_FUEL = UA_FUEL * 5;    // the fuel takes about 5 s to heat up or cool down
  const PELLET_DT = 900;         // hottest fuel centre above the fuel average at full power
  const COAST = 12;              // pump coast-down time constant (s)
  const NAT_CIRC = 6.8e-5;       // buoyancy head per °C, relative to the pump's head

  // Steam generator, calibrated so full power makes 60 bar steam.
  const P_STEAM_FULL = 60;
  const T_SAT_FULL = tsat(P_STEAM_FULL);
  const SG_R = Math.pow((T_COLD_FULL - T_SAT_FULL) / (T_HOT_FULL - T_SAT_FULL), 1 / N_SG);
  const UA_SG_CELL = W_NOM * CP * (1 / SG_R - 1);
  const P_STEAM_NOLOAD = psat(T_NOLOAD);
  const T_FEED_FULL = 150;
  const W_STEAM_FULL = P0 / (hg(P_STEAM_FULL) - hLiquid(T_FEED_FULL));
  const M_SG_NOM = 15000;        // secondary water in the steam generator at 50% level
  const C_STEAM = 66;            // kg of steam per bar (steam space plus flashing water)
  const VALVE_FULL = 0.85;       // governor valve opening at full load
  const K_TURB = W_STEAM_FULL / (VALVE_FULL * P_STEAM_FULL);
  const DUMP_CAP = 0.4;          // turbine bypass capacity, fraction of full steam flow
  const LOAD_RATE = 1;           // turbine loading rate, MWe per second
  const LOAD_HOLD = 2;           // loading pauses with the coolant this far (°C) under programme
  const SG_RELIEF_OPEN = 85, SG_RELIEF_CLOSE = 82;

  // Condenser and cooling tower.
  const T_CW_IN = 30, DT_CW_FULL = 8, APPROACH = 3;
  const T_COND_FULL = T_CW_IN + DT_CW_FULL + APPROACH;
  const CARNOT_FULL = 1 - (T_COND_FULL + 273.15) / (T_SAT_FULL + 273.15);
  const W_SPEC_FULL = PE_NOM / (GEN_EFF * W_STEAM_FULL);
  const Q_COND_FULL = W_STEAM_FULL * (hg(P_STEAM_FULL) - hLiquid(T_FEED_FULL)) - PE_NOM / GEN_EFF;
  const W_CW_FULL = Q_COND_FULL / (4180 * DT_CW_FULL);
  const VACUUM_TRIP = 0.3;       // bar

  // Pressurizer.
  const PZR_LEVEL_FULL = 0.55;
  const PZR_SWELL = 0.012;       // level per °C of mean primary temperature
  const PZR_SURGE = 120;         // bar per unit level change (the steam bubble compresses)
  const PZR_HEAT = 0.35;         // bar/s with every heater on
  const PZR_LOSS = 0.004;        // bar/s lost through the insulation
  const PZR_SPRAY = 1.2;         // bar/s with full spray
  const HEATER_BASE = PZR_LOSS / PZR_HEAT;
  const PORV_OPEN = 148, PORV_CLOSE = 145;
  const PZR_SV_OPEN = 152, PZR_SV_CLOSE = 149;

  // Passive decay heat removal into the pool.
  const UA_DHRS = 35e3;
  const M_POOL = 1.0e6;
  const T_POOL0 = 40;

  // Mean primary temperature at full power, the pressurizer level reference.
  const T_MEAN_FULL = (function () {
    let sum = M_CORE * T_HOT_FULL + M_CELL * (N_HOT * T_HOT_FULL + N_COLD * T_COLD_FULL);
    for (let i = 1; i <= N_SG; i++) sum += M_CELL * (T_SAT_FULL + Math.pow(SG_R, i) * (T_HOT_FULL - T_SAT_FULL));
    return sum / M_PRIMARY;
  })();

  function rhoRods(x, y) {
    return -ROD_WORTH_CONTROL * (1 - rodShape(x)) - ROD_WORTH_SHUTDOWN * (1 - rodShape(y));
  }

  // Excess reactivity of the core with all rods out, no boron and no
  // feedback, chosen so that full power is critical with the control bank 80%
  // out and 600 ppm of boron.
  const RHO_CORE = -(rhoRods(0.8, 1) + BORON_WORTH * 600 +
    DOPPLER * (T_FUEL_FULL - T_REF) + MODERATOR * (T_FULL - T_REF));

  // ---------------------------------------------------------------------------
  // Protection: what trips the reactor. With protection off the first trip
  // that would have fired is still recorded, so the core damage screen can
  // name it.
  const TRIPS = [
    { id: 'power', label: 'High power', setpoint: '110%', test: function (s) { return s.nFiss > 1.1; } },
    { id: 'period', label: 'Short reactor period', setpoint: 'under 10 s below 15% power', test: function (s) { return s.period > 0 && s.period < 10 && s.nFiss > 1e-4 && s.nFiss < 0.15; } },
    { id: 'pressHigh', label: 'High primary pressure', setpoint: '150 bar', test: function (s) { return s.pP > 150; } },
    { id: 'pressLow', label: 'Low primary pressure', setpoint: '125 bar', test: function (s) { return s.pP < 125; } },
    { id: 'tHot', label: 'High hot-leg temperature', setpoint: '330 °C', test: function (s) { return s.tHot > 330; } },
    { id: 'flow', label: 'Low primary flow', setpoint: '85% above 20% power', test: function (s) { return s.flowFrac < 0.85 && s.nFiss > 0.2; } },
    { id: 'sgLevel', label: 'Low steam generator level', setpoint: '20%', test: function (s) { return s.sgLevel < 0.2; } },
    { id: 'turbine', label: 'Turbine trip', setpoint: 'above 15% power', test: function (s) { return s.turbineTripSignal; } }
  ];
  const TRIP_LABELS = { manual: 'Manual SCRAM', powerLoss: 'Loss of power to the rod drives' };
  TRIPS.forEach(function (t) { TRIP_LABELS[t.id] = t.label; });

  const ALARMS = [
    ['trip', 'Reactor trip'], ['highPower', 'High power'], ['period', 'Short period'],
    ['pressHigh', 'High pressure'], ['pressLow', 'Low pressure'], ['tHot', 'High hot leg'],
    ['flow', 'Low flow'], ['sgLevel', 'Low SG level'], ['turbine', 'Turbine trip'],
    ['vacuum', 'Low vacuum'], ['relief', 'Primary relief'], ['steamRelief', 'Steam relief'],
    ['dump', 'Steam bypass'], ['dhrs', 'Passive cooling'], ['powerLoss', 'Loss of power'],
    ['dnb', 'Low DNB margin'], ['protectionOff', 'Protection off'], ['damage', 'Core damage']
  ];
  // Alarms whose start is already logged as an event of its own.
  const QUIET_ALARMS = { trip: 1, turbine: 1, damage: 1, dhrs: 1, powerLoss: 1, protectionOff: 1 };

  // ---------------------------------------------------------------------------
  // State.

  // The plant at steady full power. Scenarios start from this and change it.
  function create() {
    const s = {
      t: 0,
      in: {
        rodTarget: 0.8, rodAuto: true, shutdownOut: true, boronTarget: 600,
        pumpSet: 1, pumpOn: true,
        pzrAuto: true, heaters: false, spray: false, porv: false,
        loadDemand: 77, feedAuto: true, feedSet: 1, feedPumpOn: true, cooling: 1,
        protection: true, offsitePower: true
      },
      // neutronics
      n: 1, C: BETA_I.map(function (b, i) { return b / (GEN_TIME * LAMBDA_I[i]); }),
      D: DH_A.slice(), logN: 0, omega: 0, period: Infinity, peakPower: 1,
      rho: 0, rhoParts: { rods: 0, boron: 0, doppler: 0, moderator: 0, void: 0 },
      // rods and boron
      rodX: 0.8, rodY: 1, dropV: 0, boron: 600,
      // core and loop
      tFuel: T_FUEL_FULL, tCore: T_HOT_FULL, tClad: T_FULL + 25, tPeak: T_FUEL_FULL + PELLET_DT,
      dnbr: 2, dnb: false, voidFrac: 0,
      hot: new Float64Array(N_HOT).fill(T_HOT_FULL),
      sg: new Float64Array(N_SG),
      cold: new Float64Array(N_COLD).fill(T_COLD_FULL),
      pumpSpeed: 1, flow: W_NOM, qSg: P0,
      // pressurizer
      pP: P_PRIMARY, pzrLevel: PZR_LEVEL_FULL, pzrLevelRaw: PZR_LEVEL_FULL, inventory: 0,
      heater: HEATER_BASE, spray: 0, pzrInt: 0, porvOpen: false, pzrSvOpen: false,
      // secondary
      pS: P_STEAM_FULL, sgMass: M_SG_NOM, wBoil: W_STEAM_FULL, wFeed: W_STEAM_FULL, tFeed: T_FEED_FULL,
      wTurb: W_STEAM_FULL, wDump: 0, wSv: 0, wSteam: W_STEAM_FULL,
      valve: VALVE_FULL, loadSet: 77, rpm: 3000, mwe: PE_NOM / 1e6,
      turbineTripped: false, turbineCause: null, turbineTripSignal: false,
      dumpValve: 0, dumpInt: 0, sgSvOpen: false,
      tCond: T_COND_FULL, pCond: psat(T_COND_FULL), qCond: Q_COND_FULL, vacuumOk: true,
      qDhrs: 0, dhrsOn: false, tPool: T_POOL0, poolMass: M_POOL,
      demand: DEMAND,
      // protection
      tripped: false, tripCause: null, tripT: null, wouldTrip: null, wouldTripT: null, damage: null,
      alarms: {}, alarmSeen: {}, events: [], eventSeq: 0,
      // scripted events for a scenario: [{ t, run(s) }], sorted by time
      script: []
    };
    for (let i = 0; i < N_SG; i++) s.sg[i] = T_SAT_FULL + Math.pow(SG_R, i + 1) * (T_HOT_FULL - T_SAT_FULL);
    derive(s, 1 / 60);
    s.omega = 0; s.period = Infinity;
    updateAlarms(s);
    return s;
  }

  // Hold the neutron population at `n` with its precursors in balance.
  function setPower(s, n) {
    s.n = n;
    s.C = BETA_I.map(function (b, i) { return b * n / (GEN_TIME * LAMBDA_I[i]); });
    s.logN = Math.log(n);
    s.omega = 0;
    s.period = Infinity;
    s.peakPower = n;
  }

  // Hot standby: shut down, rods in, everything held at 292 °C, turbine off line.
  function setHotStandby(s) {
    const inp = s.in;
    inp.rodTarget = 0; inp.rodAuto = false; inp.shutdownOut = false; inp.loadDemand = 0;
    s.rodX = 0; s.rodY = 0;
    s.D = DH_A.map(function (a) { return a * 1e-4; });
    s.tFuel = T_NOLOAD; s.tCore = T_NOLOAD; s.tClad = T_NOLOAD; s.tPeak = T_NOLOAD;
    s.hot.fill(T_NOLOAD); s.sg.fill(T_NOLOAD); s.cold.fill(T_NOLOAD);
    s.qSg = 0; s.qFuel = 0;
    s.pS = P_STEAM_NOLOAD; s.wBoil = 0; s.wFeed = 0; s.tFeed = T_CW_IN + 5;
    s.wTurb = 0; s.wSteam = 0;
    s.valve = 0; s.loadSet = 0; s.rpm = 0; s.mwe = 0;
    s.turbineTripped = true; s.turbineCause = 'Off line'; s.turbineTripSignal = false;
    s.tCond = T_CW_IN; s.pCond = psat(T_CW_IN); s.qCond = 0;
    s.pzrLevelRaw = PZR_LEVEL_FULL + PZR_SWELL * (T_NOLOAD - T_MEAN_FULL);
    s.pzrLevel = s.pzrLevelRaw;
    // The neutron population the source holds up in a subcritical core.
    const rho = reactivity(s);
    setPower(s, Math.max(1e-12, -SOURCE * GEN_TIME / Math.min(rho, -1e-4)));
    refresh(s);
  }

  // Work out what the screen reads again after a scenario sets the state by hand.
  function refresh(s) {
    s.pTh = undefined;
    s.qFuel = undefined;
    derive(s, 1 / 60);
    s.omega = 0;
    s.period = Infinity;
    updateAlarms(s);
  }

  // Control bank position that makes the core exactly critical as it stands.
  function criticalRodX(s) {
    const save = s.rodX;
    let lo = 0, hi = 1, x;
    s.rodX = 1;
    if (reactivity(s) < 0) x = 1;
    else {
      s.rodX = 0;
      if (reactivity(s) > 0) x = 0;
      else {
        for (let i = 0; i < 50; i++) {
          s.rodX = (lo + hi) / 2;
          if (reactivity(s) > 0) hi = s.rodX; else lo = s.rodX;
        }
        x = (lo + hi) / 2;
      }
    }
    s.rodX = save;
    s.rho = reactivity(s);
    return x;
  }

  function log(s, msg, level) {
    s.events.push({ seq: ++s.eventSeq, t: s.t, msg: msg, level: level || 'info' });
    if (s.events.length > 80) s.events.shift();
  }

  // ---------------------------------------------------------------------------
  // Commands.

  function trip(s, cause) {
    if (s.tripped) return;
    s.tripped = true;
    s.tripCause = cause;
    s.tripT = s.t;
    s.dropV = 0;
    s.in.rodAuto = false;
    s.in.rodTarget = 0;
    s.in.shutdownOut = false;
    log(s, 'Reactor trip: ' + (TRIP_LABELS[cause] || cause), 'trip');
    tripTurbine(s, 'Reactor trip');
  }

  function scram(s) { trip(s, 'manual'); }

  // Trip conditions present right now, apart from the latched turbine signal.
  function activeTrips(s) {
    return TRIPS.filter(function (t) { return t.id !== 'turbine' && t.test(s); }).map(function (t) { return t.id; });
  }

  function canResetTrip(s) {
    return s.tripped && !s.damage && s.rodX < 1e-3 && s.rodY < 1e-3 && s.in.offsitePower &&
      activeTrips(s).length === 0;
  }

  function resetTrip(s) {
    if (!canResetTrip(s)) return false;
    s.tripped = false; s.tripCause = null; s.tripT = null;
    s.wouldTrip = null; s.wouldTripT = null; s.turbineTripSignal = false;
    s.in.rodTarget = 0; s.in.shutdownOut = false;
    if (s.dhrsOn) { s.dhrsOn = false; log(s, 'Passive cooling valves closed'); }
    log(s, 'Reactor trip reset');
    return true;
  }

  function tripTurbine(s, why) {
    if (s.turbineTripped) return;
    s.turbineTripped = true;
    s.turbineCause = why || 'Manual';
    // Above 15% power the reactor can't lose its turbine without tripping too.
    if (s.nFiss > 0.15 && why !== 'Reactor trip') s.turbineTripSignal = true;
    log(s, 'Turbine trip: ' + s.turbineCause, 'warn');
  }

  function canResetTurbine(s) {
    return s.turbineTripped && !s.tripped && !s.damage && s.in.offsitePower && s.vacuumOk && s.pS > 40;
  }

  function resetTurbine(s) {
    if (!canResetTurbine(s)) return false;
    s.turbineTripped = false; s.turbineCause = null; s.turbineTripSignal = false;
    s.valve = 0; s.loadSet = 0;
    log(s, 'Turbine rolling up to speed');
    return true;
  }

  function setOffsitePower(s, on) {
    if (s.in.offsitePower === on) return;
    s.in.offsitePower = on;
    if (on) log(s, 'Off-site power restored');
    else log(s, 'Loss of off-site power', 'trip');
  }

  function setProtection(s, on) {
    if (s.in.protection === on) return;
    s.in.protection = on;
    log(s, on ? 'Protection system on' : 'Protection system switched off', on ? 'info' : 'warn');
  }

  // ---------------------------------------------------------------------------
  // The step.

  function reactivity(s) {
    const tMod = (s.cold[N_COLD - 1] + s.tCore) / 2;
    const p = s.rhoParts;
    p.rods = rhoRods(s.rodX, s.rodY);
    p.boron = BORON_WORTH * s.boron;
    p.doppler = DOPPLER * (s.tFuel - T_REF);
    p.moderator = MODERATOR * (tMod - T_REF);
    p.void = VOID * s.voidFrac;
    return RHO_CORE + p.rods + p.boron + p.doppler + p.moderator + p.void;
  }

  // One implicit Euler step of the point kinetics equations, solved in closed
  // form. Stable for any step while the reactor is below prompt critical.
  function kinetics(s, rho, h) {
    let sumA = 0, sumB = 0;
    for (let i = 0; i < 6; i++) {
      const a = 1 / (1 + LAMBDA_I[i] * h);
      sumA += LAMBDA_I[i] * a * BETA_I[i];
      sumB += LAMBDA_I[i] * a * s.C[i];
    }
    const den = 1 - h * (rho - BETA) / GEN_TIME - h * h * sumA / GEN_TIME;
    let n = (s.n + h * sumB + h * SOURCE) / den;
    if (!(n > 1e-14)) n = 1e-14;
    for (let i = 0; i < 6; i++) s.C[i] = (s.C[i] + h * BETA_I[i] / GEN_TIME * n) / (1 + LAMBDA_I[i] * h);
    s.n = n;
  }

  function moveRods(s, dt) {
    const inp = s.in;
    if (s.tripped || !inp.offsitePower) {
      // Gravity drop: every bank falls in about 2 s.
      s.dropV = Math.min(0.8, s.dropV + 0.6 * dt);
      s.rodX = Math.max(0, s.rodX - s.dropV * dt);
      s.rodY = Math.max(0, s.rodY - s.dropV * dt);
      return;
    }
    s.dropV = 0;
    const yTarget = inp.shutdownOut ? 1 : 0;
    s.rodY += clamp(yTarget - s.rodY, -0.1 * dt, 0.1 * dt);
    const banksOut = s.rodY > 0.999;
    if (inp.rodAuto && banksOut) {
      // Hold the average coolant temperature on its programme, and move early
      // when the turbine draws more or less heat than the reactor makes.
      const err = s.tRef - s.tAvg + ROD_MISMATCH * s.mismatch;
      const v = Math.abs(err) < 0.5 ? 0 : clamp(ROD_GAIN * err, -ROD_AUTO_MAX, ROD_AUTO_MAX);
      s.rodX = clamp(s.rodX + v * dt, 0, 1);
      inp.rodTarget = s.rodX;
    } else {
      // Control rods only come out once the shutdown banks are out.
      const target = banksOut ? inp.rodTarget : Math.min(inp.rodTarget, s.rodX);
      s.rodX += clamp(target - s.rodX, -ROD_SPEED * dt, ROD_SPEED * dt);
    }
  }

  // Core: neutronics, fuel and core water together, sub-stepped while the
  // reactor is past prompt critical so a power excursion stays accurate.
  function stepCore(s, dt) {
    const tIn = s.cold[N_COLD - 1];
    let left = dt, guard = 0, pTh = 0, q = 0;
    while (left > 1e-12 && guard++ < 4000) {
      const rho = reactivity(s);
      let h = left;
      if (rho > BETA * 0.9) h = Math.min(left, 0.1 * GEN_TIME / Math.max(rho - BETA * 0.9, 1e-5));
      kinetics(s, rho, h);
      let dh = 0;
      for (let j = 0; j < DH_A.length; j++) {
        const e = Math.exp(-h / DH_TAU[j]);
        s.D[j] = s.D[j] * e + DH_A[j] * s.n * (1 - e);
        dh += s.D[j];
      }
      pTh = P0 * ((1 - DH_SUM) * s.n + dh);
      const tMod = (tIn + s.tCore) / 2;
      const ua = UA_FUEL * (s.dnb ? 0.2 : 1);
      s.tFuel = (s.tFuel + h / C_FUEL * (pTh + ua * tMod)) / (1 + h * ua / C_FUEL);
      q = ua * (s.tFuel - tMod);
      s.tCore = (s.tCore + h / (M_CORE * CP) * (q + s.flow * CP * tIn)) / (1 + h * s.flow / M_CORE);
      left -= h;
    }
    s.pTh = pTh;
    s.qFuel = q;
    if (s.n > s.peakPower) s.peakPower = s.n;
  }

  // Upwind transport of water round the loop, with the steam generator
  // cells giving up heat to the boiling secondary side.
  function stepLoop(s, dt) {
    const tSat = tsat(s.pS);
    const wet = clamp(s.sgLevel / 0.2, 0.03, 1);
    const ua = UA_SG_CELL * wet;
    const flow = s.flow;
    const nSub = Math.max(1, Math.ceil(flow * dt / (0.8 * M_CELL)));
    const h = dt / nSub;
    const c = flow * h / M_CELL;
    const k = ua * h / (M_CELL * CP);
    let qSg = 0;
    for (let sub = 0; sub < nSub; sub++) {
      for (let i = N_COLD - 1; i > 0; i--) s.cold[i] += c * (s.cold[i - 1] - s.cold[i]);
      s.cold[0] += c * (s.sg[N_SG - 1] - s.cold[0]);
      for (let i = N_SG - 1; i >= 0; i--) {
        const up = i > 0 ? s.sg[i - 1] : s.hot[N_HOT - 1];
        const t = (s.sg[i] + c * (up - s.sg[i]) + k * tSat) / (1 + k);
        s.sg[i] = t;
        qSg += ua * (t - tSat) * h;
      }
      for (let i = N_HOT - 1; i > 0; i--) s.hot[i] += c * (s.hot[i - 1] - s.hot[i]);
      s.hot[0] += c * (s.tCore - s.hot[0]);
    }
    s.qSg = qSg / dt;
  }

  function stepFlow(s, dt) {
    const inp = s.in;
    if (inp.offsitePower && inp.pumpOn) s.pumpSpeed += clamp(inp.pumpSet - s.pumpSpeed, -0.2 * dt, 0.2 * dt);
    else s.pumpSpeed = s.pumpSpeed / (1 + s.pumpSpeed * dt / COAST);
    let hotAvg = 0, coldAvg = 0;
    for (let i = 0; i < N_HOT; i++) hotAvg += s.hot[i];
    for (let i = 0; i < N_COLD; i++) coldAvg += s.cold[i];
    // Hot water rising from the core and cold water falling from the steam
    // generator keep the loop turning with the pump off.
    const buoy = Math.max(0, hotAvg / N_HOT - coldAvg / N_COLD);
    const head = s.pumpSpeed * s.pumpSpeed + NAT_CIRC * buoy;
    const wEq = W_NOM * Math.sqrt(head / (1 + NAT_CIRC * DT_CORE));
    s.flow = relax(s.flow, wEq, dt, 1.5);
  }

  function stepPressurizer(s, dt) {
    const inp = s.in;
    let mean = M_CORE * s.tCore;
    for (let i = 0; i < N_HOT; i++) mean += M_CELL * s.hot[i];
    for (let i = 0; i < N_SG; i++) mean += M_CELL * s.sg[i];
    for (let i = 0; i < N_COLD; i++) mean += M_CELL * s.cold[i];
    mean /= M_PRIMARY;
    s.tMean = mean;

    const powered = inp.offsitePower;
    // Charging pumps make up water lost through the relief valves.
    if (powered && inp.pzrAuto) s.inventory += clamp(-s.inventory, -0.002 * dt, 0.002 * dt);
    const level = PZR_LEVEL_FULL + PZR_SWELL * (mean - T_MEAN_FULL) + 0.15 * s.voidFrac + s.inventory;
    const prev = s.pzrLevelRaw;
    s.pzrLevelRaw = level;
    s.pzrLevel = clamp(level, 0, 1);

    let heater, spray;
    if (inp.pzrAuto) {
      const e = P_PRIMARY - s.pP;
      s.pzrInt = clamp(s.pzrInt + e * dt, -20, 20);
      const u = 0.3 * e + 0.02 * s.pzrInt;
      heater = clamp(HEATER_BASE + u, 0, 1);
      spray = clamp(-u - 0.1, 0, 1);
    } else {
      heater = inp.heaters ? 1 : 0;
      spray = inp.spray ? 1 : 0;
    }
    if (!powered || level < 0.12) heater = 0;
    spray *= Math.min(1, s.pumpSpeed * 1.5);   // spray is driven by the pump
    s.heater = heater; s.spray = spray;

    // Relief valves.
    if (s.pP > PORV_OPEN) s.porvOpen = true;
    else if (s.pP < PORV_CLOSE) s.porvOpen = false;
    if (s.pP > PZR_SV_OPEN) s.pzrSvOpen = true;
    else if (s.pP < PZR_SV_CLOSE) s.pzrSvOpen = false;
    const porv = s.porvOpen || inp.porv;
    const relief = (porv ? 2.5 : 0) + (s.pzrSvOpen ? 8 : 0);
    if (porv) s.inventory -= 0.0015 * dt;
    if (s.pzrSvOpen) s.inventory -= 0.005 * dt;

    // Water surging in squeezes the steam bubble; out, it lets it expand.
    // A full pressurizer squeezes far harder; an empty one has no bubble.
    const dl = Math.max(level, 0) - Math.max(prev, 0);
    const surge = PZR_SURGE * (level > 1 ? 5 : 1) * dl;
    let p = s.pP + surge + dt * (PZR_HEAT * heater - PZR_LOSS - PZR_SPRAY * spray -
      relief * Math.min(1, s.pP / 100));
    // Below the boiling pressure of the hottest water, that water flashes to
    // steam, which holds the pressure up and leaves bubbles in the core.
    // The safety valves cap how high that can push it.
    p = Math.max(p, Math.min(psat(Math.max(s.tCore, s.hot[0]) - 2), PZR_SV_OPEN + 3));
    s.pP = clamp(p, 1, 200);
  }

  function stepSecondary(s, dt) {
    const inp = s.in;
    const powered = inp.offsitePower;
    const tSatS = tsat(s.pS);
    const hgs = hg(s.pS), hfs = hf(s.pS);
    const hFeed = hLiquid(s.tFeed);
    s.vacuumOk = s.pCond < VACUUM_TRIP;

    // Turbine.
    if (!s.turbineTripped) {
      if (!powered) tripTurbine(s, 'Grid lost');
      else if (!s.vacuumOk) tripTurbine(s, 'Low condenser vacuum');
      else if (s.pS < 35 && s.loadSet > 5) tripTurbine(s, 'Low steam pressure');
    }
    let synced = false;
    if (s.turbineTripped) {
      s.valve = Math.max(0, s.valve - 2 * dt);
      s.loadSet = 0;
      s.rpm = s.rpm / (1 + dt / 40);
    } else if (s.rpm < 2999) {
      // Rolling up to speed on a crack of steam before joining the grid.
      s.rpm = Math.min(3000, s.rpm + 300 * dt);
      s.valve += clamp(0.03 - s.valve, -dt, dt);
      if (s.rpm >= 2999) log(s, 'Generator synchronised to the grid');
    } else {
      synced = true;
      // Loading waits while the reactor falls behind and the coolant runs
      // more than 2 °C under its programme, or the reactor is at full power.
      // Above 103% the turbine sheds load until the reactor is back under.
      const up = s.tRef - s.tAvg > LOAD_HOLD || s.powerFrac > 1 ? 0 : LOAD_RATE * dt;
      s.loadSet += clamp(inp.loadDemand - s.loadSet, -LOAD_RATE * dt, up);
      if (s.powerFrac > 1.03) s.loadSet = Math.max(0, s.loadSet - LOAD_RATE * dt);
      const err = s.loadSet - s.mwe;
      s.valve = clamp(s.valve + clamp(0.006 * err, -0.25, 0.25) * dt, 0, 1);
    }
    const wTurb = K_TURB * s.valve * s.pS;
    const carnot = Math.max(0, 1 - (s.tCond + 273.15) / (tSatS + 273.15));
    const pMech = synced ? wTurb * W_SPEC_FULL * carnot / CARNOT_FULL : 0;
    s.mwe = GEN_EFF * pMech / 1e6;
    s.wTurb = wTurb;

    // Turbine bypass: steam dumped straight to the condenser. Off line it
    // holds the no-load steam pressure; on line it opens when the coolant
    // runs more than 3 °C hotter than its programme, as after a load drop.
    const load = clamp(wTurb / W_STEAM_FULL, 0, 1.2);
    const dumpOk = powered && s.vacuumOk;
    const e = s.turbineTripped ? s.pS - P_STEAM_NOLOAD : (s.tAvg - s.tRef - 3) * 0.5;
    if (dumpOk && (e > 0 || s.dumpInt > 0)) s.dumpInt = clamp(s.dumpInt + e * dt, 0, 20);
    else s.dumpInt = 0;
    s.dumpValve = dumpOk ? clamp(0.5 * e + 0.05 * s.dumpInt, 0, 1) : 0;
    const wDump = DUMP_CAP * W_STEAM_FULL * s.dumpValve * s.pS / P_STEAM_FULL;

    // Steam generator safety valves, venting to the sky.
    if (s.pS > SG_RELIEF_OPEN) s.sgSvOpen = true;
    else if (s.pS < SG_RELIEF_CLOSE) s.sgSvOpen = false;
    const wSv = s.sgSvOpen ? 1.2 * W_STEAM_FULL * s.pS / SG_RELIEF_OPEN : 0;

    // Passive decay heat removal: steam condenses in a heat exchanger in the
    // pool and runs back by gravity. Opens on loss of power, a dry steam
    // generator or the safety valves lifting.
    if (!s.dhrsOn && (!powered || s.sgLevel < 0.1 || s.sgSvOpen)) {
      s.dhrsOn = true;
      log(s, 'Passive cooling into the pool started');
    }
    s.qDhrs = s.dhrsOn ? UA_DHRS * Math.max(0, tSatS - s.tPool) : 0;

    // Feedwater.
    let wFeed = 0;
    if (powered && inp.feedPumpOn) {
      if (inp.feedAuto) wFeed = s.wBoil + 3 * W_STEAM_FULL * (0.5 - s.sgLevel);
      else wFeed = inp.feedSet * W_STEAM_FULL;
      wFeed = clamp(wFeed, 0, 1.2 * W_STEAM_FULL);
    }
    s.wFeed = wFeed;
    // Feedwater heaters run on steam bled from the turbine, so they need load.
    const tCold = s.tCond + 5;
    s.tFeed = relax(s.tFeed, tCold + (T_FEED_FULL - tCold) * clamp(load, 0, 1), dt, 60);

    // Boiling and the steam space.
    const wBoil = (s.qSg - s.qDhrs - wFeed * (hfs - hFeed)) / (hgs - hfs);
    s.wBoil = wBoil;
    s.sgMass = Math.max(0, s.sgMass + (wFeed - wBoil) * dt);
    const wOut = wTurb + wDump + wSv;
    s.wDump = wDump; s.wSv = wSv; s.wSteam = wOut;
    s.pS = clamp(s.pS + (wBoil - wOut) * dt / C_STEAM, 0.05, 120);

    // Condenser heat and pressure.
    const cw = powered ? inp.cooling : 0;
    const wCw = cw * W_CW_FULL;
    const qCond = Math.max(0, (wTurb + wDump) * (hgs - hFeed) - pMech);
    s.qCond = qCond;
    let tTarget;
    if (wCw > 1) tTarget = T_CW_IN + qCond / (wCw * 4180) + APPROACH * (qCond / Q_COND_FULL) / Math.sqrt(Math.max(cw, 0.1));
    else tTarget = T_CW_IN + qCond / (0.02 * W_CW_FULL * 4180);
    s.tCond = relax(s.tCond, Math.min(tTarget, 150), dt, 20);
    s.pCond = psat(s.tCond);

    // Pool: warms, then boils off.
    const qPool = s.qDhrs * dt;
    if (s.tPool < 100) s.tPool = Math.min(100, s.tPool + qPool / (s.poolMass * 4180));
    else s.poolMass = Math.max(1, s.poolMass - qPool / 2.257e6);
  }

  // Values the controls, protection and screen read, worked out from the state.
  function derive(s, dt) {
    if (s.pTh === undefined) s.pTh = P0 * ((1 - DH_SUM) * s.n + s.D.reduce(function (a, b) { return a + b; }, 0));
    if (s.qFuel === undefined) s.qFuel = s.pTh;
    s.nFiss = s.n;
    s.powerFrac = s.pTh / P0;
    s.mwt = s.pTh / 1e6;
    s.tHot = s.hot[1];
    s.tCold = s.cold[N_COLD - 1];
    s.tAvg = (s.tHot + s.tCold) / 2;
    s.flowFrac = s.flow / W_NOM;
    s.sgLevel = clamp(0.5 * s.sgMass / M_SG_NOM, 0, 1);
    const load = s.turbineTripped ? 0 : clamp(s.wTurb / W_STEAM_FULL, 0, 1);
    s.tRef = T_NOLOAD + (T_FULL - T_NOLOAD) * load;
    s.mismatch = s.wTurb * (hg(s.pS) - hLiquid(s.tFeed)) / P0 - s.powerFrac;
    s.rho = reactivity(s);

    // Period from the smoothed rate of change of log power. The meter lags a
    // few seconds, as real ones do, so the prompt jump of a small rod step
    // doesn't read as a runaway.
    const ln = Math.log(s.n);
    s.omega = relax(s.omega, (ln - s.logN) / dt, dt, 3);
    s.logN = ln;
    s.period = Math.abs(s.omega) > 1e-4 ? 1 / s.omega : Infinity;

    // Boiling in the core, the margin to the boiling crisis, and the cladding.
    const tSatP = tsat(s.pP);
    s.tSatPrimary = tSatP;
    s.voidFrac = relax(s.voidFrac, clamp((s.tCore - tSatP) / 20, 0, 0.6), dt, 1);
    const q = Math.max(1e-6, s.qFuel / P0);
    const fFlow = Math.pow(Math.max(s.flowFrac, 0.02), 0.6);
    const fSub = clamp(0.5 + 0.5 * (tSatP - s.tHot) / 13.3, 0.1, 1.3);
    s.dnbr = Math.min(9.99, 2 * fFlow * fSub / q);
    s.dnb = s.dnbr < 1;
    const tMod = (s.tCold + s.tCore) / 2;
    // Past the boiling crisis a steam film insulates the cladding, which
    // climbs toward the fuel's temperature.
    const cladTarget = s.dnb ? tMod + 0.8 * (s.tFuel - tMod) : tMod + 25 * q;
    s.tClad = relax(s.tClad, cladTarget, dt, 3);
    s.tPeak = relax(s.tPeak, s.tFuel + PELLET_DT * s.powerFrac, dt, 2);
  }

  function protect(s) {
    const inp = s.in;
    if (!inp.offsitePower && !s.tripped) trip(s, 'powerLoss');
    for (let i = 0; i < TRIPS.length; i++) {
      if (s.tripped && inp.protection) break;
      const tr = TRIPS[i];
      if (!tr.test(s)) continue;
      if (!s.wouldTrip && !s.tripped) { s.wouldTrip = tr.id; s.wouldTripT = s.t; }
      if (inp.protection) trip(s, tr.id);
    }
    if (!s.damage) {
      if (s.tPeak > 2800) s.damage = { kind: 'melt', t: s.t };
      else if (s.tClad > 1204) s.damage = { kind: 'clad', t: s.t };
      if (s.damage) log(s, s.damage.kind === 'melt' ? 'Core damage: fuel melting' : 'Core damage: cladding failed', 'trip');
    }
  }

  function updateAlarms(s) {
    const a = {
      trip: s.tripped,
      highPower: s.nFiss > 1.05,
      period: s.period > 0 && s.period < 15 && s.nFiss > 1e-5 && s.nFiss < 0.15,
      pressHigh: s.pP > 145,
      pressLow: s.pP < 130,
      tHot: s.tHot > 326,
      flow: s.flowFrac < 0.9 && s.nFiss > 0.2,
      sgLevel: s.sgLevel < 0.3,
      turbine: s.turbineTripped && s.turbineCause !== 'Off line',
      vacuum: !s.vacuumOk,
      relief: s.porvOpen || s.in.porv || s.pzrSvOpen,
      steamRelief: s.sgSvOpen,
      dump: s.dumpValve > 0.02,
      dhrs: s.dhrsOn,
      powerLoss: !s.in.offsitePower,
      dnb: s.dnbr < 1.3,
      protectionOff: !s.in.protection,
      damage: !!s.damage
    };
    for (let i = 0; i < ALARMS.length; i++) {
      const id = ALARMS[i][0];
      if (a[id]) {
        // A valve cycling open and shut is logged once, not every cycle.
        if (!s.alarms[id] && !QUIET_ALARMS[id] && !(s.alarmSeen[id] !== undefined && s.t - s.alarmSeen[id] < 60)) {
          log(s, 'Alarm: ' + ALARMS[i][1], 'alarm');
        }
        s.alarmSeen[id] = s.t;
      }
    }
    s.alarms = a;
  }

  function step(s, dt) {
    const inp = s.in;
    while (s.script.length && s.t >= s.script[0].t) s.script.shift().run(s);
    s.boron = relax(s.boron, inp.boronTarget, dt, 30);
    moveRods(s, dt);
    stepFlow(s, dt);
    stepCore(s, dt);
    stepLoop(s, dt);
    stepPressurizer(s, dt);
    stepSecondary(s, dt);
    s.t += dt;
    derive(s, dt);
    protect(s);
    updateAlarms(s);
  }

  // A shut-down plant changes slowly, so fast-forward can take long steps.
  function quiet(s) {
    return s.tripped && s.n < 1e-3 && s.rodX < 1e-3 && s.rodY < 1e-3 && s.rho < -0.01;
  }

  // Run `seconds` of plant time in fixed steps; returns the steps taken.
  function advance(s, seconds, maxSteps) {
    let left = seconds, steps = 0;
    const limit = maxSteps || 1e7;
    while (left > 1e-9 && steps < limit) {
      const dt = Math.min(left, quiet(s) ? 0.5 : 1 / 60);
      step(s, dt);
      left -= dt;
      steps++;
    }
    return steps;
  }

  const api = {
    create: create, setHotStandby: setHotStandby, setPower: setPower, criticalRodX: criticalRodX,
    refresh: refresh, step: step, advance: advance, quiet: quiet, reactivity: reactivity, rodWorth: rhoRods,
    scram: scram, trip: trip, canResetTrip: canResetTrip, resetTrip: resetTrip,
    tripTurbine: tripTurbine, canResetTurbine: canResetTurbine, resetTurbine: resetTurbine,
    setOffsitePower: setOffsitePower, setProtection: setProtection, log: log, activeTrips: activeTrips,
    tsat: tsat, psat: psat, hg: hg, hLiquid: hLiquid, rodShape: rodShape,
    TRIPS: TRIPS, TRIP_LABELS: TRIP_LABELS, ALARMS: ALARMS,
    N_HOT: N_HOT, N_SG: N_SG, N_COLD: N_COLD,
    C: {
      P0: P0, PE_NOM: PE_NOM, DEMAND: DEMAND, GEN_EFF: GEN_EFF, BETA: BETA, PCM: PCM, W_NOM: W_NOM,
      P_PRIMARY: P_PRIMARY, P_STEAM_FULL: P_STEAM_FULL, P_STEAM_NOLOAD: P_STEAM_NOLOAD,
      W_STEAM_FULL: W_STEAM_FULL, T_NOLOAD: T_NOLOAD, T_FULL: T_FULL, T_HOT_FULL: T_HOT_FULL,
      T_COLD_FULL: T_COLD_FULL, T_POOL0: T_POOL0, Q_COND_FULL: Q_COND_FULL, M_SG_NOM: M_SG_NOM,
      M_POOL: M_POOL, RHO_CORE: RHO_CORE, DH_SUM: DH_SUM, VACUUM_TRIP: VACUUM_TRIP,
      ROD_WORTH_CONTROL: ROD_WORTH_CONTROL, ROD_WORTH_SHUTDOWN: ROD_WORTH_SHUTDOWN
    }
  };
  root.ReactorSim = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
