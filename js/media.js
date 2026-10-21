// Project media. The old site's GIFs are short looping videos here: they load
// and play only while on screen, so a phone downloads only what it shows.
// Every clip box has a pause/play toggle in its corner, so the motion can
// always be stopped. Where the browser refuses to autoplay (iOS Low Power
// Mode, data saver, reduced motion) the poster stays up with a large play
// button. The IPPT Buddy video is a poster linking to YouTube until tapped,
// then the player loads in place until the visitor leaves the tab.
(function () {
  'use strict';

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const saveData = !!(navigator.connection && navigator.connection.saveData);
  const autoplay = !reducedMotion && !saveData;

  function label(video) { return video.getAttribute('aria-label') || 'clip'; }
  function shownClip(box) { return box.querySelector(':scope > video.clip:not([hidden])'); }

  // A tap on either button: the visitor wants this clip playing. Inside the
  // tap, play() is allowed even where autoplay is refused.
  function start(video) {
    delete video.dataset.stopped;
    video.dataset.wanted = '1';
    const p = video.play();
    if (p && p.catch) p.catch(function () {});
  }

  function stop(video) {
    video.dataset.stopped = '1';
    delete video.dataset.wanted;
    video.pause();
  }

  // The toggle follows whichever clip its box shows; an image hides it.
  function sync(box) {
    const t = box.querySelector(':scope > .media-toggle');
    const v = shownClip(box);
    t.hidden = !v;
    if (!v) return;
    t.classList.toggle('is-playing', !v.paused);
    t.setAttribute('aria-label', (v.paused ? 'Play ' : 'Pause ') + label(v));
  }

  function showPlayButton(video) {
    const box = video.parentElement;
    if (box.querySelector(':scope > .media-play')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'media-play';
    btn.setAttribute('aria-label', 'Play ' + label(video));
    btn.addEventListener('click', function () {
      // This button goes once the clip plays; keep keyboard focus in the box.
      if (document.activeElement === btn) box.querySelector(':scope > .media-toggle').focus();
      start(video);
    });
    box.appendChild(btn);
  }

  function play(video) {
    if (video.dataset.stopped) return; // the visitor paused it
    if (!autoplay && !video.dataset.wanted) { showPlayButton(video); return; }
    const p = video.play();
    // AbortError only means it scrolled away again before it started.
    if (p && p.catch) p.catch(function (err) { if (err.name !== 'AbortError') showPlayButton(video); });
  }

  // Posters wait in data-poster too, so the Home tab doesn't fetch them.
  function show(video) {
    if (video.dataset.poster) { video.poster = video.dataset.poster; video.removeAttribute('data-poster'); }
    play(video);
  }

  document.querySelectorAll('.media').forEach(function (box) {
    const vids = box.querySelectorAll(':scope > video.clip');
    if (!vids.length) return;
    const t = document.createElement('button');
    t.type = 'button';
    t.className = 'media-toggle';
    t.addEventListener('click', function () {
      const v = shownClip(box);
      if (v) { if (v.paused) start(v); else stop(v); }
    });
    box.appendChild(t);
    vids.forEach(function (v) {
      v.addEventListener('play', function () { sync(box); });
      v.addEventListener('pause', function () { sync(box); });
      v.addEventListener('playing', function () {
        const b = box.querySelector(':scope > .media-play');
        if (b) b.remove();
      });
    });
    sync(box);
  });

  const clips = document.querySelectorAll('video.clip');
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) show(e.target);
        else if (!e.target.paused) e.target.pause();
      });
    }, { rootMargin: '200px 0px' });
    clips.forEach(function (v) { io.observe(v); });
  } else {
    clips.forEach(show);
  }

  // Galleries stand in for the old site's carousels: every item sits in the
  // slot, hidden but the one shown, and the thumbnails below pick which. A
  // hidden clip drops out of view, so the observer pauses it, and a hidden
  // image loads lazily the first time it is shown. The slot keeps the first
  // item's shape, so swapping never moves the rocks.
  document.querySelectorAll('.gallery').forEach(function (g) {
    const slot = g.querySelector('.media');
    const items = slot.querySelectorAll(':scope > img, :scope > video');
    const thumbs = g.querySelectorAll('.thumb');
    thumbs.forEach(function (btn, i) {
      btn.addEventListener('click', function () {
        if (btn.getAttribute('aria-pressed') === 'true') return;
        items.forEach(function (it, k) { it.hidden = k !== i; });
        thumbs.forEach(function (t, k) { t.setAttribute('aria-pressed', String(k === i)); });
        const b = slot.querySelector(':scope > .media-play');
        if (b) b.remove();
        if (slot.querySelector(':scope > .media-toggle')) sync(slot);
      });
    });
  });

  document.querySelectorAll('a.media[data-youtube]').forEach(function (link) {
    link.addEventListener('click', function (e) {
      if (e.metaKey || e.ctrlKey || e.shiftKey) return; // let it open YouTube
      e.preventDefault();
      const frame = document.createElement('iframe');
      frame.className = 'media-frame';
      frame.src = 'https://www.youtube-nocookie.com/embed/' + link.dataset.youtube + '?autoplay=1&rel=0&playsinline=1';
      frame.title = link.dataset.title || 'Video';
      frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
      frame.allowFullscreen = true;
      const page = link.closest('[data-page]');
      const box = document.createElement('div');
      box.className = link.className;
      box.style.aspectRatio = link.style.aspectRatio || '16 / 9';
      box.appendChild(frame);
      // Cracks already drawn over the poster stay on the player.
      const cracks = link.querySelector(':scope > .media-cracks');
      if (cracks) box.appendChild(cracks);
      link.replaceWith(box);
      frame.focus();
      // Switching tabs hides the player but wouldn't stop it, so put the
      // poster back, which unloads the player.
      function unload() {
        if ((location.hash || '#home').slice(1) === page.dataset.page) return;
        window.removeEventListener('hashchange', unload);
        const c = box.querySelector(':scope > .media-cracks');
        if (c) link.appendChild(c);
        box.replaceWith(link);
      }
      window.addEventListener('hashchange', unload);
    });
  });
})();
