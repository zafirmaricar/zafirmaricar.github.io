// The pixel art: palette, drawing helpers, where every part of the plant
// sits, and the static background, all drawn in code into one 480 × 270
// buffer. No image files and no DOM, so Node can draw it too.
(function (root) {
  'use strict';

  const W = 480, H = 270;
  const GROUND = 178;          // top of the grass
  const POOL_TOP = 84;         // pool surface when full
  const POOL_BOTTOM = 262;

  // Colours are kept as 0xAABBGGRR so they go straight into ImageData.
  function rgb(hex) {
    const v = parseInt(hex.slice(1), 16);
    return (0xff000000 | ((v & 255) << 16) | (v & 0xff00) | (v >>> 16)) >>> 0;
  }
  function mix(a, b, t) {
    const r = (a & 255) + ((b & 255) - (a & 255)) * t;
    const g = ((a >>> 8) & 255) + (((b >>> 8) & 255) - ((a >>> 8) & 255)) * t;
    const bl = ((a >>> 16) & 255) + (((b >>> 16) & 255) - ((a >>> 16) & 255)) * t;
    return (0xff000000 | (Math.round(bl) << 16) | (Math.round(g) << 8) | Math.round(r)) >>> 0;
  }

  const HEX = {
    // night sky
    sky0: '#05081a', sky1: '#080e24', sky2: '#0c1530', sky3: '#111d3c', sky4: '#17264a',
    star: '#dfe6ff', starDim: '#7383b8', moon: '#f1f0e4', moonShade: '#c9c6b4',
    hill: '#0c1428', hillHi: '#111b33',
    // ground
    grass: '#2f5530', grassHi: '#43733c', earth0: '#1b1410', earth1: '#241b15', earth2: '#2e231b', pebble: '#3d3026',
    // concrete
    con0: '#14171e', con1: '#1d212a', con2: '#272c37', con3: '#343a47', con4: '#454d5c', con5: '#5c6577', con6: '#7a849a',
    // steel
    st0: '#0b0e15', st1: '#1c2331', st2: '#2b3548', st3: '#3e4c66', st4: '#586b8c', st5: '#7c92b6', st6: '#b3c4de',
    // inside the buildings
    hall0: '#141923', hall1: '#1a202c', hall2: '#212836', hallLamp: '#f4e7b0',
    vac: '#070a10', vac1: '#0b0f17',
    cv0: '#0a0f18', cv1: '#0e1521', cv2: '#131c2b', cv3: '#1a2638',
    // pool water, from deep to the surface
    pool0: '#071a35', pool1: '#0b2547', pool2: '#10325c', pool3: '#164174', pool4: '#20568f', foam: '#9fd2ff',
    // coolant temperature ramp: cold blue through yellow to red and white-hot
    c0: '#13265e', c1: '#1b3f9a', c2: '#2563d4', c3: '#2f8fe8', c4: '#3cc0e6', c5: '#7fe0c0', c6: '#e8d84a',
    c7: '#f5a733', c8: '#ee6a2c', c9: '#d93a2b', c10: '#ff6b6b', c11: '#ffd6c2',
    // fuel temperature ramp
    f0: '#3a3036', f1: '#55303a', f2: '#7a2c2c', f3: '#a8381f', f4: '#d75a1c', f5: '#f08a24', f6: '#f8bb3c', f7: '#ffe27a', f8: '#fff6d8',
    // steam and vapour
    steam0: '#5d6b80', steam1: '#8b98ad', steam2: '#b9c4d4', steam3: '#e3e9f1',
    // lights
    lampOff: '#2a1f22', green: '#3ee07a', red: '#ff3b3b', amber: '#ffb020', blue: '#4aa8ff',
    cher0: '#2a6cff', cher1: '#4f9bff', cher2: '#8fc8ff', cher3: '#d6ecff',
    spark: '#ffe36b', sparkHi: '#fff8d0',
    win0: '#0e1320', win1: '#ffcf5c', win2: '#ffe9a6', win3: '#f59f3a',
    bld0: '#121827', bld1: '#182034', bld2: '#1f2940', bldHi: '#2a3654',
    absorber: '#1a1d24', absorberHi: '#3a3f4b', tipCtl: '#f2b632', tipSd: '#e2453a',
    copper0: '#5a2f16', copper1: '#a85a26', copper2: '#e09a52',
    white: '#ffffff', black: '#000000'
  };
  const P = {};
  for (const k in HEX) P[k] = rgb(HEX[k]);

  const COOLANT = ['c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9', 'c10', 'c11'].map(function (k) { return P[k]; });
  // Temperatures (°C) at each step of the coolant ramp. Most of the range
  // goes to the 280–335 °C the loop runs at, so hot and cold legs differ.
  const COOLANT_T = [30, 150, 230, 270, 286, 296, 304, 311, 318, 325, 336, 360];
  const FUEL = ['f0', 'f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8'].map(function (k) { return P[k]; });
  const FUEL_T = [280, 340, 420, 520, 640, 780, 1100, 1700, 2600];
  const STEEL = ['st1', 'st2', 'st3', 'st4', 'st5'].map(function (k) { return P[k]; });
  const CONCRETE = ['con1', 'con2', 'con3', 'con4', 'con5'].map(function (k) { return P[k]; });
  const STEAM = ['steam0', 'steam1', 'steam2', 'steam3'].map(function (k) { return P[k]; });
  const POOL = ['pool0', 'pool1', 'pool2', 'pool3', 'pool4'].map(function (k) { return P[k]; });
  const CHER = ['cher0', 'cher1', 'cher2', 'cher3'].map(function (k) { return P[k]; });

  // 4 × 4 ordered dither thresholds.
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(function (v) { return (v + 0.5) / 16; });
  function bayer(x, y) { return BAYER[((y & 3) << 2) | (x & 3)]; }

  // Pick from a ramp at a fractional position, dithering between neighbours.
  function ramp(R, pos, x, y) {
    if (pos <= 0) return R[0];
    const last = R.length - 1;
    if (pos >= last) return R[last];
    const i = pos | 0;
    return pos - i > bayer(x, y) ? R[i + 1] : R[i];
  }
  // Position on a ramp for a value, from the value at each step.
  function rampPos(T, v) {
    if (v <= T[0]) return 0;
    const last = T.length - 1;
    if (v >= T[last]) return last;
    let i = 1;
    while (T[i] < v) i++;
    return i - 1 + (v - T[i - 1]) / (T[i] - T[i - 1]);
  }
  function coolant(t, x, y) { return ramp(COOLANT, rampPos(COOLANT_T, t), x, y); }
  function fuel(t, x, y) { return ramp(FUEL, rampPos(FUEL_T, t), x, y); }

  // ---------------------------------------------------------------------------
  // Drawing helpers. `b` is a Uint32Array of W × H pixels.

  function px(b, x, y, c) {
    if (x >= 0 && y >= 0 && x < W && y < H) b[y * W + x] = c;
  }
  function rect(b, x, y, w, h, c) {
    const x0 = Math.max(0, x), y0 = Math.max(0, y), x1 = Math.min(W, x + w), y1 = Math.min(H, y + h);
    for (let j = y0; j < y1; j++) b.fill(c, j * W + x0, j * W + x1);
  }
  function line(b, x0, y0, x1, y1, c) {
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      px(b, x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }
  // Fill every pixel the test accepts; the rim gets `edge` when given.
  function shape(b, x0, y0, x1, y1, inside, fill, edge) {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (!inside(x, y)) continue;
        const rim = edge !== undefined && (!inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1));
        px(b, x, y, rim ? edge : (typeof fill === 'function' ? fill(x, y) : fill));
      }
    }
  }
  // A vertical vessel with elliptical heads, spanning x0..x1 and y0..y1.
  function capsule(x0, y0, x1, y1, head) {
    const cx = (x0 + x1 + 1) / 2, a = (x1 - x0 + 1) / 2;
    const top = y0 + head, bot = y1 + 1 - head;
    return function (x, y) {
      const dx = x + 0.5 - cx, py = y + 0.5;
      if (Math.abs(dx) > a || py < y0 || py > y1 + 1) return false;
      if (py >= top && py <= bot) return true;
      const dy = py < top ? (top - py) / head : (py - bot) / head;
      return (dx / a) * (dx / a) + dy * dy <= 1;
    };
  }
  function inset(test, n) {
    return function (x, y) {
      for (let i = -n; i <= n; i++) {
        if (!test(x + i, y) || !test(x, y + i)) return false;
      }
      return test(x, y);
    };
  }
  function box(x0, y0, x1, y1) {
    return function (x, y) { return x >= x0 && x <= x1 && y >= y0 && y <= y1; };
  }
  // Round shading across a vertical cylinder lit from the upper left.
  function vShade(R, x0, x1, bias) {
    const w = x1 - x0 + 1;
    return function (x, y) {
      const u = (x + 0.5 - x0) / w;
      const v = Math.max(0, Math.min(1, 0.95 - 1.55 * Math.abs(u - 0.3) + (bias || 0)));
      return ramp(R, v * (R.length - 1), x, y);
    };
  }
  // ... and across a horizontal one lit from above.
  function hShade(R, y0, y1, bias) {
    const h = y1 - y0 + 1;
    return function (x, y) {
      const u = (y + 0.5 - y0) / h;
      const v = Math.max(0, Math.min(1, 0.95 - 1.55 * Math.abs(u - 0.28) + (bias || 0)));
      return ramp(R, v * (R.length - 1), x, y);
    };
  }
  // Dithered vertical gradient across a list of colours.
  function vGrad(b, x, y, w, h, R) {
    for (let j = 0; j < h; j++) {
      const pos = h > 1 ? j / (h - 1) * (R.length - 1) : 0;
      for (let i = 0; i < w; i++) px(b, x + i, y + j, ramp(R, pos, x + i, y + j));
    }
  }
  // Text-grid sprite: each character maps to a colour; '.' is see-through.
  function sprite(b, x, y, rows, map) {
    for (let j = 0; j < rows.length; j++) {
      const r = rows[j];
      for (let i = 0; i < r.length; i++) {
        const ch = r[i];
        if (ch !== '.' && map[ch] !== undefined) px(b, x + i, y + j, map[ch]);
      }
    }
  }
  // Repeatable pseudo-random numbers, so the art is the same every load.
  function rng(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  // ---------------------------------------------------------------------------
  // Pipes. A pipe is an axis-aligned path with a steel wall and an interior
  // the renderer fills every frame. Each interior pixel knows how far along
  // the path it is, so cells of the model map onto it in order.

  function makePipe(points, inner) {
    const half = inner >> 1;
    const seen = new Map();
    let length = 0;
    const segs = [];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], c = points[i];
      const len = Math.abs(c[0] - a[0]) + Math.abs(c[1] - a[1]);
      segs.push({ a: a, b: c, d0: length, len: len });
      length += len;
    }
    const idx = [], dist = [], xs = [], ys = [];
    function add(x, y, d) {
      if (x < 0 || y < 0 || x >= W || y >= H) return;
      const k = y * W + x;
      if (seen.has(k)) return;
      seen.set(k, idx.length);
      idx.push(k); dist.push(d); xs.push(x); ys.push(y);
    }
    segs.forEach(function (sg) {
      const ax = sg.a[0], ay = sg.a[1], bx = sg.b[0], by = sg.b[1];
      if (ay === by) {
        const dir = bx >= ax ? 1 : -1;
        for (let x = ax; x !== bx + dir; x += dir) {
          for (let j = -half; j < inner - half; j++) add(x, ay + j, sg.d0 + Math.abs(x - ax));
        }
      } else {
        const dir = by >= ay ? 1 : -1;
        for (let y = ay; y !== by + dir; y += dir) {
          for (let i = -half; i < inner - half; i++) add(ax + i, y, sg.d0 + Math.abs(y - ay));
        }
      }
    });
    // Across-pipe position, 0 at one wall to 1 at the other, for shading.
    const across = idx.map(function (k, n) {
      const x = xs[n], y = ys[n];
      let best = 0, bestD = 1e9;
      segs.forEach(function (sg) {
        const horiz = sg.a[1] === sg.b[1];
        const lo = horiz ? Math.min(sg.a[0], sg.b[0]) : Math.min(sg.a[1], sg.b[1]);
        const hi = horiz ? Math.max(sg.a[0], sg.b[0]) : Math.max(sg.a[1], sg.b[1]);
        const along = horiz ? x : y;
        const off = horiz ? y - sg.a[1] : x - sg.a[0];
        const out = Math.max(0, lo - along, along - hi);
        const d = out + Math.abs(off + 0.5) * 0.01;
        if (d < bestD) { bestD = d; best = (off + half + 0.5) / inner; }
      });
      return best;
    });
    return {
      points: points, inner: inner, length: length,
      idx: Int32Array.from(idx), dist: Float32Array.from(dist), across: Float32Array.from(across),
      xs: Int16Array.from(xs), ys: Int16Array.from(ys)
    };
  }
  // The steel wall: a rim one pixel wide around the interior, lit from above.
  function drawPipeWall(b, pipe) {
    const inside = new Set(pipe.idx);
    const done = new Set();
    for (let n = 0; n < pipe.idx.length; n++) {
      const x = pipe.xs[n], y = pipe.ys[n];
      for (let j = -1; j <= 1; j++) {
        for (let i = -1; i <= 1; i++) {
          const xx = x + i, yy = y + j;
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          const k = yy * W + xx;
          if (inside.has(k) || done.has(k)) continue;
          done.add(k);
          b[k] = j < 0 ? P.st5 : j > 0 ? P.st1 : i < 0 ? P.st4 : P.st2;
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Where everything is. Coordinates are pixels in the 480 × 270 scene.

  const G = {
    rb: { x0: 0, x1: 205, roof: 10 },                     // reactor building
    cv: { x0: 12, x1: 172, y0: 30, y1: 256, head: 14 },    // containment
    rpv: { x0: 32, x1: 79, y0: 96, y1: 236, head: 10 },    // reactor vessel
    core: { x0: 39, x1: 72, y0: 176, y1: 215 },
    pzr: { x0: 92, x1: 105, y0: 50, y1: 106, head: 6 },    // pressurizer
    sg: { x0: 122, x1: 157, y0: 56, y1: 202, head: 8 },    // steam generator
    pump: { cx: 140, cy: 222, r: 8 },
    hall: { x0: 206, x1: 303, roof: 60 },
    turbine: { hp: [222, 126, 240, 142], lp: [241, 116, 266, 142] },
    gen: [270, 122, 296, 142],
    cond: [222, 151, 270, 175],
    feedPump: { cx: 213, cy: 170, r: 5 },
    dhrs: [180, 118, 195, 166],
    xfmr: [306, 160, 318, 177],
    pylon: { x: 330, top: 88 },
    tower: { x0: 344, x1: 400, top: 100, throat: 134 },
    town: { x0: 410, x1: 479 }
  };

  // Rod gaps in the core: control bank in gaps 0, 2, 4 and shutdown banks in 1, 3.
  G.rods = [0, 1, 2, 3, 4].map(function (i) {
    return { x: G.core.x0 + 4 + i * 6, bank: i % 2 === 0 ? 'control' : 'shutdown' };
  });
  G.assemblies = [0, 1, 2, 3, 4, 5].map(function (i) { return G.core.x0 + i * 6; });

  const PIPES = {
    // Hot leg: out of the vessel, up and over into the top of the steam generator.
    hot: makePipe([[80, 125], [113, 125], [113, 48], [139, 48], [139, 57]], 4),
    // Cold leg: out of the bottom, through the pump, round and into the vessel.
    cold: makePipe([[139, 202], [139, 241], [20, 241], [20, 125], [31, 125]], 4),
    surge: makePipe([[98, 107], [98, 122]], 2),
    steam: makePipe([[158, 77], [231, 77], [231, 125]], 4),
    bypass: makePipe([[214, 80], [214, 157], [221, 157]], 2),
    vent: makePipe([[192, 74], [192, 3]], 2),
    dhrsIn: makePipe([[184, 80], [184, 120]], 2),
    dhrsOut: makePipe([[190, 166], [190, 171]], 2),
    feed: makePipe([[207, 172], [158, 172]], 2),
    cwOut: makePipe([[271, 158], [276, 158], [276, 193], [360, 193], [360, 178]], 4),
    cwIn: makePipe([[380, 178], [380, 201], [282, 201], [282, 168], [271, 168]], 4)
  };

  // Parts a visitor can point at: the box to outline and where its label goes.
  const PARTS = [
    { id: 'rods', name: 'Control rods', box: [34, 62, 44, 112], anchor: [56, 62] },
    { id: 'core', name: 'Reactor core', box: [37, 174, 38, 44], anchor: [73, 196] },
    { id: 'pzr', name: 'Pressurizer', box: [90, 42, 18, 66], anchor: [98, 42] },
    { id: 'sg', name: 'Steam generator', box: [120, 54, 40, 150], anchor: [140, 55] },
    { id: 'pump', name: 'Primary pump', box: [130, 212, 34, 20], anchor: [131, 222] },
    { id: 'containment', name: 'Containment', box: [12, 30, 161, 227], anchor: null },
    { id: 'pool', name: 'Cooling pool', box: [6, 84, 193, 178], anchor: null },
    { id: 'dhrs', name: 'Passive cooling', box: [178, 116, 20, 52], anchor: [188, 167] },
    { id: 'turbine', name: 'Turbine', box: [220, 114, 48, 30], anchor: [253, 115] },
    { id: 'generator', name: 'Generator', box: [268, 120, 31, 24], anchor: [283, 121] },
    { id: 'bypass', name: 'Steam bypass', box: [208, 78, 12, 82], anchor: [218, 110] },
    { id: 'condenser', name: 'Condenser', box: [220, 149, 53, 28], anchor: [242, 176] },
    { id: 'feedpump', name: 'Feed pump', box: [206, 163, 15, 15], anchor: [213, 177] },
    { id: 'tower', name: 'Cooling tower', box: [344, 100, 57, 78], anchor: [372, 179] },
    { id: 'town', name: 'Town', box: [408, 112, 72, 66], anchor: [444, 179] }
  ];

  // Town buildings: x, width, height. Windows are worked out from these.
  const BUILDINGS = [
    [410, 11, 34], [422, 9, 50], [432, 13, 30], [446, 8, 62], [455, 12, 42], [468, 11, 24]
  ];

  // ---------------------------------------------------------------------------
  // The background: everything that never moves.

  function drawSky(b) {
    vGrad(b, 0, 0, W, GROUND, [P.sky0, P.sky1, P.sky2, P.sky3, P.sky4]);
    const r = rng(7);
    for (let i = 0; i < 140; i++) {
      const x = (r() * W) | 0, y = (r() * (GROUND - 40)) | 0;
      px(b, x, y, r() < 0.25 ? P.star : P.starDim);
    }
    // A crescent moon.
    const mx = 300, my = 20, mr = 7;
    shape(b, mx - mr, my - mr, mx + mr, my + mr, function (x, y) {
      const dx = x + 0.5 - mx, dy = y + 0.5 - my;
      return dx * dx + dy * dy <= mr * mr;
    }, function (x, y) { return (x + y) % 5 === 0 ? P.moonShade : P.moon; });
    shape(b, mx - mr, my - mr - 2, mx + mr, my + mr, function (x, y) {
      const dx = x + 0.5 - (mx - 4), dy = y + 0.5 - (my - 2);
      return dx * dx + dy * dy <= mr * mr * 0.9;
    }, function (x, y) { return b[y * W + x - 9] || P.sky0; });
    // Far hills behind the town.
    for (let x = 300; x < W; x++) {
      const h = 160 + Math.round(6 * Math.sin(x / 23) + 4 * Math.sin(x / 9 + 1));
      for (let y = h; y < GROUND; y++) px(b, x, y, y === h ? P.hillHi : P.hill);
    }
  }

  function drawGround(b) {
    for (let x = 0; x < W; x++) {
      px(b, x, GROUND, P.grassHi);
      px(b, x, GROUND + 1, P.grass);
      px(b, x, GROUND + 2, (x * 7) % 5 === 0 ? P.grass : P.earth2);
    }
    vGrad(b, 0, GROUND + 3, W, H - GROUND - 3, [P.earth2, P.earth1, P.earth0]);
    const r = rng(11);
    for (let i = 0; i < 260; i++) {
      const x = (r() * W) | 0, y = GROUND + 4 + ((r() * (H - GROUND - 4)) | 0);
      px(b, x, y, P.pebble);
      if (r() < 0.3) px(b, x + 1, y, P.pebble);
    }
  }

  // Cut concrete: hatched so it reads as a section through a wall.
  function concreteCut(b, x, y, w, h) {
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const xx = x + i, yy = y + j;
        const hatch = ((xx + yy) % 5) === 0;
        px(b, xx, yy, hatch ? P.con3 : ((xx * 3 + yy * 7) % 11 === 0 ? P.con5 : P.con4));
      }
    }
    for (let i = 0; i < w; i++) { px(b, x + i, y, P.con6); px(b, x + i, y + h - 1, P.con2); }
  }

  function drawReactorBuilding(b) {
    const rb = G.rb;
    // Back wall of the hall above the pool, in big precast panels.
    for (let y = rb.roof + 8; y < POOL_BOTTOM; y++) {
      for (let x = rb.x0 + 6; x < rb.x1 - 5; x++) {
        const seam = (x - 6) % 32 === 0 || (y - 28) % 28 === 0;
        px(b, x, y, seam ? P.hall0 : ((x + y) % 7 === 0 ? P.hall2 : P.hall1));
      }
    }
    // Walls, pool floor and roof, cut through.
    concreteCut(b, rb.x0, rb.roof + 6, 6, H - rb.roof - 6);
    concreteCut(b, rb.x1 - 5, rb.roof + 6, 6, H - rb.roof - 6);
    concreteCut(b, rb.x0, POOL_BOTTOM + 1, rb.x1 + 1, H - POOL_BOTTOM - 1);
    concreteCut(b, rb.x0 - 2, rb.roof, rb.x1 + 5, 7);
    // Parapet and the beacon on the roof.
    rect(b, rb.x0 - 2, rb.roof - 2, 4, 2, P.con4);
    rect(b, rb.x1 - 1, rb.roof - 2, 4, 2, P.con4);
    // Silencer on the steam relief vent.
    sprite(b, 189, 0, [
      '.oooooo.',
      'osssssso',
      'osssssso'
    ], { o: P.st1, s: P.st3 });
    sprite(b, 100, rb.roof - 6, [
      '.ooo.',
      '.oro.',
      'ooooo',
      'sssss'
    ], { o: P.st1, r: P.lampOff, s: P.st3 });
    // Crane rail with lamps under it.
    rect(b, rb.x0 + 6, rb.roof + 7, rb.x1 - 11, 2, P.st2);
    rect(b, rb.x0 + 6, rb.roof + 7, rb.x1 - 11, 1, P.st4);
    for (let x = 20; x < rb.x1 - 10; x += 44) rect(b, x, rb.roof + 9, 5, 1, P.hallLamp);
  }

  function drawPool(b) {
    for (let y = POOL_TOP; y <= POOL_BOTTOM; y++) {
      const pos = (1 - (y - POOL_TOP) / (POOL_BOTTOM - POOL_TOP)) * (POOL.length - 1.2);
      for (let x = G.rb.x0 + 6; x < G.rb.x1 - 5; x++) px(b, x, y, ramp(POOL, pos, x, y));
    }
  }

  function drawContainment(b) {
    const c = G.cv;
    const outer = capsule(c.x0, c.y0, c.x1, c.y1, c.head);
    shape(b, c.x0, c.y0, c.x1, c.y1, outer, vShade(STEEL, c.x0, c.x1, 0.05), P.st0);
    const inner = inset(outer, 3);
    const CV = [P.cv2, P.cv1, P.cv0];
    shape(b, c.x0, c.y0, c.x1, c.y1, inner, function (x, y) {
      if ((y - c.y0) % 44 === 40) return P.cv3;
      return ramp(CV, (y - c.y0) / (c.y1 - c.y0) * 2, x, y);
    }, P.st0);
    // Flange where the top head bolts on.
    const fy = c.y0 + c.head + 6;
    rect(b, c.x0 - 2, fy, c.x1 - c.x0 + 5, 4, P.st3);
    rect(b, c.x0 - 2, fy, c.x1 - c.x0 + 5, 1, P.st5);
    rect(b, c.x0 - 2, fy + 3, c.x1 - c.x0 + 5, 1, P.st1);
    for (let x = c.x0; x <= c.x1; x += 6) px(b, x, fy + 1, P.st6);
    rect(b, c.x0 + 3, fy, c.x1 - c.x0 - 5, 4, P.cv2);
    // Lifting lug on top and the stand it rests on.
    sprite(b, ((c.x0 + c.x1) >> 1) - 3, c.y0 - 5, [
      '.ooooo.',
      'oo...oo',
      'o.....o',
      'o.....o',
      'sssssss'
    ], { o: P.st3, s: P.st2 });
    rect(b, 72, c.y1 - 1, 40, POOL_BOTTOM - c.y1 + 2, P.st2);
    rect(b, 72, c.y1 - 1, 1, POOL_BOTTOM - c.y1 + 2, P.st4);
  }

  function drawVessel(b) {
    const v = G.rpv, core = G.core;
    const outer = capsule(v.x0, v.y0, v.x1, v.y1, v.head);
    shape(b, v.x0, v.y0, v.x1, v.y1, outer, vShade(STEEL, v.x0, v.x1, 0.1), P.st0);
    shape(b, v.x0, v.y0, v.x1, v.y1, inset(outer, 2), P.vac, P.st1);
    // Core barrel walls and plates.
    for (let y = v.y0 + 16; y <= core.y1 + 4; y++) {
      px(b, 37, y, P.st3);
      if (y < 122 || y > 127) px(b, 74, y, P.st3);
    }
    // Outlet: a short sleeve across the downcomer to the hot leg nozzle.
    rect(b, 74, 122, 4, 1, P.st3);
    rect(b, 74, 127, 4, 1, P.st3);
    rect(b, 37, v.y0 + 15, 38, 2, P.st4);                // barrel flange
    rect(b, 38, core.y0 - 2, 36, 1, P.st3);               // upper core plate
    rect(b, 38, core.y1 + 1, 36, 2, P.st3);               // lower core plate
    for (let x = 40; x < 73; x += 3) px(b, x, core.y1 + 2, P.st1);
    // Guide tubes above the core keep the rods lined up.
    G.rods.forEach(function (r) {
      for (let y = v.y0 + 18; y < core.y0 - 2; y++) {
        px(b, r.x - 1, y, P.st2);
        px(b, r.x + 2, y, P.st2);
      }
    });
    // Rod drive housings on the head, each with a slot showing the rod top.
    G.rods.forEach(function (r) {
      const x = r.x - 1;
      rect(b, x, 66, 4, v.y0 - 64, P.st0);
      rect(b, x + 1, 67, 2, v.y0 - 66, P.st4);
      px(b, x + 1, 67, P.st6);
      rect(b, x - 1, 63, 6, 3, P.st1);
      rect(b, x, 63, 4, 1, P.st5);
    });
    // Nozzles for the hot and cold legs.
    rect(b, v.x1 - 1, 121, 3, 8, P.st3);
    rect(b, v.x0 - 1, 121, 3, 8, P.st3);
  }

  function drawPressurizer(b) {
    const z = G.pzr;
    const outer = capsule(z.x0, z.y0, z.x1, z.y1, z.head);
    shape(b, z.x0, z.y0, z.x1, z.y1, outer, vShade(STEEL, z.x0, z.x1, 0.1), P.st0);
    shape(b, z.x0, z.y0, z.x1, z.y1, inset(outer, 2), P.vac, P.st1);
    // Relief and safety valves on top.
    sprite(b, z.x0 + 2, z.y0 - 7, [
      '..oo....oo',
      '.oooo..oooo',
      '..ss....ss',
      '..ss....ss',
      '..ssssssss',
      '.....ss...',
      '.....ss...'
    ], { o: P.st3, s: P.st2 });
  }

  function drawSteamGenerator(b) {
    const g = G.sg;
    const outer = capsule(g.x0, g.y0, g.x1, g.y1, g.head);
    shape(b, g.x0, g.y0, g.x1, g.y1, outer, vShade(STEEL, g.x0, g.x1, 0.1), P.st0);
    shape(b, g.x0, g.y0, g.x1, g.y1, inset(outer, 2), P.vac, P.st1);
    // Tube sheets: the primary water is above the top one and below the bottom one.
    rect(b, g.x0 + 2, 67, g.x1 - g.x0 - 3, 3, P.st3);
    rect(b, g.x0 + 2, 67, g.x1 - g.x0 - 3, 1, P.st5);
    rect(b, g.x0 + 2, 190, g.x1 - g.x0 - 3, 3, P.st3);
    rect(b, g.x0 + 2, 190, g.x1 - g.x0 - 3, 1, P.st5);
    // Support plates across the tube bundle.
    for (let y = 92; y < 188; y += 24) {
      for (let x = g.x0 + 3; x < g.x1 - 2; x += 2) px(b, x, y, P.st2);
    }
    // Nozzles: steam out at the top right, feed in at the bottom right.
    rect(b, g.x1 - 1, 73, 3, 8, P.st3);
    rect(b, g.x1 - 1, 169, 3, 6, P.st3);
  }

  function drawPump(b) {
    const p = G.pump;
    shape(b, p.cx - p.r - 1, p.cy - p.r - 1, p.cx + p.r + 1, p.cy + p.r + 1, function (x, y) {
      const dx = x + 0.5 - p.cx, dy = y + 0.5 - p.cy;
      return dx * dx + dy * dy <= (p.r + 0.6) * (p.r + 0.6);
    }, vShade(STEEL, p.cx - p.r, p.cx + p.r, 0.15), P.st0);
    // Motor, with cooling fins and a status lamp.
    sprite(b, p.cx + p.r + 1, p.cy - 8, [
      'oooooooooooooo',
      'osfsfsfsfsfsfo',
      'osfsfsfsfsfsfo',
      'osfsfsfsfsfsfo',
      'osfsfsfsfsfsfo',
      'osfsfsfsfsfsfo',
      'osfsfsfsfsfsfo',
      'osfsfsfsfsfsfo',
      'osfsfsfsfsfsfo',
      'osfsfsfsfsfsfo',
      'osfsfsfsfsfsfo',
      'osfsfsfsfsfsfo',
      'osfsfsfsfsfsfo',
      'oooooooooooooo',
      '..oo......oo..',
      '..oo......oo..'
    ], { o: P.st0, s: P.st3, f: P.st4 });
  }

  function drawDhrs(b) {
    const d = G.dhrs;
    // A coil of tubes hung in the pool.
    for (let y = d[1]; y <= d[3]; y += 4) {
      rect(b, d[0], y, d[2] - d[0] + 1, 2, P.st2);
      rect(b, d[0], y, d[2] - d[0] + 1, 1, P.st4);
    }
    for (let y = d[1]; y <= d[3] - 2; y += 8) {
      rect(b, d[2] - 1, y, 2, 6, P.st3);
      rect(b, d[0], y + 4, 2, 6, P.st3);
    }
    // Isolation valve on the steam line down to it.
    sprite(b, 181, 94, [
      '.oooo.',
      'oossoo',
      '.oooo.'
    ], { o: P.st1, s: P.st4 });
  }

  function drawTurbineHall(b) {
    const h = G.hall;
    // Back wall: lit panels with a row of high windows.
    for (let y = h.roof + 6; y < GROUND; y++) {
      for (let x = h.x0; x <= h.x1 - 4; x++) {
        const seam = (x - h.x0) % 24 === 0;
        px(b, x, y, seam ? P.hall0 : ((x * 5 + y) % 9 === 0 ? P.hall2 : P.hall1));
      }
    }
    for (let x = h.x0 + 6; x < h.x1 - 8; x += 24) {
      rect(b, x, h.roof + 10, 14, 6, P.st1);
      vGrad(b, x + 1, h.roof + 11, 12, 4, [P.sky1, P.sky3]);
      px(b, x + 7, h.roof + 11, P.st1); px(b, x + 7, h.roof + 12, P.st1); px(b, x + 7, h.roof + 13, P.st1); px(b, x + 7, h.roof + 14, P.st1);
    }
    // Roof truss, cut, and the right-hand wall.
    rect(b, h.x0 - 1, h.roof, h.x1 - h.x0 + 4, 3, P.st2);
    rect(b, h.x0 - 1, h.roof, h.x1 - h.x0 + 4, 1, P.st4);
    for (let x = h.x0; x < h.x1; x += 8) line(b, x, h.roof + 3, x + 4, h.roof + 5, P.st2);
    rect(b, h.x0 - 1, h.roof + 5, h.x1 - h.x0 + 4, 1, P.st2);
    concreteCut(b, h.x1 - 3, h.roof + 3, 4, GROUND - h.roof - 3);
    // Crane rail and lights.
    rect(b, h.x0, h.roof + 19, h.x1 - h.x0 - 3, 2, P.st2);
    rect(b, h.x0, h.roof + 19, h.x1 - h.x0 - 3, 1, P.st4);
    sprite(b, 278, h.roof + 21, [
      'oooooooooo',
      'oyyyyyyyyo',
      'oooooooooo',
      '....oo....',
      '....oo....',
      '...oooo...',
      '...o..o...'
    ], { o: P.st1, y: P.amber });
    for (let x = h.x0 + 18; x < h.x1 - 8; x += 30) rect(b, x, h.roof + 22, 5, 1, P.hallLamp);
    // Floor.
    rect(b, h.x0, GROUND - 1, h.x1 - h.x0, 1, P.con5);
    // Turbine deck: a concrete table on legs.
    concreteCut(b, 216, 143, 84, 5);
    [218, 262, 290].forEach(function (x) { concreteCut(b, x, 148, 5, GROUND - 149); });
  }

  function drawTurbine(b) {
    const t = G.turbine;
    const hp = t.hp, lp = t.lp;
    // Casings: a narrow high-pressure end and a fat low-pressure end, each
    // under a rounded hood, split along the middle where the halves bolt.
    const PAINT = ['#1a2440', '#243258', '#2f4374', '#41609c', '#6587c4'].map(rgb);
    function hood(c, rise) {
      const w = c[2] - c[0];
      return function (x, y) {
        if (x < c[0] || x > c[2] || y > c[3]) return false;
        const u = (x - c[0]) / w;
        return y >= c[1] + Math.round(rise * (1 - Math.sqrt(Math.max(0, 1 - Math.pow(2 * u - 1, 2)))));
      };
    }
    shape(b, hp[0], hp[1], hp[2], hp[3], hood(hp, 5), hShade(PAINT, hp[1], hp[3], 0.1), P.st0);
    shape(b, lp[0], lp[1], lp[2], lp[3], hood(lp, 8), hShade(PAINT, lp[1], lp[3], 0.1), P.st0);
    [hp, lp].forEach(function (c) {
      const y = c[3] - 3;
      for (let x = c[0] + 1; x < c[2]; x++) px(b, x, y, (x - c[0]) % 3 === 1 ? P.st6 : PAINT[0]);
    });
    // Windows cut in the casing show the blades (the renderer spins them).
    rect(b, hp[0] + 3, hp[1] + 5, hp[2] - hp[0] - 5, hp[3] - hp[1] - 9, P.st0);
    rect(b, lp[0] + 3, lp[1] + 7, lp[2] - lp[0] - 5, lp[3] - lp[1] - 11, P.st0);
    // Exhaust hood down through the deck into the condenser.
    shape(b, 244, 142, 264, 151, function (x, y) {
      const k = y - 142;
      return x >= 244 + (k >> 2) && x <= 264 - (k >> 2);
    }, hShade(STEEL, 142, 151, -0.2), P.st0);
    // Shaft to the generator.
    rect(b, 266, 131, 5, 3, P.st4);
    rect(b, 266, 131, 5, 1, P.st6);
    // Generator.
    const g = G.gen;
    shape(b, g[0], g[1], g[2], g[3], function (x, y) {
      if (y < g[1] + 2 && (x < g[0] + 2 || x > g[2] - 2)) return false;
      return x >= g[0] && x <= g[2] && y >= g[1] && y <= g[3];
    }, hShade(['#20332a', '#2a4537', '#355a46', '#4b7a5f', '#6fa585'].map(rgb), g[1], g[3], 0.05), P.st0);
    rect(b, g[0] + 3, g[1] + 5, g[2] - g[0] - 5, g[3] - g[1] - 9, P.st0);
    // Output lamp on the generator.
    rect(b, g[2] - 4, g[1] + 1, 3, 2, P.st0);
    // Bus duct out through the wall to the transformer.
    rect(b, g[2] + 1, 128, 6, 4, P.st2);
    rect(b, g[2] + 1, 128, 6, 1, P.st4);
  }

  function drawCondenser(b) {
    const c = G.cond;
    shape(b, c[0], c[1], c[2], c[3], function (x, y) {
      if ((y === c[1] || y === c[3]) && (x === c[0] || x === c[2])) return false;
      return x >= c[0] && x <= c[2] && y >= c[1] && y <= c[3];
    }, hShade(STEEL, c[1], c[3], -0.1), P.st0);
    rect(b, c[0] + 2, c[1] + 2, c[2] - c[0] - 3, c[3] - c[1] - 3, P.vac1);
    // Water boxes at each end.
    rect(b, c[0] + 2, c[1] + 4, 3, c[3] - c[1] - 10, P.st3);
    rect(b, c[2] - 4, c[1] + 4, 3, c[3] - c[1] - 10, P.st3);
  }

  function drawFeedPump(b) {
    const f = G.feedPump;
    shape(b, f.cx - f.r - 1, f.cy - f.r - 1, f.cx + f.r + 1, f.cy + f.r + 1, function (x, y) {
      const dx = x + 0.5 - f.cx, dy = y + 0.5 - f.cy;
      return dx * dx + dy * dy <= (f.r + 0.6) * (f.r + 0.6);
    }, vShade(STEEL, f.cx - f.r, f.cx + f.r, 0.15), P.st0);
    rect(b, f.cx - 4, f.cy + f.r + 1, 9, GROUND - (f.cy + f.r + 1), P.st1);
  }

  function drawTransformer(b) {
    const t = G.xfmr;
    sprite(b, t[0], t[1] - 6, [
      '..w...w...w..',
      '..w...w...w..',
      '.www.www.www.',
      '..w...w...w..',
      '..o...o...o..',
      '..o...o...o..',
      'ooooooooooooo',
      'osfsfsfsfsfso',
      'osfsfsfsfsfso',
      'osfsfsfsfsfso',
      'osfsfsfsfsfso',
      'osfsfsfsfsfso',
      'osfsfsfsfsfso',
      'osfsfsfsfsfso',
      'osfsfsfsfsfso',
      'osfsfsfsfsfso',
      'osfsfsfsfsfso',
      'osfsfsfsfsfso',
      'osfsfsfsfsfso',
      'osfsfsfsfsfso',
      'osfsfsfsfsfso',
      'osfsfsfsfsfso',
      'ooooooooooooo'
    ], { o: P.st0, s: P.st2, f: P.st3, w: P.st6 });
    // Bus duct from the hall.
    rect(b, G.hall.x1 + 1, 128, t[0] - G.hall.x1 + 2, 4, P.st2);
    rect(b, G.hall.x1 + 1, 128, t[0] - G.hall.x1 + 2, 1, P.st4);
    rect(b, t[0] + 1, 128, 3, 34, P.st2);
  }

  function drawPylon(b) {
    const p = G.pylon;
    const base = GROUND, top = p.top;
    for (let y = top; y < base; y++) {
      const k = (y - top) / (base - top);
      const half = Math.round(2 + 7 * k);
      px(b, p.x - half, y, P.st3);
      px(b, p.x + half, y, P.st3);
      if ((y - top) % 8 === 0) {
        line(b, p.x - half, y, p.x + half, Math.min(base - 1, y + 8), P.st2);
        line(b, p.x + half, y, p.x - half, Math.min(base - 1, y + 8), P.st2);
      }
    }
    // Cross arms with insulators.
    [top + 4, top + 14].forEach(function (y, i) {
      const reach = i === 0 ? 9 : 12;
      rect(b, p.x - reach, y, reach * 2 + 1, 1, P.st3);
      px(b, p.x - reach, y + 1, P.st6); px(b, p.x + reach, y + 1, P.st6);
    });
    rect(b, p.x - 1, top - 4, 3, 4, P.st3);
  }

  // Wire hanging between two points; returns the pixels for the current dashes.
  function wire(b, x0, y0, x1, y1, sag) {
    const pts = [];
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    let lx = null, ly = null;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = Math.round(x0 + (x1 - x0) * t);
      const y = Math.round(y0 + (y1 - y0) * t + sag * 4 * t * (1 - t));
      if (x === lx && y === ly) continue;
      if (lx !== null && Math.abs(y - ly) > 1) {
        const dir = y > ly ? 1 : -1;
        for (let yy = ly + dir; yy !== y; yy += dir) { px(b, x, yy, P.st1); pts.push([x, yy]); }
      }
      px(b, x, y, P.st1);
      pts.push([x, y]);
      lx = x; ly = y;
    }
    return pts;
  }

  function drawTower(b) {
    const t = G.tower;
    const cx = (t.x0 + t.x1) / 2;
    const baseHalf = (t.x1 - t.x0) / 2, throatHalf = baseHalf * 0.68, topHalf = baseHalf * 0.78;
    // Hyperboloid outline: half width at each height.
    function half(y) {
      if (y <= t.throat) {
        const k = (t.throat - y) / (t.throat - t.top);
        return throatHalf + (topHalf - throatHalf) * k * k;
      }
      const k = (y - t.throat) / (GROUND - t.throat);
      return throatHalf + (baseHalf - throatHalf) * k * k;
    }
    const TOWER = ['#1b2130', '#252d40', '#313b52', '#414d68', '#56637f'].map(rgb);
    for (let y = t.top; y < GROUND; y++) {
      const hw = half(y);
      const x0 = Math.round(cx - hw), x1 = Math.round(cx + hw);
      for (let x = x0; x <= x1; x++) {
        const u = (x - x0) / Math.max(1, x1 - x0);
        let v = 0.9 - 1.4 * Math.abs(u - 0.32);
        if ((y - t.top) % 9 === 0) v -= 0.18;
        const edge = x === x0 || x === x1;
        px(b, x, y, edge ? P.st0 : ramp(TOWER, Math.max(0, Math.min(1, v)) * 4, x, y));
      }
    }
    // Lip at the top and the dark mouth of the shell.
    const lipHalf = Math.round(half(t.top));
    rect(b, Math.round(cx - lipHalf) - 1, t.top - 1, lipHalf * 2 + 3, 2, TOWER[3]);
    rect(b, Math.round(cx - lipHalf) + 2, t.top - 1, lipHalf * 2 - 3, 1, P.st0);
    // Legs at the base let the air in.
    for (let x = Math.round(cx - baseHalf) + 2; x < cx + baseHalf - 2; x += 5) {
      line(b, x, GROUND - 1, x + 2, GROUND - 8, P.st0);
      line(b, x + 1, GROUND - 1, x + 3, GROUND - 8, P.st0);
    }
    rect(b, Math.round(cx - baseHalf) + 1, GROUND - 9, Math.round(baseHalf * 2) - 1, 1, TOWER[4]);
  }

  function drawTown(b) {
    const r = rng(23);
    const windows = [];
    BUILDINGS.forEach(function (bd, n) {
      const x = bd[0], w = bd[1], h = bd[2];
      const y0 = GROUND - h;
      rect(b, x, y0, w, h, n % 2 ? P.bld1 : P.bld0);
      rect(b, x, y0, 1, h, P.bldHi);
      rect(b, x, y0, w, 1, P.bldHi);
      // Windows: two pixels wide, on a grid.
      for (let y = y0 + 3; y < GROUND - 4; y += 4) {
        for (let wx = x + 2; wx < x + w - 2; wx += 3) {
          px(b, wx, y, P.win0); px(b, wx, y + 1, P.win0);
          windows.push({ x: wx, y: y, k: r() });
        }
      }
      // Rooftop bits.
      if (n === 1) { rect(b, x + 4, y0 - 6, 1, 6, P.st3); px(b, x + 4, y0 - 7, P.red); }
      if (n === 3) { rect(b, x + 2, y0 - 3, 4, 3, P.bld2); rect(b, x + 3, y0 - 9, 1, 6, P.st3); }
      if (n === 4) { rect(b, x + 3, y0 - 4, 5, 4, P.bld2); rect(b, x + 2, y0 - 5, 7, 1, P.bldHi); }
    });
    // Street lamps and the substation pole at the edge of town.
    for (let x = 412; x < W; x += 16) {
      rect(b, x, GROUND - 7, 1, 7, P.st3);
      px(b, x + 1, GROUND - 7, P.st3);
      windows.push({ x: x + 2, y: GROUND - 7, k: r() * 0.2, lamp: true });
    }
    rect(b, 406, 108, 2, GROUND - 108, P.st2);
    rect(b, 402, 110, 10, 1, P.st3);
    return windows;
  }

  // Trees for scale and a bit of life.
  function drawTrees(b) {
    [[300, 9], [306, 7], [404, 6]].forEach(function (t) {
      const x = t[0], h = t[1];
      rect(b, x, GROUND - 3, 1, 3, P.earth2);
      shape(b, x - 3, GROUND - 3 - h, x + 3, GROUND - 3, function (xx, yy) {
        const k = (GROUND - 3 - yy) / h;
        return Math.abs(xx - x) <= Math.round(3 * (1 - k) + 0.4);
      }, function (xx, yy) { return (xx + yy) % 3 === 0 ? P.grassHi : P.grass; });
    });
  }

  // Draw the whole static scene. `opts.pool` false leaves the pool dry, which
  // the renderer uses to show the water falling as the pool boils off.
  function background(opts) {
    opts = opts || {};
    const b = new Uint32Array(W * H);
    drawSky(b);
    drawGround(b);
    drawTower(b);
    drawPylon(b);
    const windows = drawTown(b);
    const wirePx = powerLine(b);
    drawTrees(b);
    drawReactorBuilding(b);
    if (opts.pool !== false) drawPool(b);
    drawContainment(b);
    drawDhrs(b);
    drawTurbineHall(b);
    drawTransformer(b);
    // Pipe walls go under the equipment they join.
    Object.keys(PIPES).forEach(function (k) { drawPipeWall(b, PIPES[k]); });
    drawVessel(b);
    drawPressurizer(b);
    drawSteamGenerator(b);
    drawPump(b);
    drawTurbine(b);
    drawCondenser(b);
    drawFeedPump(b);
    // Pipe interiors default to an empty dark bore; the renderer fills them.
    Object.keys(PIPES).forEach(function (k) {
      const p = PIPES[k];
      for (let n = 0; n < p.idx.length; n++) b[p.idx[n]] = P.st0;
    });
    return { px: b, windows: windows, wire: wirePx };
  }

  // Power line: transformer to pylon to town. Returns the wire pixels in order.
  function powerLine(b) {
    const p = G.pylon, t = G.xfmr;
    const a = wire(b, t[0] + 6, t[1] - 5, p.x - 9, p.top + 5, 3);
    const c = wire(b, p.x + 9, p.top + 5, 402, 111, 6);
    return a.concat(c);
  }

  // Pixels that are pool water in the finished background (nothing in front).
  function poolMask(full, dry) {
    const idx = [];
    for (let y = POOL_TOP; y <= POOL_BOTTOM; y++) {
      for (let x = G.rb.x0 + 6; x < G.rb.x1 - 5; x++) {
        const k = y * W + x;
        if (full[k] !== dry[k]) idx.push(k);
      }
    }
    return Int32Array.from(idx);
  }

  const api = {
    W: W, H: H, GROUND: GROUND, POOL_TOP: POOL_TOP, POOL_BOTTOM: POOL_BOTTOM,
    P: P, HEX: HEX, rgb: rgb, mix: mix,
    COOLANT: COOLANT, COOLANT_T: COOLANT_T, FUEL: FUEL, FUEL_T: FUEL_T, STEEL: STEEL, STEAM: STEAM, POOL: POOL, CHER: CHER, CONCRETE: CONCRETE,
    bayer: bayer, ramp: ramp, rampPos: rampPos, coolant: coolant, fuel: fuel,
    px: px, rect: rect, line: line, shape: shape, capsule: capsule, inset: inset, sprite: sprite, rng: rng,
    G: G, PIPES: PIPES, PARTS: PARTS, BUILDINGS: BUILDINGS,
    background: background, poolMask: poolMask
  };
  root.ReactorArt = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
