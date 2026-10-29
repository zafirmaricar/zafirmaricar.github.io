// Rock geometry. Each content panel gets a jagged rock outline: the inner
// ring is the panel's rounded rectangle, the outer ring is pushed out by a
// smoothed random amount with a domed top so rain runs off. The outer ring is
// the collision polygon. Rocks can carry holes (broken-off chunks), so solid
// means "inside the outline and not inside any hole".
(function (root) {
  'use strict';

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hashString(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h >>> 0;
  }

  // Polygon with outward edge normals, bounding box, area and centroid.
  function makePoly(pts) {
    const n = pts.length / 2;
    let area = 0, cx = 0, cy = 0;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const xi = pts[2 * i], yi = pts[2 * i + 1], xj = pts[2 * j], yj = pts[2 * j + 1];
      const c = xi * yj - xj * yi;
      area += c; cx += (xi + xj) * c; cy += (yi + yj) * c;
      if (xi < minX) minX = xi; if (xi > maxX) maxX = xi;
      if (yi < minY) minY = yi; if (yi > maxY) maxY = yi;
    }
    area *= 0.5;
    cx /= 6 * area; cy /= 6 * area;
    const sign = area > 0 ? 1 : -1;
    const nx = new Float32Array(n), ny = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ex = pts[2 * j] - pts[2 * i], ey = pts[2 * j + 1] - pts[2 * i + 1];
      const len = Math.hypot(ex, ey) || 1;
      nx[i] = (sign * ey) / len; ny[i] = (-sign * ex) / len;
    }
    return { n, outer: pts, nx, ny, minX, minY, maxX, maxY, area: Math.abs(area), cx, cy, holes: [] };
  }

  function pointInPoly(poly, x, y) {
    if (x < poly.minX || x > poly.maxX || y < poly.minY || y > poly.maxY) return false;
    const pts = poly.outer, n = poly.n;
    let inside = false;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const yi = pts[2 * i + 1], yj = pts[2 * j + 1];
      if ((yi > y) !== (yj > y)) {
        const xi = pts[2 * i], xj = pts[2 * j];
        if (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
    }
    return inside;
  }

  function solidAt(rock, x, y) {
    if (!pointInPoly(rock, x, y)) return false;
    for (let h = 0; h < rock.holes.length; h++) if (pointInPoly(rock.holes[h], x, y)) return false;
    return true;
  }

  // Nearest surface point for a point inside the solid part of a rock.
  // Returns a shared object: surface point (x, y), normal pointing out of the
  // solid (nx, ny) and depth d.
  const hit = { x: 0, y: 0, nx: 0, ny: -1, d: 0 };
  function scanEdges(poly, x, y, sign) {
    const pts = poly.outer, n = poly.n;
    for (let e = 0; e < n; e++) {
      const ax = pts[2 * e], ay = pts[2 * e + 1];
      const f = e + 1 === n ? 0 : e + 1;
      const ex = pts[2 * f] - ax, ey = pts[2 * f + 1] - ay;
      const len2 = ex * ex + ey * ey;
      if (len2 < 1e-9) continue;
      let t = ((x - ax) * ex + (y - ay) * ey) / len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = ax + ex * t, qy = ay + ey * t;
      const d2 = (x - qx) * (x - qx) + (y - qy) * (y - qy);
      if (d2 < hit.d) { hit.d = d2; hit.x = qx; hit.y = qy; hit.nx = sign * poly.nx[e]; hit.ny = sign * poly.ny[e]; }
    }
  }
  function contact(rock, x, y) {
    hit.d = Infinity;
    scanEdges(rock, x, y, 1);
    for (let h = 0; h < rock.holes.length; h++) scanEdges(rock.holes[h], x, y, -1);
    hit.d = Math.sqrt(hit.d);
    return hit;
  }

  // opts.pond: instead of the dome, the top dips into a basin between lips
  // raised at the corners, so rain pools there like a pond until it spills
  // over the sides.
  const LIP_POW = 2.5; // basin profile |u|^p: flat in the middle, steeper near the lips
  function makeRock(x, y, w, h, seed, opts) {
    const rng = mulberry32(seed);
    const pond = opts && opts.pond ? Math.max(30, Math.min(60, w * 0.08)) : 0;
    const r = Math.max(4, Math.min(22, w / 4, h / 4));
    const pts = []; // [x, y, nx, ny]

    function arc(cx, cy, a0) {
      for (let s = 0; s <= 4; s++) {
        const a = a0 + (s * Math.PI) / 8;
        pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r, Math.cos(a), Math.sin(a)]);
      }
    }
    function line(x0, y0, x1, y1, nx, ny) {
      const k = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / 34));
      for (let s = 1; s < k; s++) {
        const t = s / k;
        pts.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, nx, ny]);
      }
    }
    // Clockwise on screen (y points down).
    arc(x + w - r, y + r, -Math.PI / 2);
    line(x + w, y + r, x + w, y + h - r, 1, 0);
    arc(x + w - r, y + h - r, 0);
    line(x + w - r, y + h, x + r, y + h, 0, 1);
    arc(x + r, y + h - r, Math.PI / 2);
    line(x, y + h - r, x, y + r, -1, 0);
    arc(x + r, y + r, Math.PI);
    line(x + r, y, x + w - r, y, 0, -1);

    const n = pts.length;
    // Smaller rocks get thinner rims so the stone stays close to the content.
    const jitter = Math.min(20, 6 + 0.08 * Math.min(w, h));
    let off = pts.map(() => 6 + rng() * jitter);
    for (let pass = 0; pass < 2; pass++) {
      off = off.map((o, i) => (off[(i + n - 1) % n] + 2 * o + off[(i + 1) % n]) / 4);
    }
    const cx = x + w / 2;
    const dome = Math.min(18, w * 0.03);

    const inner = new Float32Array(2 * n);
    const outer = new Float32Array(2 * n);
    const normals = new Float32Array(2 * n);
    for (let i = 0; i < n; i++) {
      const [px, py, nx, ny] = pts[i];
      const u = (px - cx) / (w / 2);
      inner[2 * i] = px; inner[2 * i + 1] = py;
      if (pond && ny < 0) {
        // The lips rise straight up, so the corners don't spread sideways.
        // The lighting follows the basin's slope: each lip's inner face
        // looks towards the middle.
        const a = Math.min(1, Math.abs(u));
        const lift = pond * Math.pow(a, LIP_POW) * -ny;
        const slope = (Math.sign(u) * pond * LIP_POW * Math.pow(a, LIP_POW - 1) * 2) / w;
        const mx = nx + ny * slope, len = Math.hypot(mx, ny);
        normals[2 * i] = mx / len; normals[2 * i + 1] = ny / len;
        outer[2 * i] = px + nx * off[i]; outer[2 * i + 1] = py + ny * off[i] - lift;
        continue;
      }
      const o = off[i] + (ny < 0 ? dome * Math.max(0, 1 - u * u) * -ny : 0);
      normals[2 * i] = nx; normals[2 * i + 1] = ny;
      outer[2 * i] = px + nx * o; outer[2 * i + 1] = py + ny * o;
    }

    const rock = makePoly(outer);
    rock.inner = inner;
    rock.normals = normals;
    rock.cx = cx; rock.cy = y + h / 2; // fan centre for rendering
    return rock;
  }

  // ---- Fracture geometry ---------------------------------------------------

  // Jagged star-shaped outline around (px, py).
  function star(px, py, radius, rng) {
    const k = 13 + Math.floor(rng() * 5);
    const out = new Float32Array(2 * k);
    for (let i = 0; i < k; i++) {
      const a = ((i + (rng() - 0.5) * 0.6) / k) * Math.PI * 2;
      const r = radius * (0.6 + rng() * 0.55);
      out[2 * i] = px + Math.cos(a) * r;
      out[2 * i + 1] = py + Math.sin(a) * r;
    }
    return out;
  }

  function convexHull(pts) {
    const p = [];
    for (let i = 0; i < pts.length; i += 2) p.push([pts[i], pts[i + 1]]);
    p.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [], upper = [];
    for (const q of p) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
      lower.push(q);
    }
    for (let i = p.length - 1; i >= 0; i--) {
      const q = p[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
      upper.push(q);
    }
    upper.pop(); lower.pop();
    return lower.concat(upper);
  }

  // Sutherland-Hodgman: clip polygon `pts` (flat array) to convex `hull`.
  function clipToConvex(pts, hull) {
    let poly = [];
    for (let i = 0; i < pts.length; i += 2) poly.push([pts[i], pts[i + 1]]);
    const m = hull.length;
    let area = 0;
    for (let i = 0; i < m; i++) { const a = hull[i], b = hull[(i + 1) % m]; area += a[0] * b[1] - b[0] * a[1]; }
    const sign = area > 0 ? 1 : -1;
    for (let i = 0; i < m && poly.length; i++) {
      const a = hull[i], b = hull[(i + 1) % m];
      const side = (q) => sign * ((b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0]));
      const input = poly;
      poly = [];
      for (let j = 0; j < input.length; j++) {
        const cur = input[j], prev = input[(j + input.length - 1) % input.length];
        const sc = side(cur), sp = side(prev);
        if (sc >= 0) {
          if (sp < 0) poly.push(lerp(prev, cur, sp / (sp - sc)));
          poly.push(cur);
        } else if (sp >= 0) {
          poly.push(lerp(prev, cur, sp / (sp - sc)));
        }
      }
    }
    const out = new Float32Array(poly.length * 2);
    poly.forEach((q, i) => { out[2 * i] = q[0]; out[2 * i + 1] = q[1]; });
    return out;
  }
  function lerp(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; }

  // ---- Carving -------------------------------------------------------------
  // Clipping to the convex hull would hand a pond rock's chunks the air above
  // its basin, so pieces are traced along rays from the centre instead.

  const MAX_RAY_GAP = 0.05; // radians between rays

  // Crossings of the ray from (cx, cy) along unit (dx, dy), for 0 < t < tMax,
  // with the edges of `poly`: pushes (t, tag) pairs onto `out`.
  function rayCrossings(poly, cx, cy, dx, dy, tMax, tag, out) {
    const ex0 = cx + dx * tMax, ey0 = cy + dy * tMax;
    if (Math.max(cx, ex0) < poly.minX || Math.min(cx, ex0) > poly.maxX ||
        Math.max(cy, ey0) < poly.minY || Math.min(cy, ey0) > poly.maxY) return;
    const pts = poly.outer, n = poly.n;
    for (let e = 0; e < n; e++) {
      const f = e + 1 === n ? 0 : e + 1;
      const ax = pts[2 * e], ay = pts[2 * e + 1];
      const ex = pts[2 * f] - ax, ey = pts[2 * f + 1] - ay;
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-12) continue;
      const qx = ax - cx, qy = ay - cy;
      const t = (qx * ey - qy * ex) / den, s = (qx * dy - qy * dx) / den;
      if (t > 0 && t < tMax && s >= 0 && s < 1) out.push(t, tag);
    }
  }

  // Distance from (x, y), a point in the solid part of `rock`, along unit
  // (dx, dy) to the first edge of the outline or of a hole, at most `tMax`.
  const runCross = [];
  function freeRun(rock, x, y, dx, dy, tMax) {
    runCross.length = 0;
    rayCrossings(rock, x, y, dx, dy, tMax, -1, runCross);
    for (let h = 0; h < rock.holes.length; h++) rayCrossings(rock.holes[h], x, y, dx, dy, tMax, h, runCross);
    let t = tMax;
    for (let k = 0; k < runCross.length; k += 2) if (runCross[k] < t) t = runCross[k];
    return t;
  }

  // Pieces of `rock` inside `outline`, a polygon star-shaped about (cx, cy)
  // with its vertices in angular order. Along each ray from the centre a
  // piece takes the first stretch of solid rock (inside the outline, outside
  // the holes) that reaches past radius `core`; rock nearer the centre, or
  // hidden behind a gap, is left out (turned to dust). Ascending angles in
  // `cuts` split the outline into wedges, one piece each, or more where the
  // rock in a wedge isn't connected. Returns [{ pts, px, py }], where the
  // piece is star-shaped about (px, py), near enough to draw it as a fan.
  function carve(rock, cx, cy, outline, cuts, core) {
    const nv = outline.length / 2;
    const va = new Float64Array(nv + 1);
    for (let i = 0; i < nv; i++) {
      let a = Math.atan2(outline[2 * i + 1] - cy, outline[2 * i] - cx);
      if (i) while (a < va[i - 1]) a += 2 * Math.PI;
      va[i] = a;
    }
    va[nv] = va[0] + 2 * Math.PI;
    const wrap = (a) => {
      while (a < va[0]) a += 2 * Math.PI;
      while (a >= va[nv]) a -= 2 * Math.PI;
      return a;
    };
    // Distance along the ray at angle `a` to the outline.
    function reach(a) {
      a = wrap(a);
      let i = 0;
      while (i < nv - 1 && va[i + 1] <= a) i++;
      const j = (i + 1) % nv;
      const dx = Math.cos(a), dy = Math.sin(a);
      const ax = outline[2 * i] - cx, ay = outline[2 * i + 1] - cy;
      const ex = outline[2 * j] - cx - ax, ey = outline[2 * j + 1] - cy - ay;
      const den = dx * ey - dy * ex;
      const t = Math.abs(den) > 1e-9 ? (ax * ey - ay * ex) / den : 0;
      return t > 0 ? t : Math.hypot(ax, ay);
    }

    // Which polygons the centre is in; each crossing on a ray flips one.
    const holes = rock.holes;
    const inOuter0 = pointInPoly(rock, cx, cy);
    const inHole0 = holes.map((h) => pointInPoly(h, cx, cy));
    const holeCount0 = inHole0.filter(Boolean).length;
    const cross = [], order = [], inHole = inHole0.slice();
    function span(a, t0) {
      const dx = Math.cos(a), dy = Math.sin(a), t1 = reach(a);
      cross.length = 0;
      rayCrossings(rock, cx, cy, dx, dy, t1, -1, cross);
      for (let h = 0; h < holes.length; h++) rayCrossings(holes[h], cx, cy, dx, dy, t1, h, cross);
      order.length = 0;
      for (let k = 0; k < cross.length; k += 2) order.push(k);
      order.sort((p, q) => cross[p] - cross[q]);
      let inOuter = inOuter0, holeCount = holeCount0;
      for (let h = 0; h < holes.length; h++) inHole[h] = inHole0[h];
      let start = inOuter && !holeCount ? 0 : -1;
      for (const k of order) {
        const t = cross[k], tag = cross[k + 1];
        if (tag < 0) inOuter = !inOuter;
        else { inHole[tag] = !inHole[tag]; holeCount += inHole[tag] ? 1 : -1; }
        const solid = inOuter && !holeCount;
        if (solid && start < 0) start = t;
        else if (!solid && start >= 0) {
          if (t > t0 + 1) return { a, dx, dy, t0: Math.max(start, t0), t1: t };
          start = -1;
        }
      }
      return start >= 0 && t1 > Math.max(start, t0) + 1 ? { a, dx, dy, t0: Math.max(start, t0), t1: t1 } : null;
    }

    // Two neighbouring rays belong to one piece when their spans overlap and
    // the rock between them is solid.
    function joined(p, q) {
      const lo = Math.max(p.t0, q.t0), hi = Math.min(p.t1, q.t1);
      if (lo >= hi) return false;
      const a = (p.a + q.a) / 2, t = (lo + hi) / 2;
      return solidAt(rock, cx + Math.cos(a) * t, cy + Math.sin(a) * t);
    }

    const bounds = cuts.length ? cuts.map(wrap).sort((p, q) => p - q) : [va[0]];
    bounds.push(bounds[0] + 2 * Math.PI);
    const pieces = [];
    for (let w = 0; w + 1 < bounds.length; w++) {
      const lo = bounds[w], hi = bounds[w + 1];
      // Rays at the wedge's edges, at every outline corner inside it, and
      // close enough together in between.
      const angles = [lo];
      for (let i = 0; i < nv; i++) {
        let a = va[i];
        while (a <= lo) a += 2 * Math.PI;
        while (a - 2 * Math.PI > lo) a -= 2 * Math.PI;
        if (a < hi) angles.push(a);
      }
      angles.push(hi);
      angles.sort((p, q) => p - q);
      const rays = [];
      for (let k = 0; k < angles.length; k++) {
        if (k) {
          const gap = angles[k] - angles[k - 1];
          if (gap < 1e-4) continue;
          const extra = Math.ceil(gap / MAX_RAY_GAP) - 1;
          for (let e = 1; e <= extra; e++) rays.push(span(angles[k - 1] + (gap * e) / (extra + 1), core));
        }
        rays.push(span(angles[k], core));
      }
      // A whole turn of solid rock from the centre out is one closed piece.
      if (!cuts.length && core <= 0 && rays.every((r) => r && r.t0 === 0)) {
        rays.pop();
        const pts = [];
        for (const r of rays) pts.push(cx + r.dx * r.t1, cy + r.dy * r.t1);
        pieces.push({ pts: simplify(pts), px: cx, py: cy });
        continue;
      }
      let run = [];
      for (let k = 0; k <= rays.length; k++) {
        const r = rays[k];
        if (r && (!run.length || joined(run[run.length - 1], r))) { run.push(r); continue; }
        if (run.length >= 2) pieces.push(runPiece(run, cx, cy));
        run = r ? [r] : [];
      }
    }
    return pieces;
  }

  // Outline of a run of ray spans: far ends out, near ends back.
  function runPiece(run, cx, cy) {
    const pts = [];
    for (const r of run) pts.push(cx + r.dx * r.t1, cy + r.dy * r.t1);
    let apex = false;
    for (let k = run.length - 1; k >= 0; k--) {
      const r = run[k];
      if (r.t0 > 0.5) pts.push(cx + r.dx * r.t0, cy + r.dy * r.t0);
      else if (!apex) { pts.push(cx, cy); apex = true; }
    }
    const m = run[run.length >> 1];
    const t = (m.t0 + m.t1) / 2;
    return { pts: simplify(pts), px: cx + m.dx * t, py: cy + m.dy * t };
  }

  // Drops points that lie on the line from the last point kept to the next.
  function simplify(pts) {
    const n = pts.length / 2;
    const keep = [pts[0], pts[1]];
    let ax = pts[0], ay = pts[1];
    for (let i = 1; i < n; i++) {
      const q = (i + 1) % n;
      const bx = pts[2 * q], by = pts[2 * q + 1], x = pts[2 * i], y = pts[2 * i + 1];
      const len = Math.hypot(bx - ax, by - ay);
      const off = len > 1e-6 ? Math.abs((bx - ax) * (y - ay) - (by - ay) * (x - ax)) / len : Math.hypot(x - ax, y - ay);
      if (off > 0.25) { keep.push(x, y); ax = x; ay = y; }
    }
    return new Float32Array(keep.length >= 6 ? keep : pts);
  }

  root.Rocks = { makeRock, makePoly, pointInPoly, solidAt, contact, hashString, mulberry32, star, convexHull, clipToConvex, carve, freeRun };
  if (typeof module !== 'undefined') module.exports = root.Rocks;
})(typeof window !== 'undefined' ? window : globalThis);
