// Rock outlines around content panels. The inner ring is the panel's rounded
// rectangle; the outer ring is pushed out by a smoothed random amount with a
// domed top so rain runs off. The outer ring is the collision polygon.
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
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      const [px, py, nx, ny] = pts[i];
      const u = (px - cx) / (w / 2);
      const o = off[i] + (ny < 0 ? dome * Math.max(0, 1 - u * u) * -ny : 0);
      inner[2 * i] = px; inner[2 * i + 1] = py;
      normals[2 * i] = nx; normals[2 * i + 1] = ny;
      const ox = px + nx * o, oy = py + ny * o;
      outer[2 * i] = ox; outer[2 * i + 1] = oy;
      if (ox < minX) minX = ox; if (ox > maxX) maxX = ox;
      if (oy < minY) minY = oy; if (oy > maxY) maxY = oy;
    }

    // Outward edge normals of the outer ring.
    const enx = new Float32Array(n), eny = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ex = outer[2 * j] - outer[2 * i], ey = outer[2 * j + 1] - outer[2 * i + 1];
      const len = Math.hypot(ex, ey) || 1;
      enx[i] = ey / len; eny[i] = -ex / len;
    }

    return { n, inner, outer, normals, nx: enx, ny: eny, cx, cy: y + h / 2, minX, minY, maxX, maxY };
  }

  root.Rocks = { makeRock, hashString };
  if (typeof module !== 'undefined') module.exports = root.Rocks;
})(typeof window !== 'undefined' ? window : globalThis);
