// The achievements on the page: the boxes at the bottom (dark grey until
// unlocked, then filled with their group's colour), the banner that drops in
// over the plant with a burst of pixel sparks, the counter in the top bar
// and the goal Try it sets. achievements.js decides what's unlocked.
(function (root) {
  'use strict';

  const Ach = root.ReactorAchievements;
  const $ = function (id) { return document.getElementById(id); };

  // Brighter versions of the group colours, for text and borders on the dark page.
  const BRIGHT = { start: '#6ea8ff', physics: '#3fd6a0', protect: '#ffb43c', emergency: '#b18cff', sandbox: '#ff6b5f', gold: '#ffd23f' };
  const LOCKED = '#4b5261', LOCKED_HI = '#5f6777';

  // 12 × 12 icons: # is the colour, + a lighter shade, anything else clear.
  const ICONS = {
    button: ['....####....', '..########..', '.##++######.', '.#++#######.', '##+#########', '############',
      '############', '############', '.##########.', '.##########.', '..########..', '....####....'],
    autopilot: ['...#........', '..###.......', '.#####......', '...#........', '...#....#...', '...#....#...',
      '...#....#...', '...#....#...', '........#...', '......#####.', '.......###..', '........#...'],
    atom: ['............', '.....+#.....', '...#....#...', '..#......#..', '.#...##...#.', '.#..####..+.',
      '.+..####..#.', '.#...##...#.', '..#......#..', '...#....#...', '.....#+.....', '............'],
    bulb: ['....####....', '...#++++#...', '..#++++++#..', '..#++++++#..', '..#++++++#..', '...#++++#...',
      '....#++#....', '....####....', '....####....', '.....##.....', '............', '............'],
    thermo: ['.....##.....', '....#..#....', '....#..#....', '....#++#....', '....#++#....', '....#++#....',
      '....#++#....', '...#++++#...', '..#++++++#..', '..#++++++#..', '...#++++#...', '....####....'],
    level: ['............', '............', '............', '############', '#....++....#', '#...++++...#',
      '#....++....#', '############', '............', '.....##.....', '....####....', '............'],
    loop: ['..########..', '.#........#.', '.#........#.', '.#.......###', '.#........#.', '.#..........',
      '..........#.', '.#........#.', '###.......#.', '.#........#.', '.#........#.', '..########..'],
    ember: ['.....#......', '.....##.....', '....###.....', '....####....', '...##+##....', '...#+++##...',
      '..##+++###..', '..#++++++#..', '..#++++++#..', '...#++++#...', '....####....', '............'],
    gauge: ['.....##.....', '....####....', '...######...', '..########..', '.....##.....', '############',
      '############', '.....##.....', '.....##.....', '.....##.....', '.....##.....', '............'],
    bolt: ['......####..', '.....####...', '....####....', '...####.....', '..#######...', '.......##...',
      '......##....', '.....##.....', '....##......', '...##.......', '..#.........', '............'],
    drop: ['.....##.....', '.....##.....', '....#..#....', '....#..#....', '...#....#...', '..#......#..',
      '..#......#..', '..#......#..', '..#++++++#..', '...#++++#...', '....####....', '............'],
    tally: ['............', '.#..#..#..#.', '.#..#..#..#.', '.#..#..#.##.', '.#..#..###..', '.#..#.##.#..',
      '.#..###..#..', '.#.##.#..#..', '.###..#..#..', '##.#..#..#..', '.#..#..#..#.', '............'],
    steam: ['..#...#...#.', '.#...#...#..', '..#...#...#.', '...#...#...#', '..#...#...#.', '.#...#...#..',
      '..#...#...#.', '............', '############', '#++++++++++#', '############', '............'],
    plug: ['...#....#...', '...#....#...', '...#....#...', '..########..', '..#++++++#..', '..#++++++#..',
      '..#++++++#..', '...#++++#...', '....####....', '.....##.....', '.....##.....', '.....##.....'],
    clock: ['.##########.', '..#......#..', '..#++++++#..', '...#++++#...', '....#++#....', '.....##.....',
      '.....##.....', '....#..#....', '...#....#...', '..#..++..#..', '..#++++++#..', '.##########.'],
    hand: ['....#.#.#...', '....#.#.#.#.', '....#.#.#.#.', '.#..#.#.#.#.', '.#..#######.', '..#.#######.',
      '..#########.', '...########.', '...#######..', '....######..', '....######..', '............'],
    trefoil: ['............', '..##....##..', '.####..####.', '.####..####.', '..###..###..', '.....##.....',
      '.....##.....', '....####....', '...######...', '...######...', '....####....', '............'],
    trophy: ['.##########.', '#.########.#', '#.########.#', '.#.######.#.', '...######...', '....####....',
      '.....##.....', '.....##.....', '....####....', '...######...', '...######...', '............']
  };

  function mix(a, b, t) {
    const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    const c = [16, 8, 0].map(function (sh) {
      const x = (pa >> sh) & 255, y = (pb >> sh) & 255;
      return Math.round(x + (y - x) * t);
    });
    return 'rgb(' + c.join(',') + ')';
  }

  function drawIcon(canvas, name, color, hi) {
    const g = canvas.getContext('2d');
    const rows = ICONS[name] || ICONS.trophy;
    g.clearRect(0, 0, 12, 12);
    for (let y = 0; y < 12; y++) {
      for (let x = 0; x < 12; x++) {
        const c = rows[y][x];
        if (c === '#') g.fillStyle = color;
        else if (c === '+') g.fillStyle = hi;
        else continue;
        g.fillRect(x, y, 1, 1);
      }
    }
  }

  function iconCanvas(cls) {
    const c = document.createElement('canvas');
    c.width = 12;
    c.height = 12;
    c.className = cls;
    c.setAttribute('aria-hidden', 'true');
    return c;
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function reducedMotion() {
    return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  // How much of the top of the screen the plant covers: on phones it stays
  // pinned there while the page scrolls under it.
  function pinned() {
    const st = document.querySelector('.stage');
    return st && root.getComputedStyle(st).position === 'sticky' ? st.offsetHeight : 0;
  }

  // Pixel sparks thrown up out of the banner's icon.
  function Sparks(canvas) {
    this.c = canvas;
    this.g = canvas.getContext('2d');
    this.p = [];
    this.raf = 0;
  }
  Sparks.prototype.burst = function (x, y, colors) {
    // One spark pixel is 3 CSS pixels on a phone, 4 on the full-size plant.
    const scale = Math.max(3, Math.round(this.c.clientWidth / 240));
    const w = Math.round(this.c.clientWidth / scale), h = Math.round(this.c.clientHeight / scale);
    if (!w || !h) return;
    this.c.width = w;
    this.c.height = h;
    this.p = [];
    for (let i = 0; i < 60; i++) {
      const a = Math.random() * Math.PI * 2, v = 20 + Math.random() * 50;
      this.p.push({
        x: x / scale, y: y / scale,
        vx: Math.cos(a) * v, vy: Math.sin(a) * v - 45,
        life: 0.7 + Math.random() * 0.8, age: 0,
        c: colors[i % colors.length]
      });
    }
    const self = this;
    let last = 0;
    cancelAnimationFrame(this.raf);
    function tick(now) {
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
      last = now;
      const g = self.g;
      g.clearRect(0, 0, w, h);
      let alive = 0;
      self.p.forEach(function (q) {
        q.age += dt;
        if (q.age > q.life) return;
        alive++;
        q.vy += 70 * dt;
        q.x += q.vx * dt;
        q.y += q.vy * dt;
        g.globalAlpha = q.age > q.life * 0.7 ? 0.5 : 1;
        g.fillStyle = q.c;
        g.fillRect(Math.round(q.x), Math.round(q.y), 1, 1);
      });
      g.globalAlpha = 1;
      if (alive) self.raf = requestAnimationFrame(tick);
      else g.clearRect(0, 0, w, h);
    }
    this.raf = requestAnimationFrame(tick);
  };

  function AchievementsUI(app, tracker, save) {
    this.app = app;
    this.tr = tracker;
    this.save = save;
    this.boxes = {};
    this.queue = [];
    this.showing = false;
    this.goal = null;
    this.build();
    this.bind();
    this.refresh();
  }

  AchievementsUI.prototype.build = function () {
    const host = $('ach-groups');
    host.textContent = '';
    const ui = this;
    Object.keys(Ach.GROUPS).forEach(function (gid) {
      const items = Ach.LIST.filter(function (a) { return a.group === gid; });
      if (!items.length) return;
      const group = Ach.GROUPS[gid];
      const head = el('h3', 'ach-group', group.name);
      head.style.setProperty('--b', BRIGHT[gid]);
      const list = el('ul', 'ach-grid');
      items.forEach(function (a) {
        const li = el('li', 'ach');
        li.dataset.id = a.id;
        li.style.setProperty('--c', group.color);
        li.style.setProperty('--ink', group.ink);
        const icon = iconCanvas('ach-icon');
        const body = el('div', 'ach-body');
        const name = el('h4', 'ach-name', a.name);
        const text = el('p', 'ach-text');
        body.appendChild(name);
        body.appendChild(text);
        if (a.need) body.appendChild(el('p', 'ach-prog'));
        const state = el('span', 'sr-only ach-state');
        const lock = el('span', 'ach-lock');
        lock.setAttribute('aria-hidden', 'true');
        const badge = el('span', 'ach-new', 'New');
        li.appendChild(icon);
        li.appendChild(body);
        li.appendChild(state);
        li.appendChild(lock);
        li.appendChild(badge);
        if (a.scenario) {
          const btn = el('button', 'btn small ach-try');
          btn.type = 'button';
          btn.addEventListener('click', function () { ui.tryIt(a); });
          li.appendChild(btn);
        }
        list.appendChild(li);
        ui.boxes[a.id] = { li: li, icon: icon, text: text, state: state, a: a };
      });
      host.appendChild(head);
      host.appendChild(list);
    });
    $('ach-total').textContent = Ach.LIST.length;
    drawIcon($('btn-ach').querySelector('canvas'), 'trophy', '#ffd23f', '#fff1b0');
  };

  AchievementsUI.prototype.bind = function () {
    const ui = this;
    $('btn-ach').addEventListener('click', function () { ui.scrollTo($('achievements'), 'start'); });
    $('ach-toast').addEventListener('click', function () {
      const id = ui.toastId;
      ui.hideToast(true);
      if (id) ui.scrollTo(ui.boxes[id].li, 'center');
    });
    $('goal').addEventListener('click', function () {
      if (ui.goal) ui.app.showGoal();
    });
    const reset = $('ach-reset');
    let armed = 0;
    reset.addEventListener('click', function () {
      if (!armed) {
        armed = setTimeout(function () { armed = 0; reset.textContent = 'Reset'; reset.classList.remove('danger'); }, 4000);
        reset.textContent = 'Sure? Reset all';
        reset.classList.add('danger');
        return;
      }
      clearTimeout(armed);
      armed = 0;
      reset.textContent = 'Reset';
      reset.classList.remove('danger');
      ui.tr.reset();
      ui.save();
      ui.setGoal(null);
      ui.refresh();
    });
  };

  // Scroll `target` to the top ('start') or the middle of the part of the
  // screen the plant doesn't cover.
  AchievementsUI.prototype.scrollTo = function (target, where) {
    const top = pinned(), r = target.getBoundingClientRect();
    const gap = where === 'start' ? 8 : Math.max(8, (root.innerHeight - top - r.height) / 2);
    root.scrollBy({ top: r.top - top - gap, behavior: reducedMotion() ? 'auto' : 'smooth' });
  };

  // A box unlocked out of sight fills in once most of it scrolls into view,
  // below the plant on phones.
  AchievementsUI.prototype.watch = function (id) {
    const ui = this, b = this.boxes[id];
    if (!('IntersectionObserver' in root)) { this.fill(id); return; }
    b.watched = true;
    const io = new IntersectionObserver(function (entries) {
      if (!entries.some(function (e) { return e.intersectionRatio >= 0.59; })) return;
      io.disconnect();
      ui.fill(id);
    }, { rootMargin: -pinned() + 'px 0px 0px 0px', threshold: 0.6 });
    io.observe(b.li);
  };

  // Draw every box, the counters and the meter from the tracker.
  AchievementsUI.prototype.refresh = function () {
    const tr = this.tr;
    const ids = Object.keys(this.boxes);
    for (let i = 0; i < ids.length; i++) this.drawBox(ids[i]);
    const n = tr.count(), total = Ach.LIST.length;
    $('ach-done').textContent = n;
    $('ach-meter-fill').style.width = (100 * n / total) + '%';
    $('ach-count').textContent = n + '/' + total;
    $('btn-ach').setAttribute('aria-label', 'Achievements: ' + n + ' of ' + total + ' unlocked');
    $('ach-reset').disabled = n === 0 && tr.tripCount() === 0;
  };

  AchievementsUI.prototype.drawBox = function (id) {
    const b = this.boxes[id], a = b.a, tr = this.tr;
    const got = !!tr.got[id];
    // Unlocked but not yet watched filling in: still shows as locked, marked New.
    const waiting = got && !tr.seen[id];
    b.li.classList.toggle('got', got);
    b.li.classList.toggle('fresh', waiting);
    const lit = got && !waiting;
    const group = Ach.GROUPS[a.group];
    if (lit) drawIcon(b.icon, a.icon, group.ink, mix(group.ink, group.color, 0.45));
    else drawIcon(b.icon, a.icon, LOCKED, LOCKED_HI);
    b.text.textContent = lit ? a.done : a.hint;
    b.state.textContent = got ? 'Unlocked.' : 'Locked.';
    const prog = b.li.querySelector('.ach-prog');
    if (prog) prog.textContent = Math.min(tr.tripCount(), a.need) + ' of ' + a.need + ' trips';
    const btn = b.li.querySelector('.ach-try');
    if (btn) {
      btn.textContent = got ? 'Play again' : 'Try it';
      btn.setAttribute('aria-label', (got ? 'Play again: ' : 'Try it: ') + a.name);
    }
    if (waiting && !b.watched) this.watch(id);
  };

  // The box fills with colour from the bottom up, then a shine runs across.
  AchievementsUI.prototype.fill = function (id) {
    const b = this.boxes[id], tr = this.tr, ui = this;
    b.watched = false;
    if (!tr.got[id] || tr.seen[id]) return;
    function finish() {
      tr.seen[id] = true;
      ui.save();
      b.li.classList.remove('filling');
      ui.drawBox(id);
      if (!reducedMotion()) {
        b.li.classList.add('shine');
        setTimeout(function () { b.li.classList.remove('shine'); }, 900);
      }
    }
    if (reducedMotion()) { finish(); return; }
    b.li.classList.add('filling');
    setTimeout(finish, 1250);
  };

  // Newly unlocked: queue a banner for each, refresh the boxes.
  AchievementsUI.prototype.unlocked = function (list) {
    const ui = this;
    list.forEach(function (a) {
      ui.queue.push(a);
      if (ui.goal && ui.goal.id === a.id) {
        ui.setGoal(null);
        if (ui.app.onGoalDone) ui.app.onGoalDone();
      }
    });
    this.refresh();
    if (!this.showing) this.next();
  };

  AchievementsUI.prototype.next = function () {
    const a = this.queue.shift();
    if (!a) { this.showing = false; return; }
    this.showing = true;
    const t = $('ach-toast'), gid = a.group;
    this.toastId = a.id;
    t.style.setProperty('--b', BRIGHT[gid]);
    drawIcon(t.querySelector('canvas.ach-toast-icon'), a.icon, BRIGHT[gid], mix(BRIGHT[gid], '#ffffff', 0.5));
    $('ach-toast-name').textContent = a.name;
    $('ach-live').textContent = 'Achievement unlocked: ' + a.name + '. ' + a.done;
    t.setAttribute('aria-label', 'Achievement unlocked: ' + a.name + '. Show it in the list.');
    t.hidden = false;
    t.classList.remove('show');
    void t.offsetWidth; // restart the drop-in
    t.classList.add('show');
    if (!reducedMotion()) {
      const sparks = this.sparks || (this.sparks = new Sparks($('ach-sparks')));
      const icon = t.querySelector('canvas.ach-toast-icon');
      const cr = $('ach-sparks').getBoundingClientRect(), ir = icon.getBoundingClientRect();
      sparks.burst(ir.left + ir.width / 2 - cr.left, ir.top + ir.height / 2 - cr.top, [BRIGHT[gid], '#ffffff', '#ffd23f', BRIGHT[gid]]);
    }
    if (this.app.onAchievement) this.app.onAchievement(a);
    const ui = this;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(function () { ui.hideToast(); }, 4200);
  };

  AchievementsUI.prototype.hideToast = function (now) {
    const t = $('ach-toast'), ui = this;
    clearTimeout(this.toastTimer);
    t.classList.remove('show');
    setTimeout(function () {
      if (!t.classList.contains('show')) t.hidden = true;
      ui.next();
    }, now || reducedMotion() ? 0 : 300);
  };

  AchievementsUI.prototype.tryIt = function (a) {
    this.app.start(a.scenario, a.id);
    root.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
  };

  // The goal chip over the plant, set by Try it until it's done.
  AchievementsUI.prototype.setGoal = function (a) {
    this.goal = a && !this.tr.got[a.id] ? a : null;
    const g = $('goal');
    g.hidden = !this.goal;
    if (this.goal) {
      $('goal-name').textContent = this.goal.name;
      g.style.setProperty('--b', BRIGHT[this.goal.group]);
      g.setAttribute('aria-label', 'Goal: ' + this.goal.name + '. ' + this.goal.hint + ' Show the briefing.');
    }
  };

  root.ReactorAchievementsUI = { AchievementsUI: AchievementsUI, drawIcon: drawIcon, ICONS: ICONS, BRIGHT: BRIGHT };
})(typeof window !== 'undefined' ? window : globalThis);
