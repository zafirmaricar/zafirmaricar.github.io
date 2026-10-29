// Draws the plant each frame from the simulation state: coolant colours,
// rods, the core's glow, spinning machines, steam, the plume and the town's
// lights. Writes straight into a 480 × 270 pixel buffer; no DOM.
(function (root) {
  'use strict';

  const Art = root.ReactorArt || require('./art.js');
  const Sim = root.ReactorSim || require('./sim.js');
  const W = Art.W, H = Art.H, P = Art.P, G = Art.G, PIPES = Art.PIPES;
  const C = Sim.C;
  const ramp = Art.ramp, rampPos = Art.rampPos, bayer = Art.bayer;

  function lighten(R, t) { return R.map(function (c) { return Art.mix(c, P.white, t); }); }
  const COOL = Art.COOLANT, COOL_LIT = lighten(COOL, 0.14), COOL_DASH = lighten(COOL, 0.38);
  const STEAM = Art.STEAM, STEAM_DASH = lighten(STEAM, 0.5);
  const POOL = Art.POOL;
  const POOL_WARM = ['#0b3442', '#0f4655', '#155a68', '#1d717c', '#2c8c92'].map(Art.rgb);
  const CW = [P.pool1, P.pool2, P.pool3, P.pool4, P.foam];
  const CW_DASH = lighten(CW, 0.35);
  const HEAT = [P.st2, P.lampOff, P.f2, P.f4, P.f6, P.f7];
  const BLADE = [P.st1, P.st3, P.st5, P.st6];

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function mod(a, n) { return ((a % n) + n) % n; }

  // Temperature at a fraction of the way along a run of cells.
  function along(cells, i0, i1, u) {
    const f = i0 + u * (i1 - i0) - 0.5;
    const a = clamp(Math.floor(f), i0, i1 - 1), b = clamp(a + 1, i0, i1 - 1);
    const k = clamp(f - a, 0, 1);
    return cells[a] + (cells[b] - cells[a]) * k;
  }

  // ---------------------------------------------------------------------------
  // Particles: bubbles, drops, puffs of steam, the plume, neutrons.

  const BUBBLE = 0, DROP = 1, PUFF = 2, PLUME = 3, SHIMMER = 4, NEUTRON = 5, SPARK = 6;
  const MAXP = 900;

  function Particles() {
    this.x = new Float32Array(MAXP); this.y = new Float32Array(MAXP);
    this.vx = new Float32Array(MAXP); this.vy = new Float32Array(MAXP);
    this.age = new Float32Array(MAXP); this.life = new Float32Array(MAXP);
    this.size = new Float32Array(MAXP); this.lim = new Float32Array(MAXP);
    this.kind = new Uint8Array(MAXP);
    this.n = 0;
  }
  Particles.prototype.add = function (kind, x, y, vx, vy, life, size, lim) {
    if (this.n >= MAXP) return;
    const i = this.n++;
    this.kind[i] = kind; this.x[i] = x; this.y[i] = y; this.vx[i] = vx; this.vy[i] = vy;
    this.age[i] = 0; this.life[i] = life; this.size[i] = size || 1; this.lim[i] = lim === undefined ? -1e9 : lim;
  };
  Particles.prototype.kill = function (i) {
    const j = --this.n;
    this.kind[i] = this.kind[j]; this.x[i] = this.x[j]; this.y[i] = this.y[j];
    this.vx[i] = this.vx[j]; this.vy[i] = this.vy[j]; this.age[i] = this.age[j];
    this.life[i] = this.life[j]; this.size[i] = this.size[j]; this.lim[i] = this.lim[j];
  };
  Particles.prototype.clear = function () { this.n = 0; };

  // ---------------------------------------------------------------------------

  function Renderer() {
    const bg = Art.background();
    const dry = Art.background({ pool: false });
    this.bg = bg.px;
    this.dry = dry.px;
    this.windows = bg.windows;
    this.wire = bg.wire;
    this.pool = Art.poolMask(this.bg, this.dry);
    this.poolDepth = new Float32Array(this.pool.length);
    for (let n = 0; n < this.pool.length; n++) {
      const y = (this.pool[n] / W) | 0;
      this.poolDepth[n] = (1 - (y - Art.POOL_TOP) / (Art.POOL_BOTTOM - Art.POOL_TOP)) * (POOL.length - 1.2);
    }
    this.p = new Particles();
    this.phase = { loop: 0, steam: 0, feed: 0, cw: 0, bypass: 0, dhrs: 0, wire: 0, pump: 0, fpump: 0, rotor: 0, ripple: 0 };
    this.acc = {};
    this.t = 0;
    this.rand = Art.rng(99);
    this.findRegions();
  }

  // Sort the inside of each vessel into the regions drawn every frame.
  Renderer.prototype.findRegions = function () {
    const bg = this.bg;
    const v = G.rpv, core = G.core;
    const inVessel = Art.inset(Art.capsule(v.x0, v.y0, v.x1, v.y1, v.head), 2);
    const R = { down: [], lower: [], upper: [], head: [], water: [], fuel: [], outlet: [] };
    for (let y = v.y0; y <= v.y1; y++) {
      for (let x = v.x0; x <= v.x1; x++) {
        const k = y * W + x;
        if (!inVessel(x, y) || bg[k] !== P.vac) continue;
        if (x >= 74 && y >= 123 && y <= 126) R.outlet.push(k);
        else if (y >= core.y0 && y <= core.y1 && x >= 38 && x <= 73) {
          const a = x - core.x0;
          if (x >= core.x0 && x <= core.x1 && a % 6 < 4) R.fuel.push(k);
          else R.water.push(k);
        } else if (y > core.y1 + 4) R.lower.push(k);
        else if (x <= 36 || x >= 75) R.down.push(k);
        else if (y < v.y0 + 15) R.head.push(k);
        else R.upper.push(k);
      }
    }
    // Pressurizer and steam generator insides.
    const z = G.pzr, g = G.sg;
    const inPzr = Art.inset(Art.capsule(z.x0, z.y0, z.x1, z.y1, z.head), 2);
    R.pzr = [];
    for (let y = z.y0; y <= z.y1; y++) {
      for (let x = z.x0; x <= z.x1; x++) if (inPzr(x, y) && bg[y * W + x] === P.vac) R.pzr.push(y * W + x);
    }
    const inSg = Art.inset(Art.capsule(g.x0, g.y0, g.x1, g.y1, g.head), 2);
    R.sgTop = []; R.sgBot = []; R.tubes = []; R.shell = [];
    for (let y = g.y0; y <= g.y1; y++) {
      for (let x = g.x0; x <= g.x1; x++) {
        const k = y * W + x;
        if (!inSg(x, y) || bg[k] !== P.vac) continue;
        if (y < 67) R.sgTop.push(k);
        else if (y > 192) R.sgBot.push(k);
        else if (y >= 70 && y <= 189 && (x - 126) % 5 < 2 && x >= 126 && x <= 152) R.tubes.push(k);
        else R.shell.push(k);
      }
    }
    // Passive cooling coil: the pixels of the coil drawn into the pool.
    const d = G.dhrs, poolSet = new Set(this.pool);
    R.coil = [];
    for (let y = d[1]; y <= d[3] + 1; y++) {
      for (let x = d[0]; x <= d[2]; x++) {
        const k = y * W + x;
        if (!poolSet.has(k)) R.coil.push(k);
      }
    }
    for (const key in R) R[key] = Int32Array.from(R[key]);
    this.R = R;
    this.pzrTop = z.y0 + 3; this.pzrBot = z.y1 - 3;
  };

  Renderer.prototype.every = function (key, rate, dt, fn) {
    let a = (this.acc[key] || 0) + rate * dt;
    while (a >= 1) { fn(); a -= 1; }
    this.acc[key] = a;
  };

  // Fill a pipe with water coloured by temperature, with flow marks moving
  // at `phase`.
  function fillWater(f, pipe, tempAt, phase, dashes) {
    const len = pipe.length;
    for (let n = 0; n < pipe.idx.length; n++) {
      const x = pipe.xs[n], y = pipe.ys[n], d = pipe.dist[n], a = pipe.across[n];
      const pos = rampPos(Art.COOLANT_T, tempAt(d / len));
      let R = COOL;
      if (dashes && a > 0.2 && a < 0.8 && mod(d - phase, 12) < 2.5) R = COOL_DASH;
      else if (a < 0.3) R = COOL_LIT;
      f[pipe.idx[n]] = ramp(R, pos, x, y);
    }
  }
  function fillSteam(f, pipe, density, phase, dashes) {
    for (let n = 0; n < pipe.idx.length; n++) {
      const x = pipe.xs[n], y = pipe.ys[n], d = pipe.dist[n], a = pipe.across[n];
      let R = STEAM;
      if (dashes && a > 0.2 && a < 0.8 && mod(d - phase, 10) < 3) R = STEAM_DASH;
      f[pipe.idx[n]] = ramp(R, density + (a < 0.3 ? 0.6 : 0), x, y);
    }
  }
  function fillCw(f, pipe, warm, phase, dashes) {
    for (let n = 0; n < pipe.idx.length; n++) {
      const x = pipe.xs[n], y = pipe.ys[n], d = pipe.dist[n], a = pipe.across[n];
      const R = dashes && a > 0.2 && a < 0.8 && mod(d - phase, 14) < 3 ? CW_DASH : CW;
      f[pipe.idx[n]] = ramp(R, 1.4 + warm + (a < 0.3 ? 0.7 : 0), x, y);
    }
  }
  function fillEmpty(f, pipe) {
    for (let n = 0; n < pipe.idx.length; n++) f[pipe.idx[n]] = P.st0;
  }

  // Dithered round blob, used for steam puffs and the plume.
  function blob(f, cx, cy, r, alpha, R, pos) {
    const x0 = Math.floor(cx - r), x1 = Math.ceil(cx + r), y0 = Math.floor(cy - r), y1 = Math.ceil(cy + r);
    const r2 = r * r;
    for (let y = y0; y <= y1; y++) {
      if (y < 0 || y >= H) continue;
      for (let x = x0; x <= x1; x++) {
        if (x < 0 || x >= W) continue;
        const dx = x + 0.5 - cx, dy = y + 0.5 - cy, d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        const a = alpha * (1 - 0.6 * d2 / r2);
        if (a > bayer(x, y)) f[y * W + x] = ramp(R, pos + (dy < 0 ? 0.6 : 0) - 0.8 * d2 / r2, x, y);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // One frame. `view`: { reduced, neutrons, highlight, alarm, shake }.

  Renderer.prototype.draw = function (f, s, dt, view) {
    view = view || {};
    dt = Math.min(dt, 0.1);
    this.t += dt;
    const t = this.t, ph = this.phase, rnd = this.rand;
    const calm = view.reduced ? 0.4 : 1;
    const powered = s.in.offsitePower;
    f.set(this.bg);

    // Flow marks move with the flows they show.
    const loopRate = s.flow / C.W_NOM;
    ph.loop += loopRate * 26 * dt * calm;
    ph.steam += Math.min(1.5, s.wSteam / C.W_STEAM_FULL) * 40 * dt * calm;
    ph.feed += Math.min(1.5, s.wFeed / C.W_STEAM_FULL) * 22 * dt * calm;
    const cwOn = powered ? s.in.cooling : 0;
    ph.cw += cwOn * 18 * dt * calm;
    ph.bypass += s.dumpValve * 40 * dt * calm;
    ph.dhrs += (s.dhrsOn ? Math.min(1, s.qDhrs / 5e6) : 0) * 16 * dt * calm;
    ph.wire += (s.mwe / 77) * 30 * dt * calm;
    ph.pump += s.pumpSpeed * 14 * dt;
    ph.fpump += Math.min(1.2, s.wFeed / C.W_STEAM_FULL) * 12 * dt;
    ph.rotor += Math.min(1, s.rpm / 3000) * 30 * dt * calm;
    ph.ripple += dt * 3 * calm;

    this.drawPool(f, s, dt, calm);
    this.drawLoop(f, s);
    this.drawCore(f, s, view);
    this.drawPressurizer(f, s, dt, calm);
    this.drawSteamGenerator(f, s, dt, calm);
    this.drawSecondary(f, s, dt, calm);
    this.drawGrid(f, s, view);
    this.drawParticles(f, s, dt, calm, view);
    this.drawLamps(f, s, view);
    if (view.leaders) this.drawLeaders(f, view.leaders);
    if (view.highlight) this.drawHighlight(f, view.highlight);
    if (view.shake && !view.reduced) f.copyWithin(1, 0);
  };

  Renderer.prototype.drawPool = function (f, s, dt, calm) {
    const surf = Math.round(Art.POOL_TOP + (1 - s.poolMass / C.M_POOL) * (Art.POOL_BOTTOM - Art.POOL_TOP));
    const warm = clamp((s.tPool - C.T_POOL0) / (100 - C.T_POOL0), 0, 1);
    const rip = Math.floor(this.phase.ripple);
    const idx = this.pool, depth = this.poolDepth, dry = this.dry;
    const open = this.openWater || (this.openWater = []);
    open.length = 0;
    for (let n = 0; n < idx.length; n++) {
      const k = idx[n], y = (k / W) | 0;
      if (y < surf) { f[k] = dry[k]; continue; }
      const x = k - y * W;
      if (y === surf) open.push(x);
      if (y === surf) f[k] = (x + rip) % 9 < 3 ? P.foam : P.pool4;
      else f[k] = warm > bayer(x + 2, y + 1) ? ramp(POOL_WARM, depth[n] + warm * 0.5, x, y) : ramp(POOL, depth[n], x, y);
    }
    this.surf = surf;
    // Warm water rising off the coil, and steam off a boiling pool.
    if (s.dhrsOn && s.qDhrs > 1e5) {
      const d = G.dhrs;
      this.every('shimmer', Math.min(14, s.qDhrs / 4e5) * calm, dt, function () {
        this.p.add(SHIMMER, d[0] + this.rand() * (d[2] - d[0]), d[1] + this.rand() * (d[3] - d[1]), (this.rand() - 0.5) * 2, -6 - this.rand() * 6, 6, 1, surf + 1);
      }.bind(this));
    }
    // Steam off a hot pool, only where the water is open to the air.
    if (s.tPool > 90 && open.length) {
      const boil = clamp((s.tPool - 90) / 10, 0, 1);
      this.every('wisp', boil * 4 * calm, dt, function () {
        const x = open[Math.floor(this.rand() * open.length)];
        this.p.add(PUFF, x + 0.5, surf - 1, 0.5 + this.rand() * 1.5, -4 - this.rand() * 3, 2.5 + this.rand() * 2, 1.5, -1e9);
      }.bind(this));
    }
  };

  Renderer.prototype.drawLoop = function (f, s) {
    const ph = this.phase.loop;
    const moving = s.flow / C.W_NOM > 0.002;
    fillWater(f, PIPES.hot, function (u) { return along(s.hot, 0, Sim.N_HOT, u); }, ph, moving);
    fillWater(f, PIPES.cold, function (u) { return along(s.cold, 0, Sim.N_COLD - 2, u); }, ph, moving);
    fillWater(f, PIPES.surge, function () { return s.hot[2]; }, 0, false);
    // Inside the vessel: down the downcomer, round the bottom, up the core.
    const R = this.R;
    const tIn = s.cold[Sim.N_COLD - 1], tDown = s.cold[Sim.N_COLD - 2];
    const dashY = ph;
    for (let n = 0; n < R.down.length; n++) {
      const k = R.down[n], y = (k / W) | 0, x = k - y * W;
      const lit = moving && (x === 35 || x === 76) && mod(y - dashY, 12) < 2.5;
      f[k] = ramp(lit ? COOL_DASH : COOL, rampPos(Art.COOLANT_T, tDown + (tIn - tDown) * (y - 110) / 110), x, y);
    }
    for (let n = 0; n < R.lower.length; n++) {
      const k = R.lower[n], y = (k / W) | 0, x = k - y * W;
      f[k] = ramp(COOL, rampPos(Art.COOLANT_T, tIn), x, y);
    }
    const tOut = s.tCore;
    for (let n = 0; n < R.upper.length; n++) {
      const k = R.upper[n], y = (k / W) | 0, x = k - y * W;
      const lit = moving && (x === 55 || x === 56) && mod(-y - dashY, 12) < 2.5;
      f[k] = ramp(lit ? COOL_DASH : COOL, rampPos(Art.COOLANT_T, tOut), x, y);
    }
    for (let n = 0; n < R.head.length; n++) {
      const k = R.head[n], y = (k / W) | 0, x = k - y * W;
      f[k] = ramp(COOL, rampPos(Art.COOLANT_T, tOut - 4), x, y);
    }
    for (let n = 0; n < R.outlet.length; n++) {
      const k = R.outlet[n], y = (k / W) | 0, x = k - y * W;
      f[k] = ramp(y === 123 ? COOL_LIT : COOL, rampPos(Art.COOLANT_T, tOut), x, y);
    }
  };

  // Fuel, the water and blue glow around it, and the rods.
  Renderer.prototype.drawCore = function (f, s, view) {
    const R = this.R, core = G.core, v = G.rpv;
    const L = core.y1 - core.y0 + 1;
    const tIn = s.cold[Sim.N_COLD - 1], tMod = (tIn + s.tCore) / 2;
    // Cherenkov glow grows with the log of fission power.
    const n = Math.max(s.nFiss, 1e-9);
    let glow = clamp((Math.log(n) / Math.LN10 + 3) / 3, 0, 1.4);
    if (!view.reduced) glow *= 1 + 0.05 * Math.sin(this.t * 23) * Math.sin(this.t * 7);
    const dmg = s.damage;
    const melt = dmg ? clamp((s.t - dmg.t) / 20, 0, 1) : 0;
    const voids = s.voidFrac;
    const tick = Math.floor(this.t * 12);
    for (let q = 0; q < R.water.length; q++) {
      const k = R.water[q], y = (k / W) | 0, x = k - y * W;
      if (voids > 0.01 && bayer(x, y + tick) < voids * 1.6) { f[k] = P.steam2; continue; }
      const g = glow * 2.3;
      f[k] = g > 0.3 ? ramp(Art.CHER, g - 0.3, x, y) : ramp(COOL, rampPos(Art.COOLANT_T, tMod), x, y);
    }
    // Glow spills into the water just above and below the core.
    if (glow > 0.12) {
      for (let q = 0; q < R.upper.length; q++) {
        const k = R.upper[q], y = (k / W) | 0, x = k - y * W;
        const d = core.y0 - y;
        if (d > 16) continue;
        const g = glow * 2.3 - d * 0.16;
        if (g > 0.4 + bayer(x, y) * 0.8) f[k] = ramp(Art.CHER, g - 0.6, x, y);
      }
    }
    if (glow > 0.12) {
      for (let q = 0; q < R.lower.length; q++) {
        const k = R.lower[q], y = (k / W) | 0, x = k - y * W;
        const d = y - core.y1;
        if (d > 10 || x < 38 || x > 73) continue;
        const g = glow * 2.3 - d * 0.2;
        if (g > 0.4 + bayer(x, y) * 0.8) f[k] = ramp(Art.CHER, g - 0.6, x, y);
      }
    }
    // Fuel: hottest in the middle of the core.
    const tf = s.tFuel;
    for (let q = 0; q < R.fuel.length; q++) {
      const k = R.fuel[q], y = (k / W) | 0, x = k - y * W;
      const col = (x - core.x0) % 6;
      const ky = (y - core.y0 + 0.5) / L;
      if (melt > 0 && ky < melt * 0.75) {
        const h = (((x * 73856093) ^ (y * 19349663) ^ (tick * 83492791)) >>> 0) % 100;
        f[k] = h < 10 ? P.steam1 : h < 14 ? P.steam0 : P.vac1;
        continue;
      }
      if (ky < 0.05 || ky > 0.95) { f[k] = col === 0 ? P.st4 : P.st3; continue; }
      const shape = 0.55 + 0.6 * Math.sin(Math.PI * ky);
      let temp = tMod + (tf - tMod) * shape;
      let pos = rampPos(Art.FUEL_T, temp);
      if (col === 0 || col === 3) pos -= 1.1;
      f[k] = ramp(Art.FUEL, pos, x, y);
    }
    if (melt > 0) {
      // Molten fuel slumped onto the bottom of the core: white-hot on top,
      // orange underneath, shimmering.
      const top = core.y1 - Math.round(4 + 8 * melt);
      const bottom = core.y1 + 3, frame6 = Math.floor(this.t * 6);
      for (let y = top - 2; y <= bottom; y++) {
        for (let x = 38; x <= 73; x++) {
          const surface = top + Math.round(Math.sin(x * 0.7 + this.t * 1.5) * 1.2 + Math.sin(x * 1.9) * 0.8);
          if (y < surface) continue;
          const depth = (y - surface) / Math.max(1, bottom - surface);
          const h = (((x * 73856093) ^ (y * 19349663) ^ (frame6 * 83492791)) >>> 0) % 1000 / 1000;
          f[y * W + x] = ramp(Art.FUEL, 7.7 - depth * 2.4 + (h - 0.5) * 0.9, x, y);
        }
      }
    }
    // Rods: the control bank in gaps 0, 2, 4 and the shutdown banks in 1, 3.
    G.rods.forEach(function (r) {
      const w = r.bank === 'control' ? s.rodX : s.rodY;
      const bottom = core.y1 - Math.round(w * L);
      const top = bottom - L + 1;
      for (let y = Math.max(top, v.y0 + 17); y <= bottom; y++) {
        const tip = bottom - y < 2;
        f[y * W + r.x] = tip ? (r.bank === 'control' ? P.tipCtl : P.tipSd) : P.absorberHi;
        f[y * W + r.x + 1] = tip ? (r.bank === 'control' ? P.tipCtl : P.tipSd) : P.absorber;
      }
      // Drive shaft up through the head.
      for (let y = v.y0 + 3; y < top; y++) { f[y * W + r.x] = P.st4; f[y * W + r.x + 1] = P.st2; }
      // Position marker in the drive housing.
      const h = v.y0 - 70;
      const my = v.y0 - 2 - Math.round(w * h);
      for (let y = 67; y < v.y0 - 1; y++) {
        const c = y < my ? P.st0 : y === my ? (r.bank === 'control' ? P.tipCtl : P.tipSd) : P.st4;
        f[y * W + r.x] = c; f[y * W + r.x + 1] = c;
      }
    });
    // Neutrons, when that view is on.
    if (view.neutrons && n > 1e-6) {
      const rate = clamp((Math.log(n) / Math.LN10 + 6) / 6, 0, 1.3) * 70;
      this.every('neutron', rate, 1 / 60, function () {
        const a = this.rand() * Math.PI * 2, sp = 40 + this.rand() * 40;
        const col = Math.floor(this.rand() * 6);
        this.p.add(NEUTRON, G.assemblies[col] + 1 + this.rand() * 2, core.y0 + 3 + this.rand() * (L - 6), Math.cos(a) * sp, Math.sin(a) * sp, 0.3 + this.rand() * 0.3, 1);
      }.bind(this));
    }
  };

  Renderer.prototype.drawPressurizer = function (f, s, dt, calm) {
    const R = this.R, z = G.pzr;
    const top = this.pzrTop, bot = this.pzrBot;
    const levelY = bot - s.pzrLevel * (bot - top);
    const tw = Sim.tsat(s.pP) - 1;
    const wPos = rampPos(Art.COOLANT_T, tw);
    const rip = Math.floor(this.phase.ripple * 2);
    for (let q = 0; q < R.pzr.length; q++) {
      const k = R.pzr[q], y = (k / W) | 0, x = k - y * W;
      if (y < Math.floor(levelY)) f[k] = ramp(STEAM, 1.1 + (y - top) * 0.02, x, y);
      else if (y === Math.floor(levelY)) f[k] = (x + rip) % 4 === 0 ? P.c11 : ramp(COOL_LIT, wPos, x, y);
      else f[k] = ramp(COOL, wPos, x, y);
    }
    // Heater bundle in the bottom head.
    const hc = s.heater > 0.01 ? 1 + s.heater * 4 : 0;
    for (let x = z.x0 + 4; x <= z.x1 - 4; x++) {
      f[(bot - 1) * W + x] = ramp(HEAT, hc, x, bot - 1);
      f[(bot - 3) * W + x] = ramp(HEAT, hc * 0.9, x, bot - 3);
    }
    if (s.heater > 0.05 && s.pzrLevel > 0.1) {
      this.every('pzrBub', s.heater * 8 * calm, dt, function () {
        this.p.add(BUBBLE, z.x0 + 4 + this.rand() * (z.x1 - z.x0 - 8), bot - 2, 0, -10 - this.rand() * 8, 4, 1, levelY);
      }.bind(this));
    }
    if (s.spray > 0.02) {
      this.every('spray', s.spray * 30 * calm, dt, function () {
        this.p.add(DROP, (z.x0 + z.x1) / 2 + (this.rand() - 0.5) * 6, top + 1, (this.rand() - 0.5) * 6, 18 + this.rand() * 10, 2, 1, levelY);
      }.bind(this));
    }
    if (s.porvOpen || s.in.porv || s.pzrSvOpen) {
      this.every('relief', (s.pzrSvOpen ? 10 : 5) * calm, dt, function () {
        const x = z.x0 + 3 + (this.rand() < 0.5 ? 0 : 6);
        this.p.add(PUFF, x, z.y0 - 8, (this.rand() - 0.2) * 6, -6 - this.rand() * 6, 1.6, 2, -1e9);
      }.bind(this));
    }
  };

  Renderer.prototype.drawSteamGenerator = function (f, s, dt, calm) {
    const R = this.R;
    const tIn = s.hot[Sim.N_HOT - 1], tOut = s.sg[Sim.N_SG - 1];
    for (let q = 0; q < R.sgTop.length; q++) {
      const k = R.sgTop[q], y = (k / W) | 0, x = k - y * W;
      f[k] = ramp(COOL, rampPos(Art.COOLANT_T, tIn), x, y);
    }
    for (let q = 0; q < R.sgBot.length; q++) {
      const k = R.sgBot[q], y = (k / W) | 0, x = k - y * W;
      f[k] = ramp(COOL, rampPos(Art.COOLANT_T, tOut), x, y);
    }
    const y0 = 70, y1 = 189;
    for (let q = 0; q < R.tubes.length; q++) {
      const k = R.tubes[q], y = (k / W) | 0, x = k - y * W;
      const temp = along(s.sg, 0, Sim.N_SG, (y - y0 + 0.5) / (y1 - y0 + 1));
      f[k] = ramp((x - 126) % 5 === 0 ? COOL_LIT : COOL, rampPos(Art.COOLANT_T, temp), x, y);
    }
    // Shell side: boiling water up to the level, steam above.
    const levelY = Math.round(y1 - clamp(s.sgLevel, 0, 1) * (y1 - y0));
    const wPos = rampPos(Art.COOLANT_T, Sim.tsat(s.pS) - 8);
    const steamPos = clamp(s.pS / 80, 0.2, 1.4);
    const rip = Math.floor(this.phase.ripple * 2);
    for (let q = 0; q < R.shell.length; q++) {
      const k = R.shell[q], y = (k / W) | 0, x = k - y * W;
      if (y < levelY) f[k] = ramp(STEAM, steamPos + (y < 80 ? 0.4 : 0), x, y);
      else if (y === levelY) f[k] = (x + rip) % 5 === 0 ? P.foam : ramp(COOL_LIT, wPos, x, y);
      else f[k] = ramp(COOL, wPos, x, y);
    }
    this.sgLevelY = levelY;
    const boil = clamp(s.wBoil / C.W_STEAM_FULL, 0, 1.5);
    if (boil > 0.005 && s.sgLevel > 0.02) {
      this.every('sgBub', (4 + boil * 40) * calm, dt, function () {
        const tube = Math.floor(this.rand() * 6);
        this.p.add(BUBBLE, 128.5 + tube * 5 + (this.rand() < 0.5 ? 0 : 1), levelY + 2 + this.rand() * (y1 - levelY - 2), (this.rand() - 0.5) * 2, -12 - this.rand() * 14, 6, 1, levelY);
      }.bind(this));
    }
  };

  Renderer.prototype.drawSecondary = function (f, s, dt, calm) {
    const ph = this.phase;
    // Steam line, bypass, relief vent and the passive cooling lines.
    const steamPos = clamp(s.pS / 70, 0.15, 1.6);
    if (s.pS > 2) fillSteam(f, PIPES.steam, steamPos, ph.steam, s.wSteam > 0.5);
    else fillEmpty(f, PIPES.steam);
    if (s.dumpValve > 0.005) fillSteam(f, PIPES.bypass, steamPos, ph.bypass, true);
    else fillSteam(f, PIPES.bypass, 0.1, 0, false);
    if (s.sgSvOpen) {
      fillSteam(f, PIPES.vent, steamPos + 0.4, ph.steam * 1.6, true);
      this.every('vent', 14 * calm, dt, function () {
        this.p.add(PUFF, 192.5 + (this.rand() - 0.5) * 3, 4, (this.rand() - 0.3) * 8, -12 - this.rand() * 10, 2.5 + this.rand() * 1.5, 2.5, -1e9);
      }.bind(this));
    } else fillEmpty(f, PIPES.vent);
    if (s.dhrsOn) {
      fillSteam(f, PIPES.dhrsIn, steamPos, ph.dhrs, true);
      fillWater(f, PIPES.dhrsOut, function () { return s.tPool + 20; }, ph.dhrs, true);
    } else {
      // Valve shut: steam above it, still water below.
      const p = PIPES.dhrsIn;
      for (let n = 0; n < p.idx.length; n++) {
        f[p.idx[n]] = p.ys[n] < 95 ? ramp(STEAM, steamPos, p.xs[n], p.ys[n]) : ramp(COOL, rampPos(Art.COOLANT_T, s.tPool), p.xs[n], p.ys[n]);
      }
      fillWater(f, PIPES.dhrsOut, function () { return s.tPool; }, 0, false);
    }
    // Passive cooling coil warms when it is working.
    if (s.dhrsOn) {
      const pos = rampPos(Art.COOLANT_T, Math.max(s.tPool, Sim.tsat(s.pS) - 30));
      const coil = this.R.coil;
      for (let q = 0; q < coil.length; q++) {
        const k = coil[q], y = (k / W) | 0, x = k - y * W;
        if (this.bg[k] === P.st2 || this.bg[k] === P.st3) f[k] = ramp(COOL, pos, x, y);
      }
    }
    fillWater(f, PIPES.feed, function () { return s.tFeed; }, ph.feed, s.wFeed > 0.5);
    // Cooling water to and from the tower.
    const flowing = (s.in.offsitePower ? s.in.cooling : 0) > 0.01;
    const warm = clamp((s.tCond - 30) / 15, 0, 1);
    fillCw(f, PIPES.cwOut, warm * 1.2, ph.cw, flowing);
    fillCw(f, PIPES.cwIn, 0, ph.cw, flowing);

    // Turbine blades and the generator's rotor, seen through cut-outs.
    const rot = ph.rotor;
    const hp = G.turbine.hp, lp = G.turbine.lp, g = G.gen;
    this.drawRotor(f, hp[0] + 3, hp[1] + 5, hp[2] - 3, hp[3] - 5, rot, 0.45, 0.7, s);
    this.drawRotor(f, lp[0] + 3, lp[1] + 7, lp[2] - 3, lp[3] - 5, rot, 0.4, 1, s);
    const gx0 = g[0] + 3, gy0 = g[1] + 5, gx1 = g[2] - 3, gy1 = g[3] - 5;
    const gcy = (gy0 + gy1) / 2;
    for (let y = gy0; y <= gy1; y++) {
      for (let x = gx0; x <= gx1; x++) {
        const d = Math.abs(y + 0.5 - gcy);
        let c;
        if (d > (gy1 - gy0) / 2 - 1) c = P.st2;
        else if ((x - gx0) % 4 === 3) c = P.st1;
        else c = mod(y + Math.floor(rot), 3) === 0 ? P.copper2 : (d < 1.5 ? P.copper0 : P.copper1);
        f[y * W + x] = c;
      }
    }
    // Condenser: tubes carrying cooling water, condensate in the hotwell.
    const c = G.cond;
    const cwPos = flowing ? 2.4 : 0.6;
    for (let y = c[1] + 5; y <= c[3] - 7; y += 3) {
      for (let x = c[0] + 6; x <= c[2] - 6; x++) {
        const dash = flowing && mod(x - ph.cw, 12) < 2;
        f[y * W + x] = ramp(dash ? CW_DASH : CW, cwPos + (warm * (x - c[0]) / (c[2] - c[0])), x, y);
      }
    }
    for (let y = c[3] - 4; y <= c[3] - 2; y++) {
      for (let x = c[0] + 2; x <= c[2] - 2; x++) {
        f[y * W + x] = y === c[3] - 4 ? ((x + Math.floor(ph.ripple * 2)) % 5 === 0 ? P.foam : P.pool4) : ramp(CW, 1.6, x, y);
      }
    }
    const condense = clamp(s.qCond / C.Q_COND_FULL, 0, 1.5);
    if (condense > 0.01) {
      this.every('cond', condense * 26 * calm, dt, function () {
        this.p.add(DROP, c[0] + 6 + this.rand() * (c[2] - c[0] - 12), c[1] + 3, 0, 14 + this.rand() * 10, 3, 1, c[3] - 4);
      }.bind(this));
    }
    // Pumps: impellers spin with their speed.
    this.drawImpeller(f, G.pump.cx, G.pump.cy, 6, ph.pump, s.cold[1]);
    this.drawImpeller(f, G.feedPump.cx, G.feedPump.cy, 4, ph.fpump, s.tFeed);
    // Cooling tower plume, sized by the heat it throws away.
    const tower = G.tower;
    const heat = clamp(s.qCond / C.Q_COND_FULL, 0, 1.5) * (flowing ? 1 : 0);
    if (heat > 0.01) {
      const cx = (tower.x0 + tower.x1) / 2, half = (tower.x1 - tower.x0) * 0.36;
      this.every('plume', (1.5 + heat * 9) * calm, dt, function () {
        this.p.add(PLUME, cx + (this.rand() - 0.5) * half * 2, tower.top - 1, 2 + this.rand() * 3, -7 - this.rand() * 5 * heat, 7 + this.rand() * 5 * heat, 3 + 3 * heat, -1e9);
      }.bind(this));
    }
  };

  // Rows of blades on a shaft, sliding past as the rotor turns.
  Renderer.prototype.drawRotor = function (f, x0, y0, x1, y1, rot, grow0, grow1, s) {
    const cy = (y0 + y1) / 2, hh = (y1 - y0 + 1) / 2;
    const steam = s.wTurb > 0.5;
    for (let x = x0; x <= x1; x++) {
      const k = (x - x0) / Math.max(1, x1 - x0);
      const reach = hh * (grow0 + (grow1 - grow0) * k);
      const disc = (x - x0) % 3 !== 2;
      for (let y = y0; y <= y1; y++) {
        const d = Math.abs(y + 0.5 - cy);
        let c;
        if (d < 1) c = P.st5;                                     // shaft
        else if (disc && d < reach) c = BLADE[mod(y + Math.floor(rot), 3) === 0 ? 3 : 1 + (d < reach / 2 ? 1 : 0)];
        else c = steam && (x + y + Math.floor(rot * 2)) % 6 === 0 ? P.steam1 : P.st0;
        f[y * W + x] = c;
      }
    }
  };

  Renderer.prototype.drawImpeller = function (f, cx, cy, r, angle, temp) {
    const wPos = rampPos(Art.COOLANT_T, temp);
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        const dx = x + 0.5 - cx, dy = y + 0.5 - cy, d = Math.sqrt(dx * dx + dy * dy);
        if (d > r + 0.3) continue;
        let c;
        if (d < 1.6) c = P.st6;
        else {
          const a = mod(Math.atan2(dy, dx) - angle - d * 0.25, Math.PI / 2);
          c = a < 0.55 ? P.st5 : a < 0.8 ? P.st3 : ramp(COOL, wPos, x, y);
        }
        f[y * W + x] = c;
      }
    }
  };

  Renderer.prototype.drawGrid = function (f, s) {
    // Current along the power line.
    const mw = s.mwe;
    if (mw > 0.5) {
      const ph = this.phase.wire, pts = this.wire;
      for (let i = 0; i < pts.length; i++) {
        if (mod(i - ph, 10) < 2) {
          const x = pts[i][0], y = pts[i][1];
          f[y * W + x] = mod(i - ph, 10) < 1 ? P.sparkHi : P.spark;
        }
      }
    }
    // Town lights follow what the plant sends, and go out with the grid.
    const lit = s.in.offsitePower ? clamp(0.06 + 0.94 * s.mwe / s.demand, 0, 1) : 0;
    const wins = this.windows;
    for (let i = 0; i < wins.length; i++) {
      const w = wins[i];
      if (w.lamp) {
        if (s.in.offsitePower) { f[w.y * W + w.x] = P.win2; f[(w.y + 1) * W + w.x] = P.win3; }
        continue;
      }
      if (w.k < lit) {
        const c = w.k * 97 % 1 < 0.6 ? P.win1 : w.k * 97 % 1 < 0.85 ? P.win2 : P.win3;
        f[w.y * W + w.x] = c;
        f[(w.y + 1) * W + w.x] = c;
      }
    }
  };

  Renderer.prototype.drawLamps = function (f, s, view) {
    const blink = Math.floor(this.t * 2.5) % 2 === 0;
    // Beacon on the reactor building.
    const by = G.rb.roof - 5;
    let beacon = P.lampOff;
    if (s.tripped || s.damage) beacon = blink ? P.red : P.lampOff;
    else if (view.alarm) beacon = blink ? P.amber : P.lampOff;
    f[by * W + 102] = beacon;
    if (beacon !== P.lampOff) { f[(by - 1) * W + 102] = beacon; f[by * W + 101] = beacon; f[by * W + 103] = beacon; }
    // Primary pump motor lamp.
    const pumpOk = s.in.pumpOn && s.in.offsitePower;
    lamp(f, G.pump.cx + G.pump.r + 12, G.pump.cy - 6, pumpOk ? P.green : P.red);
    // Generator output lamp: green when feeding the grid.
    lamp(f, G.gen[2] - 3, G.gen[1] + 2, s.mwe > 0.5 ? P.green : s.turbineTripped ? P.red : P.amber);
    // Valves: green open, red shut.
    valve(f, 210, 108, s.dumpValve > 0.01, s.dumpValve);
    valve(f, 227, 98, !s.turbineTripped && s.valve > 0.01, s.valve);
    valve(f, 188, 60, s.sgSvOpen, s.sgSvOpen ? 1 : 0);
    f[95 * W + 183] = s.dhrsOn ? P.green : P.red;
    f[95 * W + 184] = s.dhrsOn ? P.green : P.red;
    // Pressurizer relief valves.
    const z = G.pzr;
    f[(z.y0 - 6) * W + z.x0 + 3] = (s.porvOpen || s.in.porv) ? P.green : P.st3;
    f[(z.y0 - 6) * W + z.x0 + 10] = s.pzrSvOpen ? P.green : P.st3;
  };

  function lamp(f, x, y, c) {
    f[y * W + x] = c; f[y * W + x + 1] = c;
  }
  // A small gate valve drawn on a vertical pipe: body, stem and a colour.
  function valve(f, x, y, open, amount) {
    const body = [
      '..hhhhh..',
      '....s....',
      '..ooooo..',
      '.occccco.',
      '..ooooo..'
    ];
    const c = open ? P.green : P.red;
    const stem = Math.round(clamp(amount, 0, 1) * 2);
    Art.sprite(f, x, y - stem, body.slice(0, 2), { h: P.st4, s: P.st5 });
    Art.sprite(f, x, y + 2, body.slice(2), { o: P.st0, c: c });
  }

  Renderer.prototype.drawParticles = function (f, s, dt, calm, view) {
    const p = this.p;
    for (let i = p.n - 1; i >= 0; i--) {
      p.age[i] += dt;
      const kind = p.kind[i];
      if (kind === PLUME) { p.vx[i] += 0.5 * dt; p.size[i] += 0.55 * dt; }
      if (kind === PUFF) p.size[i] += 1.2 * dt;
      p.x[i] += p.vx[i] * dt;
      p.y[i] += p.vy[i] * dt;
      if (kind === BUBBLE) p.x[i] += Math.sin(p.age[i] * 9 + i) * 0.15;
      const dead = p.age[i] >= p.life[i] ||
        ((kind === BUBBLE || kind === SHIMMER) && p.y[i] <= p.lim[i]) ||
        (kind === DROP && p.y[i] >= p.lim[i]) ||
        p.x[i] < -10 || p.x[i] > W + 10 || p.y[i] < -12 || p.y[i] > H;
      if (dead) { p.kill(i); continue; }
      const x = Math.floor(p.x[i]), y = Math.floor(p.y[i]);
      const a = p.age[i] / p.life[i];
      switch (kind) {
        case BUBBLE: set(f, x, y, P.steam3); break;
        case DROP: set(f, x, y, P.foam); break;
        case SHIMMER: if (a < 0.9) set(f, x, y, (x + y) & 1 ? P.pool4 : P.foam); break;
        case NEUTRON:
          if (!view.neutrons) { p.kill(i); break; }
          if (this.absorbed(x, y, s)) { set(f, x, y, P.sparkHi); p.kill(i); break; }
          set(f, x, y, P.sparkHi);
          set(f, Math.floor(p.x[i] - p.vx[i] * 0.02), Math.floor(p.y[i] - p.vy[i] * 0.02), P.cher2);
          break;
        case PUFF:
        case PLUME: {
          const fade = a < 0.15 ? a / 0.15 : 1 - (a - 0.15) / 0.85;
          blob(f, p.x[i], p.y[i], p.size[i], fade * (kind === PLUME ? 0.75 : 1), STEAM, 2.6 - a * 1.6);
          break;
        }
      }
    }
  };

  // Does a neutron at this pixel hit a rod?
  Renderer.prototype.absorbed = function (x, y, s) {
    const core = G.core, L = core.y1 - core.y0 + 1;
    if (y < core.y0 || y > core.y1 || x < core.x0 - 1 || x > core.x1 + 1) return x < 38 || x > 73 || y < core.y0 - 6 || y > core.y1 + 3;
    for (let i = 0; i < G.rods.length; i++) {
      const r = G.rods[i];
      if (x !== r.x && x !== r.x + 1) continue;
      const w = r.bank === 'control' ? s.rodX : s.rodY;
      const bottom = core.y1 - Math.round(w * L);
      if (y <= bottom) return true;
    }
    return false;
  };

  function set(f, x, y, c) {
    if (x >= 0 && y >= 0 && x < W && y < H) f[y * W + x] = c;
  }

  // Marching dashes round the part a visitor is looking at.
  Renderer.prototype.drawHighlight = function (f, id) {
    const part = Art.PARTS.filter(function (p) { return p.id === id; })[0];
    if (!part) return;
    const x0 = part.box[0] - 1, y0 = part.box[1] - 1, x1 = part.box[0] + part.box[2], y1 = part.box[1] + part.box[3];
    const off = Math.floor(this.t * 10);
    let i = 0;
    function dot(x, y) {
      if (mod(i++ - off, 4) < 2) set(f, x, y, P.white);
    }
    for (let x = x0; x <= x1; x++) dot(x, y0);
    for (let y = y0 + 1; y <= y1; y++) dot(x1, y);
    for (let x = x1 - 1; x >= x0; x--) dot(x, y1);
    for (let y = y1 - 1; y > y0; y--) dot(x0, y);
  };

  // Dotted leader lines from each label to the part it names.
  Renderer.prototype.drawLeaders = function (f, list) {
    for (let i = 0; i < list.length; i++) {
      const a = list[i].from, b = list[i].to;
      let x0 = Math.round(a[0]), y0 = Math.round(a[1]);
      const x1 = Math.round(b[0]), y1 = Math.round(b[1]);
      const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
      let err = dx + dy, n = 0;
      for (;;) {
        if (n++ % 2 === 0) set(f, x0, y0, P.st6);
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 >= dy) { err += dy; x0 += sx; }
        if (e2 <= dx) { err += dx; y0 += sy; }
      }
      set(f, x1, y1, P.white);
    }
  };

  Renderer.prototype.reset = function () { this.p.clear(); this.acc = {}; };

  const api = { Renderer: Renderer, W: W, H: H };
  root.ReactorRender = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
