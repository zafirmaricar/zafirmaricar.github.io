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
  let rocks = [];

  const chunkLayer = document.getElementById('chunks');
  const fracture = new window.Fracture({
    layer: chunkLayer,
    renderer: renderer,
    onDamage: function () { buildRocks(); },
  });
  window.portfolioFracture = fracture;

  function docWidth() { return document.documentElement.clientWidth; }
  function docHeight() { return document.documentElement.scrollHeight; }

  function buildRocks() {
    const sx = window.scrollX, sy = window.scrollY;
    rocks = [];
    document.querySelectorAll('.rock:not(.chunk)').forEach(function (el, i) {
      if (!el.getClientRects().length) return; // hidden page
      const r = el.getBoundingClientRect();
      const seed = window.Rocks.hashString(el.textContent.slice(0, 60)) + i;
      const rock = window.Rocks.makeRock(r.left + sx, r.top + sy, r.width, r.height, seed);
      fracture.decorate(rock, el, r.left + sx, r.top + sy);
      rocks.push(rock);
    });
    sim.setRocks(rocks);
    sim.removeInsideRocks();
    renderer.setRocks(rocks);
    chunkLayer.style.height = '0';
    chunkLayer.style.height = docHeight() + 'px';
  }

  let rebuildTimer = 0;
  onLayoutChange = function () {
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(buildRocks, 60);
  };
  onPageChange = function () { fracture.clearChunks(); };
  buildRocks();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(onLayoutChange);
  window.addEventListener('load', onLayoutChange);
  window.addEventListener('resize', onLayoutChange);
  if (window.ResizeObserver) new ResizeObserver(onLayoutChange).observe(document.querySelector('.wrap'));

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

  // Click a rock to crack it; click open space to splash.
  window.addEventListener('click', function (e) {
    if (e.button !== 0) return;
    if (e.target.closest('a, button, input, iframe, object, .hud')) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return; // the user was selecting text
    const x = e.clientX + window.scrollX, y = e.clientY + window.scrollY;
    if (!fracture.hit(rocks, x, y)) sim.splash(x, y, 45);
  });

  // ---- HUD ----------------------------------------------------------------
  const rainBtn = document.getElementById('rain-toggle');
  function syncRainButton() {
    rainBtn.textContent = raining ? 'Pause rain' : 'Start rain';
    rainBtn.setAttribute('aria-pressed', String(raining));
  }
  rainBtn.addEventListener('click', function () { raining = !raining; syncRainButton(); });
  syncRainButton();
  document.getElementById('repair').addEventListener('click', function () { fracture.repair(); });

  // ---- Loop (capped at 60 fps so high-refresh screens run at normal speed) --
  const FRAME_MS = 1000 / 60;
  let lastFrame = 0, frames = 0, lastCheck = 0, slowStreak = 0;

  function frame(now) {
    requestAnimationFrame(frame);
    if (now - lastFrame < FRAME_MS - 1) return;
    lastFrame = Math.max(lastFrame + FRAME_MS, now - FRAME_MS);

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

    const moving = fracture.step(rocks, docHeight());
    sim.setRocks(moving.length ? rocks.concat(moving) : rocks);
    sim.step({ left: -40, right: dw + 40, top: sy - 400, bottom: sy + H + 60 });
    sim.pointer.dx *= 0.5; sim.pointer.dy *= 0.5;
    renderer.render(sim, sx, sy, fracture.chunks);

    // Shed particles on slow devices.
    frames++;
    if (now - lastCheck > 1000) {
      const fps = (frames * 1000) / (now - lastCheck);
      slowStreak = fps < 45 ? slowStreak + 1 : 0;
      if (slowStreak >= 2 && sim.limit > 500) { sim.setLimit(sim.limit * 0.8); slowStreak = 0; }
      frames = 0; lastCheck = now;
    }
  }
  requestAnimationFrame(frame);
})();
