// Rock fracturing. Clicking a rock cracks it open at that spot; a second hit on
// the same spot breaks the chunk off. The chunk keeps the
// text it covered (a clipped clone of the panel), falls as a rigid body,
// collides with the other rocks and pushes water aside until it leaves the
// page. Damage is stored per panel in panel-local pixels so it survives
// relayouts and tab switches.
(function (root) {
  'use strict';

  const Rocks = root.Rocks;
  const MERGE_RADIUS = 45;   // hits closer than this build on the same fracture
  const HITS_TO_BREAK = 2;
  const GRAVITY = 0.32;      // px / frame^2
  const RESTITUTION = 0.2;
  const MU = 0.5;
  const SUBSTEPS = 3;
  const DT = 1 / SUBSTEPS;
  const MAX_SPEED = 22;
  const SVG_NS = 'http://www.w3.org/2000/svg';

  class Fracture {
    constructor(opts) {
      this.layer = opts.layer;       // absolutely positioned container for chunk text
      this.onDamage = opts.onDamage; // rebuild rock geometry
      this.renderer = opts.renderer;
      this.damage = new Map();       // panel element -> { holes, cracks, spots }
      this.chunks = [];
      this.colliders = [];
    }

    state(el) {
      let s = this.damage.get(el);
      if (!s) { s = { holes: [], cracks: [], spots: [] }; this.damage.set(el, s); }
      return s;
    }

    // Attach stored holes and cracks (converted to document px) to a freshly
    // built rock for panel `el` whose top-left is at (ox, oy).
    decorate(rock, el, ox, oy) {
      rock.el = el; rock.ox = ox; rock.oy = oy;
      rock.cracks = [];
      const s = this.damage.get(el);
      if (!s) return;
      for (const h of s.holes) {
        const pts = new Float32Array(h.pts.length);
        for (let i = 0; i < pts.length; i += 2) { pts[i] = h.pts[i] + ox; pts[i + 1] = h.pts[i + 1] + oy; }
        const poly = Rocks.makePoly(pts);
        poly.hx = h.cx + ox; poly.hy = h.cy + oy;
        rock.holes.push(poly);
      }
      for (const sp of s.spots) {
        for (const c of sp.cracks) {
          const pts = new Float32Array(c.length);
          for (let i = 0; i < pts.length; i += 2) { pts[i] = c[i] + ox; pts[i + 1] = c[i + 1] + oy; }
          rock.cracks.push(pts);
        }
      }
    }

    // Returns true if (x, y) hit solid rock.
    hit(rocks, x, y) {
      let rock = null;
      for (const r of rocks) if (r.el && Rocks.solidAt(r, x, y)) { rock = r; break; }
      if (!rock) return false;
      const s = this.state(rock.el);
      const lx = x - rock.ox, ly = y - rock.oy;

      let spot = null, best = MERGE_RADIUS;
      for (const sp of s.spots) {
        const d = Math.hypot(sp.x - lx, sp.y - ly);
        if (d < best) { best = d; spot = sp; }
      }
      if (!spot) {
        // The first hit decides the chunk's outline and cracks most of it
        // open, so the piece that breaks off follows the visible fracture.
        const outline = Rocks.star(lx, ly, 60 + Math.random() * 30, Math.random);
        spot = { x: lx, y: ly, hits: 0, outline: outline, cracks: majorCracks(lx, ly, outline) };
        s.spots.push(spot);
      } else {
        for (let k = 0; k < 3; k++) spot.cracks.push(crackLine(lx, ly, 30 + Math.random() * 30));
      }
      spot.hits++;

      if (spot.hits >= HITS_TO_BREAK) {
        s.spots.splice(s.spots.indexOf(spot), 1);
        this.breakOff(rock, s, spot);
      }
      this.onDamage();
      return true;
    }

    breakOff(rock, s, spot) {
      const px = spot.x + rock.ox, py = spot.y + rock.oy;
      const outline = new Float32Array(spot.outline.length);
      for (let i = 0; i < outline.length; i += 2) {
        outline[i] = spot.outline[i] + rock.ox;
        outline[i + 1] = spot.outline[i + 1] + rock.oy;
      }
      // The chunk is slightly smaller than the hole it leaves so it falls clear.
      const shrunk = new Float32Array(outline.length);
      for (let i = 0; i < outline.length; i += 2) {
        shrunk[i] = px + (outline[i] - px) * 0.94;
        shrunk[i + 1] = py + (outline[i + 1] - py) * 0.94;
      }
      const hull = Rocks.convexHull(rock.outer);
      const pts = Rocks.clipToConvex(shrunk, hull);
      if (pts.length < 6) return;
      const poly = Rocks.makePoly(pts);
      if (!(poly.area > 200)) return;

      const el = rock.el;
      const ghost = this.makeGhost(el, rock.ox, rock.oy, pts, poly.cx, poly.cy);

      const local = new Float32Array(outline.length);
      for (let i = 0; i < outline.length; i += 2) { local[i] = outline[i] - rock.ox; local[i + 1] = outline[i + 1] - rock.oy; }
      s.holes.push({ pts: local, cx: spot.x, cy: spot.y });
      applyMask(el, s.holes);

      this.chunks.push(makeChunk(pts, poly, px, py, el, ghost));
    }

    makeGhost(el, ox, oy, pts, cx, cy) {
      const ghost = el.cloneNode(true);
      ghost.classList.add('chunk');
      ghost.setAttribute('aria-hidden', 'true');
      ghost.removeAttribute('id');
      ghost.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
      ghost.querySelectorAll('object, iframe').forEach((n) => {
        const pad = document.createElement('div');
        pad.className = n.className;
        n.replaceWith(pad);
      });
      const box = el.getBoundingClientRect();
      const w = box.width, h = box.height;
      // The clone leaves its parent, so carry over box styles that may come
      // from the parent's context (padding, flex layout, font size). Line
      // height stays inherited: its resolved px value would not scale with
      // the children's own font sizes.
      const cs = getComputedStyle(el);
      for (const k of ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'fontSize', 'display', 'gap', 'flexWrap', 'alignItems', 'justifyContent']) ghost.style[k] = cs[k];
      const poly = [];
      for (let i = 0; i < pts.length; i += 2) poly.push((pts[i] - ox).toFixed(1) + 'px ' + (pts[i + 1] - oy).toFixed(1) + 'px');
      Object.assign(ghost.style, {
        position: 'absolute', left: ox + 'px', top: oy + 'px', width: w + 'px', height: h + 'px',
        margin: '0', pointerEvents: 'none',
        transformOrigin: (cx - ox) + 'px ' + (cy - oy) + 'px',
        clipPath: 'polygon(' + poly.join(',') + ')',
      });
      this.layer.appendChild(ghost);
      return ghost;
    }

    // Advance falling chunks. rocks: static rocks; bottom: document height.
    step(rocks, bottom) {
      const colliders = this.colliders;
      colliders.length = 0;
      for (let k = this.chunks.length - 1; k >= 0; k--) {
        const c = this.chunks[k];
        // Substeps keep fast chunks from sinking deep into a rock before the
        // contact is seen (which would pick the wrong surface normal).
        for (let sub = 0; sub < SUBSTEPS; sub++) {
          c.vy += GRAVITY * DT;
          const sp = Math.hypot(c.vx, c.vy);
          if (sp > MAX_SPEED) { c.vx *= MAX_SPEED / sp; c.vy *= MAX_SPEED / sp; }
          c.w *= 0.998;
          c.x += c.vx * DT; c.y += c.vy * DT; c.angle += c.w * DT;
          const cos = Math.cos(c.angle), sin = Math.sin(c.angle);

          let corrX = 0, corrY = 0, deepest = 0;
          // A chunk that has come to rest eventually drops off the page.
          const sm = c.age < 480 ? c.samples : [];
          for (let i = 0; i < sm.length; i += 2) {
            const rx = cos * sm[i] - sin * sm[i + 1], ry = sin * sm[i] + cos * sm[i + 1];
            const wx = c.x + rx, wy = c.y + ry;
            for (const r of rocks) {
              if (r.el === c.source || !Rocks.solidAt(r, wx, wy)) continue;
              const h = Rocks.contact(r, wx, wy);
              impulse(c, rx, ry, h.nx, h.ny);
              if (h.d > deepest) { deepest = h.d; corrX = h.nx * h.d; corrY = h.ny * h.d; }
              break;
            }
          }
          c.x += corrX * 0.8; c.y += corrY * 0.8;
        }
        c.age++;

        if (c.y - c.radius > bottom || c.age > 1800) {
          c.ghost.remove();
          this.renderer.releaseChunk(c);
          this.chunks.splice(k, 1);
          continue;
        }
        c.ghost.style.transform = 'translate(' + (c.x - c.c0x).toFixed(2) + 'px,' + (c.y - c.c0y).toFixed(2) + 'px) rotate(' + c.angle.toFixed(4) + 'rad)';

        // World-space polygon so the water can collide with the chunk.
        const cos = Math.cos(c.angle), sin = Math.sin(c.angle);
        const L = c.local, world = c.world;
        for (let i = 0; i < L.length; i += 2) {
          world[i] = c.x + cos * L[i] - sin * L[i + 1];
          world[i + 1] = c.y + sin * L[i] + cos * L[i + 1];
        }
        const col = Rocks.makePoly(world);
        col.vx = c.vx; col.vy = c.vy;
        colliders.push(col);
      }
      return colliders;
    }

    clearChunks() {
      for (const c of this.chunks) { c.ghost.remove(); this.renderer.releaseChunk(c); }
      this.chunks.length = 0;
      this.colliders.length = 0;
    }

    repair() {
      this.clearChunks();
      for (const el of this.damage.keys()) clearMask(el);
      this.damage.clear();
      this.onDamage();
    }
  }

  // Jagged crack from (x0, y0) to (x1, y1).
  function jagged(x0, y0, x1, y1) {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const k = Math.max(2, Math.round(len / 8));
    const nx = -(y1 - y0) / (len || 1), ny = (x1 - x0) / (len || 1);
    const pts = [x0, y0];
    for (let i = 1; i < k; i++) {
      const t = i / k, j = (Math.random() - 0.5) * 5;
      pts.push(x0 + (x1 - x0) * t + nx * j, y0 + (y1 - y0) * t + ny * j);
    }
    pts.push(x1, y1);
    return pts;
  }

  // A heavy first fracture: radial cracks out to the chunk outline, most of
  // the outline itself cracked open, and a few cracks running past it.
  function majorCracks(x, y, outline) {
    const n = outline.length / 2;
    const cracks = [];
    for (let i = 0; i < n; i += 2 + (Math.random() < 0.5 ? 1 : 0)) {
      cracks.push(jagged(x, y, outline[2 * i], outline[2 * i + 1]));
    }
    const start = Math.floor(Math.random() * n), span = Math.round(n * (0.6 + Math.random() * 0.2));
    for (let s = 0; s < span; s++) {
      const a = (start + s) % n, b = (a + 1) % n;
      cracks.push(jagged(outline[2 * a], outline[2 * a + 1], outline[2 * b], outline[2 * b + 1]));
    }
    for (let k = 0; k < 4; k++) {
      const i = Math.floor(Math.random() * n);
      const ox = outline[2 * i], oy = outline[2 * i + 1];
      const d = Math.hypot(ox - x, oy - y) || 1;
      const ext = 20 + Math.random() * 35;
      cracks.push(jagged(ox, oy, ox + ((ox - x) / d) * ext, oy + ((oy - y) / d) * ext));
    }
    return cracks;
  }

  function crackLine(x, y, len) {
    const pts = [x, y];
    let a = Math.random() * Math.PI * 2, l = 0;
    while (l < len) {
      a += (Math.random() - 0.5) * 0.9;
      const s = 5 + Math.random() * 6;
      x += Math.cos(a) * s; y += Math.sin(a) * s;
      pts.push(x, y);
      l += s;
    }
    return pts;
  }

  function makeChunk(pts, poly, px, py, source, ghost) {
    const n = pts.length / 2;
    const c0x = poly.cx, c0y = poly.cy;
    const local = new Float32Array(pts.length);
    let radius = 0, inertia = 0;
    for (let i = 0; i < n; i++) {
      local[2 * i] = pts[2 * i] - c0x; local[2 * i + 1] = pts[2 * i + 1] - c0y;
      radius = Math.max(radius, Math.hypot(local[2 * i], local[2 * i + 1]));
    }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const xi = local[2 * i], yi = local[2 * i + 1], xj = local[2 * j], yj = local[2 * j + 1];
      const cr = Math.abs(xi * yj - xj * yi);
      inertia += cr * (xi * xi + xi * xj + xj * xj + yi * yi + yi * yj + yj * yj);
    }
    inertia /= 12;
    // Contact samples along the outline, pulled in slightly.
    const samples = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = local[2 * i], ay = local[2 * i + 1], bx = local[2 * j], by = local[2 * j + 1];
      const k = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 10));
      for (let s = 0; s < k; s++) {
        const t = s / k;
        const x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
        const d = Math.hypot(x, y) || 1;
        samples.push(x - (x / d) * 1.5, y - (y / d) * 1.5);
      }
    }
    return {
      pts, px, py, c0x, c0y, local, world: new Float32Array(pts.length),
      samples: new Float32Array(samples), radius,
      x: c0x, y: c0y, vx: (Math.random() - 0.5) * 1.2, vy: 0.5, angle: 0, w: (Math.random() - 0.5) * 0.02,
      invMass: 1 / poly.area, invInertia: 1 / Math.max(inertia, 1),
      source, ghost, age: 0,
    };
  }

  // Point contact at offset (rx, ry) from the centre of mass, normal n.
  function impulse(c, rx, ry, nx, ny) {
    const vpx = c.vx - c.w * ry, vpy = c.vy + c.w * rx;
    const vn = vpx * nx + vpy * ny;
    if (vn >= 0) return;
    const rn = rx * ny - ry * nx;
    const j = (-(1 + RESTITUTION) * vn) / (c.invMass + rn * rn * c.invInertia);
    c.vx += j * nx * c.invMass; c.vy += j * ny * c.invMass;
    c.w += rn * j * c.invInertia;
    // Coulomb friction along the tangent.
    const tx = -ny, ty = nx;
    const vt = (c.vx - c.w * ry) * tx + (c.vy + c.w * rx) * ty;
    const rt = rx * ty - ry * tx;
    let jt = -vt / (c.invMass + rt * rt * c.invInertia);
    const lim = MU * j;
    jt = jt < -lim ? -lim : jt > lim ? lim : jt;
    c.vx += jt * tx * c.invMass; c.vy += jt * ty * c.invMass;
    c.w += rt * jt * c.invInertia;
  }

  // Hide broken-off regions of the panel's text with an SVG mask.
  function applyMask(el, holes) {
    const size = Math.ceil(Math.max(el.offsetWidth, el.offsetHeight) + 2000);
    let body = '<rect width="' + size + '" height="' + size + '" fill="white"/>';
    for (const h of holes) {
      const p = [];
      for (let i = 0; i < h.pts.length; i += 2) p.push(h.pts[i].toFixed(1) + ',' + h.pts[i + 1].toFixed(1));
      body += '<polygon points="' + p.join(' ') + '" fill="black"/>';
    }
    const svg = '<svg xmlns="' + SVG_NS + '" width="' + size + '" height="' + size + '"><defs><mask id="m">' + body +
      '</mask></defs><rect width="' + size + '" height="' + size + '" fill="white" mask="url(#m)"/></svg>';
    const url = 'url("data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg) + '")';
    for (const k of ['maskImage', 'webkitMaskImage']) el.style[k] = url;
    for (const k of ['maskSize', 'webkitMaskSize']) el.style[k] = size + 'px ' + size + 'px';
    for (const k of ['maskRepeat', 'webkitMaskRepeat']) el.style[k] = 'no-repeat';
    for (const k of ['maskPosition', 'webkitMaskPosition']) el.style[k] = '0 0';
  }

  function clearMask(el) {
    for (const k of ['maskImage', 'webkitMaskImage', 'maskSize', 'webkitMaskSize', 'maskRepeat', 'webkitMaskRepeat', 'maskPosition', 'webkitMaskPosition']) el.style[k] = '';
  }

  root.Fracture = Fracture;
})(window);
