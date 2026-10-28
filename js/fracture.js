// Rock fracturing. Clicking a rock cracks it open at that spot; a second hit on
// the same spot breaks the chunk off. A TNT blast (see tnt.js) blows a far
// bigger hole and throws the rock out as a few huge chunks. A chunk keeps the
// text it covered (a clipped clone of the panel), flies as a rigid body,
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
      paintMedia(el, s);
      if (!s) return;
      // Damage is stored relative to the panel, so after a reflow (e.g. the
      // phone was rotated) it can reach past the new outline. Clip it to
      // this rock so it never cuts into a neighbour.
      const hull = Rocks.convexHull(rock.outer);
      for (const h of s.holes) {
        const pts = new Float32Array(h.pts.length);
        for (let i = 0; i < pts.length; i += 2) { pts[i] = h.pts[i] + ox; pts[i + 1] = h.pts[i + 1] + oy; }
        const hx = h.cx + ox, hy = h.cy + oy;
        // A hole is drawn as a fan from its centre. With the centre still in
        // the rock the clipped outline stays star-shaped about it; otherwise
        // clip each fan triangle on its own so the pieces stay exact.
        const pieces = [];
        if (Rocks.pointInPoly(rock, hx, hy)) {
          pieces.push({ pts: Rocks.clipToConvex(pts, hull), hx: hx, hy: hy });
        } else {
          const n = pts.length / 2;
          for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            pieces.push({ pts: Rocks.clipToConvex([hx, hy, pts[2 * i], pts[2 * i + 1], pts[2 * j], pts[2 * j + 1]], hull) });
          }
        }
        for (const p of pieces) {
          if (p.pts.length < 6) continue;
          const poly = Rocks.makePoly(p.pts);
          if (!(poly.area > 1)) continue;
          poly.hx = p.hx === undefined ? poly.cx : p.hx;
          poly.hy = p.hy === undefined ? poly.cy : p.hy;
          rock.holes.push(poly);
        }
      }
      // Cracks keep only their runs inside the rock; the stencil would
      // otherwise draw a stray end on a neighbouring rock.
      for (const sp of s.spots) {
        for (const c of sp.cracks) {
          let run = [];
          for (let i = 0; i <= c.length; i += 2) {
            const x = c[i] + ox, y = c[i + 1] + oy;
            if (i < c.length && Rocks.pointInPoly(rock, x, y)) { run.push(x, y); continue; }
            if (run.length >= 4) rock.cracks.push(new Float32Array(run));
            run = [];
          }
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
        if (sp.scar) continue; // cracks round a blast hole
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
      s.rev = (s.rev || 0) + 1;

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
      const piece = Rocks.carve(rock, px, py, shrunk, [], 0)[0];
      if (!piece) return;
      const pts = piece.pts;
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

    // A bomb going off at (x, y). Every rock in reach loses everything inside
    // a jagged outline about `radius` across: the rock next to the bomb turns
    // to dust and the rest flies off as a few huge chunks.
    blast(rocks, x, y, radius) {
      const outline = blastOutline(x, y, radius);
      const n = 5 + Math.floor(Math.random() * 3);
      const turn = Math.random() * Math.PI * 2;
      const cuts = [];
      for (let k = 0; k < n; k++) cuts.push(turn + ((k + (Math.random() - 0.5) * 0.5) * Math.PI * 2) / n);
      const core = radius * 0.15;

      // Chunks already flying get thrown too.
      const reach = radius * 1.6;
      for (const c of this.chunks) {
        const dx = c.x - x, dy = c.y - y, d = Math.hypot(dx, dy);
        if (d >= reach || d < 1e-3) continue;
        const k = (9 * (1 - d / reach)) / d;
        c.vx += dx * k; c.vy += dy * k - 2; c.w += (Math.random() - 0.5) * 0.1;
      }

      let broke = false;
      for (const rock of rocks) {
        if (!rock.el || rock.maxX < x - radius * 1.2 || rock.minX > x + radius * 1.2 ||
            rock.maxY < y - radius * 1.2 || rock.minY > y + radius * 1.2) continue;
        const pieces = Rocks.carve(rock, x, y, outline, cuts, core);
        if (!pieces.length) continue;
        const el = rock.el, s = this.state(el);
        // Clone the panel for the chunks before the new hole is masked out.
        for (const p of pieces) {
          const poly = Rocks.makePoly(p.pts);
          if (!(poly.area > 150)) continue;
          const ghost = this.makeGhost(el, rock.ox, rock.oy, p.pts, poly.cx, poly.cy);
          const c = makeChunk(p.pts, poly, p.px, p.py, el, ghost);
          const dx = poly.cx - x, dy = poly.cy - y, d = Math.hypot(dx, dy) || 1;
          const sp = (6 + Math.random() * 4) * (1.2 - 0.5 * Math.min(1, d / radius));
          c.vx = (dx / d) * sp + (Math.random() - 0.5) * 1.5;
          c.vy = (dy / d) * sp - 2.5 - Math.random() * 2;
          c.w = (Math.random() - 0.5) * 0.12;
          this.chunks.push(c);
        }
        const local = new Float32Array(outline.length);
        for (let i = 0; i < local.length; i += 2) { local[i] = outline[i] - rock.ox; local[i + 1] = outline[i + 1] - rock.oy; }
        const lx = x - rock.ox, ly = y - rock.oy;
        s.holes.push({ pts: local, cx: lx, cy: ly });
        // Cracks that were inside the hole went with it; new ones run out
        // from its rim.
        const gone = Rocks.makePoly(local);
        s.spots = s.spots.filter((sp) => sp.scar || !Rocks.pointInPoly(gone, sp.x, sp.y));
        s.spots.push({ x: lx, y: ly, hits: 0, scar: true, cracks: rimCracks(lx, ly, local) });
        s.rev = (s.rev || 0) + 1;
        applyMask(el, s.holes);
        broke = true;
      }
      if (broke) this.onDamage();
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
      // A piece of a playing clip keeps the frame it showed when it broke.
      // Clips hidden in a gallery are dropped so the piece shows what was on
      // screen.
      const clips = el.querySelectorAll('video');
      ghost.querySelectorAll('video').forEach((n, i) => {
        const src = clips[i];
        if (n.hidden) { n.remove(); return; }
        let still;
        if (src.readyState >= 2) {
          still = document.createElement('canvas');
          still.width = src.videoWidth; still.height = src.videoHeight;
          still.getContext('2d').drawImage(src, 0, 0);
        } else if (src.poster) {
          still = document.createElement('img');
          still.src = src.poster;
        } else {
          still = document.createElement('div');
        }
        still.className = n.className;
        n.replaceWith(still);
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

  // Jagged blast outline around (x, y), with its corners in angular order.
  function blastOutline(x, y, radius) {
    const k = 20 + Math.floor(Math.random() * 7);
    const out = new Float32Array(2 * k);
    for (let i = 0; i < k; i++) {
      const a = ((i + (Math.random() - 0.5) * 0.6) / k) * Math.PI * 2;
      const r = radius * (0.8 + Math.random() * 0.35);
      out[2 * i] = x + Math.cos(a) * r;
      out[2 * i + 1] = y + Math.sin(a) * r;
    }
    return out;
  }

  // Cracks running out from a blast hole's rim into the rock left behind.
  function rimCracks(x, y, outline) {
    const n = outline.length / 2;
    const cracks = [];
    for (let k = 0; k < 9; k++) {
      const i = Math.floor(Math.random() * n);
      const ox = outline[2 * i], oy = outline[2 * i + 1];
      const d = Math.hypot(ox - x, oy - y) || 1;
      const ext = 25 + Math.random() * 55;
      cracks.push(jagged(ox, oy, ox + ((ox - x) / d) * ext, oy + ((oy - y) / d) * ext));
    }
    return cracks;
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

  // Images and clips cover the stone, which hides the cracks drawn on the
  // canvas, so the cracks and fresh fracture rims are drawn again on top of
  // each media box and thumbnail as an SVG overlay. A box gets only the marks
  // that reach it, and is redrawn only when the damage or its place in the
  // panel changed, since this runs for every rock on every rebuild.
  const TAPER = 3;               // stroke widths along each crack, thick to thin
  const drawn = new WeakMap();   // media box or thumb -> key of what it shows
  const marked = new WeakSet();  // panels that may carry overlays

  function paintMedia(el, s) {
    if (!s) {
      if (!marked.has(el)) return;
      marked.delete(el);
      el.querySelectorAll('.media, .thumb').forEach((m) => {
        drawn.delete(m);
        const old = m.querySelector(':scope > .media-cracks');
        if (old) old.remove();
      });
      return;
    }
    const boxes = el.querySelectorAll('.media, .thumb');
    if (!boxes.length) return;
    marked.add(el);
    // Read every rect before writing, so the rebuild doesn't force a layout
    // per box.
    const pr = el.getBoundingClientRect();
    const rects = Array.prototype.map.call(boxes, (m) => m.getBoundingClientRect());
    let marks = null;
    boxes.forEach((m, b) => {
      const r = rects[b];
      const dx = r.left - pr.left, dy = r.top - pr.top;
      const key = s.rev + ':' + dx.toFixed(1) + ',' + dy.toFixed(1) + ',' + r.width.toFixed(1) + ',' + r.height.toFixed(1);
      if (drawn.get(m) === key) return;
      drawn.set(m, key);
      const old = m.querySelector(':scope > .media-cracks');
      if (old) old.remove();
      if (!marks) marks = damageMarks(s);
      let rims = '', light = '', dark = '';
      for (const mk of marks) {
        const p = mk.pad;
        if (mk.x1 + p < dx || mk.x0 - p > dx + r.width || mk.y1 + p < dy || mk.y0 - p > dy + r.height) continue;
        rims += mk.rim; light += mk.light; dark += mk.dark;
      }
      if (!rims && !dark) return;
      const svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('class', 'media-cracks');
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('fill', 'none');
      svg.setAttribute('stroke-linecap', 'round');
      svg.setAttribute('stroke-linejoin', 'round');
      svg.innerHTML = '<g transform="translate(' + (-dx).toFixed(1) + ' ' + (-dy).toFixed(1) + ')">' + rims +
        '<g transform="translate(.7 1)" stroke="rgba(128,128,133,.3)">' + light + '</g>' +
        '<g stroke="rgba(8,8,10,.85)">' + dark + '</g></g>';
      m.appendChild(svg);
    });
  }

  // The panel's holes and cracks as SVG in panel px, each with its bounds.
  // Cracks taper like the canvas ones: a faint light edge under a dark line.
  function damageMarks(s) {
    const f = (v) => v.toFixed(1);
    const marks = [];
    function mark(pts, pad) {
      const mk = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, pad: pad, rim: '', light: '', dark: '' };
      for (let i = 0; i < pts.length; i += 2) {
        if (pts[i] < mk.x0) mk.x0 = pts[i]; if (pts[i] > mk.x1) mk.x1 = pts[i];
        if (pts[i + 1] < mk.y0) mk.y0 = pts[i + 1]; if (pts[i + 1] > mk.y1) mk.y1 = pts[i + 1];
      }
      marks.push(mk);
      return mk;
    }
    for (const h of s.holes) {
      const p = [];
      for (let i = 0; i < h.pts.length; i += 2) p.push(f(h.pts[i]) + ',' + f(h.pts[i + 1]));
      const pts = p.join(' ');
      mark(h.pts, 7).rim = '<polygon points="' + pts + '" stroke="#807d78" stroke-opacity=".3" stroke-width="14"/>' +
        '<polygon points="' + pts + '" stroke="#807d78" stroke-opacity=".6" stroke-width="5"/>';
    }
    for (const sp of s.spots) {
      for (const c of sp.cracks) {
        const mk = mark(c, 4), segs = c.length / 2 - 1;
        for (let k = 0; k < TAPER; k++) {
          const a = Math.floor((k * segs) / TAPER), b = Math.floor(((k + 1) * segs) / TAPER);
          if (b <= a) continue;
          let d = 'M' + f(c[2 * a]) + ' ' + f(c[2 * a + 1]);
          for (let i = a + 1; i <= b; i++) d += 'L' + f(c[2 * i]) + ' ' + f(c[2 * i + 1]);
          const t = 1 - (k + 0.5) / TAPER;
          mk.light += '<path d="' + d + '" stroke-width="' + f(2 * (0.6 + t * 0.8)) + '"/>';
          mk.dark += '<path d="' + d + '" stroke-width="' + f(2 * (0.6 + t * 1.1)) + '"/>';
        }
      }
    }
    return marks;
  }

  function clearMask(el) {
    for (const k of ['maskImage', 'webkitMaskImage', 'maskSize', 'webkitMaskSize', 'maskRepeat', 'webkitMaskRepeat', 'maskPosition', 'webkitMaskPosition']) el.style[k] = '';
  }

  root.Fracture = Fracture;
})(window);
