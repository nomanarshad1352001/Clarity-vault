/**
 * fx.js — calm motion layer for the Linen design: directional step swaps,
 * number morphs and count-ups, ripples, haptics, shake feedback and a
 * warm-palette confetti burst. Everything respects prefers-reduced-motion.
 * Dynamic styles go through CSSOM only (CSP blocks inline style attributes).
 */

export const reducedMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ---------------- Counters & morphs ---------------- */
export function countUp(el, target, { duration = 900, format = (v) => Math.round(v).toLocaleString('en-US') } = {}) {
  if (!el) return;
  if (reducedMotion()) { el.textContent = format(target); return; }
  const start = performance.now();
  const tick = (now) => {
    const p = Math.min(1, (now - start) / duration);
    el.textContent = format(target * (1 - Math.pow(1 - p, 3)));
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** Swap an element's text with a short slide/fade. */
export function morphText(el, nextText) {
  if (!el || el.textContent === nextText) return;
  if (reducedMotion() || !el.textContent) { el.textContent = nextText; return; }
  el.classList.add('morph-out');
  setTimeout(() => {
    el.textContent = nextText;
    el.classList.remove('morph-out');
    el.classList.add('morph-in');
    setTimeout(() => el.classList.remove('morph-in'), 320);
  }, 140);
}

/* ---------------- Directional step transition ---------------- */
export function swapStep(container, renderFn, direction = 'forward') {
  const fwd = direction !== 'back';
  if (reducedMotion()) { renderFn(); return; }
  const doRender = () => {
    renderFn();
    const next = container.firstElementChild;
    if (!next) return;
    const cls = fwd ? 'step-enter-fwd' : 'step-enter-back';
    next.classList.add(cls);
    const onEnd = (e) => {
      if (e.target !== next) return; // ignore bubbling child animations
      next.classList.remove(cls);
      next.removeEventListener('animationend', onEnd);
    };
    next.addEventListener('animationend', onEnd);
  };
  const current = container.firstElementChild;
  if (current && current.classList.contains('step-panel')) {
    current.classList.add(fwd ? 'step-exit-fwd' : 'step-exit-back');
    setTimeout(doRender, 150);
  } else {
    doRender();
  }
}

/* ---------------- Touch feedback ---------------- */
export function attachRipple(trigger, surface = trigger) {
  if (!trigger || !surface) return;
  trigger.addEventListener('pointerdown', (e) => {
    if (reducedMotion() || trigger.disabled) return;
    const target = typeof surface === 'function' ? surface() : surface;
    if (!target) return;
    const r = target.getBoundingClientRect();
    const size = Math.max(r.width, r.height) * 1.6;
    const s = document.createElement('span');
    s.className = 'ripple';
    s.style.width = `${size}px`;
    s.style.height = `${size}px`;
    s.style.left = `${e.clientX - r.left - size / 2}px`;
    s.style.top = `${e.clientY - r.top - size / 2}px`;
    target.appendChild(s);
    setTimeout(() => s.remove(), 700);
  });
}

export function haptic(ms = 8) {
  try { if (navigator.vibrate) navigator.vibrate(ms); } catch { /* unsupported */ }
}

export function shake(el) {
  if (!el) return;
  el.classList.remove('shake');
  void el.offsetWidth; // restart the animation
  el.classList.add('shake');
  setTimeout(() => el.classList.remove('shake'), 500);
}

/* ---------------- Confetti (canvas, warm palette, no deps) ---------------- */
export function confettiBurst({ count = 120 } = {}) {
  if (reducedMotion()) return;
  let ox = 0.5;
  let oy = 0.32;
  const screen = document.querySelector('.device-screen');
  if (screen && window.innerWidth >= 560) {
    const r = screen.getBoundingClientRect();
    ox = (r.left + r.width / 2) / window.innerWidth;
    oy = (r.top + r.height * 0.3) / window.innerHeight;
  }
  const canvas = document.createElement('canvas');
  canvas.className = 'confetti-canvas';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  const colors = ['#2A1E18', '#C2A592', '#E8B7A0', '#F5E5DA', '#5E8466', '#FFFFFF', '#D9A08A'];
  const parts = Array.from({ length: count }, () => ({
    x: ox * canvas.width,
    y: oy * canvas.height,
    vx: (Math.random() - 0.5) * 14 * dpr,
    vy: (-Math.random() * 12 - 4) * dpr,
    size: (Math.random() * 6 + 4) * dpr,
    color: colors[(Math.random() * colors.length) | 0],
    rot: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.28,
    rect: Math.random() > 0.4,
    life: 1,
    decay: Math.random() * 0.008 + 0.006,
  }));
  const gravity = 0.3 * dpr;
  let last = performance.now();
  (function frame(now) {
    const dt = Math.min(2.5, (now - last) / 16.7);
    last = now;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;
    for (const p of parts) {
      p.vy += gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.99;
      p.rot += p.vr * dt;
      p.life -= p.decay * dt;
      if (p.life > 0 && p.y < canvas.height + 40) {
        alive = true;
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 1.4));
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        if (p.rect) ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        else { ctx.beginPath(); ctx.arc(0, 0, p.size / 2.4, 0, Math.PI * 2); ctx.fill(); }
        ctx.restore();
      }
    }
    if (alive) requestAnimationFrame(frame);
    else canvas.remove();
  })(last);
}
