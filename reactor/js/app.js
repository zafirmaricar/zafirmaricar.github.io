// Runs the page: a fixed 60 Hz simulation step, the speed controls, the
// pixel scaling, pointing at parts of the plant, and pausing when the tab
// is hidden.
(function () {
  'use strict';

  const Sim = window.ReactorSim, Scenarios = window.ReactorScenarios, Art = window.ReactorArt;
  const STEP = 1 / 60;

  const canvas = document.getElementById('plant');
  const ctx = canvas.getContext('2d', { alpha: false });
  const img = ctx.createImageData(Art.W, Art.H);
  const px = new Uint32Array(img.data.buffer);
  const sceneBox = document.getElementById('scene-box');
  const scene = document.getElementById('scene');

  const renderer = new window.ReactorRender.Renderer();
  const audio = new window.ReactorAudio();
  const trend = new window.ReactorTrend.TrendChart(document.getElementById('trend'), document.getElementById('trend-tip'), document.getElementById('trend-span'));
  const reducedQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

  function load(key, fallback) {
    try { const v = window.localStorage.getItem('reactor.' + key); return v === null ? fallback : v === '1'; } catch (e) { return fallback; }
  }
  function save(key, v) {
    try { window.localStorage.setItem('reactor.' + key, v ? '1' : '0'); } catch (e) { /* private mode */ }
  }
  function loadJSON(key) {
    try { return JSON.parse(window.localStorage.getItem('reactor.' + key)); } catch (e) { return null; }
  }

  const phone = window.matchMedia && window.matchMedia('(max-width: 699px)').matches;
  const app = {
    s: null,
    scenario: 'full',
    speed: 1,
    paused: false,
    labels: load('labels', !phone),
    sound: load('sound', true),
    reduced: !!(reducedQuery && reducedQuery.matches),
    neutrons: false,
    damageShown: false
  };
  const ui = new window.ReactorUI.UI(app);
  const leaders = ui.leaders();

  // Achievements, kept in this browser between visits.
  const Ach = window.ReactorAchievements;
  const tracker = new Ach.Tracker(loadJSON('achievements'));
  function saveAchievements() {
    try { window.localStorage.setItem('reactor.achievements', JSON.stringify(tracker.save())); } catch (e) { /* private mode */ }
  }
  const achUi = new window.ReactorAchievementsUI.AchievementsUI(app, tracker, saveAchievements);
  app.onAchievement = function () { audio.fanfare(); };
  app.onGoalDone = function () { ui.dropGoal(); };

  let acc = 0;

  app.setSpeed = function (v) {
    if (v === 0) app.paused = true;
    else {
      if (v >= 3600 && !Sim.quiet(app.s)) v = 60;
      app.speed = v;
      app.paused = false;
      if (app.s.damage) document.getElementById('damage').hidden = true;
    }
    syncSpeed();
  };
  app.togglePause = function () {
    app.paused = !app.paused;
    if (!app.paused && app.s.damage) document.getElementById('damage').hidden = true;
    syncSpeed();
  };
  function syncSpeed() {
    document.querySelectorAll('[data-speed]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(+b.dataset.speed === (app.paused ? 0 : app.speed)));
    });
  }
  app.setLabels = function (on) {
    app.labels = on;
    ui.setLabels(on);
    save('labels', on);
  };
  app.showGoal = function () { ui.showBrief(Scenarios.byId(app.scenario), achUi.goal); };
  app.setSound = function (on) {
    app.sound = on;
    audio.setOn(on);
    if (on) audio.start();
    document.getElementById('btn-sound').setAttribute('aria-pressed', String(on));
    save('sound', on);
  };

  let prevTripped = false;
  // `goalId` is the achievement Try it was pressed for. Restarting the same
  // scenario keeps the goal; picking another drops it.
  app.start = function (id, goalId) {
    const sc = Scenarios.byId(id);
    app.scenario = sc.id;
    app.s = Scenarios.start(sc.id);
    acc = 0;
    app.damageShown = false;
    app.paused = false;
    app.speed = 1;
    prevTripped = app.s.tripped;
    renderer.reset();
    trend.reset();
    ui.reset(app.s);
    tracker.startRun();
    const keep = achUi.goal && achUi.goal.scenario === sc.id ? achUi.goal : null;
    achUi.setGoal(goalId ? Ach.byId(goalId) : keep);
    ui.showBrief(sc, achUi.goal);
    syncSpeed();
    try {
      window.history.replaceState(null, '', sc.id === 'full' ? window.location.pathname + window.location.search : '#' + sc.id);
    } catch (e) { /* file:// */ }
  };

  // ---------------------------------------------------------------------------
  // Pixel scaling: whole-number device pixels when that fills at least 85% of
  // the room, otherwise nearest-neighbour to fit.

  function layout() {
    const dpr = window.devicePixelRatio || 1;
    const availW = sceneBox.clientWidth;
    const landscape = window.matchMedia('(max-height: 520px) and (orientation: landscape) and (max-width: 1099px)').matches;
    const narrow = window.matchMedia('(max-width: 699px)').matches;
    let maxH;
    if (landscape) maxH = sceneBox.clientHeight;
    else if (narrow) maxH = window.innerHeight * 0.48;
    else {
      const bar = document.querySelector('.bar').offsetHeight;
      const strip = document.getElementById('strip').offsetHeight;
      maxH = window.innerHeight - bar - strip - 48;
    }
    maxH = Math.max(maxH, 160);
    let w = Math.min(availW, maxH * Art.W / Art.H);
    const dev = w * dpr;
    const k = Math.floor(dev / Art.W + 1e-6);
    if (k >= 1 && k * Art.W >= 0.85 * dev) w = k * Art.W / dpr;
    w = Math.floor(w * dpr) / dpr;
    const h = w * Art.H / Art.W;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    scene.style.setProperty('--px', (w / Art.W).toFixed(4));
    // On phones the briefing sits above the desk instead of over the small scene.
    const brief = document.getElementById('brief');
    const home = narrow ? document.getElementById('desk') : scene;
    if (brief.parentNode !== home) home.insertBefore(brief, home.firstChild);
    if (ui.cardPart) ui.closeCard();
    trend.dirty = true;
  }
  let layoutQueued = false;
  function queueLayout() {
    if (layoutQueued) return;
    layoutQueued = true;
    window.requestAnimationFrame(function () { layoutQueued = false; layout(); });
  }
  window.addEventListener('resize', queueLayout);
  window.addEventListener('orientationchange', queueLayout);
  if (window.ResizeObserver) new window.ResizeObserver(queueLayout).observe(sceneBox);

  // ---------------------------------------------------------------------------
  // Pointing at the plant: hover outlines a part, a tap opens its card, and
  // dragging the rods with a mouse moves them.

  let hoverPart = null, drag = null;
  function toScene(e) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width * Art.W, y: (e.clientY - r.top) / r.height * Art.H };
  }
  function rodsPart(p) { return p && (p.id === 'rods' || p.id === 'core'); }
  canvas.addEventListener('pointerdown', function (e) {
    const p = toScene(e);
    const part = ui.partAt(p.x, p.y);
    drag = { id: e.pointerId, x: p.x, y: p.y, part: part, moved: false, rod0: app.s.rodX, mouse: e.pointerType !== 'touch' };
    if (drag.mouse && rodsPart(part)) canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', function (e) {
    const p = toScene(e);
    if (drag && drag.id === e.pointerId) {
      if (Math.abs(p.y - drag.y) > 3 || Math.abs(p.x - drag.x) > 3) drag.moved = true;
      if (drag.moved && drag.mouse && rodsPart(drag.part) && !app.s.tripped) {
        const s = app.s;
        s.in.rodAuto = false;
        s.in.rodTarget = Math.max(0, Math.min(1, drag.rod0 - (p.y - drag.y) / 40));
      }
      return;
    }
    if (e.pointerType === 'mouse') {
      const part = ui.partAt(p.x, p.y);
      hoverPart = part ? part.id : null;
      canvas.style.cursor = rodsPart(part) ? 'ns-resize' : part ? 'pointer' : 'default';
    }
  });
  canvas.addEventListener('pointerup', function (e) {
    if (!drag || drag.id !== e.pointerId) return;
    const d = drag;
    drag = null;
    if (d.moved) return;
    const p = toScene(e);
    if (d.part && ui.cardPart !== d.part.id) ui.openCard(d.part, p.x, p.y);
    else ui.closeCard();
  });
  canvas.addEventListener('pointercancel', function () { drag = null; });
  canvas.addEventListener('pointerleave', function () { hoverPart = null; });
  document.addEventListener('pointerdown', function (e) {
    if (ui.cardPart && !e.target.closest('#card') && e.target !== canvas) ui.closeCard();
  });
  // Range inputs: don't fight a slider while it is being dragged.
  document.querySelectorAll('input[type="range"]').forEach(function (el) {
    el.addEventListener('pointerdown', function () { el._dragging = true; });
    el.addEventListener('pointerup', function () { el._dragging = false; });
    el.addEventListener('pointercancel', function () { el._dragging = false; });
    el.addEventListener('blur', function () { el._dragging = false; });
  });

  // Sound needs a first tap or key.
  function firstGesture() {
    if (app.sound) audio.start();
    document.removeEventListener('pointerdown', firstGesture, true);
    document.removeEventListener('keydown', firstGesture, true);
  }
  document.addEventListener('pointerdown', firstGesture, true);
  document.addEventListener('keydown', firstGesture, true);

  // ---------------------------------------------------------------------------
  // The loop, capped at 60 fps and stopped while the tab is hidden.

  const view = { reduced: app.reduced, labels: app.labels, highlight: null, alarm: false, shake: false, leaders: null };
  let raf = 0, last = 0, lastUi = 0, lastTrend = 0, lastDescribe = 0, shakeUntil = 0;

  function frame(now) {
    raf = window.requestAnimationFrame(frame);
    if (last && now - last < 1000 / 60 - 2) return;
    let dt = last ? (now - last) / 1000 : STEP;
    last = now;
    dt = Math.min(dt, 0.1);
    const s = app.s;

    if (!app.paused) {
      if (app.speed >= 3600) {
        if (Sim.quiet(s)) Sim.advance(s, 3600 * dt);
        else app.setSpeed(60);
      }
      if (app.speed < 3600) {
        acc += dt * app.speed;
        let n = 0;
        while (acc >= STEP && n < 800) {
          Sim.step(s, STEP);
          acc -= STEP;
          n++;
          if (s.damage) break;
        }
        if (n >= 800 || s.damage) acc = 0;
      }
    }

    if (s.tripped && !prevTripped) {
      audio.klaxon();
      shakeUntil = now + 450;
    }
    prevTripped = s.tripped;
    if (s.damage && !app.damageShown) {
      app.damageShown = true;
      app.paused = true;
      syncSpeed();
      ui.showDamage(s);
    }
    const fresh = tracker.check(s, Date.now());
    if (tracker.changed) saveAchievements();
    if (fresh.length) achUi.unlocked(fresh);
    else if (tracker.changed) achUi.refresh();

    view.reduced = app.reduced;
    view.labels = app.labels;
    view.neutrons = app.neutrons;
    view.leaders = app.labels ? leaders : null;
    view.highlight = ui.cardPart || ui.watch || hoverPart;
    view.alarm = ui.unacked > 0;
    view.shake = now < shakeUntil;
    renderer.draw(px, s, app.paused ? 0 : dt, view);
    ctx.putImageData(img, 0, 0);

    ui.frame(s, app.paused ? 0 : app.speed);
    if (now - lastUi > 100) {
      lastUi = now;
      if (ui.update(s) && !s.tripped) audio.chime();
    }
    trend.sample(s, app.speed);
    if (now - lastTrend > 150) { lastTrend = now; trend.draw(); }
    audio.update(s, !app.paused);
    if (now - lastDescribe > 4000) {
      lastDescribe = now;
      canvas.setAttribute('aria-label', 'Cross section of the plant. ' + ui.describe(s));
    }
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      window.cancelAnimationFrame(raf);
      raf = 0;
      audio.suspend();
    } else if (!raf) {
      last = 0;
      raf = window.requestAnimationFrame(frame);
      audio.resume();
    }
  });
  if (reducedQuery && reducedQuery.addEventListener) {
    reducedQuery.addEventListener('change', function (e) { app.reduced = e.matches; });
  }

  // Start: a scenario named in the address, or full power.
  ui.setLabels(app.labels);
  document.getElementById('btn-sound').setAttribute('aria-pressed', String(app.sound));
  audio.setOn(app.sound);
  const fromHash = (window.location.hash || '').slice(1);
  app.start(Scenarios.LIST.some(function (sc) { return sc.id === fromHash; }) ? fromHash : 'full');
  layout();
  raf = window.requestAnimationFrame(frame);
  window.ReactorApp = app;
})();
