(function () {
  'use strict';

  const pages = document.querySelectorAll('[data-page]');
  const tabs = document.querySelectorAll('[data-tab]');
  let onLayoutChange = function () {};
  let onPageChange = function () {};

  function showPage() {
    const id = (location.hash || '#home').slice(1);
    const target = document.querySelector('[data-page="' + id + '"]') ? id : 'home';
    pages.forEach(function (p) { p.hidden = p.dataset.page !== target; });
    tabs.forEach(function (t) {
      const on = t.dataset.tab === target;
      t.classList.toggle('active', on);
      if (on) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
    });
    window.scrollTo(0, 0);
    onPageChange();
    onLayoutChange();
  }

  document.getElementById('year').textContent = new Date().getFullYear();
  // Without an inline PDF viewer the resume tab shows an image of the page.
  // Phones count too: iOS paints a PDF <object> as a static, squashed image.
  if (navigator.pdfViewerEnabled === false || window.matchMedia('(pointer: coarse)').matches) {
    document.querySelector('.resume').classList.add('no-pdf');
  }
  window.addEventListener('hashchange', showPage);
  showPage();

  // ---- Simulation -------------------------------------------------------
  // The canvas sits in a page-sized layer and is moved to the viewport every
  // frame (plus some overscan above and below). The browser scrolls it along
  // with the text, so the stone stays under its text during touch scrolling
  // even when a frame is late.
  const OVERSCAN = 120;
  const canvas = document.getElementById('sim');
  const simLayer = document.getElementById('sim-layer');
  canvas.style.height = 'calc(100vh + ' + 2 * OVERSCAN + 'px)';
  const small = window.innerWidth < 700;
  const maxParticles = small ? 1200 : 2600;
  const renderer = window.FluidRenderer && window.FluidRenderer.create(canvas, { maxParticles: maxParticles });
  if (!renderer) return; // CSS fallback keeps the panels readable
  document.body.classList.add('sim-on');

  // Canvas size in CSS px. 100vh is the viewport with the browser toolbar
  // hidden, so it doesn't change while a phone's toolbar slides in and out.
  let canvasW = 0, canvasH = 0;
  function measure() { canvasW = canvas.clientWidth; canvasH = canvas.clientHeight; }
  measure();
  window.addEventListener('resize', measure);
  if (window.ResizeObserver) new ResizeObserver(measure).observe(canvas);

  const sim = new window.FluidSim({ maxParticles: maxParticles });
  window.portfolioSim = sim; // handy for poking at it from the console
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let raining = !reducedMotion;
  let rainCarry = 0;
  let rocks = [];

  const chunkLayer = document.getElementById('chunks');
  const fracture = new window.Fracture({
    layer: chunkLayer,
    renderer: renderer,
    onDamage: function () { buildRocks(); },
  });
  window.portfolioFracture = fracture;

  const ducks = new window.Ducks({ size: small ? 42 : 56 });
  window.portfolioDucks = ducks;

  const tnt = new window.Tnt({
    layer: chunkLayer,
    rocks: function () { return rocks; },
    radius: small ? 100 : 140,
    onBlast: function (x, y, r) {
      fracture.blast(rocks, x, y, r);
      sim.blast(x, y, r * 1.8, 12);
      ducks.blast(x, y, r * 2, 10);
    },
  });
  window.portfolioTnt = tnt;

  function docWidth() { return document.documentElement.clientWidth; }
  function docHeight() { return document.documentElement.scrollHeight; }

  let needsRender = true;

  function buildRocks() {
    const sx = window.scrollX, sy = window.scrollY;
    rocks = [];
    document.querySelectorAll('.rock:not(.chunk)').forEach(function (el, i) {
      if (!el.getClientRects().length) return; // hidden page
      const r = el.getBoundingClientRect();
      const seed = window.Rocks.hashString(el.textContent.slice(0, 60)) + i;
      const rock = window.Rocks.makeRock(r.left + sx, r.top + sy, r.width, r.height, seed, { pond: el.classList.contains('pond') });
      fracture.decorate(rock, el, r.left + sx, r.top + sy);
      rocks.push(rock);
    });
    tnt.layout(rocks);
    sim.setRocks(rocks);
    sim.removeInsideRocks();
    ducks.removeInsideRocks(rocks);
    renderer.setRocks(rocks);
    needsRender = true;
    chunkLayer.style.height = simLayer.style.height = '0';
    const dh = docHeight();
    chunkLayer.style.height = simLayer.style.height = dh + 'px';
  }

  let rebuildTimer = 0;
  onLayoutChange = function () {
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(buildRocks, 60);
  };
  // Rebuild at once so the old tab's rocks are never drawn over the new one.
  onPageChange = function () { fracture.clearChunks(); tnt.clear(); buildRocks(); };
  buildRocks();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(onLayoutChange);
  window.addEventListener('load', onLayoutChange);
  window.addEventListener('resize', onLayoutChange);
  if (window.ResizeObserver) new ResizeObserver(onLayoutChange).observe(document.querySelector('.wrap'));

  // ---- Input --------------------------------------------------------------
  let lastPointer = null;
  function pointerAt(clientX, clientY) {
    const x = clientX + window.scrollX, y = clientY + window.scrollY;
    const ptr = sim.pointer;
    ptr.dx = lastPointer ? Math.max(-20, Math.min(20, x - lastPointer.x)) : 0;
    ptr.dy = lastPointer ? Math.max(-20, Math.min(20, y - lastPointer.y)) : 0;
    ptr.x = x; ptr.y = y; ptr.active = true;
    lastPointer = { x: x, y: y };
  }
  function pointerGone() { sim.pointer.active = false; lastPointer = null; }
  window.addEventListener('pointermove', function (e) { pointerAt(e.clientX, e.clientY); }, { passive: true });
  document.documentElement.addEventListener('pointerleave', pointerGone);
  window.addEventListener('blur', pointerGone);
  window.addEventListener('pointerup', function (e) { if (e.pointerType !== 'mouse') pointerGone(); });
  // A touch that turns into a scroll ends with pointercancel and no
  // pointerup, and pointer events stop for the rest of the scroll. Touch
  // events keep coming, so a finger dragged through the water still pushes it.
  window.addEventListener('pointercancel', pointerGone);
  window.addEventListener('touchmove', function (e) {
    const t = e.touches[0];
    if (t) pointerAt(t.clientX, t.clientY);
  }, { passive: true });
  window.addEventListener('touchend', function (e) { if (!e.touches.length) pointerGone(); });
  window.addEventListener('touchcancel', pointerGone);

  // These listen on <html> rather than window: iOS Safari only turns a tap
  // into a click when an element on the tapped path has a click listener.
  const root = document.documentElement;

  // A double click on stone would select a word, which the click handler
  // treats as text selection and ignores; keep the second hit a hit.
  root.addEventListener('mousedown', function (e) {
    if (e.detail < 2 || e.button !== 0 || e.target.closest('a, button, input, iframe, object, .hud')) return;
    const x = e.clientX + window.scrollX, y = e.clientY + window.scrollY;
    if (rocks.some(function (r) { return window.Rocks.solidAt(r, x, y); })) e.preventDefault();
  });

  // Click a duck to make it hop, a rock to crack it (or, with TNT on, to
  // plant a bomb), open space to splash.
  let tntOn = false;
  root.addEventListener('click', function (e) {
    if (e.button !== 0 || glLost) return;
    if (e.target.closest('a, button, input, iframe, object, .hud')) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return; // the user was selecting text
    const x = e.clientX + window.scrollX, y = e.clientY + window.scrollY;
    if (ducks.hit(x, y)) return;
    if (!(tntOn ? tnt.place(rocks, x, y) : fracture.hit(rocks, x, y))) sim.splash(x, y, 45);
  });

  // ---- HUD ----------------------------------------------------------------
  const rainBtn = document.getElementById('rain-toggle');
  function syncRainButton() {
    rainBtn.textContent = raining ? 'Pause rain' : 'Start rain';
    rainBtn.setAttribute('aria-pressed', String(raining));
  }
  rainBtn.addEventListener('click', function () { raining = !raining; syncRainButton(); });
  syncRainButton();
  document.getElementById('repair').addEventListener('click', function () { tnt.clear(); fracture.repair(); });
  const tntBtn = document.getElementById('tnt');
  tntBtn.addEventListener('click', function () {
    tntOn = !tntOn;
    tntBtn.setAttribute('aria-pressed', String(tntOn));
    root.classList.toggle('tnt-armed', tntOn);
  });

  // ---- Tilt ---------------------------------------------------------------
  // Phones only: gravity for the water and the ducks points at the real
  // ground, so tilting the phone side to side pours the water. On from the
  // start; the Tilt button turns it off and on.
  const MAX_TILT = (80 * Math.PI) / 180;
  let tiltOn = false, tiltTarget = 0, tilt = 0; // radians from straight down, + towards the right
  const tiltBtn = document.getElementById('tilt');
  let tiltWanted = true;
  // iOS only hands out orientation once the visitor allows it.
  let tiltAllowed = !window.DeviceOrientationEvent || typeof DeviceOrientationEvent.requestPermission !== 'function';

  function screenAngle() {
    const o = window.screen && window.screen.orientation;
    return o && typeof o.angle === 'number' ? o.angle : window.orientation || 0;
  }

  function onOrientation(e) {
    if (e.beta === null || e.gamma === null) return; // no sensor
    const b = (e.beta * Math.PI) / 180, g = (e.gamma * Math.PI) / 180;
    // Gravity in the phone's frame (x to its right edge, y to its top edge),
    // then turned into the page's frame (y down) for landscape.
    const px = Math.sin(g) * Math.cos(b), py = -Math.sin(b);
    const turn = (screenAngle() * Math.PI) / 180, c = Math.cos(turn), s = Math.sin(turn);
    const gx = px * c - py * s, gy = -(px * s + py * c);
    let a = Math.atan2(gx, gy);
    // Past sideways (the phone tipping upside down) ease back to straight
    // down instead of flipping from one side to the other.
    if (a > Math.PI / 2) a = Math.PI - a; else if (a < -Math.PI / 2) a = -Math.PI - a;
    // Lying flat, gravity barely touches the screen and the angle is noise.
    const flat = Math.min(1, Math.max(0, (Math.hypot(gx, gy) - 0.1) / 0.2));
    tiltTarget = Math.max(-MAX_TILT, Math.min(MAX_TILT, a * flat));
  }

  function syncTilt() {
    tiltBtn.setAttribute('aria-pressed', String(tiltWanted));
    const on = tiltWanted && tiltAllowed;
    if (on === tiltOn) return;
    tiltOn = on;
    tiltTarget = 0;
    if (on) window.addEventListener('deviceorientation', onOrientation);
    else window.removeEventListener('deviceorientation', onOrientation);
  }

  // iOS answers at once if this visit has already allowed or refused motion
  // access, but only shows its prompt from a tap. So ask on arrival, then on
  // every tap until there's an answer (one prompt at a time: a tap's
  // touchend and click both get here).
  let tiltAsking = false;
  function askTilt() {
    if (tiltAllowed || tiltAsking || tiltBtn.disabled) return;
    tiltAsking = true;
    DeviceOrientationEvent.requestPermission().then(function (state) {
      tiltAsking = false;
      root.removeEventListener('touchend', tapAsk);
      root.removeEventListener('click', tapAsk);
      if (state === 'granted') {
        tiltAllowed = true;
      } else {
        tiltWanted = false; // refused: iOS won't ask again until Safari restarts
        tiltBtn.disabled = true;
      }
      syncTilt();
    }, function () { tiltAsking = false; }); // no tap yet
  }
  function tapAsk(e) {
    if (tiltWanted && !e.target.closest('#tilt')) askTilt();
  }

  if (window.DeviceOrientationEvent && window.matchMedia('(pointer: coarse)').matches) {
    tiltBtn.hidden = false;
    tiltBtn.addEventListener('click', function () {
      tiltWanted = !tiltWanted;
      syncTilt();
      if (tiltWanted) askTilt();
    });
    syncTilt();
    if (!tiltAllowed) {
      root.addEventListener('touchend', tapAsk);
      root.addEventListener('click', tapAsk);
      askTilt();
    }
  }

  // ---- Lost GPU context ---------------------------------------------------
  // Phones can drop the WebGL context (e.g. when the tab is in the
  // background). Fall back to the CSS stone until it comes back.
  let glLost = false;
  canvas.addEventListener('webglcontextlost', function (e) {
    e.preventDefault();
    glLost = true;
    fracture.clearChunks();
    tnt.clear();
    document.body.classList.remove('sim-on');
  });
  canvas.addEventListener('webglcontextrestored', function () {
    renderer.init();
    document.body.classList.add('sim-on');
    measure();
    buildRocks();
    glLost = false;
  });

  // ---- Loop -----------------------------------------------------------------
  // The simulation takes fixed 60 Hz steps: high-refresh screens skip frames,
  // and a 30 Hz screen (e.g. iOS Low Power Mode) takes two steps per frame.
  const FRAME_MS = 1000 / 60;
  let lastFrame = 0, steps = 0, lastCheck = -1, slowStreak = 0;
  let lastTx = NaN, lastTy = NaN, lastCount = 0, lastChunks = 0, lastDucks = 0;

  function step(sy, viewH, dw) {
    tilt += ((tiltOn ? tiltTarget : 0) - tilt) * 0.12;
    const down = sim.down;
    down.x = Math.sin(tilt); down.y = Math.cos(tilt);
    if (raining) {
      // Rain falls along gravity. Slanted rain comes in through the top and
      // through the side it slants away from, each in proportion to how
      // square that edge is to the rain, so it stays as dense.
      const fromTop = dw * down.y, fromSide = viewH * Math.abs(down.x);
      rainCarry += ((fromTop + fromSide) / 1400) * 3.2;
      while (rainCarry >= 1) {
        rainCarry -= 1;
        const s = 5 + Math.random() * 2, drift = 0.4 + Math.random() * 0.3;
        const vx = down.x * s + down.y * drift, vy = down.y * s - down.x * drift;
        if (Math.random() * (fromTop + fromSide) < fromTop) {
          sim.add(Math.random() * dw, sy - 10 - Math.random() * 40, vx, vy);
        } else {
          sim.add(down.x > 0 ? -5 - Math.random() * 30 : dw + 5 + Math.random() * 30, sy + Math.random() * viewH, vx, vy);
        }
      }
    }
    const view = { left: -40, right: dw + 40, top: sy - 400, bottom: sy + viewH + 60 };
    tnt.step();
    const moving = fracture.step(rocks, docHeight());
    if (raining) ducks.countdown(rocks, dw, sy, viewH);
    const floating = ducks.step(rocks, moving, sim, view);
    sim.setRocks(moving.length || floating.length ? rocks.concat(moving, floating) : rocks);
    sim.step(view);
    sim.pointer.dx *= 0.5; sim.pointer.dy *= 0.5;
  }

  function frame(now) {
    requestAnimationFrame(frame);
    if (glLost || now - lastFrame < FRAME_MS - 1) return;
    const n = Math.min(2, Math.max(1, Math.floor((now - lastFrame + 1) / FRAME_MS)));
    lastFrame = Math.max(lastFrame + n * FRAME_MS, now - FRAME_MS);

    const resized = renderer.resize(canvasW, canvasH, Math.min(window.devicePixelRatio || 1, 2));
    const sx = window.scrollX, sy = window.scrollY;
    const dw = docWidth();
    for (let i = 0; i < n; i++) step(sy, window.innerHeight, dw);

    // Skip the redraw when nothing on the canvas changed (rain paused and
    // dried up, no falling chunks or ducks, no scroll): the last frame stays
    // up. A reallocated canvas is blank, so it always gets redrawn.
    const tx = sx, ty = sy - OVERSCAN;
    if (resized || needsRender || sim.count || lastCount || fracture.chunks.length || lastChunks ||
        ducks.list.length || lastDucks || tx !== lastTx || ty !== lastTy) {
      if (tx !== lastTx || ty !== lastTy) canvas.style.transform = 'translate(' + tx + 'px,' + ty + 'px)';
      renderer.render(sim, tx, ty, fracture.chunks, ducks);
      lastTx = tx; lastTy = ty; lastCount = sim.count; lastChunks = fracture.chunks.length;
      lastDucks = ducks.list.length; needsRender = false;
    }

    // Shed particles when the device can't keep up with 60 steps a second.
    steps += n;
    if (lastCheck < 0) lastCheck = now;
    if (now - lastCheck > 1000) {
      const rate = (steps * 1000) / (now - lastCheck);
      slowStreak = rate < 45 ? slowStreak + 1 : 0;
      if (slowStreak >= 2 && sim.limit > 500) { sim.setLimit(sim.limit * 0.8); slowStreak = 0; }
      steps = 0; lastCheck = now;
    }
  }
  requestAnimationFrame(frame);
})();
