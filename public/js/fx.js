/* Shared motion + interaction effects. Pure client-side polish; no data or prices here. CSP-safe (CSSOM only). */
(function () {
  'use strict';
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const FX = { reduce };

  // -------- scroll reveal + counters
  const revealIO = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => entries.forEach((e) => {
    if (!e.isIntersecting) return;
    e.target.classList.add('in'); revealIO.unobserve(e.target);
    e.target.querySelectorAll('[data-count]').forEach(runCounter);
    if (e.target.hasAttribute('data-count')) runCounter(e.target);
  }), { threshold: 0.16, rootMargin: '0px 0px -30px 0px' }) : null;

  FX.reveal = (root = document) => root.querySelectorAll('.reveal:not(.in), .timeline:not(.in)').forEach((el) => {
    if (!revealIO || reduce) {
      el.classList.add('in');
      el.querySelectorAll('[data-count]').forEach(runCounter);
    } else revealIO.observe(el);
  });

  function runCounter(el) {
    if (el._counted) return; el._counted = true;
    const to = Number(el.dataset.count); const suffix = el.dataset.suffix || ''; const prefix = el.dataset.prefix || '';
    FX.animateNumber(el, to, { duration: 1300, format: (v) => `${prefix}${Math.round(v).toLocaleString('en-US')}${suffix}` });
  }

  /** Smoothly count an element's number to a new value. format(v) returns the display string. */
  FX.animateNumber = (el, to, { duration = 650, format = (v) => String(Math.round(v)) } = {}) => {
    const from = el._v == null ? 0 : el._v;
    el._v = to;
    if (reduce || from === to) { el.textContent = format(to); return; }
    cancelAnimationFrame(el._raf);
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration); const e = 1 - Math.pow(1 - t, 4);
      el.textContent = format(from + (to - from) * e);
      if (t < 1) el._raf = requestAnimationFrame(tick); else el.textContent = format(to);
    };
    el._raf = requestAnimationFrame(tick);
  };

  /** Set --i on children so CSS can stagger their entrance animation. */
  FX.stagger = (container, max = 14) => {
    [...container.children].forEach((c, i) => c.style.setProperty('--i', Math.min(i, max)));
    container.classList.add('stagger');
  };

  FX.tilt = () => {};
  FX.magnet = (el, strength = 0.15) => {
    if (reduce || !fine) return;
    el.addEventListener('mousemove', (e) => { const r = el.getBoundingClientRect(); el.style.transform = `translate(${(e.clientX - r.left - r.width / 2) * strength}px, ${(e.clientY - r.top - r.height / 2) * strength}px)`; });
    el.addEventListener('mouseleave', () => { el.style.transform = ''; });
  };

  // -------- ripple on every .btn
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('.btn'); if (!b || reduce) return;
    const r = b.getBoundingClientRect(); const s = document.createElement('span'); s.className = 'ripple';
    s.style.left = `${e.clientX - r.left}px`; s.style.top = `${e.clientY - r.top}px`; b.append(s); setTimeout(() => s.remove(), 620);
  });

  // -------- warm champagne & sage confetti burst
  FX.confetti = () => {
    if (reduce) return;
    const c = document.createElement('canvas'); c.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:200';
    document.body.append(c); const ctx = c.getContext('2d'); const w = (c.width = innerWidth); const h = (c.height = innerHeight);
    const colors = ['#2b231d', '#8b684c', '#d8b892', '#527961', '#c4836a', '#fcf6f0'];
    const ps = Array.from({ length: 120 }, () => ({ x: w / 2 + (Math.random() - 0.5) * 100, y: h * 0.35, vx: (Math.random() - 0.5) * 14, vy: -Math.random() * 13 - 4, s: Math.random() * 7 + 4, c: colors[(Math.random() * colors.length) | 0], r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.35 }));
    const t0 = performance.now();
    const tick = (now) => {
      ctx.clearRect(0, 0, w, h);
      for (const p of ps) { p.vy += 0.34; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.globalAlpha = Math.max(0, 1 - (now - t0) / 3400); ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); ctx.restore(); }
      if (now - t0 < 3400) requestAnimationFrame(tick); else c.remove();
    };
    requestAnimationFrame(tick);
  };

  // -------- toasts
  FX.toast = (msg, type = '') => {
    let box = document.getElementById('toasts'); if (!box) { box = document.createElement('div'); box.id = 'toasts'; box.setAttribute('role', 'status'); document.body.append(box); }
    const t = document.createElement('div'); t.className = `toast ${type}`; t.textContent = msg; box.append(t);
    setTimeout(() => { t.classList.add('leaving'); setTimeout(() => t.remove(), 300); }, 3400);
  };

  FX.parallax = () => {};
  FX.particles = () => {};

  document.addEventListener('DOMContentLoaded', () => {
    FX.reveal();
    document.querySelectorAll('[data-magnetic]').forEach((el) => FX.magnet(el));
  });
  window.FX = FX;
})();
