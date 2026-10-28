// 2D particle fluid: double density relaxation (Clavet et al. 2005,
// "Particle-based Viscoelastic Fluid Simulation") with a uniform-grid
// neighbour search. Positions are in document pixels, time step is one frame.
(function (root) {
  'use strict';

  const Rocks = root.Rocks || require('./rocks.js');

  const DEFAULTS = {
    maxParticles: 2400,
    h: 15,              // interaction radius (px)
    restDensity: 3.0,
    stiffness: 0.02,
    nearStiffness: 0.08,
    gravity: 0.22,      // px / frame^2
    viscositySigma: 0.08,
    viscosityBeta: 0.03,
    friction: 0.12,
    maxSpeed: 16,
    pointerRadius: 70,
    restFrames: 360,    // frames nearly still before a particle may evaporate
  };

  class FluidSim {
    constructor(opts) {
      this.p = Object.assign({}, DEFAULTS, opts);
      const N = this.p.maxParticles;
      this.capacity = N;
      this.limit = N;
      this.count = 0;
      this.x = new Float32Array(N);
      this.y = new Float32Array(N);
      this.px = new Float32Array(N);
      this.py = new Float32Array(N);
      this.vx = new Float32Array(N);
      this.vy = new Float32Array(N);
      this.still = new Uint16Array(N);
      this.rho = new Float32Array(N);
      this.rhoNear = new Float32Array(N);
      this.dx = new Float32Array(N);
      this.dy = new Float32Array(N);
      this.cellOf = new Int32Array(N);
      this.sorted = new Int32Array(N);
      this.cellStart = new Int32Array(1);
      this.cellCursor = new Int32Array(1);
      const maxPairs = N * 40;
      this.maxPairs = maxPairs;
      this.pairI = new Int32Array(maxPairs);
      this.pairJ = new Int32Array(maxPairs);
      this.pairQ = new Float32Array(maxPairs);
      this.pairUx = new Float32Array(maxPairs);
      this.pairUy = new Float32Array(maxPairs);
      this.pairCount = 0;
      this.rocks = [];
      this.pointer = { active: false, x: 0, y: 0, dx: 0, dy: 0 };
      // Unit vector gravity pulls along; tilting a phone turns it.
      this.down = { x: 0, y: 1 };
    }

    setLimit(n) { this.limit = Math.max(0, Math.min(this.capacity, n | 0)); }

    add(x, y, vx, vy) {
      if (this.count >= this.limit) return -1;
      const i = this.count++;
      this.x[i] = x; this.y[i] = y;
      this.vx[i] = vx; this.vy[i] = vy;
      this.px[i] = x - vx; this.py[i] = y - vy;
      this.still[i] = 0;
      return i;
    }

    splash(x, y, n) {
      for (let k = 0; k < n; k++) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * 14;
        const s = 2 + Math.random() * 5;
        this.add(x + Math.cos(a) * r, y + Math.sin(a) * r, Math.cos(a) * s, Math.sin(a) * s - 3);
      }
    }

    // Throws the water within r of (x, y) outwards and a little up: `speed`
    // at the centre, fading to nothing at r.
    blast(x, y, r, speed) {
      const r2 = r * r;
      for (let i = 0; i < this.count; i++) {
        const dx = this.x[i] - x, dy = this.y[i] - y, d2 = dx * dx + dy * dy;
        if (d2 >= r2) continue;
        const d = Math.sqrt(d2) || 1, k = speed * (1 - d / r);
        this.vx[i] += (dx / d) * k;
        this.vy[i] += (dy / d) * k - k * 0.3;
        this.still[i] = 0;
      }
    }

    remove(i) {
      const last = --this.count;
      if (i === last) return;
      this.x[i] = this.x[last]; this.y[i] = this.y[last];
      this.px[i] = this.px[last]; this.py[i] = this.py[last];
      this.vx[i] = this.vx[last]; this.vy[i] = this.vy[last];
      this.still[i] = this.still[last];
    }

    clear() { this.count = 0; }

    setRocks(rocks) { this.rocks = rocks; }

    // Drop particles that a layout change left buried inside a rock.
    removeInsideRocks() {
      for (let i = this.count - 1; i >= 0; i--) {
        for (const r of this.rocks) {
          if (Rocks.solidAt(r, this.x[i], this.y[i])) { this.remove(i); break; }
        }
      }
    }

    // view: { left, right, top, bottom } in document px; particles outside are recycled.
    step(view) {
      const p = this.p;
      const { x, y, px, py, vx, vy } = this;
      const maxV = p.maxSpeed;

      // Gravity, then advance to predicted positions.
      const gx = p.gravity * this.down.x, gy = p.gravity * this.down.y;
      for (let i = 0; i < this.count; i++) {
        vx[i] += gx; vy[i] += gy;
        const s2 = vx[i] * vx[i] + vy[i] * vy[i];
        if (s2 > maxV * maxV) {
          const k = maxV / Math.sqrt(s2);
          vx[i] *= k; vy[i] *= k;
        }
        px[i] = x[i]; py[i] = y[i];
        x[i] += vx[i]; y[i] += vy[i];
      }

      this.applyPointer();

      // Recycle particles that left the view or have sat still for a long time.
      for (let i = this.count - 1; i >= 0; i--) {
        if (y[i] > view.bottom || y[i] < view.top || x[i] < view.left || x[i] > view.right) {
          this.remove(i);
        } else if (this.still[i] > p.restFrames && Math.random() < 0.004) {
          this.remove(i);
        }
      }

      this.findPairs(view);
      this.relax();
      this.collide();

      // Velocities from the corrected positions.
      for (let i = 0; i < this.count; i++) {
        vx[i] = x[i] - px[i];
        vy[i] = y[i] - py[i];
        const s2 = vx[i] * vx[i] + vy[i] * vy[i];
        this.still[i] = s2 < 0.04 ? Math.min(this.still[i] + 1, 65535) : 0;
      }

      this.viscosity();
    }

    applyPointer() {
      const ptr = this.pointer;
      if (!ptr.active) return;
      const R = this.p.pointerRadius, R2 = R * R;
      for (let i = 0; i < this.count; i++) {
        const dx = this.x[i] - ptr.x, dy = this.y[i] - ptr.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= R2 || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        const w = 1 - d / R;
        this.x[i] += (dx / d) * w * 3 + ptr.dx * w * 0.6;
        this.y[i] += (dy / d) * w * 3 + ptr.dy * w * 0.6;
      }
    }

    findPairs(view) {
      const h = this.p.h, h2 = h * h;
      const n = this.count;
      const left = view.left, top = view.top;
      const cols = Math.max(1, Math.ceil((view.right - left) / h) + 1);
      const rows = Math.max(1, Math.ceil((view.bottom - top) / h) + 1);
      const nc = cols * rows;
      if (this.cellStart.length < nc + 1) {
        this.cellStart = new Int32Array(nc + 1);
        this.cellCursor = new Int32Array(nc + 1);
      }
      const start = this.cellStart, cursor = this.cellCursor;
      start.fill(0, 0, nc + 1);
      const { x, y, cellOf, sorted } = this;

      for (let i = 0; i < n; i++) {
        let cx = ((x[i] - left) / h) | 0, cy = ((y[i] - top) / h) | 0;
        if (cx < 0) cx = 0; else if (cx >= cols) cx = cols - 1;
        if (cy < 0) cy = 0; else if (cy >= rows) cy = rows - 1;
        const c = cy * cols + cx;
        cellOf[i] = c;
        start[c + 1]++;
      }
      for (let c = 0; c < nc; c++) start[c + 1] += start[c];
      cursor.set(start.subarray(0, nc));
      for (let i = 0; i < n; i++) sorted[cursor[cellOf[i]]++] = i;

      const { pairI, pairJ, pairQ, pairUx, pairUy } = this;
      let np = 0;
      const maxPairs = this.maxPairs;
      outer:
      for (let i = 0; i < n; i++) {
        const c = cellOf[i];
        const cx = c % cols, cy = (c / cols) | 0;
        const xi = x[i], yi = y[i];
        for (let oy = -1; oy <= 1; oy++) {
          const ry = cy + oy;
          if (ry < 0 || ry >= rows) continue;
          for (let ox = -1; ox <= 1; ox++) {
            const rx = cx + ox;
            if (rx < 0 || rx >= cols) continue;
            const cc = ry * cols + rx;
            for (let k = start[cc], e = start[cc + 1]; k < e; k++) {
              const j = sorted[k];
              if (j <= i) continue;
              const dx = x[j] - xi, dy = y[j] - yi;
              const r2 = dx * dx + dy * dy;
              if (r2 >= h2 || r2 < 1e-8) continue;
              const r = Math.sqrt(r2);
              pairI[np] = i; pairJ[np] = j;
              pairQ[np] = r / h;
              pairUx[np] = dx / r; pairUy[np] = dy / r;
              if (++np >= maxPairs) break outer;
            }
          }
        }
      }
      this.pairCount = np;
    }

    relax() {
      const p = this.p;
      const n = this.count, np = this.pairCount;
      const { rho, rhoNear, dx, dy, pairI, pairJ, pairQ, pairUx, pairUy } = this;
      rho.fill(0, 0, n); rhoNear.fill(0, 0, n);
      dx.fill(0, 0, n); dy.fill(0, 0, n);
      for (let k = 0; k < np; k++) {
        const q1 = 1 - pairQ[k];
        const a = q1 * q1, b = a * q1;
        rho[pairI[k]] += a; rho[pairJ[k]] += a;
        rhoNear[pairI[k]] += b; rhoNear[pairJ[k]] += b;
      }
      const k0 = p.stiffness, kn = p.nearStiffness, r0 = p.restDensity;
      for (let k = 0; k < np; k++) {
        const i = pairI[k], j = pairJ[k];
        const q1 = 1 - pairQ[k];
        const P = k0 * (rho[i] + rho[j] - 2 * r0) * 0.5;
        const Pn = kn * (rhoNear[i] + rhoNear[j]) * 0.5;
        const D = (P * q1 + Pn * q1 * q1) * 0.5 * this.p.h;
        const ux = pairUx[k] * D, uy = pairUy[k] * D;
        dx[i] -= ux; dy[i] -= uy;
        dx[j] += ux; dy[j] += uy;
      }
      const lim = 4;
      for (let i = 0; i < n; i++) {
        let ddx = dx[i], ddy = dy[i];
        const m2 = ddx * ddx + ddy * ddy;
        if (m2 > lim * lim) { const s = lim / Math.sqrt(m2); ddx *= s; ddy *= s; }
        this.x[i] += ddx; this.y[i] += ddy;
      }
    }

    collide() {
      const rocks = this.rocks;
      if (!rocks.length) return;
      const { x, y, px, py } = this;
      const fr = 1 - this.p.friction;
      for (let i = 0; i < this.count; i++) {
        const xi = x[i], yi = y[i];
        for (let r = 0; r < rocks.length; r++) {
          const rock = rocks[r];
          if (!Rocks.solidAt(rock, xi, yi)) continue;
          const c = Rocks.contact(rock, xi, yi);
          const bnx = c.nx, bny = c.ny;
          const nxp = c.x + bnx * 0.5, nyp = c.y + bny * 0.5;
          // Relative to the collider (moving chunks carry water along): keep
          // tangential motion with friction, drop motion into the surface.
          const cvx = rock.vx || 0, cvy = rock.vy || 0;
          const vxi = xi - px[i] - cvx, vyi = yi - py[i] - cvy;
          const vn = vxi * bnx + vyi * bny;
          let tx = (vxi - vn * bnx) * fr, ty = (vyi - vn * bny) * fr;
          if (vn > 0) { tx += vn * bnx; ty += vn * bny; }
          x[i] = nxp; y[i] = nyp;
          px[i] = nxp - tx - cvx; py[i] = nyp - ty - cvy;
          break;
        }
      }
    }

    viscosity() {
      const { vx, vy, pairI, pairJ, pairQ, pairUx, pairUy } = this;
      const sigma = this.p.viscositySigma, beta = this.p.viscosityBeta;
      for (let k = 0; k < this.pairCount; k++) {
        const i = pairI[k], j = pairJ[k];
        const ux = pairUx[k], uy = pairUy[k];
        const u = (vx[i] - vx[j]) * ux + (vy[i] - vy[j]) * uy;
        if (u <= 0) continue;
        const I = (1 - pairQ[k]) * (sigma * u + beta * u * u) * 0.5;
        vx[i] -= I * ux; vy[i] -= I * uy;
        vx[j] += I * ux; vy[j] += I * uy;
      }
    }

    // Interleaved [x, y, speed] for the renderer.
    fill(buf) {
      for (let i = 0; i < this.count; i++) {
        buf[3 * i] = this.x[i];
        buf[3 * i + 1] = this.y[i];
        buf[3 * i + 2] = Math.sqrt(this.vx[i] * this.vx[i] + this.vy[i] * this.vy[i]);
      }
      return this.count;
    }
  }

  root.FluidSim = FluidSim;
  if (typeof module !== 'undefined') module.exports = { FluidSim };
})(typeof window !== 'undefined' ? window : globalThis);
