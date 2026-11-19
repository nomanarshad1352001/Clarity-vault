/**
 * shared.js — toolkit for every page: API client (JSON + CSRF), app chrome
 * (shield logo · centered title + progress line · hamburger sheet), demo
 * ribbon, toasts, icons and formatting. Plain ES module — no framework.
 * CSP note: never emit inline style attributes; use classes + CSSOM.
 */

/* ---------------- Icons (stroke, lucide-style) ---------------- */
const ICONS = {
  arrowRight: '<path d="M5 12h14"/><path d="m13 5 7 7-7 7"/>',
  chevronL: '<path d="m15 18-6-6 6-6"/>',
  chevronR: '<path d="m9 18 6-6-6-6"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  home: '<path d="m3 10 9-7 9 7"/><path d="M5 8.8V21h14V8.8"/><path d="M9.5 21v-6h5v6"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  layers: '<path d="m12 2 9 4.9-9 4.9-9-4.9Z"/><path d="m3 11.9 9 4.9 9-4.9"/><path d="m3 16.9 9 4.9 9-4.9"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  card: '<rect x="2" y="5" width="20" height="14" rx="2.5"/><path d="M2 10h20"/><path d="M6 15h4"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2.5"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  shield: '<path d="M12 22s8-3.5 8-10V5l-8-3-8 3v7c0 6.5 8 10 8 10Z"/><path d="m9 11.5 2 2 4-4.5"/>',
  zap: '<path d="M13 2 3 14h7l-1 8 11-13h-8Z"/>',
  wind: '<path d="M3 8h10.5a2.5 2.5 0 1 0-2.4-3.2"/><path d="M3 12h14.5a2.5 2.5 0 1 1-2.4 3.2"/><path d="M3 16h7a2 2 0 1 1-2 2.6"/>',
  thermometer: '<path d="M10 13.6V5a2 2 0 1 1 4 0v8.6a4.5 4.5 0 1 1-4 0Z"/>',
  box: '<path d="m21 8-9-5-9 5v8l9 5 9-5Z"/><path d="m3 8 9 5 9-5"/><path d="M12 13v8"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M9 13h6M9 17h6"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v5"/><path d="M12 16.5h.01"/>',
  sparkle: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9Z"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.3"/><path d="M21 3v6h-6"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/><path d="M3 12.5h18"/>',
  settings: '<path d="M21 4h-7"/><path d="M10 4H3"/><path d="M21 12h-9"/><path d="M8 12H3"/><path d="M21 20h-5"/><path d="M12 20H3"/><path d="M14 2v4"/><path d="M8 10v4"/><path d="M16 18v4"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  calendar: '<rect x="3" y="4.5" width="18" height="17" rx="2"/><path d="M8 2.5v4M16 2.5v4M3 9.5h18"/>',
  dollar: '<path d="M12 2v20"/><path d="M17 5.5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M9.9 4.2A9.6 9.6 0 0 1 12 4c6.4 0 10 8 10 8a18 18 0 0 1-2.2 3.2"/><path d="M6.6 6.6A18 18 0 0 0 2 12s3.6 8 10 8a9.7 9.7 0 0 0 5.4-1.6"/><path d="M14.1 14.1a3 3 0 1 1-4.2-4.2"/><path d="m2 2 20 20"/>',
  wifi: '<path d="M8.5 9a4.5 4.5 0 0 1 0 6"/><path d="M12 6.5a8 8 0 0 1 0 11"/><path d="M15.5 4a11.5 11.5 0 0 1 0 16"/>',
};

export function icon(name, size = 18, stroke = 1.8) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

/** Shield + padlock mark (after the reference logo). Keyhole colour via the .keyhole class. */
export const LOGO_SVG = '<svg viewBox="0 0 30 34" fill="none" aria-hidden="true">'
  + '<path d="M15 1.8 3.2 6.2v9.1c0 7.5 5 13.7 11.8 16.7 6.8-3 11.8-9.2 11.8-16.7V6.2L15 1.8Z" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/>'
  + '<path d="M11.4 15.3v-2.3a3.6 3.6 0 0 1 7.2 0v2.3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'
  + '<rect x="9.6" y="15" width="10.8" height="8.6" rx="1.9" fill="currentColor"/>'
  + '<circle class="keyhole" cx="15" cy="18.7" r="1.25"/></svg>';

/* ---------------- Formatting ---------------- */
const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
export const fmtMoney = (n) => usd0.format(Math.round(n));
export const fmtMoney2 = (n) => usd2.format(n);
export const fmtDate = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
export const fmtDateTime = (iso) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const roleHome = (role) => (role === 'admin' ? '/admin' : role === 'sales' ? '/sales' : '/quote');
/** Only same-origin relative paths are allowed as post-login redirects (blocks //evil.com). */
export const safeNext = (next) => (typeof next === 'string' && /^\/(?![/\\])/.test(next) ? next : null);

/* ---------------- API client ---------------- */
let csrfToken = null;
export function setCsrfToken(t) { csrfToken = t; }

export class ApiError extends Error {
  constructor(status, code, message, details) { super(message); this.status = status; this.code = code; this.details = details; }
}

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(csrfToken && method !== 'GET' ? { 'X-CSRF-Token': csrfToken } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON body */ }
  if (!res.ok) {
    const e = (data && data.error) || {};
    throw new ApiError(res.status, e.code || 'ERROR', e.message || `Request failed (${res.status})`, e.details);
  }
  return data;
}

/* ---------------- Toasts (drop from the top of the phone screen) ---------------- */
export function toast(message, type = 'info', ms = 3800) {
  const host = document.querySelector('.device-screen') || document.body;
  let holder = host.querySelector(':scope > .toasts');
  if (!holder) {
    holder = document.createElement('div');
    holder.className = 'toasts';
    holder.setAttribute('role', 'status');
    holder.setAttribute('aria-live', 'polite');
    host.appendChild(holder);
  }
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const ic = type === 'ok' ? 'check' : type === 'error' ? 'alert' : 'sparkle';
  el.innerHTML = `<span class="toast-icon">${icon(ic, 14, 2.2)}</span><span class="toast-msg"></span>`;
  el.querySelector('.toast-msg').textContent = message;
  holder.appendChild(el);
  const remove = () => { el.classList.add('leaving'); setTimeout(() => el.remove(), 300); };
  const timer = setTimeout(remove, ms);
  el.addEventListener('click', () => { clearTimeout(timer); remove(); });
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Copied to clipboard', 'ok', 2000); }
  catch { toast('Copy failed — select the text manually', 'error'); }
}

/* ---------------- Chrome ---------------- */
export async function getAppConfig() {
  return api('/api/app-config');
}

function renderDemoRibbon() {
  if (document.querySelector('.demo-ribbon')) return;
  const b = document.createElement('div');
  b.className = 'demo-ribbon';
  b.innerHTML = '<span class="demo-dot" aria-hidden="true"></span><span>Demo mode — sample data, no real charges</span>';
  document.body.prepend(b);
  document.body.classList.add('has-demo');
}

function renderAppBar(header, user) {
  header.classList.add('appbar');
  header.innerHTML = `
    <a class="logo" href="${user ? roleHome(user.role) : '/login'}" aria-label="AireDirect home">
      <span class="logo-mark">${LOGO_SVG}</span><span class="logo-word">Aire<br />Direct</span>
    </a>
    <div class="appbar-center">
      <div class="appbar-title" id="appbar-title"></div>
      <div class="appbar-line" aria-hidden="true"><span class="appbar-line-fill" id="appbar-line-fill"></span></div>
    </div>
    <button class="menu-btn" id="menu-btn" type="button" aria-label="Open menu" aria-expanded="false" aria-controls="menu-sheet"><span></span><span></span></button>`;
}

function setupMenu(user, active, extras) {
  const btn = document.getElementById('menu-btn');
  if (!btn) return;
  const host = document.querySelector('.device-screen') || document.querySelector('.panel') || document.body;
  const items = [];
  if (user) {
    items.push({ href: '/quote', label: 'Get a quote', sub: 'Price a new AC system', icon: 'home', key: 'quote' });
    if (user.role === 'sales' || user.role === 'admin') items.push({ href: '/sales', label: 'Sales desk', sub: 'Locked quotes & deposits', icon: 'briefcase', key: 'sales' });
    if (user.role === 'admin') items.push({ href: '/admin', label: 'Admin console', sub: 'Catalog, pricing & audit', icon: 'settings', key: 'admin' });
  } else {
    items.push({ href: '/login', label: 'Sign in', sub: 'Homeowner, sales or admin', icon: 'user', key: 'login' });
  }
  items.push({ href: '/verify', label: 'Verify a price lock', sub: 'Check any locked quote', icon: 'shield', key: 'verify' });

  const backdrop = document.createElement('div');
  backdrop.className = 'menu-backdrop';
  const sheet = document.createElement('nav');
  sheet.className = 'menu-sheet';
  sheet.id = 'menu-sheet';
  sheet.setAttribute('aria-label', 'Main menu');
  const initial = user ? String(user.name || user.email).trim().charAt(0).toUpperCase() : '';
  sheet.innerHTML = `
    <div class="menu-top">
      <span class="logo"><span class="logo-mark">${LOGO_SVG}</span><span class="logo-word">Aire<br />Direct</span></span>
      <button class="menu-close" type="button" aria-label="Close menu">${icon('x', 24, 1.6)}</button>
    </div>
    <div class="menu-user">
      <span class="menu-avatar">${user ? escapeHtml(initial) : icon('user', 18)}</span>
      <div><b>${user ? escapeHtml(user.name || user.email) : 'Welcome'}</b><span>${user ? `${escapeHtml(user.email)} · ${escapeHtml(user.role)}` : 'Sign in to price your new AC'}</span></div>
    </div>
    <div class="menu-list">
      ${items.map((it) => `<a class="menu-item ${active === it.key ? 'active' : ''}" href="${it.href}"><span class="menu-ic">${icon(it.icon, 17)}</span><span class="menu-text"><b>${it.label}</b><small>${it.sub}</small></span>${icon('chevronR', 16)}</a>`).join('')}
      ${extras.map((ex, i) => `<button class="menu-item" type="button" data-extra="${i}"><span class="menu-ic">${icon(ex.icon || 'sparkle', 17)}</span><span class="menu-text"><b>${escapeHtml(ex.label)}</b><small>${escapeHtml(ex.sub || '')}</small></span>${icon('chevronR', 16)}</button>`).join('')}
    </div>
    ${user ? `<button class="btn btn-sand btn-block" id="menu-logout" type="button">${icon('logout', 16)}<span class="btn-label">Sign out</span></button>` : ''}
    <p class="menu-foot">AireDirect · every price is computed on our server</p>`;
  host.append(backdrop, sheet);

  const setOpen = (open) => {
    host.classList.toggle('menu-open', open);
    btn.setAttribute('aria-expanded', String(open));
    btn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  };
  btn.addEventListener('click', () => setOpen(!host.classList.contains('menu-open')));
  backdrop.addEventListener('click', () => setOpen(false));
  sheet.querySelector('.menu-close').addEventListener('click', () => { setOpen(false); btn.focus({ preventScroll: true }); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && host.classList.contains('menu-open')) setOpen(false); });
  sheet.querySelectorAll('[data-extra]').forEach((el) => el.addEventListener('click', () => {
    setOpen(false);
    extras[Number(el.dataset.extra)].onClick();
  }));
  const logout = sheet.querySelector('#menu-logout');
  if (logout) {
    logout.addEventListener('click', async () => {
      logout.classList.add('loading');
      await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
      location.replace('/login');
    });
  }
}

function chromeController() {
  const titleEl = document.getElementById('appbar-title');
  const fillEl = document.getElementById('appbar-line-fill');
  const pillEl = document.getElementById('screen-pill');
  const footEl = document.getElementById('screen-foot');
  const swap = (el, apply) => {
    if (!el.dataset.ready) { apply(); el.dataset.ready = '1'; return; }
    el.classList.add('is-swapping');
    setTimeout(() => { apply(); el.classList.remove('is-swapping'); }, 160);
  };
  return {
    setTitle(text) { if (titleEl && titleEl.textContent !== text) swap(titleEl, () => { titleEl.textContent = text; }); },
    setProgress(frac) { if (fillEl) fillEl.style.width = `${Math.round(Math.max(0, Math.min(1, frac || 0)) * 100)}%`; },
    setPill(text, iconName) {
      if (!pillEl || pillEl.dataset.text === text) return;
      pillEl.dataset.text = text;
      swap(pillEl, () => {
        pillEl.innerHTML = `${iconName ? icon(iconName, 14, 1.9) : ''}<span class="pill-text"></span>`;
        pillEl.querySelector('.pill-text').textContent = text;
      });
    },
    setFoot(text) { if (footEl && footEl.textContent !== text) swap(footEl, () => { footEl.textContent = text; }); },
  };
}

/**
 * bootChrome — renders the reference-style app bar, menu and demo ribbon, and
 * (optionally) enforces roles. Returns { user, appConfig, setTitle,
 * setProgress, setPill, setFoot }.
 */
export async function bootChrome({ title = '', active = null, requireRoles = null, menuExtras = [] } = {}) {
  const [appConfig, me] = await Promise.all([getAppConfig(), api('/api/auth/me').catch(() => null)]);
  const user = me ? me.user : null;
  if (me) setCsrfToken(me.csrfToken);

  if (requireRoles) {
    if (!user) { location.replace(`/login?next=${encodeURIComponent(location.pathname)}`); throw new Error('redirect'); }
    if (!requireRoles.includes(user.role)) { location.replace(roleHome(user.role)); throw new Error('redirect'); }
  }

  if (appConfig.demoBanner) renderDemoRibbon();
  const header = document.getElementById('app-header');
  if (header) renderAppBar(header, user);
  setupMenu(user, active, menuExtras);
  const ctl = chromeController();
  ctl.setTitle(title);
  return { user, appConfig, ...ctl };
}
