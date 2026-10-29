// Trend chart: three small charts stacked on one time axis (power, coolant
// temperature, pressure), two series each, with a crosshair and a tooltip
// that lists every series at the time under the pointer.
(function (root) {
  'use strict';

  const SERIES_1 = '#3987e5', SERIES_2 = '#d95926';
  const INK = '#eef2f6', INK_2 = '#c3cad6', MUTED = '#8792a5', GRID = 'rgba(255,255,255,0.07)', AXIS = 'rgba(255,255,255,0.18)';
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

    const left = 44, right = 86, top = 4, gapY = 20, axisH = 18;
    const panelH = (h - top - axisH - gapY * (PANELS.length - 1)) / PANELS.length;
    const plotW = w - left - right;
    const x = function (t) { return left + (t - t0) / span * plotW; };
    g.font = '11px Inter, system-ui, sans-serif';
    g.textBaseline = 'middle';

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
      const titleH = 16;
      const y0 = py + titleH, y1 = py + panelH;
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
      const y = function (v) { return y1 - (v - lo) / (hi - lo) * (y1 - y0); };

      // Title and legend.
      g.fillStyle = INK_2;
      g.textAlign = 'left';
      g.font = '600 11.5px Inter, system-ui, sans-serif';
      g.fillText(pn.title, left, py + 7);
      let lx = left + g.measureText(pn.title).width + 14;
      g.font = '11px Inter, system-ui, sans-serif';
      pn.series.forEach(function (sr) {
        g.strokeStyle = sr.color; g.lineWidth = 2;
        g.beginPath(); g.moveTo(lx, py + 7); g.lineTo(lx + 12, py + 7); g.stroke();
        g.fillStyle = MUTED;
        g.fillText(sr.name, lx + 16, py + 7);
        lx += 16 + g.measureText(sr.name).width + 12;
      });

      // Grid and ticks.
      g.lineWidth = 1;
      for (let v = lo; v <= hi + 1e-9; v += step) {
        const yy = Math.round(y(v)) + 0.5;
        g.strokeStyle = v === lo ? AXIS : GRID;
        g.beginPath(); g.moveTo(left, yy); g.lineTo(left + plotW, yy); g.stroke();
        g.fillStyle = MUTED;
        g.textAlign = 'right';
        g.fillText(+v.toFixed(2) + '', left - 6, yy);
      }

      // Lines, clipped to the plot.
      g.save();
      g.beginPath(); g.rect(left, y0 - 2, plotW, y1 - y0 + 4); g.clip();
      pn.series.forEach(function (sr) {
        g.strokeStyle = sr.color;
        g.lineWidth = 2;
        g.lineJoin = 'round';
        g.beginPath();
        data.forEach(function (d, i) {
          const xx = x(d.t), yy = y(d[sr.key]);
          if (i === 0) g.moveTo(xx, yy); else g.lineTo(xx, yy);
        });
        g.stroke();
      });
      g.restore();

      // Direct labels at the line ends, nudged apart.
      const last = data[data.length - 1];
      const ends = pn.series.map(function (sr) { return { sr: sr, y: y(last[sr.key]) }; }).sort(function (a, b) { return a.y - b.y; });
      for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 13) ends[i].y = ends[i - 1].y + 13;
      ends.forEach(function (e) {
        const yy = Math.max(y0 + 4, Math.min(y1 + 2, e.y));
        g.fillStyle = INK_2;
        g.textAlign = 'left';
        g.fillText(e.sr.name, left + plotW + 8, yy);
      });

      if (hoverS) {
        const xx = Math.round(x(hoverS.t)) + 0.5;
        g.strokeStyle = 'rgba(255,255,255,0.45)';
        g.lineWidth = 1;
        g.beginPath(); g.moveTo(xx, y0 - 2); g.lineTo(xx, y1); g.stroke();
        pn.series.forEach(function (sr) {
          g.fillStyle = sr.color;
          g.strokeStyle = '#0f1828';
          g.lineWidth = 2;
          g.beginPath(); g.arc(xx, y(hoverS[sr.key]), 4, 0, Math.PI * 2); g.fill(); g.stroke();
        });
      }
    });

    // Time axis.
    g.fillStyle = MUTED;
    g.textAlign = 'left';
    const tStart = Math.max(t0, data[0].t);
    g.fillText(clock(tStart), x(tStart), h - axisH / 2);
    g.textAlign = 'right';
    g.fillText(clock(tEnd), left + plotW, h - axisH / 2);

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
    const tx = x(hoverS.t);
    const tw = tip.offsetWidth;
    tip.style.left = (tx + 12 + tw > w ? tx - 12 - tw : tx + 12) + 'px';
    tip.style.top = '16px';
  };

  root.ReactorTrend = { TrendChart: TrendChart, clock: clock };
})(typeof window !== 'undefined' ? window : globalThis);
