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

  function makeRock(x, y, w, h, seed) {
    const rng = mulberry32(seed);
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
    let off = pts.map(() => 8 + rng() * 20);
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
      const o = off[i] + (ny < 0 ? dome * Math.max(0, 1 - u * u) * -ny : 0);
      inner[2 * i] = px; inner[2 * i + 1] = py;
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

  root.Rocks = { makeRock, makePoly, pointInPoly, solidAt, contact, hashString, mulberry32, star, convexHull, clipToConvex };
  if (typeof module !== 'undefined') module.exports = root.Rocks;
})(typeof window !== 'undefined' ? window : globalThis);
