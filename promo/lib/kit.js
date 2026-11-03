/* SPOT promo kit — helpers shared by both videos.
 * Everything is driven by ONE paused GSAP timeline; the renderer seeks it frame by
 * frame (window.__seek), so every tween must be a pure function of time: no
 * call()/setTimeout, text and counters are written from onUpdate. */
(function () {
  const Z = 620 / 393; // phone screen zoom: points → stage px

  /* ---------- icons: <i data-i="name" data-s="20" data-c="#888" data-w="1"></i> → svg */
  function svg(name, size = 24, color = 'currentColor', w = 1.15) {
    const inner = (window.ICONS[name] || '').replace(/SW/g, String(w));
    return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" style="color:${color}">${inner}</svg>`;
  }
  function hydrateIcons(root = document) {
    root.querySelectorAll('i[data-i]').forEach((el) => {
      const s = el.dataset;
      el.outerHTML = svg(s.i, Number(s.s || 24), s.c || 'currentColor', Number(s.w || 1.15));
    });
  }

  /* ---------- avatars: deterministic gradient + initials, as components/ui/Avatar */
  const AV = [['#8E9EAB', '#636B72'], ['#B8C0C8', '#8A929B'], ['#A3A7B0', '#6E7480'], ['#9BA8B4', '#6B7885'], ['#AEB6BD', '#7C848C']];
  const GYM = [['#23262B', '#3B424B'], ['#1F2A24', '#33413A'], ['#262330', '#3E3846'], ['#22272E', '#39434E'], ['#2A2622', '#443C34']];
  const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };
  function hydrateAvatars(root = document) {
    root.querySelectorAll('[data-av]').forEach((el) => {
      const name = el.dataset.av; const size = Number(el.dataset.size || 44);
      const [a, b] = el.dataset.tone ? el.dataset.tone.split(',') : AV[hash(name) % AV.length];
      el.classList.add('av');
      el.style.width = el.style.height = size + 'px';
      el.style.fontSize = size * 0.36 + 'px';
      el.style.background = `linear-gradient(135deg, ${a}, ${b})`;
      el.textContent = name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
    });
    root.querySelectorAll('[data-gym]').forEach((el) => {
      const name = el.dataset.gym;
      const [a, b] = el.dataset.tone ? el.dataset.tone.split(',') : GYM[hash(name) % GYM.length];
      const glyph = el.dataset.glyph === 'none' ? '' : `<div class="glyph">${svg(el.dataset.glyph || 'dumbbell', Number(el.dataset.gs || 54), 'rgba(255,255,255,0.10)', 1)}</div>`;
      el.insertAdjacentHTML('afterbegin', `<div class="g" style="background:linear-gradient(135deg, ${a}, ${b})"></div>${el.dataset.light ? `<div class="g" style="background:${el.dataset.light}"></div>` : ''}${glyph}<div class="sheen"></div>`);
    });
  }

  /* ---------- measuring: an element's box in UI points, read before any tween runs */
  function box(el) {
    if (typeof el === 'string') el = document.querySelector(el);
    const ui = el.closest('.ui');
    const r = el.getBoundingClientRect();
    const u = ui.getBoundingClientRect();
    // getBoundingClientRect is in stage px; the .ui is zoomed by Z
    const k = u.width / 393;
    return { x: (r.left - u.left) / k, y: (r.top - u.top) / k, w: r.width / k, h: r.height / k, cx: (r.left - u.left + r.width / 2) / k, cy: (r.top - u.top + r.height / 2) / k };
  }

  /* ---------- text & numbers written from progress */
  function typeText(tl, el, text, at, dur, { empty = '' } = {}) {
    if (typeof el === 'string') el = document.querySelector(el);
    const o = { n: 0 };
    tl.to(o, {
      n: text.length, duration: dur, ease: 'none',
      onUpdate: () => { const s = text.slice(0, Math.round(o.n)); el.textContent = s || empty; },
    }, at);
    return at + dur;
  }
  function count(tl, el, from, to, at, dur, fmt = (v) => Math.round(v), ease = 'power2.out') {
    if (typeof el === 'string') el = document.querySelector(el);
    const o = { v: from };
    tl.fromTo(o, { v: from }, { v: to, duration: dur, ease, immediateRender: false, onUpdate: () => { el.textContent = fmt(o.v); } }, at);
  }
  const az1 = (v) => v.toFixed(1).replace('.', ',');
  /** Swap an element's text at `at` — reversible (seeking back restores `from`). */
  function text(tl, el, from, to, at) {
    if (typeof el === 'string') el = document.querySelector(el);
    const o = { p: 0 };
    tl.fromTo(o, { p: 0 }, { p: 1, duration: 0.001, ease: 'none', immediateRender: false, onUpdate: () => { el.textContent = o.p >= 0.5 ? to : from; } }, at);
  }
  /** Add (on=true) or remove a class at `at` — reversible. */
  function cls(tl, el, name, at, on = true) {
    const els = typeof el === 'string' ? [...document.querySelectorAll(el)] : [el];
    const o = { p: 0 };
    tl.fromTo(o, { p: 0 }, { p: 1, duration: 0.001, ease: 'none', immediateRender: false, onUpdate: () => { els.forEach((e) => e.classList.toggle(name, (o.p >= 0.5) === on)); } }, at);
  }

  /* ---------- headline lines: wrap each line in a mask for a slide-up reveal */
  function splitLines(el) {
    const parts = el.innerHTML.split('<br>');
    el.innerHTML = parts.map((p) => `<span class="line"><span>${p}</span></span>`).join('');
    return el.querySelectorAll('.line > span');
  }

  /* ---------- touch indicator */
  function makeTouch(ui) {
    const t = document.createElement('div'); t.className = 'touch';
    const r = document.createElement('div'); r.className = 'ripple';
    ui.appendChild(r); ui.appendChild(t);
    return { t, r, x: 200, y: 600, shown: false };
  }
  /** Move the finger to (x,y) and tap at `at` (tap moment). Press effect on `target`. */
  function tap(tl, T, x, y, at, { target, move = 0.45, hold = 0.12, hide = true, sfx = true } = {}) {
    const start = at - move;
    if (!T.shown) {
      tl.set(T.t, { x, y, scale: 1.25, opacity: 0 }, start);
      tl.to(T.t, { opacity: 1, scale: 1, duration: 0.25, ease: 'power2.out' }, start);
      T.shown = true;
    } else {
      tl.to(T.t, { x, y, duration: move, ease: 'power3.inOut' }, start);
    }
    tl.to(T.t, { scale: 0.78, duration: 0.1, ease: 'power2.out' }, at);
    tl.to(T.t, { scale: 1, duration: 0.18, ease: 'power2.out' }, at + hold);
    tl.fromTo(T.r, { x, y, scale: 0.7, opacity: 0.9 }, { x, y, scale: 2.1, opacity: 0, duration: 0.5, ease: 'power2.out', immediateRender: false }, at + 0.02);
    if (target) {
      const els = typeof target === 'string' ? document.querySelectorAll(target) : target;
      tl.to(els, { scale: 0.96, duration: 0.1, ease: 'power2.out' }, at);
      tl.to(els, { scale: 1, duration: 0.25, ease: 'power2.out' }, at + hold);
    }
    if (sfx) window.SFX.push({ t: at, s: 'tap' });
    if (hide) hideTouch(tl, T, at + hold + 0.25);
    T.x = x; T.y = y;
    return at;
  }
  function hideTouch(tl, T, at) {
    tl.to(T.t, { opacity: 0, scale: 1.2, duration: 0.25, ease: 'power2.in' }, at);
    T.shown = false;
  }
  /** A drag (scroll gesture) from y0 to y1 at x, over dur. */
  function drag(tl, T, x, y0, y1, at, dur) {
    tl.set(T.t, { x, y: y0, scale: 1.2, opacity: 0 }, at - 0.2);
    tl.to(T.t, { opacity: 1, scale: 0.9, duration: 0.2 }, at - 0.2);
    tl.to(T.t, { y: y1, duration: dur, ease: 'power2.inOut' }, at);
    tl.to(T.t, { opacity: 0, scale: 1.1, duration: 0.2 }, at + dur);
    T.shown = false;
  }

  /* ---------- navigation */
  function push(tl, from, to, at, dur = 0.55) {
    tl.set(to, { xPercent: 100, visibility: 'visible' }, at);
    tl.to(to, { xPercent: 0, duration: dur, ease: 'power3.out' }, at);
    tl.to(from, { xPercent: -28, duration: dur, ease: 'power3.out' }, at);
    const d = from.querySelector(':scope > .dim');
    if (d) tl.to(d, { opacity: 0.12, duration: dur, ease: 'power3.out' }, at);
    tl.set(from, { visibility: 'hidden' }, at + dur);
    return at + dur;
  }
  function pop(tl, top, under, at, dur = 0.5) {
    tl.set(under, { visibility: 'visible' }, at);
    tl.to(top, { xPercent: 100, duration: dur, ease: 'power3.out' }, at);
    tl.to(under, { xPercent: 0, duration: dur, ease: 'power3.out' }, at);
    const d = under.querySelector(':scope > .dim');
    if (d) tl.to(d, { opacity: 0, duration: dur, ease: 'power3.out' }, at);
    tl.set(top, { visibility: 'hidden' }, at + dur);
    return at + dur;
  }

  /* ---------- copy blocks (label + headline + sub) */
  function copyIn(tl, block, at) {
    const label = block.querySelector('.label');
    const lines = block.querySelectorAll('.h1 .line > span');
    const sub = block.querySelector('.sub');
    tl.set(block, { visibility: 'visible' }, at);
    tl.fromTo(label, { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, ease: 'power3.out', immediateRender: false }, at);
    tl.fromTo(lines, { yPercent: 110 }, { yPercent: 0, duration: 0.7, ease: 'power4.out', stagger: 0.08, immediateRender: false }, at + 0.05);
    if (sub) tl.fromTo(sub, { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6, ease: 'power3.out', immediateRender: false }, at + 0.25);
    return at + 0.8;
  }
  function copyOut(tl, block, at) {
    const label = block.querySelector('.label');
    const lines = block.querySelectorAll('.h1 .line > span');
    const sub = block.querySelector('.sub');
    tl.to(label, { y: -20, opacity: 0, duration: 0.35, ease: 'power2.in' }, at);
    tl.to(lines, { yPercent: -110, duration: 0.4, ease: 'power3.in', stagger: 0.04 }, at);
    if (sub) tl.to(sub, { y: -16, opacity: 0, duration: 0.35, ease: 'power2.in' }, at);
    tl.set(block, { visibility: 'hidden' }, at + 0.5);
    return at + 0.5;
  }

  /* ---------- callouts */
  function calloutIn(tl, el, at, { from = 'right' } = {}) {
    const dx = from === 'left' ? -60 : from === 'right' ? 60 : 0;
    tl.fromTo(el, { opacity: 0, scale: 0.7, x: dx, y: 10 }, { opacity: 1, scale: 1, x: 0, y: 0, duration: 0.6, ease: 'back.out(1.6)', immediateRender: false }, at);
    window.SFX.push({ t: at + 0.05, s: 'pop' });
  }
  function calloutOut(tl, el, at) {
    tl.to(el, { opacity: 0, scale: 0.85, duration: 0.3, ease: 'power2.in' }, at);
  }

  function init() {
    hydrateIcons();
    hydrateAvatars();
    document.querySelectorAll('.copy .h1, [data-split]').forEach(splitLines);
  }

  window.SFX = [];
  window.K = { Z, svg, box, typeText, count, az1, text, cls, tap, hideTouch, drag, push, pop, copyIn, copyOut, calloutIn, calloutOut, makeTouch, init, hash };

  /** The renderer's entry: build() returns the master timeline. */
  window.__boot = function (build) {
    init();
    const tl = build();
    tl.pause(0);
    // touch every tween once in order so later seeks start from recorded values
    tl.progress(1, false).progress(0, false);
    window.__duration = tl.duration();
    window.__seek = (t) => { tl.seek(t, false); };
    window.__tl = tl;
    window.__ready = true;
  };
})();
