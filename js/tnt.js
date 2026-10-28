// TNT. With the TNT switch on, clicking a rock plants a bundle of dynamite
// there instead of cracking it. The fuse burns for 3 seconds, then the bomb
// blows a huge hole in every rock in reach (Fracture.blast) and throws the
// water, the ducks and anything already falling. A blast that reaches another
// bomb, or knocks the rock out from under it, sets that one off too. Bombs
// are pinned to their panel in panel px, so they stay put through relayouts.
(function (root) {
  'use strict';

  const Rocks = root.Rocks;
  const FUSE = 3 * 60;     // simulation steps (60 a second)
  const CHAIN = 8;         // steps left on a bomb the blast reaches
  const HOT = 50;          // steps left when the bundle starts to glow
  const MAX_BOMBS = 8;
  const SVG_NS = 'http://www.w3.org/2000/svg';

  // The sprite is 40 x 56 with the middle of the bundle at (20, 37). The fuse
  // is a cubic from the top of the middle stick, sampled for burning down.
  const W = 40, H = 56, MID_X = 20, MID_Y = 37;
  const FUSE_PTS = (function () {
    const p = [[20, 22], [20, 13], [31, 15], [29, 4]];
    const out = [];
    for (let i = 0; i <= 16; i++) {
      const t = i / 16, u = 1 - t;
      const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
      out.push([a * p[0][0] + b * p[1][0] + c * p[2][0] + d * p[3][0], a * p[0][1] + b * p[1][1] + c * p[2][1] + d * p[3][1]]);
    }
    return out;
  })();

  const STICK = (x) =>
    '<rect x="' + x + '" y="22" width="10" height="30" rx="2" fill="#c8301f" stroke="#5c1009" stroke-width="1"/>' +
    '<rect x="' + (x + 1.6) + '" y="23" width="2.2" height="28" rx="1" fill="#ec6a4f" opacity=".75"/>' +
    '<rect x="' + (x + 7) + '" y="23" width="2" height="28" rx="1" fill="#7d150d" opacity=".6"/>' +
    '<ellipse cx="' + (x + 5) + '" cy="22.5" rx="4.6" ry="1.8" fill="#ead9b0" stroke="#5c1009" stroke-width=".8"/>';

  function makeSprite() {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'tnt');
    svg.setAttribute('width', W);
    svg.setAttribute('height', H);
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.innerHTML =
      '<ellipse cx="20" cy="53" rx="17" ry="3" fill="rgba(0,0,0,.35)"/>' +
      STICK(5) + STICK(25) + STICK(15) +
      '<rect x="3.5" y="31" width="33" height="11" rx="1.5" fill="#211b16" stroke="#0d0a08" stroke-width=".8"/>' +
      '<text x="20" y="39.6" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="8.6" fill="#f6d34a" letter-spacing=".6">TNT</text>' +
      '<polyline class="tnt-fuse" fill="none" stroke="#2c2219" stroke-width="1.9" stroke-linecap="round"/>' +
      '<g class="tnt-spark"><g class="tnt-flicker">' +
      '<circle r="5" fill="rgba(255,170,40,.45)"/>' +
      '<path d="M-6 0H6M0-6V6M-4-4L4 4M-4 4L4-4" stroke="#ffc34d" stroke-width="1.1" stroke-linecap="round"/>' +
      '<circle r="2.2" fill="#fff8d6"/>' +
      '</g></g>';
    return svg;
  }

  class Tnt {
    constructor(opts) {
      this.layer = opts.layer;     // document-px layer above the panels
      this.rocks = opts.rocks;     // () => the current static rocks
      this.radius = opts.radius;   // blast radius (px)
      this.onBlast = opts.onBlast; // (x, y, radius): break the rocks, throw the water
      this.bombs = [];
    }

    // Plants a bomb if (x, y) is on solid rock. Returns true if it hit rock.
    place(rocks, x, y) {
      let rock = null;
      for (const r of rocks) if (r.el && Rocks.solidAt(r, x, y)) { rock = r; break; }
      if (!rock) return false;
      if (this.bombs.length >= MAX_BOMBS) return true;
      const node = makeSprite();
      const b = {
        el: rock.el, lx: x - rock.ox, ly: y - rock.oy, x: x, y: y,
        fuse: FUSE, tilt: (Math.random() - 0.5) * 24, node: node,
        fuseLine: node.querySelector('.tnt-fuse'), spark: node.querySelector('.tnt-spark'),
      };
      this.position(b);
      this.draw(b);
      this.layer.appendChild(node);
      this.bombs.push(b);
      return true;
    }

    position(b) {
      b.node.style.transform = 'translate(' + (b.x - MID_X).toFixed(1) + 'px,' + (b.y - MID_Y).toFixed(1) + 'px) rotate(' + b.tilt.toFixed(1) + 'deg)';
    }

    // Burns the fuse down to the spark.
    draw(b) {
      const f = (FUSE_PTS.length - 1) * Math.max(0, b.fuse / FUSE);
      const i = Math.floor(f), t = f - i;
      const pts = [];
      for (let k = 0; k <= i; k++) pts.push(FUSE_PTS[k][0].toFixed(1) + ',' + FUSE_PTS[k][1].toFixed(1));
      const a = FUSE_PTS[i], c = FUSE_PTS[Math.min(i + 1, FUSE_PTS.length - 1)];
      const sx = a[0] + (c[0] - a[0]) * t, sy = a[1] + (c[1] - a[1]) * t;
      pts.push(sx.toFixed(1) + ',' + sy.toFixed(1));
      b.fuseLine.setAttribute('points', pts.join(' '));
      b.spark.setAttribute('transform', 'translate(' + sx.toFixed(1) + ' ' + sy.toFixed(1) + ')');
      b.node.classList.toggle('hot', b.fuse <= HOT);
    }

    // After the rocks are rebuilt: follow each bomb's panel, and drop bombs
    // whose panel is no longer shown.
    layout(rocks) {
      for (let k = this.bombs.length - 1; k >= 0; k--) {
        const b = this.bombs[k];
        const rock = rocks.find((r) => r.el === b.el);
        if (!rock) { b.node.remove(); this.bombs.splice(k, 1); continue; }
        b.x = rock.ox + b.lx; b.y = rock.oy + b.ly;
        this.position(b);
      }
    }

    // One simulation step.
    step() {
      for (const b of this.bombs.slice()) {
        if (this.bombs.indexOf(b) < 0) continue; // dropped by a relayout mid-step
        // The rock under it was knocked away: it goes off at once.
        if (b.fuse > CHAIN && !this.rocks().some((r) => r.el === b.el && Rocks.solidAt(r, b.x, b.y))) b.fuse = CHAIN;
        if (--b.fuse > 0) { this.draw(b); continue; }
        this.bombs.splice(this.bombs.indexOf(b), 1);
        b.node.remove();
        this.explode(b.x, b.y);
      }
    }

    explode(x, y) {
      const R = this.radius * (0.9 + Math.random() * 0.2);
      for (const o of this.bombs) {
        if (Math.hypot(o.x - x, o.y - y) < R) o.fuse = Math.min(o.fuse, CHAIN + Math.floor(Math.random() * 6));
      }
      boom(this.layer, x, y, R);
      this.onBlast(x, y, R);
    }

    clear() {
      for (const b of this.bombs) b.node.remove();
      this.bombs.length = 0;
    }
  }

  // Flash, shock ring, embers and smoke, all CSS animations, then a shake.
  function boom(layer, x, y, r) {
    const el = document.createElement('div');
    el.className = 'boom';
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.style.setProperty('--r', r.toFixed(0) + 'px');
    let html = '<i class="boom-flash"></i><i class="boom-ring"></i>';
    for (let k = 0; k < 14; k++) {
      const a = Math.random() * Math.PI * 2, d = r * (0.6 + Math.random() * 0.9);
      html += '<i class="boom-ember" style="--dx:' + (Math.cos(a) * d).toFixed(0) + 'px;--dy:' + (Math.sin(a) * d - r * 0.3).toFixed(0) + 'px"></i>';
    }
    for (let k = 0; k < 10; k++) {
      const a = Math.random() * Math.PI * 2, d = r * (0.25 + Math.random() * 0.55);
      html += '<i class="boom-smoke" style="--dx:' + (Math.cos(a) * d).toFixed(0) + 'px;--dy:' + (Math.sin(a) * d - r * 0.35).toFixed(0) +
        'px;--s:' + (r * (0.5 + Math.random() * 0.5)).toFixed(0) + 'px;--t:' + (Math.random() * 120).toFixed(0) + 'ms"></i>';
    }
    el.innerHTML = html;
    layer.appendChild(el);
    setTimeout(() => el.remove(), 1800);

    const doc = document.documentElement;
    doc.classList.remove('shaking');
    void doc.offsetWidth; // restart the shake for a chain reaction
    doc.classList.add('shaking');
    clearTimeout(boom.timer);
    boom.timer = setTimeout(() => doc.classList.remove('shaking'), 450);
  }

  root.Tnt = Tnt;
})(window);
