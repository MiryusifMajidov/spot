/* SPOT promo stage helpers (style of SPOT-promo-v3). Depends on kit.js (K). */
(function () {
  const $ = (s) => document.querySelector(s);

  /* ---------- grounds: hard cut to one of .bg.dark/.volt/.light/.photo */
  function ground(tl, name, at) {
    document.querySelectorAll('#stage > .bg').forEach((b) => {
      tl.set(b, { opacity: b.classList.contains(name) ? 1 : 0 }, at);
    });
    const r = $('#rings');
    if (r) {
      tl.set(r, { opacity: name === 'pic' ? 0 : 1 }, at);
      K.cls(tl, r, 'onvolt', at, name === 'volt');
      K.cls(tl, r, 'onlight', at, name === 'light');
    }
  }
  function makeRings(radii = [260, 420, 600, 800, 1020]) {
    const r = document.createElement('div'); r.className = 'rings'; r.id = 'rings';
    radii.forEach((d) => { const i = document.createElement('i'); i.style.width = i.style.height = d * 2 + 'px'; r.appendChild(i); });
    $('#stage').insertBefore(r, $('#stage .phone') || null);
    return r;
  }
  /** a soft pulse of the rings on the beat between t0 and t1 */
  function ringPulse(tl, t0, t1, beat = 0.5) {
    for (let t = t0; t < t1; t += beat * 2) {
      tl.fromTo('#rings', { scale: 1.035 }, { scale: 1, duration: beat * 1.8, ease: 'power2.out', immediateRender: false }, t);
    }
  }

  /* ---------- headlines: <div class="head" id="h1">Line one<br><span class="v">line two.</span></div> */
  function headIn(tl, id, at) {
    const el = typeof id === 'string' ? $(id) : id;
    const lines = el.querySelectorAll('.line > span');
    tl.set(el, { visibility: 'visible' }, at);
    tl.fromTo(lines, { yPercent: 105 }, { yPercent: 0, duration: 0.55, ease: 'power4.out', stagger: 0.09, immediateRender: false }, at);
  }
  function headOut(tl, id, at, cut = true) {
    const el = typeof id === 'string' ? $(id) : id;
    if (cut) { tl.set(el, { visibility: 'hidden' }, at); return; }
    tl.to(el.querySelectorAll('.line > span'), { yPercent: -105, duration: 0.3, ease: 'power3.in', stagger: 0.04 }, at);
    tl.set(el, { visibility: 'hidden' }, at + 0.4);
  }

  /* ---------- badges */
  function pop(tl, el, at, { rot = 0, from = 0.6 } = {}) {
    if (typeof el === 'string') el = $(el);
    tl.fromTo(el, { opacity: 0, scale: from, rotation: rot - 6 }, { opacity: 1, scale: 1, rotation: rot, duration: 0.55, ease: 'back.out(1.8)', immediateRender: false }, at);
    window.SFX.push({ t: at, s: 'pop' });
  }
  function unpop(tl, el, at) {
    if (typeof el === 'string') el = $(el);
    tl.to(el, { opacity: 0, scale: 0.85, duration: 0.25, ease: 'power2.in' }, at);
  }

  /* ---------- confetti: deterministic burst (seeded), physics from progress */
  function confetti(tl, x, y, at, { n = 46, seed = 7, spread = 1, dur = 1.6 } = {}) {
    let s = seed;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const colors = ['#C5FE01', '#FF6B35', '#0A84FF', '#1A1A1A', '#FEFEFE', '#C5FE01'];
    for (let i = 0; i < n; i++) {
      const d = document.createElement('div'); d.className = 'cf';
      const w = 8 + rnd() * 12, h = rnd() < 0.4 ? w : 6 + rnd() * 8;
      d.style.width = w + 'px'; d.style.height = h + 'px';
      d.style.background = colors[Math.floor(rnd() * colors.length)];
      d.style.borderRadius = rnd() < 0.35 ? '50%' : '2px';
      $('#stage').appendChild(d);
      const ang = rnd() * Math.PI * 2, sp = (380 + rnd() * 700) * spread;
      const vx = Math.cos(ang) * sp, vy = Math.sin(ang) * sp - 520, rz = (rnd() - 0.5) * 900;
      const o = { t: 0 };
      tl.fromTo(o, { t: 0 }, {
        t: dur, duration: dur, ease: 'none', immediateRender: false,
        onUpdate: () => {
          const t = o.t, g = 1500;
          const px = x + vx * t * 0.8, py = y + vy * t + 0.5 * g * t * t;
          d.style.transform = `translate(${px}px, ${py}px) rotate(${rz * t}deg)`;
          d.style.opacity = t <= 0 || t >= dur ? 0 : t > dur - 0.4 ? (dur - t) / 0.4 : 1;
        },
      }, at);
    }
  }

  /* ---------- phone 3D move */
  function phoneTo(tl, at, vars) {
    tl.to('#phone', Object.assign({ duration: 0.8, ease: 'power3.inOut' }, vars), at);
  }

  /* ---------- app launch from the SPOT icon on the home screen */
  function launch(tl, at, iconSel, appScreen) {
    const ic = K.box(iconSel);
    // a volt-black tile grows from the icon to the full screen, then fades into the app
    const z = document.createElement('div');
    z.style.cssText = `position:absolute; left:${ic.x}px; top:${ic.y}px; width:${ic.w}px; height:${ic.h}px; border-radius:15px; background:#101014; z-index:65; opacity:0; display:flex; align-items:center; justify-content:center; overflow:hidden`;
    z.innerHTML = '<div class="ring" style="width:34px; height:34px"></div>';
    $('#ui').appendChild(z);
    const zr = z.firstChild;
    zr.style.setProperty('--x', '0');
    tl.to(zr, { width: 92, height: 92, duration: 0.5, ease: 'power3.inOut' }, at);
    tl.set(z, { opacity: 1 }, at);
    tl.to(z, { left: 0, top: 0, width: 393, height: 852, borderRadius: 55, duration: 0.5, ease: 'power3.inOut' }, at);
    tl.to('.home .grid, .home .dock', { scale: 1.15, opacity: 0, duration: 0.45, ease: 'power2.in' }, at);
    tl.set('.home', { visibility: 'hidden' }, at + 0.5);
    tl.set(appScreen, { visibility: 'visible' }, at + 0.5);
    tl.to(z, { opacity: 0, duration: 0.3 }, at + 0.7);
  }

  /* ---------- montage: tilted wall of live clones of the app's screens */
  function buildMontage(sel, ids) {
    const m = $(sel); const g = m.querySelector('.gridm');
    for (let k = 0; k < 18; k++) {
      const src = document.getElementById(ids[k % ids.length]);
      const cell = document.createElement('div'); cell.className = 'cell';
      const inner = document.createElement('div');
      inner.style.cssText = 'position:absolute; left:0; top:0; width:393px; height:852px; zoom:1.0687; overflow:hidden';
      const c = src.cloneNode(true); c.removeAttribute('id');
      c.querySelectorAll('[id]').forEach((e) => e.removeAttribute('id'));
      inner.appendChild(c); cell.appendChild(inner); g.appendChild(cell);
    }
  }

  window.S = { ground, makeRings, ringPulse, headIn, headOut, pop, unpop, confetti, phoneTo, launch, buildMontage };
})();
