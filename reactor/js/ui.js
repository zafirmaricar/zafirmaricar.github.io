// The page around the scene: the control desk, readouts, alarm panel,
// event log, scenario picker, labels, inspect cards, briefings and the
// core damage screen. app.js owns the loop and calls in here.
(function (root) {
  'use strict';

  const Sim = root.ReactorSim, Art = root.ReactorArt, Scenarios = root.ReactorScenarios;
  const C = Sim.C;
  const MINUS = '−';

  function $(id) { return document.getElementById(id); }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function num(v, d) { return (v < 0 ? MINUS : '') + Math.abs(v).toFixed(d || 0); }
  function thousands(v) { return Math.round(v).toLocaleString('en-GB'); }
  function clock(t) {
    t = Math.max(0, Math.floor(t));
    const d = Math.floor(t / 86400), h = Math.floor(t / 3600) % 24, m = Math.floor(t / 60) % 60, s = t % 60;
    const hms = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    return d ? d + 'd ' + hms : hms;
  }
  function shortClock(t) {
    t = Math.max(0, Math.floor(t));
    const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = t % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : String(m).padStart(2, '0')) + ':' + String(s).padStart(2, '0');
  }
  function sup(n) {
    const map = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
    return String(n).split('').map(function (c) { return map[c] || c; }).join('');
  }
  // Power as a percentage, switching to powers of ten when it is tiny.
  function powerText(n) {
    const pct = n * 100;
    if (pct >= 10) return pct.toFixed(1) + '%';
    if (pct >= 0.1) return pct.toFixed(2) + '%';
    const e = Math.floor(Math.log(pct) / Math.LN10);
    return (pct / Math.pow(10, e)).toFixed(1) + '×10' + sup(e) + '%';
  }

  // Which alarm lamp is the first out for each trip.
  const FIRST_OUT = {
    manual: 'trip', power: 'highPower', period: 'period', pressHigh: 'pressHigh', pressLow: 'pressLow',
    tHot: 'tHot', flow: 'flow', sgLevel: 'sgLevel', turbine: 'turbine', powerLoss: 'powerLoss'
  };
  const RED = { trip: 1, damage: 1, powerLoss: 1 };

  // One plain sentence for each part, and the live values its card shows.
  const INFO = {
    rods: {
      text: 'Rods of neutron-absorbing boron carbide. Lift them and the chain reaction speeds up; drop them in and it stops. Drag them in the picture to move them.',
      values: function (s) {
        return [['Control rods', Math.round(s.rodX * 100) + '% out'], ['Shutdown rods', s.rodY > 0.999 ? 'Out' : s.rodY < 0.001 ? 'In' : Math.round(s.rodY * 100) + '%'],
          ['Mode', s.tripped ? 'Tripped' : s.in.rodAuto ? 'Auto' : 'Manual'], ['Rod reactivity', num(s.rhoParts.rods / C.PCM) + ' pcm']];
      },
      actions: function (s) {
        const off = s.tripped || s.rodY < 0.999;
        function nudge(d) {
          return function () {
            const base = s.in.rodAuto ? s.rodX : s.in.rodTarget;
            s.in.rodAuto = false;
            s.in.rodTarget = clamp(Math.round((base + d) * 100) / 100, 0, 1);
          };
        }
        return [['Insert 5%', nudge(-0.05), off], ['Withdraw 5%', nudge(0.05), off],
          [s.in.rodAuto ? 'Switch to manual' : 'Switch to auto', function () { s.in.rodAuto = !s.in.rodAuto; }, off]];
      }
    },
    core: {
      text: 'Uranium fuel in tall assemblies. Splitting atoms heat the water flowing up past them, and the blue glow is Cherenkov light from fast particles in the water.',
      values: function (s) {
        return [['Fission power', powerText(s.nFiss)], ['Heat', num(s.mwt, 1) + ' MW'], ['Fuel average', thousands(s.tFuel) + ' °C'],
          ['Fuel centre', thousands(s.tPeak) + ' °C'], ['Cladding', thousands(s.tClad) + ' °C']];
      }
    },
    pzr: {
      text: 'Keeps the primary water at 138 bar so it can’t boil: electric heaters push the pressure up and a cold spray pulls it down.',
      values: function (s) {
        return [['Pressure', s.pP.toFixed(1) + ' bar'], ['Water level', Math.round(s.pzrLevel * 100) + '%'], ['Heaters', Math.round(s.heater * 100) + '%'],
          ['Spray', Math.round(s.spray * 100) + '%'], ['Relief valve', (s.porvOpen || s.in.porv) ? 'Open' : 'Shut']];
      },
      actions: function (s, ui) {
        return [[(s.porvOpen || s.in.porv) ? 'Close relief valve' : 'Open relief valve', function () { s.in.porv = !s.in.porv; Sim.log(s, s.in.porv ? 'Pressurizer relief valve opened by hand' : 'Pressurizer relief valve closed', s.in.porv ? 'warn' : 'info'); }]];
      }
    },
    sg: {
      text: 'Hot primary water runs down thousands of tubes and boils the separate secondary water around them into steam, so the two never mix.',
      values: function (s) {
        return [['Heat passed', num(s.qSg / 1e6, 1) + ' MW'], ['Steam pressure', s.pS.toFixed(1) + ' bar'], ['Water level', Math.round(s.sgLevel * 100) + '%'],
          ['Steam made', Math.round(Math.max(0, s.wBoil)) + ' kg/s']];
      }
    },
    pump: {
      text: 'Drives the primary water round the loop. If it stops, hot water still rises and cold water sinks, so the loop keeps turning slowly on its own.',
      values: function (s) {
        return [['Pump speed', Math.round(s.pumpSpeed * 100) + '%'], ['Flow', num(s.flowFrac * 100, 1) + '%'], ['Motor', s.in.pumpOn && s.in.offsitePower ? 'Running' : 'Off']];
      },
      actions: function (s) {
        return [[s.in.pumpOn ? 'Trip the pump' : 'Start the pump', function () { s.in.pumpOn = !s.in.pumpOn; Sim.log(s, s.in.pumpOn ? 'Primary pump started' : 'Primary pump tripped by hand', s.in.pumpOn ? 'info' : 'warn'); }]];
      }
    },
    containment: {
      text: 'A sealed steel vessel around the whole primary circuit. Whatever happens inside, the radioactive water stays in.',
      values: function (s) {
        return [['Primary water', s.inventory < -0.005 ? Math.round(-s.inventory * 100) + '% vented to it' : 'All in the loop'], ['Fuel', s.damage ? 'Damaged' : 'Intact']];
      }
    },
    pool: {
      text: 'A big pool of water around the containment. With no power at all it soaks up the leftover heat for days, then slowly boils off.',
      values: function (s) {
        return [['Temperature', num(s.tPool, 1) + ' °C'], ['Water left', thousands(s.poolMass / 1000) + ' t'], ['Heat coming in', s.dhrsOn ? num(s.qDhrs / 1e6, 2) + ' MW' : 'None']];
      }
    },
    dhrs: {
      text: 'Passive cooling: steam condenses in these tubes, warms the pool, and the water runs back by gravity. No pumps, no power, no operator.',
      values: function (s) {
        return [['State', s.dhrsOn ? 'Working' : 'Standby'], ['Heat removed', num(s.qDhrs / 1e6, 2) + ' MW'], ['Decay heat', num(s.mwt, 2) + ' MW']];
      }
    },
    turbine: {
      text: 'Steam at 60 bar spins the turbine at 3,000 rpm. About a third of the reactor’s heat becomes motion; the rest goes to the condenser.',
      values: function (s) {
        return [['Speed', thousands(s.rpm) + ' rpm'], ['Steam valve', Math.round(s.valve * 100) + '%'], ['Steam in', Math.round(s.wTurb) + ' kg/s'],
          ['State', s.turbineTripped ? (s.turbineCause === 'Off line' ? 'Off line' : 'Tripped') : s.rpm < 2999 ? 'Rolling up' : 'On line']];
      },
      actions: function (s) {
        if (s.turbineTripped) return [['Reset the turbine', function () { Sim.resetTurbine(s); }, !Sim.canResetTurbine(s)]];
        return [['Trip the turbine', function () { Sim.tripTurbine(s, 'Manual trip'); }]];
      }
    },
    generator: {
      text: 'Turns the turbine’s spin into electricity for the grid, locked to its 50 Hz.',
      values: function (s) {
        return [['Output', num(s.mwe, 1) + ' MWe'], ['Town needs', s.demand + ' MWe'], ['Efficiency', s.mwt > 1 ? Math.round(s.mwe / s.mwt * 100) + '%' : '–']];
      }
    },
    bypass: {
      text: 'When the turbine can’t take the steam, this valve dumps it straight into the condenser so the reactor still has somewhere to put its heat.',
      values: function (s) {
        return [['Valve', Math.round(s.dumpValve * 100) + '% open'], ['Steam dumped', Math.round(s.wDump) + ' kg/s'], ['Mode', s.turbineTripped ? 'Holding steam pressure' : 'Holding coolant temperature']];
      }
    },
    condenser: {
      text: 'Cold water from the tower turns the spent steam back into water. The steam shrinks as it condenses, which leaves a vacuum that pulls more steam through the turbine.',
      values: function (s) {
        return [['Pressure', s.pCond.toFixed(3) + ' bar'], ['Temperature', num(s.tCond, 1) + ' °C'], ['Heat removed', num(s.qCond / 1e6, 1) + ' MW'], ['Vacuum', s.vacuumOk ? 'Good' : 'Lost']];
      }
    },
    feedpump: {
      text: 'Pumps the condensed water back into the steam generator to be boiled again.',
      values: function (s) {
        return [['Feed flow', Math.round(s.wFeed / C.W_STEAM_FULL * 100) + '%'], ['Water temperature', Math.round(s.tFeed) + ' °C'], ['Mode', s.in.feedAuto ? 'Auto' : 'Manual']];
      },
      actions: function (s) {
        return [[s.in.feedPumpOn ? 'Trip the feed pump' : 'Start the feed pump', function () { s.in.feedPumpOn = !s.in.feedPumpOn; Sim.log(s, s.in.feedPumpOn ? 'Feed pump started' : 'Feed pump tripped by hand', s.in.feedPumpOn ? 'info' : 'warn'); }]];
      }
    },
    tower: {
      text: 'Throws the waste heat into the air by letting some of the cooling water evaporate. The cloud is water vapour, not smoke.',
      values: function (s) {
        return [['Heat to the air', num(s.qCond / 1e6, 1) + ' MW'], ['Cooling water', Math.round((s.in.offsitePower ? s.in.cooling : 0) * 100) + '%']];
      }
    },
    town: {
      text: 'The town runs on what the generator sends. When the plant trips, the grid has to find the power somewhere else.',
      values: function (s) {
        return [['Needs', s.demand + ' MWe'], ['Getting', num(s.mwe, 1) + ' MWe'], ['Grid', s.in.offsitePower ? 'Up' : 'Down']];
      }
    }
  };

  // Labels: where each sits (scene pixels), which way it hangs off that
  // point, and its text. Leaders run to the part's anchor in art.js.
  const LABELS = {
    rods: [46, 23, 'center', 'Control rods'],
    pzr: [99, 23, 'center', 'Pressurizer'],
    sg: [154, 23, 'center', 'Steam generator'],
    core: [84, 196, 'left', 'Core'],
    pump: [129, 222, 'right', 'Coolant pump'],
    containment: [92, 250, 'center', 'Containment'],
    pool: [38, 259, 'center', 'Cooling pool'],
    dhrs: [150, 259, 'center', 'Passive cooling'],
    turbine: [252, 108, 'center', 'Turbine'],
    generator: [283, 97, 'center', 'Generator'],
    bypass: [236, 90, 'left', 'Bypass'],
    condenser: [226, 186, 'left', 'Condenser'],
    feedpump: [207, 196, 'left', 'Feed pump'],
    tower: [372, 213, 'center', 'Cooling tower'],
    town: [444, 189, 'center', 'Town']
  };

  function UI(app) {
    this.app = app;
    this.lastSeq = 0;
    this.ackSet = {};          // alarms acknowledged while still on
    this.prevAlarms = {};
    this.card = null;
    this.cardPart = null;
    this.briefTimer = 0;
    this.bind();
    this.buildLabels();
    this.buildAnnunciator();
    this.buildScenarios();
  }

  UI.prototype.bind = function () {
    const ui = this, app = this.app;
    const S = function () { return app.s; };

    // Speed, labels and sound.
    document.querySelectorAll('[data-speed]').forEach(function (b) {
      b.addEventListener('click', function () { app.setSpeed(+b.dataset.speed); });
    });
    $('btn-labels').addEventListener('click', function () { app.setLabels(!app.labels); });
    $('btn-neutrons').addEventListener('click', function () {
      app.neutrons = !app.neutrons;
      $('btn-neutrons').setAttribute('aria-pressed', String(app.neutrons));
    });
    $('btn-sound').addEventListener('click', function () { app.setSound(!app.sound); });
    $('btn-scenarios').addEventListener('click', function () { ui.openScenarios(); });

    // Reactor.
    $('c-rods').addEventListener('input', function (e) {
      const s = S();
      s.in.rodTarget = +e.target.value / 100;
      s.in.rodAuto = false;
    });
    $('c-rod-auto').addEventListener('change', function (e) { S().in.rodAuto = e.target.checked; });
    $('c-sd').addEventListener('change', function (e) {
      const s = S();
      s.in.shutdownOut = e.target.checked;
      Sim.log(s, e.target.checked ? 'Shutdown rods withdrawing' : 'Shutdown rods inserting');
    });
    $('c-boron').addEventListener('input', function (e) { S().in.boronTarget = +e.target.value; });
    $('c-protect').addEventListener('change', function (e) {
      if (e.target.checked) { Sim.setProtection(S(), true); return; }
      e.target.checked = true;
      ui.askProtectionOff();
    });
    $('btn-reset-trip').addEventListener('click', function () { Sim.resetTrip(S()); });

    // Plant.
    $('c-pump').addEventListener('input', function (e) { S().in.pumpSet = +e.target.value / 100; });
    $('c-pump-on').addEventListener('change', function (e) {
      const s = S();
      s.in.pumpOn = e.target.checked;
      Sim.log(s, e.target.checked ? 'Primary pump started' : 'Primary pump tripped by hand', e.target.checked ? 'info' : 'warn');
    });
    $('c-pzr-auto').addEventListener('change', function (e) { S().in.pzrAuto = e.target.checked; });
    [['c-heaters', 'heaters'], ['c-spray', 'spray'], ['c-porv', 'porv']].forEach(function (p) {
      $(p[0]).addEventListener('click', function () {
        const s = S();
        s.in[p[1]] = !s.in[p[1]];
        if (p[1] === 'porv') Sim.log(s, s.in.porv ? 'Pressurizer relief valve opened by hand' : 'Pressurizer relief valve closed', s.in.porv ? 'warn' : 'info');
      });
    });
    $('c-feed').addEventListener('input', function (e) {
      const s = S();
      s.in.feedSet = +e.target.value / 100;
      s.in.feedAuto = false;
    });
    $('c-feed-auto').addEventListener('change', function (e) {
      const s = S();
      s.in.feedAuto = e.target.checked;
      if (!e.target.checked) s.in.feedSet = clamp(s.wFeed / C.W_STEAM_FULL, 0, 1.2);
    });
    $('c-feed-on').addEventListener('change', function (e) {
      const s = S();
      s.in.feedPumpOn = e.target.checked;
      Sim.log(s, e.target.checked ? 'Feed pump started' : 'Feed pump tripped by hand', e.target.checked ? 'info' : 'warn');
    });

    // Grid.
    $('c-load').addEventListener('input', function (e) { S().in.loadDemand = +e.target.value; });
    $('btn-trip-turbine').addEventListener('click', function () { Sim.tripTurbine(S(), 'Manual trip'); });
    $('btn-reset-turbine').addEventListener('click', function () { Sim.resetTurbine(S()); });
    $('c-cooling').addEventListener('input', function (e) { S().in.cooling = +e.target.value / 100; });
    $('c-grid').addEventListener('change', function (e) { Sim.setOffsitePower(S(), e.target.checked); });

    // Alarms.
    $('btn-ack').addEventListener('click', function () { ui.acknowledge(); });
    $('s-alarms').addEventListener('click', function () { ui.selectTab('tab-alarms', true); });

    // SCRAM: lift the cover, then press.
    const scram = $('scram'), cover = $('scram-cover'), btn = $('scram-btn');
    let coverTimer = 0;
    function closeCover() {
      scram.classList.remove('open');
      cover.setAttribute('aria-expanded', 'false');
      btn.tabIndex = -1;
    }
    cover.addEventListener('click', function () {
      scram.classList.add('open');
      cover.setAttribute('aria-expanded', 'true');
      btn.tabIndex = 0;
      btn.focus();
      clearTimeout(coverTimer);
      coverTimer = setTimeout(closeCover, 6000);
    });
    btn.addEventListener('click', function () {
      if (!scram.classList.contains('open')) return;
      Sim.scram(S());
      clearTimeout(coverTimer);
      closeCover();
    });

    // Tabs.
    const tabs = Array.prototype.slice.call(document.querySelectorAll('[role="tab"]'));
    tabs.forEach(function (t, i) {
      t.addEventListener('click', function () { ui.selectTab(t.id); });
      t.addEventListener('keydown', function (e) {
        let j = -1;
        if (e.key === 'ArrowRight') j = (i + 1) % tabs.length;
        else if (e.key === 'ArrowLeft') j = (i - 1 + tabs.length) % tabs.length;
        else if (e.key === 'Home') j = 0;
        else if (e.key === 'End') j = tabs.length - 1;
        if (j < 0) return;
        e.preventDefault();
        ui.selectTab(tabs[j].id);
        tabs[j].focus();
      });
    });

    // Landscape phones: the desk is a drawer.
    $('drawer-handle').addEventListener('click', function () {
      const open = !$('desk').classList.contains('open');
      $('desk').classList.toggle('open', open);
      $('drawer-handle').setAttribute('aria-expanded', String(open));
    });

    // Damage screen.
    $('damage-retry').addEventListener('click', function () { app.start(app.scenario); });
    $('damage-inspect').addEventListener('click', function () { $('damage').hidden = true; });

    // Keys: space pauses, Escape closes things.
    document.addEventListener('keydown', function (e) {
      const tag = (e.target.tagName || '').toLowerCase();
      if (e.key === 'Escape') { ui.closeCard(); ui.hideBrief(); return; }
      if (e.key === ' ' && tag !== 'input' && tag !== 'button' && tag !== 'select' && tag !== 'textarea') {
        e.preventDefault();
        app.togglePause();
      }
    });
  };

  UI.prototype.selectTab = function (id, scroll) {
    document.querySelectorAll('[role="tab"]').forEach(function (t) {
      const on = t.id === id;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      $(t.getAttribute('aria-controls')).hidden = !on;
    });
    if (scroll) {
      const desk = $('desk');
      if (desk.classList.contains('open') || getComputedStyle(desk).position === 'fixed') {
        desk.classList.add('open');
        $('drawer-handle').setAttribute('aria-expanded', 'true');
      } else {
        const r = desk.getBoundingClientRect();
        const stage = document.querySelector('.stage');
        const pinned = getComputedStyle(stage).position === 'sticky' ? stage.getBoundingClientRect().height : 0;
        if (r.top < pinned || r.top > window.innerHeight - 120) window.scrollBy({ top: r.top - pinned - 8, behavior: 'smooth' });
      }
    }
  };

  UI.prototype.askProtectionOff = function () {
    const app = this.app, d = $('protect-dialog');
    if (!d.showModal) {
      Sim.setProtection(app.s, false);
      return;
    }
    d.returnValue = '';
    d.showModal();
    d.addEventListener('close', function once() {
      d.removeEventListener('close', once);
      if (d.returnValue === 'off') Sim.setProtection(app.s, false);
    });
  };

  // ---------------------------------------------------------------------------
  // Scenarios and briefings.

  UI.prototype.buildScenarios = function () {
    const ui = this, list = $('scenario-list');
    Scenarios.LIST.forEach(function (sc) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.id = sc.id;
      if (sc.sandbox) b.classList.add('sandbox');
      const n = document.createElement('span');
      n.className = 'sc-name';
      n.textContent = sc.name;
      const t = document.createElement('span');
      t.className = 'sc-brief';
      t.textContent = sc.brief[0];
      b.appendChild(n);
      b.appendChild(t);
      b.addEventListener('click', function () {
        $('scenarios').close();
        ui.app.start(sc.id);
      });
      li.appendChild(b);
      list.appendChild(li);
    });
  };

  UI.prototype.openScenarios = function () {
    const d = $('scenarios'), app = this.app;
    d.querySelectorAll('.scenario-list button').forEach(function (b) {
      b.classList.toggle('current', b.dataset.id === app.scenario);
      b.setAttribute('aria-current', b.dataset.id === app.scenario ? 'true' : 'false');
    });
    if (d.showModal) d.showModal(); else d.setAttribute('open', '');
  };

  // `goal` is the achievement Try it was pressed for: it heads the briefing,
  // which then stays up until dismissed.
  UI.prototype.showBrief = function (sc, goal) {
    const box = $('brief');
    box.textContent = '';
    if (goal) {
      const g = document.createElement('p');
      g.className = 'brief-goal';
      const bright = root.ReactorAchievementsUI && root.ReactorAchievementsUI.BRIGHT[goal.group];
      if (bright) g.style.setProperty('--b', bright);
      const k = document.createElement('span');
      k.className = 'brief-goal-k';
      k.textContent = 'Goal';
      const n = document.createElement('strong');
      n.textContent = goal.name;
      g.appendChild(k);
      g.appendChild(n);
      g.appendChild(document.createTextNode(' ' + goal.hint));
      box.appendChild(g);
    }
    const h = document.createElement('h2');
    h.textContent = sc.name;
    box.appendChild(h);
    sc.brief.forEach(function (line) {
      const p = document.createElement('p');
      p.textContent = line;
      box.appendChild(p);
    });
    const row = document.createElement('div');
    row.className = 'brief-actions';
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'btn small primary';
    ok.textContent = 'Got it';
    const ui = this;
    ok.addEventListener('click', function () { ui.hideBrief(); });
    const other = document.createElement('button');
    other.type = 'button';
    other.className = 'btn small';
    other.textContent = 'Other scenarios';
    other.addEventListener('click', function () { ui.hideBrief(); ui.openScenarios(); });
    row.appendChild(ok);
    row.appendChild(other);
    box.appendChild(row);
    box.hidden = false;
    this.watch = sc.watch === 'power' ? 'core' : sc.watch;
    this.setWatchLabel(this.watch);
    clearTimeout(this.briefTimer);
    if (!goal) this.briefTimer = setTimeout(function () { ui.hideBrief(); }, 16000);
  };

  // The goal's been reached: take it off the briefing, which then goes the
  // way a plain one does.
  UI.prototype.dropGoal = function () {
    const g = document.querySelector('#brief .brief-goal');
    if (!g) return;
    g.parentNode.removeChild(g);
    const ui = this;
    clearTimeout(this.briefTimer);
    this.briefTimer = setTimeout(function () { ui.hideBrief(); }, 16000);
  };

  UI.prototype.hideBrief = function () {
    $('brief').hidden = true;
    this.watch = null;
    this.setWatchLabel(null);
    clearTimeout(this.briefTimer);
  };

  // ---------------------------------------------------------------------------
  // Labels and inspect cards.

  UI.prototype.buildLabels = function () {
    const box = $('labels');
    this.labelEls = {};
    const ui = this;
    Art.PARTS.forEach(function (p) {
      const at = LABELS[p.id];
      if (!at) return;
      const el = document.createElement('span');
      el.className = 'label l-' + at[2];
      el.textContent = at[3];
      el.style.left = (at[0] / Art.W * 100) + '%';
      el.style.top = (at[1] / Art.H * 100) + '%';
      box.appendChild(el);
      ui.labelEls[p.id] = el;
    });
  };
  UI.prototype.setWatchLabel = function (id) {
    for (const k in this.labelEls) this.labelEls[k].classList.toggle('watch', k === id);
  };
  UI.prototype.setLabels = function (on) {
    $('labels').classList.toggle('off', !on);
    $('btn-labels').setAttribute('aria-pressed', String(on));
  };

  // Leader lines from each label to its part, for the renderer.
  UI.prototype.leaders = function () {
    const out = [];
    Art.PARTS.forEach(function (p) {
      const at = LABELS[p.id];
      if (at && p.anchor) out.push({ id: p.id, from: [at[0], at[1]], to: p.anchor });
    });
    return out;
  };

  // The part under a point in scene pixels: the smallest box that holds it.
  UI.prototype.partAt = function (x, y) {
    let best = null, area = Infinity;
    Art.PARTS.forEach(function (p) {
      const b = p.box;
      if (x >= b[0] && x < b[0] + b[2] && y >= b[1] && y < b[1] + b[3] && b[2] * b[3] < area) { best = p; area = b[2] * b[3]; }
    });
    return best;
  };

  UI.prototype.openCard = function (part, px, py) {
    const card = $('card');
    this.cardPart = part.id;
    card.textContent = '';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'card-close';
    close.setAttribute('aria-label', 'Close');
    close.textContent = '×';
    const ui = this;
    close.addEventListener('click', function () { ui.closeCard(); });
    const h = document.createElement('h2');
    h.id = 'card-title';
    h.textContent = part.name;
    const p = document.createElement('p');
    p.textContent = INFO[part.id] ? INFO[part.id].text : '';
    const dl = document.createElement('dl');
    this.cardValues = dl;
    const actions = document.createElement('div');
    actions.className = 'card-actions';
    this.cardActions = actions;
    card.appendChild(close);
    card.appendChild(h);
    card.appendChild(p);
    card.appendChild(dl);
    card.appendChild(actions);
    card.hidden = false;
    this.fillCard(true);
    // Beside the part, inside the scene.
    const scene = $('scene');
    const sw = scene.clientWidth, sh = scene.clientHeight;
    const cw = card.offsetWidth, ch = card.offsetHeight;
    const k = sw / Art.W;
    let left = (part.box[0] + part.box[2]) * k + 8;
    if (left + cw > sw - 4) left = part.box[0] * k - cw - 8;
    if (left < 4) left = Math.max(4, Math.min(sw - cw - 4, px * k - cw / 2));
    let top = py * k - ch / 2;
    top = Math.max(4, Math.min(sh - ch - 4, top));
    card.style.left = left + 'px';
    card.style.top = top + 'px';
    close.focus({ preventScroll: true });
  };

  UI.prototype.fillCard = function (rebuildActions) {
    if (!this.cardPart) return;
    const info = INFO[this.cardPart], s = this.app.s;
    if (!info) return;
    const dl = this.cardValues;
    const rows = info.values(s);
    if (dl.childElementCount !== rows.length * 2) {
      dl.textContent = '';
      rows.forEach(function () {
        dl.appendChild(document.createElement('dt'));
        dl.appendChild(document.createElement('dd'));
      });
    }
    rows.forEach(function (r, i) {
      dl.children[i * 2].textContent = r[0];
      dl.children[i * 2 + 1].textContent = r[1];
    });
    if (!info.actions) return;
    const acts = info.actions(s, this);
    const sig = acts.map(function (a) { return a[0] + (a[2] ? '!' : ''); }).join('|');
    if (!rebuildActions && sig === this.cardSig) return;
    this.cardSig = sig;
    const box = this.cardActions, ui = this;
    box.textContent = '';
    acts.forEach(function (a) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn small';
      b.textContent = a[0];
      b.disabled = !!a[2];
      b.addEventListener('click', function () { a[1](); ui.fillCard(true); });
      box.appendChild(b);
    });
  };

  UI.prototype.closeCard = function () {
    if (!this.cardPart) return;
    this.cardPart = null;
    $('card').hidden = true;
  };

  // ---------------------------------------------------------------------------
  // Alarm panel and event log.

  UI.prototype.buildAnnunciator = function () {
    const list = $('annunciator');
    this.lamps = {};
    const ui = this;
    Sim.ALARMS.forEach(function (a) {
      const li = document.createElement('li');
      li.textContent = a[1];
      li.dataset.id = a[0];
      list.appendChild(li);
      ui.lamps[a[0]] = li;
    });
  };

  UI.prototype.acknowledge = function () {
    const s = this.app.s;
    for (const id in s.alarms) if (s.alarms[id]) this.ackSet[id] = true;
    this.updateAlarms(s);
  };

  UI.prototype.updateAlarms = function (s) {
    let count = 0, unacked = 0, fresh = false;
    const first = s.tripCause ? FIRST_OUT[s.tripCause] : null;
    for (const id in this.lamps) {
      const on = !!s.alarms[id];
      if (!on) delete this.ackSet[id];
      if (on) count++;
      if (on && !this.prevAlarms[id]) fresh = true;
      const flash = on && !this.ackSet[id];
      if (flash) unacked++;
      const li = this.lamps[id];
      li.classList.toggle('on', on);
      li.classList.toggle('red', on && !!RED[id]);
      li.classList.toggle('first', on && id === first);
      li.classList.toggle('flash', flash && !this.app.reduced);
      this.prevAlarms[id] = on;
    }
    $('btn-ack').disabled = unacked === 0;
    $('s-alarm-count').textContent = String(count);
    const strip = $('s-alarms');
    strip.classList.toggle('active', count > 0);
    strip.classList.toggle('trip', s.tripped);
    strip.classList.toggle('flash', unacked > 0 && !this.app.reduced);
    strip.setAttribute('aria-label', count + ' alarm' + (count === 1 ? '' : 's') + (unacked ? ', ' + unacked + ' new' : ''));
    $('tab-alarms').classList.toggle('attn', unacked > 0);
    this.unacked = unacked;
    return fresh;
  };

  UI.prototype.updateLog = function (s) {
    const list = $('log');
    if (!s.events.length) {
      if (!list.firstChild) {
        const li = document.createElement('li');
        li.className = 'empty';
        li.textContent = 'Nothing yet.';
        list.appendChild(li);
      }
      return;
    }
    let added = false;
    for (let i = 0; i < s.events.length; i++) {
      const ev = s.events[i];
      if (ev.seq <= this.lastSeq) continue;
      if (!added) {
        const empty = list.querySelector('.empty');
        if (empty) empty.remove();
      }
      const li = document.createElement('li');
      const t = document.createElement('time');
      t.textContent = shortClock(ev.t);
      const m = document.createElement('span');
      m.className = ev.level;
      m.textContent = ev.msg;
      li.appendChild(t);
      li.appendChild(m);
      list.insertBefore(li, list.firstChild);
      this.lastSeq = ev.seq;
      added = true;
    }
    while (list.children.length > 80) list.removeChild(list.lastChild);
  };

  // ---------------------------------------------------------------------------
  // Readouts and controls, about ten times a second.

  function setText(id, v) {
    const el = $(id);
    if (el.textContent !== v) el.textContent = v;
  }
  function setClass(id, cls, on) { $(id).classList.toggle(cls, on); }
  function busy(el) { return document.activeElement === el && el.matches(':active, :focus-visible'); }
  function sync(id, value) {
    const el = $(id);
    if (el._dragging) return;
    if (String(el.value) !== String(value)) el.value = value;
  }
  function check(id, v) { const el = $(id); if (el.checked !== v) el.checked = v; }
  function press(id, v) { $(id).setAttribute('aria-pressed', String(v)); }

  UI.prototype.update = function (s) {
    const inp = s.in;
    // Reactor.
    sync('c-rods', ((inp.rodAuto || s.tripped ? s.rodX : inp.rodTarget) * 100).toFixed(1));
    const rodsMoving = Math.abs(inp.rodTarget - s.rodX) > 0.004 && !inp.rodAuto && !s.tripped;
    setText('o-rods', Math.round(s.rodX * 100) + '% out' + (rodsMoving ? ' → ' + Math.round(inp.rodTarget * 100) + '%' : ''));
    check('c-rod-auto', inp.rodAuto);
    $('c-rod-auto').disabled = s.tripped || s.rodY < 0.999;
    $('c-rods').disabled = s.tripped;
    let hint;
    if (s.tripped) hint = 'Tripped: every rod dropped in';
    else if (s.rodY < 0.999) hint = 'Shutdown rods must be out first';
    else if (inp.rodAuto) hint = 'Holding coolant at ' + Math.round(s.tRef) + ' °C';
    else hint = 'Manual';
    setText('h-rods', hint);
    check('c-sd', inp.shutdownOut);
    $('c-sd').disabled = s.tripped || !inp.offsitePower;
    setText('o-sd', s.rodY > 0.999 ? 'Out' : s.rodY < 0.001 ? 'In' : Math.round(s.rodY * 100) + '%');
    sync('c-boron', inp.boronTarget);
    setText('o-boron', Math.round(s.boron) + ' ppm' + (Math.abs(s.boron - inp.boronTarget) > 2 ? ' → ' + inp.boronTarget : ''));
    check('c-protect', inp.protection);
    setText('o-protect', inp.protection ? 'On' : 'Off');
    setClass('o-protect', 'warn', !inp.protection);
    document.querySelector('.ctl-protect').classList.toggle('off', !inp.protection);
    $('btn-reset-trip').disabled = !Sim.canResetTrip(s);

    // Readouts: reactor.
    setText('r-flux', powerText(s.nFiss));
    const pos = clamp((Math.log(Math.max(s.nFiss, 1e-12)) / Math.LN10 + 8) / 8, 0, 1.05);
    $('logmeter-fill').style.width = (pos / 1.05 * 100).toFixed(2) + '%';
    setClass('logmeter-fill', 'hot', s.nFiss > 1.05);
    setText('r-heat', num(s.mwt, s.mwt < 10 ? 2 : 1) + ' MW');
    const pcm = s.rho / C.PCM;
    setText('r-rho', (pcm > 0.5 ? '+' : '') + num(Math.abs(pcm) < 0.5 ? 0 : pcm) + ' pcm');
    let badge, cls;
    if (pcm >= C.BETA / C.PCM) { badge = 'Prompt critical'; cls = 'prompt'; }
    else if (pcm > 15) { badge = 'Supercritical'; cls = 'super'; }
    else if (pcm < -15) { badge = 'Subcritical'; cls = 'sub'; }
    else { badge = 'Critical'; cls = 'crit'; }
    const b = $('r-crit');
    if (b.textContent !== badge) { b.textContent = badge; b.className = 'badge ' + cls; }
    const per = s.period;
    setText('r-period', !isFinite(per) || Math.abs(per) > 9999 ? '∞' : (per > 0 ? '+' : MINUS) + Math.abs(per).toFixed(Math.abs(per) < 100 ? 1 : 0) + ' s');
    $('r-period').className = 'ro-v' + (per > 0 && per < 10 ? ' danger' : per > 0 && per < 30 ? ' warn' : '');
    setText('r-fuel', thousands(s.tFuel) + ' °C');
    $('r-fuel').className = 'ro-v' + (s.tPeak > 2400 || s.tClad > 900 ? ' danger' : s.tPeak > 2000 ? ' warn' : '');
    setText('r-fuel-sub', 'Centre ' + thousands(s.tPeak) + ' °C · cladding ' + thousands(s.tClad) + ' °C');

    // Plant.
    sync('c-pump', Math.round(inp.pumpSet * 100));
    setText('o-pump', Math.round(s.pumpSpeed * 100) + '%');
    check('c-pump-on', inp.pumpOn);
    setText('h-pump', s.pumpSpeed < 0.05 && s.flowFrac > 0.005 ? 'Natural circulation ' + num(s.flowFrac * 100, 1) + '%' : 'Flow ' + num(s.flowFrac * 100, 1) + '%');
    check('c-pzr-auto', inp.pzrAuto);
    $('c-heaters').disabled = inp.pzrAuto;
    $('c-spray').disabled = inp.pzrAuto;
    press('c-heaters', inp.pzrAuto ? s.heater > 0.5 : inp.heaters);
    press('c-spray', inp.pzrAuto ? s.spray > 0.05 : inp.spray);
    press('c-porv', inp.porv || s.porvOpen);
    setText('o-pzr', s.pP.toFixed(1) + ' bar');
    sync('c-feed', Math.round((inp.feedAuto ? clamp(s.wFeed / C.W_STEAM_FULL, 0, 1.2) : inp.feedSet) * 100));
    $('c-feed').disabled = false;
    setText('o-feed', Math.round(s.wFeed / C.W_STEAM_FULL * 100) + '%');
    check('c-feed-auto', inp.feedAuto);
    check('c-feed-on', inp.feedPumpOn);
    setText('r-thot', Math.round(s.tHot) + ' °C');
    setText('r-tcold', Math.round(s.tCold) + ' °C');
    setText('r-tavg', num(s.tAvg, 1) + ' °C');
    setText('r-tref', 'Target ' + num(s.tRef, 1) + ' °C');
    setText('r-press', s.pP.toFixed(1) + ' bar');
    $('r-press').className = 'ro-v' + (s.pP > 148 || s.pP < 127 ? ' danger' : s.pP > 145 || s.pP < 130 ? ' warn' : '');
    setText('r-pzr-level', 'Pressurizer ' + Math.round(s.pzrLevel * 100) + '% full');
    setText('r-flow', num(s.flowFrac * 100, 1) + '%');
    setText('r-dnb', s.dnbr >= 9.9 ? '>9.9' : s.dnbr.toFixed(2));
    $('r-dnb').className = 'ro-v' + (s.dnbr < 1 ? ' danger' : s.dnbr < 1.3 ? ' warn' : '');
    setText('r-sg', Math.round(s.sgLevel * 100) + '%');
    $('r-sg').className = 'ro-v' + (s.sgLevel < 0.2 ? ' danger' : s.sgLevel < 0.3 ? ' warn' : '');
    setText('r-steam', 'Level · steam ' + s.pS.toFixed(1) + ' bar');
    setText('r-pool', num(s.tPool, 1) + ' °C');
    setText('r-pool-sub', thousands(s.poolMass / 1000) + ' t of water' + (s.dhrsOn ? ', taking ' + num(s.qDhrs / 1e6, 2) + ' MW' : ''));

    // Grid.
    sync('c-load', Math.round(inp.loadDemand));
    setText('o-load', Math.round(inp.loadDemand) + ' MWe');
    $('btn-trip-turbine').disabled = s.turbineTripped;
    $('btn-reset-turbine').disabled = !Sim.canResetTurbine(s);
    let th;
    if (s.turbineTripped) th = s.turbineCause === 'Off line' ? 'Off line' : 'Tripped: ' + s.turbineCause;
    else if (s.rpm < 2999) th = 'Rolling up: ' + thousands(s.rpm) + ' rpm';
    else th = 'On line, ' + num(s.mwe, 1) + ' MWe';
    setText('h-turbine', th);
    sync('c-cooling', Math.round(inp.cooling * 100));
    setText('o-cooling', Math.round(inp.cooling * 100) + '%');
    check('c-grid', inp.offsitePower);
    setText('o-grid', inp.offsitePower ? 'Connected' : 'Lost');
    setClass('o-grid', 'warn', !inp.offsitePower);
    setText('r-mwe', num(s.mwe, 1) + ' MWe');
    setText('r-demand', 'Town needs ' + s.demand + ' MWe');
    $('r-mwe-bar').style.width = clamp(s.mwe / s.demand * 100, 0, 100).toFixed(1) + '%';
    setText('r-rpm', thousands(s.rpm) + ' rpm');
    setText('r-cond', s.pCond.toFixed(3) + ' bar');
    $('r-cond').className = 'ro-v' + (!s.vacuumOk ? ' danger' : s.pCond > 0.2 ? ' warn' : '');
    setText('r-cond-sub', num(s.tCond, 1) + ' °C, ' + (s.vacuumOk ? 'vacuum good' : 'vacuum lost'));
    setText('r-qcond', num(s.qCond / 1e6, 1) + ' MW');
    setText('r-dhrs', s.dhrsOn ? num(s.qDhrs / 1e6, 2) + ' MW' : 'Standby');

    // Speed buttons: ×3600 waits for a shut-down reactor.
    $$('[data-speed]').forEach(function (b) { b.setAttribute('aria-pressed', String(+b.dataset.speed === (this.app.paused ? 0 : this.app.speed))); }, this);
    document.querySelector('[data-speed="3600"]').disabled = !Sim.quiet(s);

    this.fillCard(false);
    const fresh = this.updateAlarms(s);
    this.updateLog(s);
    return fresh;
  };
  function $$(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }

  // Cheap bits, every frame.
  UI.prototype.frame = function (s, speed) {
    setText('clock', clock(s.t));
    $('clock').classList.toggle('fast', speed > 1);
    setText('s-power', powerText(s.powerFrac).replace(/\.\d+%$/, function (m) { return s.powerFrac >= 0.1 ? '%' : m; }));
    setText('s-mwe', num(s.mwe, 1) + ' MWe');
  };

  // The calm screen at the end of the sandbox.
  UI.prototype.showDamage = function (s) {
    const d = s.damage;
    const what = d.kind === 'melt' ? 'the fuel at the centre of the core passed 2,800 °C and started to melt'
      : 'the fuel cladding passed 1,204 °C and started to break down';
    let text = 'At ' + shortClock(d.t) + ' ' + what + '. ';
    if (s.wouldTrip) {
      const trip = Sim.TRIPS.filter(function (t) { return t.id === s.wouldTrip; })[0];
      const early = Math.max(0, d.t - s.wouldTripT);
      text += 'With protection on, the ' + trip.label.toLowerCase() + ' trip (' + trip.setpoint + ') would have dropped the rods at ' +
        shortClock(s.wouldTripT) + ', ' + (early < 90 ? Math.round(early) + ' seconds' : Math.round(early / 60) + ' minutes') + ' earlier.';
    } else {
      text += 'None of the trips would have caught this one in time.';
    }
    $('damage-text').textContent = text;
    $('damage').hidden = false;
    $('damage-retry').focus({ preventScroll: true });
  };

  UI.prototype.reset = function (s) {
    this.lastSeq = 0;
    this.ackSet = {};
    this.prevAlarms = {};
    $('log').textContent = '';
    $('damage').hidden = true;
    this.closeCard();
    this.updateAlarms(s);
    for (const id in s.alarms) if (s.alarms[id]) { this.ackSet[id] = true; this.prevAlarms[id] = true; }
    this.update(s);
  };

  // A sentence for screen readers describing the scene.
  UI.prototype.describe = function (s) {
    let t = 'Reactor at ' + powerText(s.powerFrac) + ' power, making ' + num(s.mwe, 1) + ' megawatts of electricity. ';
    if (s.damage) t += 'The core is damaged. ';
    else if (s.tripped) t += 'Tripped: ' + (Sim.TRIP_LABELS[s.tripCause] || s.tripCause) + '. ';
    const n = Sim.ALARMS.filter(function (a) { return s.alarms[a[0]]; }).length;
    t += n ? n + ' alarm' + (n === 1 ? '' : 's') + ' on.' : 'No alarms.';
    return t;
  };

  root.ReactorUI = { UI: UI, INFO: INFO, LABELS: LABELS, clock: clock };
})(typeof window !== 'undefined' ? window : globalThis);
