// Trend chart: three small charts stacked on one time axis (power, coolant
// temperature, pressure), two series each, with a crosshair and a tooltip
// that lists every series at the time under the pointer. It is pixel art
// like the plant: everything is drawn on whole pixels with no smoothing, the
// lines as staircases two pixels thick, and the text in the page's pixel font.
(function (root) {
  'use strict';

  const U = 1; // one pixel of the page
  const T = 2; // line thickness
  const FONT = (56 / 3) + 'px "Jersey 10", "Reactor Pixel", monospace';
  const SERIES_1 = '#3987e5', SERIES_2 = '#d95926';
  const INK_2 = '#c3cad6', MUTED = '#8792a5', GRID = '#263550', AXIS = '#3a4c72', CROSS = '#8b98b0', PANEL = '#101a2c';
  const PANELS = [
    { title: 'Power, % of full', unit: '%', digits: 1, fixedMin: 0, minSpan: 110,
      series: [{ key: 'heat', name: 'Heat', color: SERIES_1 }, { key: 'elec', name: 'Electricity', color: SERIES_2 }] },
    { title: 'Coolant, °C', unit: ' °C', digits: 1, minSpan: 16,
      series: [{ key: 'cold', name: 'Cold leg', color: SERIES_1 }, { key: 'hot', name: 'Hot leg', color: SERIES_2 }] },
    { title: 'Pressure, bar', unit: ' bar', digits: 1, minSpan: 20,
      series: [{ key: 'steam', name: 'Steam', color: SERIES_1 }, { key: 'primary', name: 'Primary', color: SERIES_2 }] }
  ];
  const KEEP = 4000;

  function niceStep(span) {
    const raw = span / 3, p = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10)), m = raw / p;
    return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
  }
  function clock(t) {
    t = Math.max(0, Math.floor(t));
    const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = t % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(s).padStart(2, '0');
  }
  function spanText(sec) {
    if (sec < 120) return 'Last ' + Math.round(sec) + ' seconds';
    if (sec < 7200) return 'Last ' + Math.round(sec / 60) + ' minutes';
    if (sec < 172800) return 'Last ' + Math.round(sec / 3600) + ' hours';
    return 'Last ' + Math.round(sec / 86400) + ' days';
  }

  function TrendChart(canvas, tip, spanEl) {
    this.c = canvas;
    this.g = canvas.getContext('2d');
    this.tip = tip;
    this.spanEl = spanEl;
    this.samples = [];
    this.interval = 0.5;
    this.lastT = -Infinity;
    this.hover = null;
    this.dirty = true;
    const self = this;
    function move(e) {
      const r = canvas.getBoundingClientRect();
      self.hover = e.clientX - r.left;
      self.dirty = true;
    }
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerdown', move);
    canvas.addEventListener('pointerleave', function () { self.hover = null; self.dirty = true; });
  }

  TrendChart.prototype.reset = function () {
    this.samples = [];
    this.lastT = -Infinity;
    this.dirty = true;
  };

  // Record the plant every `interval` seconds of sim time; the interval grows
  // with the speed so the chart always shows about 240 points.
  TrendChart.prototype.sample = function (s, speed) {
    const interval = speed >= 3600 ? 1800 : speed >= 60 ? 30 : speed >= 10 ? 5 : 0.5;
    this.interval = interval;
    if (s.t - this.lastT < interval * 0.999) return;
    this.lastT = s.t;
    this.samples.push({
      t: s.t,
      heat: s.powerFrac * 100,
      elec: s.mwe / 0.77,
      cold: s.tCold, hot: s.tHot,
      steam: s.pS, primary: s.pP
    });
    if (this.samples.length > KEEP) this.samples.splice(0, this.samples.length - KEEP);
    this.dirty = true;
  };

  TrendChart.prototype.draw = function () {
    if (!this.dirty) return;
    this.dirty = false;
    const c = this.c, g = this.g;
    const dpr = Math.min(root.devicePixelRatio || 1, 3);
    const w = c.clientWidth, h = c.clientHeight;
    if (!w || !h) return;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const all = this.samples;
    if (!all.length) return;
    const tEnd = all[all.length - 1].t;
    const span = 240 * this.interval;
    const t0 = tEnd - span;
    let first = all.length - 1;
    while (first > 0 && all[first - 1].t >= t0) first--;
    const data = all.slice(Math.max(0, first - 1));
    if (this.spanEl) this.spanEl.textContent = spanText(span);

    // Everything below is placed in whole blocks.
    const snap = function (v) { return Math.round(v / U) * U; };
    const block = function (x, y, bw, bh) { g.fillRect(x, y, bw || U, bh || U); };
    const narrow = w < 520;
    const left = 40, right = narrow ? 92 : 96, top = 0, gapY = 12, axisH = 20, titleH = 24;
    const panelH = snap((h - top - axisH - gapY * (PANELS.length - 1)) / PANELS.length);
    const plotW = snap(w - left - right);
    const cols = plotW / U;
    g.font = FONT;
    g.textBaseline = 'alphabetic';
    // Text sits on whole pixels, 12px of it above the baseline.
    const text = function (str, x, y, align) {
      g.textAlign = align || 'left';
      g.fillText(str, Math.round(x), Math.round(y) + 12);
    };

    // The value of `key` at time t, on the straight line between samples.
    let at = 0;
    const value = function (key, t) {
      while (at < data.length - 2 && data[at + 1].t < t) at++;
      const a = data[at], b = data[Math.min(at + 1, data.length - 1)];
      if (b.t <= a.t) return a[key];
      const k = Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t)));
      return a[key] + (b[key] - a[key]) * k;
    };
    const tFirst = Math.max(t0, data[0].t);
    const col = function (t) { return Math.max(0, Math.min(cols - 1, Math.round((t - t0) / span * (cols - 1)))); };

    // Crosshair: snap to the nearest sample.
    let hoverS = null;
    if (this.hover !== null && this.hover >= left - 6 && this.hover <= left + plotW + 6) {
      const th = t0 + (this.hover - left) / plotW * span;
      let best = Infinity;
      for (let i = 0; i < data.length; i++) {
        const d = Math.abs(data[i].t - th);
        if (d < best && data[i].t >= t0) { best = d; hoverS = data[i]; }
      }
    }

    PANELS.forEach(function (pn, pi) {
      const py = top + pi * (panelH + gapY);
      const y0 = py + titleH, y1 = py + panelH - U;
      // Range from what is on screen.
      let lo = Infinity, hi = -Infinity;
      data.forEach(function (d) {
        pn.series.forEach(function (sr) { const v = d[sr.key]; if (v < lo) lo = v; if (v > hi) hi = v; });
      });
      if (pn.fixedMin !== undefined) lo = Math.min(pn.fixedMin, lo);
      if (hi - lo < pn.minSpan) { const mid = (hi + lo) / 2; lo = pn.fixedMin !== undefined ? pn.fixedMin : mid - pn.minSpan / 2; hi = lo + pn.minSpan; }
      const step = niceStep(hi - lo);
      lo = Math.floor(lo / step) * step;
      hi = Math.ceil(hi / step) * step;
      const y = function (v) { return snap(y1 - (v - lo) / (hi - lo) * (y1 - y0)); };

      // Title and legend.
      g.fillStyle = INK_2;
      text(pn.title, left, py);
      let lx = left + snap(g.measureText(pn.title).width) + 16;
      pn.series.forEach(function (sr) {
        if (narrow) return; // the line ends are labelled, which is enough on a phone
        g.fillStyle = sr.color;
        block(lx, py + 6, 8, 8);
        g.fillStyle = MUTED;
        text(sr.name, lx + 12, py);
        lx += 12 + snap(g.measureText(sr.name).width) + 14;
      });

      // Grid: dotted lines, a solid one along the bottom, and the scale.
      for (let v = lo; v <= hi + 1e-9; v += step) {
        const yy = y(v);
        if (v === lo) { g.fillStyle = AXIS; block(left, yy, plotW, 2); }
        else { g.fillStyle = GRID; for (let x = 0; x < plotW; x += 6) block(left + x, yy, 2, 2); }
        g.fillStyle = MUTED;
        text(+v.toFixed(2) + '', left - 8, yy - 8, 'right');
      }

      // Lines: one step per column, joined up and down so they never break.
      const c0 = col(tFirst), c1 = col(tEnd);
      pn.series.forEach(function (sr) {
        g.fillStyle = sr.color;
        at = 0;
        let prev = null;
        for (let i = c0; i <= c1; i++) {
          const t = c1 === c0 ? tEnd : tFirst + (tEnd - tFirst) * (i - c0) / (c1 - c0);
          const yy = Math.max(y0 - U, Math.min(y1, y(value(sr.key, t))));
          if (prev === null || prev === yy) block(left + i * U, yy, U, T);
          else if (yy > prev) block(left + i * U, prev + U, U, yy - prev + T - U);
          else block(left + i * U, yy, U, prev - yy + T - U);
          prev = yy;
        }
      });

      // Direct labels at the line ends, nudged apart.
      const last = data[data.length - 1];
      const ends = pn.series.map(function (sr) { return { sr: sr, y: y(last[sr.key]) }; }).sort(function (a, b) { return a.y - b.y; });
      for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 16) ends[i].y = ends[i - 1].y + 16;
      const over = ends[ends.length - 1].y - (y1 + U);
      if (over > 0) ends.forEach(function (e) { e.y -= over; });
      ends.forEach(function (e) {
        const yy = Math.max(y0 - 4, e.y);
        g.fillStyle = e.sr.color;
        block(left + plotW + 6, yy - 2, 6, 6);
        g.fillStyle = INK_2;
        text(e.sr.name, left + plotW + 18, yy - 8);
      });

      if (hoverS) {
        const xx = left + col(hoverS.t) * U;
        g.fillStyle = CROSS;
        for (let yy = y0 - 2; yy < y1; yy += 4) block(xx, yy, 2, 2);
        pn.series.forEach(function (sr) {
          const yy = y(hoverS[sr.key]);
          g.fillStyle = PANEL;
          block(xx - 4, yy - 4, 10, 10);
          g.fillStyle = sr.color;
          block(xx - 2, yy - 2, 6, 6);
        });
      }
    });

    // Time axis.
    g.fillStyle = MUTED;
    text(clock(tEnd), left + plotW, h - axisH + 2, 'right');
    if (col(tEnd) - col(tFirst) > 60) text(clock(tFirst), left + col(tFirst) * U, h - axisH + 2);

    // Tooltip.
    const tip = this.tip;
    if (!hoverS) { tip.hidden = true; return; }
    tip.hidden = false;
    tip.textContent = '';
    const head = document.createElement('div');
    head.className = 'tt-time';
    head.textContent = 'At ' + clock(hoverS.t);
    tip.appendChild(head);
    PANELS.forEach(function (pn) {
      pn.series.forEach(function (sr) {
        const row = document.createElement('div');
        row.className = 'tt-row';
        const key = document.createElement('span');
        key.className = 'tt-key';
        key.style.background = sr.color;
        const v = document.createElement('span');
        v.className = 'tt-v';
        v.textContent = hoverS[sr.key].toFixed(pn.digits) + pn.unit;
        const n = document.createElement('span');
        n.className = 'tt-n';
        n.textContent = sr.name;
        row.appendChild(key); row.appendChild(v); row.appendChild(n);
        tip.appendChild(row);
      });
    });
    const tx = left + col(hoverS.t) * U;
    const tw = tip.offsetWidth;
    tip.style.left = snap(tx + 12 + tw > w ? tx - 12 - tw : tx + 12) + 'px';
    tip.style.top = '24px';
  };

  root.ReactorTrend = { TrendChart: TrendChart, clock: clock };
})(typeof window !== 'undefined' ? window : globalThis);
