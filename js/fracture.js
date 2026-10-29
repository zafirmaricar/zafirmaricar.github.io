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
  const MIN_MERGE = 16;      // (3/4 of the size of a smaller one, but at least this)
  const HITS_TO_BREAK = 2;
  const MIN_RADIUS = 8;      // smallest chunk outline
  const PROBES = 24;         // directions that size up the rock at a first hit
  const MIN_CHUNK = 40;      // px^2; a smaller piece crumbles to dust
  const SMALL = 6000;        // px^2; a piece of rock up to this size breaks off whole
  const CELL = 2;            // px; grid the search for a small piece runs on
  const SPAN = 160;          // px; how far from the hit that search looks
  const PIECE_DIRS = 180;    // corners round a small piece's outline
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

      let spot = null, best = Infinity;
      for (const sp of s.spots) {
        if (sp.scar) continue; // cracks round a hole
        const d = Math.hypot(sp.x - lx, sp.y - ly);
        // A small piece is one spot wherever on it the hit lands.
        const near = d < sp.merge || (sp.region && Rocks.pointInPoly(sp.region, lx, ly));
        if (near && d < best) { best = d; spot = sp; }
      }
      if (!spot) {
        // The first hit decides the chunk's outline and cracks most of it
        // open, so the piece that breaks off follows the visible fracture.
        // The outline is only as big as the rock round the hit, so a thin
        // strip or a neck between holes breaks off at its own size instead
        // of taking a big bite out of the rock it hangs from.
        const full = 60 + Math.random() * 30;
        const t = thickness(rock, x, y, full);
        const r = Math.max(MIN_RADIUS, Math.min(full, t));
        const outline = Rocks.star(lx, ly, r, Math.random);
        const merge = Math.max(MIN_MERGE, Math.min(MERGE_RADIUS, r * 0.75));
        spot = { x: lx, y: ly, r: r, merge: merge, hits: 0, outline: outline };
        // A small piece of rock on its own (or hanging on by a thread)
        // cracks all over instead, and the next hit takes all of it rather
        // than chipping it into even smaller bits. Rock any thicker than
        // this can't be such a piece, so the search is skipped there.
        const piece = t < Math.sqrt(2 * SMALL) ? smallPiece(rock, x, y) : null;
        if (piece) {
          const local = shift(piece.outline, -rock.ox, -rock.oy);
          spot.region = Rocks.makePoly(local);
          spot.cracks = majorCracks(lx, ly, pick(local, 14), 0);
        } else {
          spot.cracks = majorCracks(lx, ly, outline, Math.min(1, r / 60));
        }
        s.spots.push(spot);
      } else {
        const len = 30 * Math.min(1, spot.r / 60);
        for (let k = 0; k < 3; k++) spot.cracks.push(crackLine(lx, ly, len * (1 + Math.random())));
      }
      spot.hits++;
      s.rev = (s.rev || 0) + 1;

      if (spot.hits >= HITS_TO_BREAK) {
        s.spots.splice(s.spots.indexOf(spot), 1);
        this.breakOff(rock, s, spot, x, y);
      }
      this.onDamage();
      return true;
    }

    // Breaks off the spot's chunk; (x, y) is the hit that broke it.
    breakOff(rock, s, spot, x, y) {
      const px = spot.x + rock.ox, py = spot.y + rock.oy;
      if (spot.region) {
        // Look at the small piece again, as the rock round it may have
        // changed since it cracked, and take all of it.
        const at = Rocks.solidAt(rock, px, py);
        const piece = smallPiece(rock, at ? px : x, at ? py : y);
        if (piece) { this.cut(rock, s, piece.cx, piece.cy, piece.outline, piece.outline); return; }
      }
      const outline = shift(spot.outline, rock.ox, rock.oy);
      // The chunk is slightly smaller than the hole it leaves so it falls clear.
      const shrunk = new Float32Array(outline.length);
      for (let i = 0; i < outline.length; i += 2) {
        shrunk[i] = px + (outline[i] - px) * 0.94;
        shrunk[i + 1] = py + (outline[i + 1] - py) * 0.94;
      }
      this.cut(rock, s, px, py, shrunk, outline);
    }

    // Knocks a hole in the rock where `outline` is (doc px, star-shaped about
    // (px, py)), and the solid rock seen from (px, py) inside `inner` flies
    // off as a chunk.
    cut(rock, s, px, py, inner, outline) {
      const el = rock.el;
      const piece = Rocks.carve(rock, px, py, inner, [], 0)[0];
      const poly = piece && Rocks.makePoly(piece.pts);
      // Clone the panel for the chunk before the new hole is masked out. A
      // crumb too small to fly just turns to dust.
      if (poly && poly.area > MIN_CHUNK) {
        const ghost = this.makeGhost(el, rock.ox, rock.oy, piece.pts, poly.cx, poly.cy);
        this.chunks.push(makeChunk(piece.pts, poly, px, py, el, ghost));
      }

      const local = shift(outline, -rock.ox, -rock.oy);
      s.holes.push({ pts: local, cx: px - rock.ox, cy: py - rock.oy });
      // A cracked spot the hole swallowed keeps the cracks still showing
      // round it, but a hit there starts a new fracture sized to what's left.
      const gone = Rocks.makePoly(local);
      for (const sp of s.spots) if (!sp.scar && Rocks.pointInPoly(gone, sp.x, sp.y)) sp.scar = true;
      applyMask(el, s.holes);
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
        const local = shift(outline, -rock.ox, -rock.oy);
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

  // How thick the rock is at (x, y): the shortest line through it that
  // stays in solid rock, ending at the rock's edge or a hole (at most
  // 2 * `max`). Anywhere in a big rock, even next to its edge, that's the
  // whole rock, but on a neck left between holes, a strip along the edge or
  // a small leftover piece it's about the piece's width.
  function thickness(rock, x, y, max) {
    let min = 2 * max;
    for (let k = 0; k < PROBES; k++) {
      const a = (k / PROBES) * Math.PI, dx = Math.cos(a), dy = Math.sin(a);
      min = Math.min(min, Rocks.freeRun(rock, x, y, dx, dy, max) + Rocks.freeRun(rock, x, y, -dx, -dy, max));
    }
    return min;
  }

  // The small piece of rock that (x, y) is on, if there is one: all the
  // solid rock joined to it, where joins thinner than a few px don't count,
  // so a piece hanging on by a thread counts on its own. Returns null if
  // that's more than SMALL, else { cx, cy, outline }: (cx, cy) a point deep
  // in the piece, and `outline` a polygon star-shaped about it that holds
  // all of the piece but stops short of the rock round it.
  function smallPiece(rock, x, y) {
    const h = Math.round(SPAN / CELL), N = 2 * h + 1;
    const x0 = x - h * CELL, y0 = y - h * CELL; // centre of cell 0; the hit is cell (h, h)
    const solid = new Int8Array(N * N).fill(-1);
    const at = (k) => {
      if (solid[k] < 0) {
        const i = k % N;
        solid[k] = Rocks.solidAt(rock, x0 + i * CELL, y0 + ((k - i) / N) * CELL) ? 1 : 0;
      }
      return solid[k] === 1;
    };
    const border = (k) => { const i = k % N, j = (k - i) / N; return i < 2 || j < 2 || i > N - 3 || j > N - 3; };
    const limit = SMALL / (CELL * CELL);
    // Cells joined to `start` through cells that pass `ok`, or null if they
    // run past `limit` or out to the edge of the grid.
    function fill(start, ok) {
      const seen = new Uint8Array(N * N);
      const list = [start];
      seen[start] = 1;
      for (let q = 0; q < list.length; q++) {
        const k = list[q];
        if (border(k)) return null;
        for (const n of [k - 1, k + 1, k - N, k + N]) {
          if (seen[n] || !ok(n)) continue;
          seen[n] = 1;
          if (list.push(n) > limit) return null;
        }
      }
      return list;
    }
    const around = (k) => [k, k - 1, k + 1, k - N, k + N, k - N - 1, k - N + 1, k + N - 1, k + N + 1];
    const start = h * N + h;
    let cells = fill(start, at);
    if (!cells) {
      // Too big all told, but the hit may be on a piece that hangs on by
      // threads. Thinning the rock by a cell all round cuts them.
      const core = (k) => around(k).every(at);
      const seed = around(start).find(core);
      const inner = seed === undefined ? null : fill(seed, core);
      if (!inner) return null;
      // Put back the rim the thinning took off.
      const mark = new Uint8Array(N * N);
      cells = [];
      for (const k of inner) for (const n of around(k)) if (!mark[n] && at(n)) { mark[n] = 1; cells.push(n); }
      if (cells.length > limit) return null;
    }

    // Centre on the cell deepest in the piece (nearest the middle of it if
    // there's a tie), so the chunk carved from there sees all of it.
    const inside = new Uint8Array(N * N);
    for (const k of cells) inside[k] = 1;
    const depth = new Int16Array(N * N).fill(-1);
    const queue = cells.filter((k) => !(inside[k - 1] && inside[k + 1] && inside[k - N] && inside[k + N]));
    for (const k of queue) depth[k] = 0;
    for (let q = 0; q < queue.length; q++) {
      const k = queue[q];
      for (const n of [k - 1, k + 1, k - N, k + N]) if (inside[n] && depth[n] < 0) { depth[n] = depth[k] + 1; queue.push(n); }
    }
    const top = depth[queue[queue.length - 1]];
    let mx = 0, my = 0;
    for (const k of cells) { mx += k % N; my += Math.floor(k / N); }
    mx /= cells.length; my /= cells.length;
    let deep = -1, bestD = Infinity;
    for (const k of cells) {
      if (depth[k] !== top) continue;
      const d = Math.hypot((k % N) - mx, Math.floor(k / N) - my);
      if (d < bestD) { bestD = d; deep = k; }
    }
    const cx = x0 + (deep % N) * CELL, cy = y0 + Math.floor(deep / N) * CELL;

    // How far out the piece reaches in each direction from there, and how
    // near other rock comes. A cell counts in every direction it spans.
    const K = PIECE_DIRS, step = (2 * Math.PI) / K, half = CELL * Math.SQRT1_2;
    const far = new Float32Array(K), near = new Float32Array(K).fill(Infinity);
    function spread(k, fn) {
      const dx = x0 + (k % N) * CELL - cx, dy = y0 + Math.floor(k / N) * CELL - cy;
      const d = Math.hypot(dx, dy), a = Math.atan2(dy, dx), w = Math.atan(half / Math.max(d, half));
      for (let b = Math.floor((a - w) / step); b <= Math.floor((a + w) / step); b++) fn(((b % K) + K) % K, d);
    }
    let i0 = N, i1 = 0, j0 = N, j1 = 0;
    for (const k of cells) {
      spread(k, (b, d) => { if (d + half > far[b]) far[b] = d + half; });
      const i = k % N, j = Math.floor(k / N);
      i0 = Math.min(i0, i); i1 = Math.max(i1, i); j0 = Math.min(j0, j); j1 = Math.max(j1, j);
    }
    for (let j = Math.max(0, j0 - 3); j <= Math.min(N - 1, j1 + 3); j++) {
      for (let i = Math.max(0, i0 - 3); i <= Math.min(N - 1, i1 + 3); i++) {
        const k = j * N + i;
        if (!inside[k] && at(k)) spread(k, (b, d) => { if (d - half < near[b]) near[b] = d - half; });
      }
    }
    // Corner b sits between directions b - 1 and b. It reaches a little past
    // the piece but not into rock just beyond it, and stops short of rock
    // that is in the way (the piece behind that is left).
    const out = new Float32Array(2 * K);
    for (let b = 0; b < K; b++) {
      const p = (b + K - 1) % K;
      const f = Math.max(far[p], far[b]), c = Math.min(near[p], near[b]);
      const t = c < f - 4 ? Math.max(0.5, c - 0.5) : Math.max(f, Math.min(f + 1.5, c - 0.25));
      out[2 * b] = cx + Math.cos(b * step) * t;
      out[2 * b + 1] = cy + Math.sin(b * step) * t;
    }
    return { cx, cy, outline: Rocks.simplify(out) };
  }

  function shift(pts, dx, dy) {
    const out = new Float32Array(pts.length);
    for (let i = 0; i < pts.length; i += 2) { out[i] = pts[i] + dx; out[i + 1] = pts[i + 1] + dy; }
    return out;
  }

  // About `k` of the corners of `pts`, evenly spread.
  function pick(pts, k) {
    const n = pts.length / 2;
    if (n <= k) return pts;
    const out = new Float32Array(2 * k);
    for (let i = 0; i < k; i++) {
      const j = Math.floor((i * n) / k);
      out[2 * i] = pts[2 * j]; out[2 * i + 1] = pts[2 * j + 1];
    }
    return out;
  }

  // A heavy first fracture: radial cracks out to the chunk outline, most of
  // the outline itself cracked open, and a few cracks running `past` it (a
  // fraction of the usual length; none round a small piece).
  function majorCracks(x, y, outline, past) {
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
    for (let k = 0; past > 0 && k < 4; k++) {
      const i = Math.floor(Math.random() * n);
      const ox = outline[2 * i], oy = outline[2 * i + 1];
      const d = Math.hypot(ox - x, oy - y) || 1;
      const ext = (20 + Math.random() * 35) * past;
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
