// Scenarios: each sets up the plant, gives a two-line briefing and points at
// the part of the plant worth watching. No DOM, so the tests run them too.
(function (root) {
  'use strict';

  const Sim = root.ReactorSim || require('./sim.js');

  function at(s, t, run) {
    s.script.push({ t: t, run: run });
    s.script.sort(function (a, b) { return a.t - b.t; });
  }

  const LIST = [
    {
      id: 'full',
      name: 'Full power',
      brief: [
        'Steady at 100%: 250 MW of heat makes 77 MW of electricity for the town.',
        'Everything is on automatic. Lower the turbine load and watch the rods follow.'
      ],
      watch: 'rods',
      setup: function () {}
    },
    {
      id: 'cold',
      name: 'Cold start',
      brief: [
        'The reactor is shut down with every rod in, hot and ready.',
        'Pull the shutdown rods, then raise the control rods to about 33% and wait for the power to climb. Then put the turbine on line.'
      ],
      watch: 'power',
      setup: function (s) {
        Sim.setHotStandby(s);
        Sim.log(s, 'Reactor shut down at hot standby, 292 °C');
      }
    },
    {
      id: 'turbine',
      name: 'Turbine trip',
      brief: [
        'In 5 seconds the turbine trips and its steam has nowhere to go.',
        'Watch the bypass dump steam into the condenser while the reactor trips.'
      ],
      watch: 'bypass',
      setup: function (s) {
        at(s, 5, function (s) { Sim.tripTurbine(s, 'Low lube oil pressure'); });
      }
    },
    {
      id: 'pump',
      name: 'Pump failure',
      brief: [
        'In 5 seconds the primary pump loses its motor and coasts down.',
        'Watch the low-flow trip, then hot water rising on its own: natural circulation.'
      ],
      watch: 'pump',
      setup: function (s) {
        at(s, 5, function (s) {
          s.in.pumpOn = false;
          Sim.log(s, 'Primary pump motor tripped', 'warn');
        });
      }
    },
    {
      id: 'blackout',
      name: 'Station blackout',
      brief: [
        'In 5 seconds the grid goes down: no pumps, no feedwater, no turbine.',
        'Nobody touches anything. Watch the pool take the decay heat, then try ×3600.'
      ],
      watch: 'pool',
      setup: function (s) {
        at(s, 5, function (s) { Sim.setOffsitePower(s, false); });
      }
    },
    {
      id: 'sandbox',
      name: 'Rod withdrawal (sandbox)',
      brief: [
        'Protection is off and the control rods are about to pull out unchecked.',
        'Watch the power spike and the hot fuel stop it. Then see what else it takes to damage the core.'
      ],
      watch: 'core',
      sandbox: true,
      setup: function (s) {
        Sim.setHotStandby(s);
        s.rodY = 1;
        s.in.shutdownOut = true;
        s.rodX = s.in.rodTarget = Sim.criticalRodX(s);
        Sim.setPower(s, 1e-4);
        Sim.refresh(s);
        Sim.setProtection(s, false);
        at(s, 3, function (s) {
          s.in.rodTarget = 1;
          Sim.log(s, 'Control rods withdrawing without a stop', 'warn');
        });
      }
    }
  ];

  function byId(id) {
    for (let i = 0; i < LIST.length; i++) if (LIST[i].id === id) return LIST[i];
    return LIST[0];
  }

  // A fresh plant set up for the scenario.
  function start(id) {
    const sc = byId(id);
    const s = Sim.create();
    s.scenario = sc.id;
    sc.setup(s);
    return s;
  }

  const api = { LIST: LIST, byId: byId, start: start };
  root.ReactorScenarios = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
