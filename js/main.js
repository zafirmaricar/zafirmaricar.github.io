(function () {
  'use strict';

  const pages = document.querySelectorAll('[data-page]');
  const tabs = document.querySelectorAll('[data-tab]');
  let onLayoutChange = function () {};

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
    onLayoutChange();
  }

  document.getElementById('year').textContent = new Date().getFullYear();
  window.addEventListener('hashchange', showPage);
  showPage();

  // ---- Simulation -------------------------------------------------------
  const canvas = document.getElementById('sim');
  const small = window.innerWidth < 700;
  const maxParticles = small ? 1200 : 2600;
  const renderer = window.FluidRenderer && window.FluidRenderer.create(canvas, { maxParticles: maxParticles });
  if (!renderer) return; // CSS fallback keeps the panels readable
  document.body.classList.add('sim-on');

  const sim = new window.FluidSim({ maxParticles: maxParticles });
  window.portfolioSim = sim; // handy for poking at it from the console
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let raining = !reducedMotion;
  let rainCarry = 0;

  function docWidth() { return document.documentElement.clientWidth; }

  function buildRocks() {
    const sx = window.scrollX, sy = window.scrollY;
    const rocks = [];
    document.querySelectorAll('.rock').forEach(function (el, i) {
      if (!el.getClientRects().length) return; // hidden page
      const r = el.getBoundingClientRect();
      const seed = window.Rocks.hashString(el.textContent.slice(0, 60)) + i;
      rocks.push(window.Rocks.makeRock(r.left + sx, r.top + sy, r.width, r.height, seed));
    });
    sim.setRocks(rocks);
    sim.removeInsideRocks();
    renderer.setRocks(rocks);
  }

  let rebuildTimer = 0;
  onLayoutChange = function () {
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(buildRocks, 60);
  };
  buildRocks();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(onLayoutChange);
  window.addEventListener('load', onLayoutChange);
  window.addEventListener('resize', onLayoutChange);
  if (window.ResizeObserver) new ResizeObserver(onLayoutChange).observe(document.body);

  // ---- Input --------------------------------------------------------------
  let lastPointer = null;
  window.addEventListener('pointermove', function (e) {
    const x = e.clientX + window.scrollX, y = e.clientY + window.scrollY;
    const ptr = sim.pointer;
    ptr.dx = lastPointer ? Math.max(-20, Math.min(20, x - lastPointer.x)) : 0;
    ptr.dy = lastPointer ? Math.max(-20, Math.min(20, y - lastPointer.y)) : 0;
    ptr.x = x; ptr.y = y; ptr.active = true;
    lastPointer = { x: x, y: y };
  }, { passive: true });
  function pointerGone() { sim.pointer.active = false; lastPointer = null; }
  document.documentElement.addEventListener('pointerleave', pointerGone);
  window.addEventListener('blur', pointerGone);
  window.addEventListener('pointerup', function (e) { if (e.pointerType !== 'mouse') pointerGone(); });

  window.addEventListener('pointerdown', function (e) {
    if (e.button !== 0) return;
    if (e.target.closest('a, button, iframe, input, .rock, .hud')) return;
    sim.splash(e.clientX + window.scrollX, e.clientY + window.scrollY, 45);
  });

  // ---- HUD ----------------------------------------------------------------
  const stats = document.getElementById('hud-stats');
  const rainBtn = document.getElementById('rain-toggle');
  function syncRainButton() {
    rainBtn.textContent = raining ? 'Pause rain' : 'Start rain';
    rainBtn.setAttribute('aria-pressed', String(raining));
  }
  rainBtn.addEventListener('click', function () { raining = !raining; syncRainButton(); });
  syncRainButton();

  // ---- Loop ---------------------------------------------------------------
  let frames = 0, lastStat = performance.now(), slowStreak = 0;

  function frame(now) {
    const W = window.innerWidth, H = window.innerHeight;
    renderer.resize(W, H, Math.min(window.devicePixelRatio || 1, 2));
    const sx = window.scrollX, sy = window.scrollY;
    const dw = docWidth();

    if (raining) {
      rainCarry += (dw / 1400) * 3.2;
      while (rainCarry >= 1) {
        rainCarry -= 1;
        sim.add(Math.random() * dw, sy - 10 - Math.random() * 40, 0.4 + Math.random() * 0.3, 5 + Math.random() * 2);
      }
    }
    sim.step({ left: -40, right: dw + 40, top: sy - 400, bottom: sy + H + 60 });
    sim.pointer.dx *= 0.5; sim.pointer.dy *= 0.5;
    renderer.render(sim, sx, sy);

    frames++;
    if (now - lastStat > 1000) {
      const fps = (frames * 1000) / (now - lastStat);
      // Shed particles on slow devices.
      slowStreak = fps < 45 ? slowStreak + 1 : 0;
      if (slowStreak >= 2 && sim.limit > 500) { sim.setLimit(sim.limit * 0.8); slowStreak = 0; }
      stats.textContent = sim.count + ' particles · ' + Math.round(fps) + ' fps';
      frames = 0; lastStat = now;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
