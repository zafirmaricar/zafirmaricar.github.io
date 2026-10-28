// Rubber ducks that ride the rain. Each duck is a light rigid body. Probes
// around its hull read the nearby water: each wet probe lifts the hull and
// drags it along with the flow, so ducks float on puddles and get carried off
// by streams. Ducks bounce off rocks and
// falling chunks, and the water collides with them in turn. At most
// MAX_DUCKS are alive; while there is room a new one drops in every 7 s.
(function (root) {
  'use strict';

  const Rocks = root.Rocks;
  const MAX_DUCKS = 3;
  const SPAWN_FRAMES = 7 * 60;
  const GRAVITY = 0.2;        // px / frame^2
  const PROBE_COUNT = 16;
  const LIFT = 0.04;          // upward accel per fully wet probe
  const DRAG = 0.05;          // pull towards the water's velocity per wet probe
  const PROBE_R = 16;         // probe radius (px), about one particle spacing past h
  const WET_REF = 3.5;        // kernel sum of a probe on the surface of deep water
  const RIGHTING = 0.006;     // ducks are weighted to sit upright
  const RESTITUTION = 0.35;
  const MU_DRY = 0.45, MU_WET = 0.06;
  const SUBSTEPS = 3;
  const DT = 1 / SUBSTEPS;
  const MAX_SPEED = 12;
  const MAX_AGE = 45 * 60;    // then the duck fades out
  const STILL_FRAMES = 15 * 60;
  const FADE_FRAMES = 45;

  // Silhouette in design units (the body is 100 wide), facing right, y down.
  // Each part is an ellipse: [cx, cy, rx, ry, rotation].
  const PARTS = [
    [-4, 14, 44, 24, 0],       // body
    [-42, -3, 16, 8.5, 0.75],  // tail
    [20, -18, 21, 21, 0],      // head
    [43, -12, 12, 6.5, 0.12],  // beak
  ];
  function inPart(p, x, y) {
    const c = Math.cos(p[4]), s = Math.sin(p[4]);
    const dx = x - p[0], dy = y - p[1];
    const u = (c * dx + s * dy) / p[2], v = (-s * dx + c * dy) / p[3];
    return u * u + v * v <= 1;
  }
  function inDuck(x, y) {
    for (const p of PARTS) if (inPart(p, x, y)) return true;
    return false;
  }

  // Outline, probes and mass properties for a duck `size` px wide, centred on
  // its centre of mass.
  function buildShape(size) {
    const s = size / 100;
    const N = 48, ox = 0, oy = 6;
    const unit = new Float32Array(2 * N);
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      let last = 0;
      for (let t = 0; t < 80; t += 0.25) if (inDuck(ox + ca * t, oy + sa * t)) last = t;
      unit[2 * i] = ox + ca * last; unit[2 * i + 1] = oy + sa * last;
    }
    const c = Rocks.makePoly(unit);
    let inertia = 0;
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      const xi = (unit[2 * i] - c.cx) * s, yi = (unit[2 * i + 1] - c.cy) * s;
      const xj = (unit[2 * j] - c.cx) * s, yj = (unit[2 * j + 1] - c.cy) * s;
      inertia += Math.abs(xi * yj - xj * yi) * (xi * xi + xi * xj + xj * xj + yi * yi + yi * yj + yj * yj) / 12;
    }
    // Collide with the convex hull, so rain runs off the hollow of the back
    // instead of pooling between the tail and the head. The water sees the
    // hull with its underside raised halfway to the body's centre line, so
    // it laps up the sides and the duck sits in the water, not on it.
    const hull = Rocks.convexHull(unit);
    const n = hull.length;
    const lap = (y) => (y > 14 ? 14 + (y - 14) * 0.5 : y);
    const outline = new Float32Array(2 * n), wetHull = new Float32Array(2 * n);
    let radius = 0;
    for (let i = 0; i < n; i++) {
      outline[2 * i] = wetHull[2 * i] = (hull[i][0] - c.cx) * s;
      outline[2 * i + 1] = (hull[i][1] - c.cy) * s;
      wetHull[2 * i + 1] = (lap(hull[i][1]) - c.cy) * s;
      radius = Math.max(radius, Math.hypot(outline[2 * i], outline[2 * i + 1]));
    }
    // Contact samples along the outline, pulled in slightly.
    const samples = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = outline[2 * i], ay = outline[2 * i + 1], bx = outline[2 * j], by = outline[2 * j + 1];
      const k = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 6));
      for (let t = 0; t < k; t++) {
        const x = ax + ((bx - ax) * t) / k, y = ay + ((by - ay) * t) / k;
        const d = Math.hypot(x, y) || 1;
        samples.push(x - (x / d) * 1, y - (y / d) * 1);
      }
    }
    // Probes spread evenly round the silhouette the water sees, so a
    // submerged duck is lifted through its middle and the righting torque
    // turns it upright.
    const probes = new Float32Array(2 * PROBE_COUNT);
    for (let k = 0; k < PROBE_COUNT; k++) {
      const i = (k * N) / PROBE_COUNT;
      probes[2 * k] = (unit[2 * i] - c.cx) * s;
      probes[2 * k + 1] = (lap(unit[2 * i + 1]) - c.cy) * s;
    }
    return {
      size, scale: s, cx: c.cx, cy: c.cy, outline, wetHull, radius, probes,
      samples: new Float32Array(samples), invI: (c.area * s * s) / inertia,
    };
  }

  // The duck drawn into a 256 px texture covering 128 design units, with the
  // centre of mass in the middle.
  function drawSprite(shape) {
    const T = 256, k = T / 128;
    const cv = document.createElement('canvas');
    cv.width = cv.height = T;
    const g = cv.getContext('2d');
    g.translate(T / 2 - shape.cx * k, T / 2 - shape.cy * k);
    g.scale(k, k);
    const ell = (cx, cy, rx, ry, rot) => { g.beginPath(); g.ellipse(cx, cy, rx, ry, rot || 0, 0, Math.PI * 2); };

    // A darker rim round the whole silhouette: stroke every part, then fill
    // over the inner strokes.
    g.fillStyle = g.strokeStyle = '#c47f00';
    g.lineWidth = 3.5;
    for (const p of PARTS.slice(0, 3)) { ell(p[0], p[1], p[2], p[3], p[4]); g.stroke(); }
    const yellow = g.createLinearGradient(0, -40, 0, 40);
    yellow.addColorStop(0, '#ffe766');
    yellow.addColorStop(0.55, '#ffd21f');
    yellow.addColorStop(1, '#f0a800');
    g.fillStyle = yellow;
    for (const p of PARTS.slice(0, 3)) { ell(p[0], p[1], p[2], p[3], p[4]); g.fill(); }

    // Wing.
    ell(-10, 13, 19, 10, -0.22);
    g.fillStyle = '#f5b400'; g.fill();
    g.lineWidth = 1.6; g.strokeStyle = 'rgba(176, 108, 0, 0.7)'; g.stroke();

    // Beak with a mouth line.
    const b = PARTS[3];
    ell(b[0], b[1], b[2], b[3], b[4]);
    g.fillStyle = '#ff8a1c'; g.fill();
    g.lineWidth = 2.5; g.strokeStyle = '#c95800'; g.stroke();
    ell(b[0], b[1], b[2], b[3], b[4]);
    g.fillStyle = '#ff8a1c'; g.fill();
    g.beginPath(); g.moveTo(34, -11); g.quadraticCurveTo(44, -9.5, 54, -11.5);
    g.lineWidth = 1.4; g.strokeStyle = 'rgba(160, 60, 0, 0.8)'; g.stroke();

    // Cheek, eye and highlights.
    ell(30, -9, 4.5, 3.2); g.fillStyle = 'rgba(255, 110, 70, 0.35)'; g.fill();
    ell(27, -24, 4, 4.4); g.fillStyle = '#1b1712'; g.fill();
    ell(28.4, -25.6, 1.4, 1.4); g.fillStyle = '#fff'; g.fill();
    g.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ell(11, -30, 6, 3.4, -0.6); g.fill();
    ell(-22, 2, 11, 3.6, -0.15); g.fill();
    return cv;
  }

  // Point contact at offset (rx, ry) from the centre of mass, normal n, on a
  // collider moving at (cvx, cvy). Mass is 1; invI is per unit mass.
  function impulse(d, invI, rx, ry, nx, ny, cvx, cvy, mu) {
    const vpx = d.vx - d.w * ry - cvx, vpy = d.vy + d.w * rx - cvy;
    const vn = vpx * nx + vpy * ny;
    if (vn >= 0) return;
    const rn = rx * ny - ry * nx;
    const j = (-(1 + RESTITUTION) * vn) / (1 + rn * rn * invI);
    d.vx += j * nx; d.vy += j * ny;
    d.w += rn * j * invI;
    // Coulomb friction along the tangent.
    const tx = -ny, ty = nx;
    const vt = (d.vx - d.w * ry - cvx) * tx + (d.vy + d.w * rx - cvy) * ty;
    const rt = rx * ty - ry * tx;
    let jt = -vt / (1 + rt * rt * invI);
    const lim = mu * j;
    jt = jt < -lim ? -lim : jt > lim ? lim : jt;
    d.vx += jt * tx; d.vy += jt * ty;
    d.w += rt * jt * invI;
  }

  class Ducks {
    constructor(opts) {
      this.shape = buildShape(opts.size);
      // Texture covers 128 design units centred on the centre of mass.
      this.sprite = { canvas: drawSprite(this.shape), half: 64 * this.shape.scale };
      this.list = [];
      this.colliders = [];
      this.timer = 0;
      this.near = [];
      this.down = { x: 0, y: 1 }; // gravity's direction, shared with the water by step()
      const P = this.shape.probes.length / 2;
      this.probeAcc = new Float32Array(3 * P * MAX_DUCKS);
      this.probeWorld = new Float32Array(2 * P * MAX_DUCKS);
    }

    // Counts down to the next duck while there is room for one. Called once
    // per step while it rains; top and height give the screen in document px.
    countdown(rocks, width, top, height) {
      if (this.list.length >= MAX_DUCKS) { this.timer = 0; return; }
      if (++this.timer < SPAWN_FRAMES) return;
      // Rock all along the top of the screen: look again in a quarter second.
      this.timer = this.spawn(rocks, width, top, height) ? 0 : SPAWN_FRAMES - 15;
    }

    // rocks: static rocks; moving: falling chunk colliders; view: the
    // simulated band in document px. Returns colliders for the water.
    step(rocks, moving, sim, view) {
      const list = this.list;
      this.down = sim.down;
      if (list.length) this.feelWater(sim);
      for (let k = 0; k < list.length; k++) this.move(list[k], k, rocks, moving, sim.pointer);
      this.separate();

      const S = this.shape, cols = this.colliders;
      cols.length = 0;
      for (let k = list.length - 1; k >= 0; k--) {
        const d = list[k];
        d.age++;
        const still = d.vx * d.vx + d.vy * d.vy < 0.02 && Math.abs(d.w) < 0.002;
        d.still = still ? d.still + 1 : 0;
        if (d.age > MAX_AGE || d.still > STILL_FRAMES) d.leaving = true;
        if (d.leaving) d.alpha -= 1 / FADE_FRAMES;
        const r = S.radius;
        if (d.alpha <= 0 || d.y - r > view.bottom || d.y + r < view.top || d.x + r < view.left || d.x - r > view.right) {
          list.splice(k, 1);
          continue;
        }
        // World-space hull so the water can collide with the duck.
        const cos = Math.cos(d.angle), sin = Math.sin(d.angle);
        const L = S.wetHull, world = d.world;
        for (let i = 0; i < L.length; i += 2) {
          const lx = L[i] * d.flip, ly = L[i + 1];
          world[i] = d.x + cos * lx - sin * ly;
          world[i + 1] = d.y + sin * lx + cos * ly;
        }
        const col = Rocks.makePoly(world);
        col.vx = d.vx; col.vy = d.vy;
        cols.push(col);
      }
      return cols;
    }

    // Drop a duck in just above the top of the screen, clear of any rock. Of
    // a few random spots it prefers one over a rock in view, so the duck
    // lands in the water pooling there; then one with a clear fall; and only
    // then one over a rock at the top edge, where it would sit half hidden.
    spawn(rocks, width, top, height) {
      const S = this.shape, r = S.radius;
      const y = top - r - 10;
      let spot = null, bestRank = -1, bestLand = -Infinity;
      for (let tries = 0; tries < 10 && bestRank < 2; tries++) {
        const x = r + 10 + Math.random() * Math.max(0, width - 2 * r - 20);
        if (this.blocked(rocks, x, y)) continue;
        let land = Infinity; // top of the first rock below, by bounding box
        for (const rock of rocks) {
          if (x + r > rock.minX && x - r < rock.maxX && rock.maxY > y) land = Math.min(land, rock.minY);
        }
        const rank = land < top + 60 ? 0 : land > top + height ? 1 : 2;
        if (rank > bestRank || (rank === bestRank && land > bestLand)) { spot = x; bestRank = rank; bestLand = land; }
      }
      if (spot === null) return false;
      this.list.push({
        x: spot, y, vx: (Math.random() - 0.5) * 1.5, vy: 1.5,
        angle: (Math.random() - 0.5) * 0.6, w: (Math.random() - 0.5) * 0.03,
        flip: Math.random() < 0.5 ? 1 : -1, wet: 0,
        age: 0, still: 0, alpha: 1, leaving: false,
        world: new Float32Array(S.wetHull.length),
      });
      return true;
    }

    // True if a duck at (x, y) would overlap solid rock.
    blocked(rocks, x, y) {
      const L = this.shape.outline, r = this.shape.radius;
      for (const rock of rocks) {
        if (x + r < rock.minX || x - r > rock.maxX || y + r < rock.minY || y - r > rock.maxY) continue;
        for (let i = 0; i < L.length; i += 2) if (Rocks.solidAt(rock, x + L[i], y + L[i + 1])) return true;
      }
      return false;
    }

    // Kernel-weighted water amount and velocity at every probe.
    feelWater(sim) {
      const S = this.shape, list = this.list;
      const P = S.probes.length / 2, R = PROBE_R, R2 = R * R;
      const acc = this.probeAcc, pw = this.probeWorld;
      acc.fill(0);
      for (let k = 0; k < list.length; k++) {
        const d = list[k];
        const cos = Math.cos(d.angle), sin = Math.sin(d.angle);
        for (let p = 0; p < P; p++) {
          const lx = S.probes[2 * p] * d.flip, ly = S.probes[2 * p + 1];
          pw[2 * (k * P + p)] = d.x + cos * lx - sin * ly;
          pw[2 * (k * P + p) + 1] = d.y + sin * lx + cos * ly;
        }
        const ext = S.radius + R;
        d.minX = d.x - ext; d.maxX = d.x + ext; d.minY = d.y - ext; d.maxY = d.y + ext;
      }
      const { x, y, vx, vy } = sim;
      for (let i = 0; i < sim.count; i++) {
        const xi = x[i], yi = y[i];
        for (let k = 0; k < list.length; k++) {
          const d = list[k];
          if (xi < d.minX || xi > d.maxX || yi < d.minY || yi > d.maxY) continue;
          for (let p = k * P, e = p + P; p < e; p++) {
            const dx = xi - pw[2 * p], dy = yi - pw[2 * p + 1];
            const r2 = dx * dx + dy * dy;
            if (r2 >= R2) continue;
            const q = 1 - r2 / R2, w = q * q;
            acc[3 * p] += w; acc[3 * p + 1] += w * vx[i]; acc[3 * p + 2] += w * vy[i];
          }
        }
      }
    }

    move(d, k, rocks, moving, pointer) {
      const S = this.shape, invI = S.invI;
      const P = S.probes.length / 2;
      const acc = this.probeAcc, pw = this.probeWorld;
      const down = this.down;

      // Gravity, lift and drag from the water. Drag is solved implicitly so a
      // duck deep in fast water can't overshoot the flow; gravity and lift go
      // through the same solve so they balance where the duck floats. Lift
      // pushes straight against gravity.
      let fx = GRAVITY * down.x, fy = GRAVITY * down.y, tq = 0, lin = 0, ang = 0, lift = 0;
      for (let p = 0; p < P; p++) {
        const W = acc[3 * (k * P + p)];
        if (W < 1e-4) continue;
        const f = Math.min(1, W / WET_REF);
        const rx = pw[2 * (k * P + p)] - d.x, ry = pw[2 * (k * P + p) + 1] - d.y;
        const ux = acc[3 * (k * P + p) + 1] / W, uy = acc[3 * (k * P + p) + 2] / W;
        const c = DRAG * f;
        // Force c * (u - v - w x r) plus lift; the -c * v and -c * w x r
        // parts are taken implicitly below.
        const gx = c * (ux - d.vx) - LIFT * f * down.x, gy = c * (uy - d.vy) - LIFT * f * down.y;
        fx += gx + c * d.w * ry; fy += gy - c * d.w * rx;
        tq += rx * gy - ry * gx;
        lin += c;
        ang += c * (rx * rx + ry * ry);
        lift += LIFT * f;
      }
      d.wet = Math.min(1, lift / GRAVITY); // share of its weight the water carries
      d.vx += fx / (1 + lin);
      d.vy += fy / (1 + lin);
      d.w = (d.w + tq * invI) / (1 + ang * invI);

      // The cursor pushes ducks the way it pushes the water.
      if (pointer.active) {
        const dx = d.x - pointer.x, dy = d.y - pointer.y;
        const R = 70 + S.radius * 0.5, dist = Math.hypot(dx, dy);
        if (dist < R && dist > 1e-3) {
          const w = 1 - dist / R;
          d.vx += (dx / dist) * w * 0.3 + pointer.dx * w * 0.08;
          d.vy += (dy / dist) * w * 0.3 + pointer.dy * w * 0.08;
        }
      }

      // Upright means head away from gravity, so a tilt turns that too.
      d.w += -RIGHTING * Math.sin(d.angle + Math.atan2(down.x, down.y)) * (0.4 + 0.6 * d.wet);
      d.w *= 0.99;
      d.vx *= 0.997; d.vy *= 0.997;

      // Only colliders near the duck this frame.
      const near = this.near;
      near.length = 0;
      const ext = S.radius + MAX_SPEED + 4;
      for (const r of rocks) {
        if (d.x + ext > r.minX && d.x - ext < r.maxX && d.y + ext > r.minY && d.y - ext < r.maxY) near.push(r);
      }
      for (const r of moving) {
        if (d.x + ext > r.minX && d.x - ext < r.maxX && d.y + ext > r.minY && d.y - ext < r.maxY) near.push(r);
      }
      const mu = MU_DRY + (MU_WET - MU_DRY) * Math.min(1, d.wet * 3);
      const sm = S.samples;

      // Substeps keep a fast duck from sinking deep into a rock before the
      // contact is seen.
      for (let sub = 0; sub < SUBSTEPS; sub++) {
        const sp = Math.hypot(d.vx, d.vy);
        if (sp > MAX_SPEED) { d.vx *= MAX_SPEED / sp; d.vy *= MAX_SPEED / sp; }
        d.x += d.vx * DT; d.y += d.vy * DT; d.angle += d.w * DT;
        if (!near.length) continue;
        const cos = Math.cos(d.angle), sin = Math.sin(d.angle);
        let corrX = 0, corrY = 0, deepest = 0;
        for (let i = 0; i < sm.length; i += 2) {
          const lx = sm[i] * d.flip, ly = sm[i + 1];
          const rx = cos * lx - sin * ly, ry = sin * lx + cos * ly;
          const wx = d.x + rx, wy = d.y + ry;
          for (const r of near) {
            if (!Rocks.solidAt(r, wx, wy)) continue;
            const h = Rocks.contact(r, wx, wy);
            impulse(d, invI, rx, ry, h.nx, h.ny, r.vx || 0, r.vy || 0, mu);
            if (h.d > deepest) { deepest = h.d; corrX = h.nx * h.d; corrY = h.ny * h.d; }
            break;
          }
        }
        d.x += corrX * 0.8; d.y += corrY * 0.8;
      }
    }

    // Ducks bump into each other as circles.
    separate() {
      const list = this.list, rr = this.shape.radius * 1.5; // two body circles
      for (let a = 0; a < list.length; a++) {
        for (let b = a + 1; b < list.length; b++) {
          const A = list[a], B = list[b];
          const dx = B.x - A.x, dy = B.y - A.y;
          const dist = Math.hypot(dx, dy);
          if (dist >= rr || dist < 1e-3) continue;
          const nx = dx / dist, ny = dy / dist, push = (rr - dist) / 2;
          A.x -= nx * push; A.y -= ny * push;
          B.x += nx * push; B.y += ny * push;
          const vn = (B.vx - A.vx) * nx + (B.vy - A.vy) * ny;
          if (vn >= 0) continue;
          const j = (-(1 + RESTITUTION) * vn) / 2;
          A.vx -= j * nx; A.vy -= j * ny;
          B.vx += j * nx; B.vy += j * ny;
        }
      }
    }

    // A click on a duck makes it hop, against gravity. Returns true if (x, y)
    // hit one.
    hit(x, y) {
      const reach = this.shape.radius * 0.85, down = this.down;
      for (const d of this.list) {
        if (Math.hypot(x - d.x, y - d.y) > reach) continue;
        const vn = d.vx * down.x + d.vy * down.y;
        if (vn > -6) { d.vx -= (vn + 6) * down.x; d.vy -= (vn + 6) * down.y; }
        d.vx += (d.x - x) * 0.05 + (Math.random() - 0.5);
        d.w += (Math.random() - 0.5) * 0.15;
        return true;
      }
      return false;
    }

    // A blast at (x, y) throws the ducks within r away from it, spinning.
    blast(x, y, r, speed) {
      for (const d of this.list) {
        const dx = d.x - x, dy = d.y - y, dist = Math.hypot(dx, dy);
        if (dist >= r) continue;
        const k = speed * (1 - dist / r);
        d.vx += (dx / (dist || 1)) * k;
        d.vy += (dy / (dist || 1)) * k - k * 0.4;
        d.w += (Math.random() - 0.5) * 0.4;
      }
    }

    // Drop ducks that a layout change left inside a rock.
    removeInsideRocks(rocks) {
      for (let k = this.list.length - 1; k >= 0; k--) {
        const d = this.list[k];
        if (rocks.some((r) => Rocks.solidAt(r, d.x, d.y))) this.list.splice(k, 1);
      }
    }
  }

  root.Ducks = Ducks;
})(window);
