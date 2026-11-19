/* Shared browser helpers. No secrets live in client code; prices are never computed here. */
(function () {
  'use strict';

  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (cents) => (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: cents % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 });
  const money2 = (cents) => (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  const dateFmt = (iso) => new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  const dateTimeFmt = (iso) => new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  /** Build an element safely (text via textContent, never innerHTML with data). */
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return el;
  }

  // Static, trusted SVG path data. Never built from user input.
  const ICONS = {
    snow: '<path d="M12 2v20M4.9 7l14.2 10M19.1 7 4.9 17M9 3.5l3 2.5 3-2.5M9 20.5l3-2.5 3 2.5"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5v3.5"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    dollar: '<path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2.5"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    card: '<rect x="2" y="5" width="20" height="14" rx="2.5"/><path d="M2 10h20"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
    home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
    pin: '<path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
    box: '<path d="M21 16V8l-9-5-9 5v8l9 5z"/><path d="m3.3 7 8.7 5 8.7-5M12 22V12"/>',
    plus: '<circle cx="12" cy="12" r="10"/><path d="M12 8v8M8 12h8"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h8"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
    users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
    user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    key: '<path d="m21 2-2 2m-7.6 7.6a5.5 5.5 0 1 1-7.8 7.8 5.5 5.5 0 0 1 7.8-7.8zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3z"/>',
    chart: '<path d="M3 3v18h18"/><path d="M18 17V9M13 17V5M8 17v-3"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
    tag: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z"/><circle cx="7" cy="7" r="1.5"/>',
    plug: '<path d="M12 22v-5M9 8V2M15 8V2M18 8v5a6 6 0 0 1-12 0V8z"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>',
    globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20z"/>',
    seed: '<path d="M12 22V12M12 12C12 7 8 4 3 4c0 5 3 8 9 8zm0 0c0-5 4-8 9-8 0 5-3 8-9 8z"/>',
  };

  function icon(name) {
    const s = document.createElement('span');
    s.className = 'ico-wrap';
    s.style.display = 'inline-grid';
    s.innerHTML = `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
    return s;
  }
  const svgIcon = (name) => icon(name).firstChild;

  /** Signature shield + padlock/keyhole mark matching the client's reference screenshot. */
  function shieldLockSvg() {
    const w = document.createElement('span');
    w.innerHTML = '<svg class="vault-shield" viewBox="0 0 28 30" fill="none" aria-hidden="true">'
      + '<path d="M14 2.3 4.2 6.2v7.6c0 6.7 4.2 11.7 9.8 14 5.6-2.3 9.8-7.3 9.8-14V6.2L14 2.3Z" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/>'
      + '<path d="M11.3 13V10.9a2.7 2.7 0 0 1 5.4 0V13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'
      + '<rect x="9.6" y="12.7" width="8.8" height="7.6" rx="2.1" fill="currentColor"/>'
      + '<circle cx="14" cy="15.8" r="1.05" fill="#f9efe5"/>'
      + '<path d="M14 16.5v1.9" stroke="#f9efe5" stroke-width="1.4" stroke-linecap="round"/>'
      + '</svg>';
    return w.firstChild;
  }

  function vaultBrandNode(companyName) {
    const clean = (companyName || 'CoolHome').replace(/ \(placeholder\)/i, '').trim();
    const first = clean.split(/\s+/)[0] || 'CoolHome';
    return h('a', { class: 'vault-brand', href: '/' },
      shieldLockSvg(),
      h('span', { class: 'brand-stack' }, h('span', {}, first), h('span', {}, 'Vault')));
  }

  /** Concentric tactile orb button used inside Vault cards. */
  function createOrb({ iconName = 'arrow', label = 'Tap to continue', ariaLabel, onClick, disabled = false } = {}) {
    const btn = h('button', {
      type: 'button',
      class: 'orb-btn',
      'aria-label': ariaLabel || label,
      disabled,
    }, svgIcon(iconName));
    if (onClick) btn.addEventListener('click', onClick);
    const caption = h('span', { class: 'orb-caption' }, label);
    const wrap = h('div', { class: 'orb-zone' }, h('div', { class: 'orb-ring' }, btn), caption);
    return { wrap, btn, caption };
  }

  let csrfToken = null;
  async function getCsrf(force) {
    if (csrfToken && !force) return csrfToken;
    const r = await fetch('/api/csrf', { credentials: 'same-origin' });
    csrfToken = (await r.json()).token;
    return csrfToken;
  }

  /** JSON API helper. Throws an Error with .status, .data on failure. */
  async function api(path, { method = 'GET', body } = {}, retry = true) {
    const opts = { method, credentials: 'same-origin', headers: { Accept: 'application/json' } };
    if (method !== 'GET') {
      opts.headers['Content-Type'] = 'application/json';
      opts.headers['X-CSRF-Token'] = await getCsrf();
      opts.body = JSON.stringify(body || {});
    }
    const res = await fetch(path, opts);
    let data = null;
    try { data = await res.json(); } catch { /* non-JSON */ }
    if (res.status === 403 && data && data.error === 'csrf_invalid' && retry) { await getCsrf(true); return api(path, { method, body }, false); }
    if (!res.ok) {
      const err = new Error((data && data.message) || `Request failed (${res.status})`);
      err.status = res.status; err.data = data;
      throw err;
    }
    return data;
  }

  const HOME = { homeowner: '/quote', sales: '/sales', admin: '/admin' };

  /** Build the slide-over sheet opened by the two-line "=" menu icon. */
  function attachMenuSheet(triggerBtn, cfg) {
    let sheet = null;
    const close = () => {
      if (!sheet) return;
      sheet.remove();
      sheet = null;
      triggerBtn.setAttribute('aria-expanded', 'false');
    };
    triggerBtn.addEventListener('click', () => {
      if (sheet) { close(); return; }
      triggerBtn.setAttribute('aria-expanded', 'true');
      const links = [
        h('a', { href: '/quote' }, h('span', {}, 'Price a new AC'), h('span', { class: 'muted' }, '→')),
        h('a', { href: '/' }, h('span', {}, 'Overview & budget studio'), h('span', { class: 'muted' }, '→')),
      ];
      if (cfg.user) {
        links.push(h('a', { href: HOME[cfg.user.role] }, h('span', {}, `My area (${cfg.user.role})`), h('span', { class: 'muted' }, '→')));
        if (cfg.user.role === 'admin') links.push(h('a', { href: '/sales' }, h('span', {}, 'Sales pipeline'), h('span', { class: 'muted' }, '→')));
        links.push(h('button', {
          class: 'sheet-link',
          type: 'button',
          onclick: async () => { await api('/api/auth/logout', { method: 'POST' }); location.href = '/login'; },
        }, h('span', {}, `Sign out (${cfg.user.name})`), h('span', { class: 'muted' }, '×')));
      } else {
        links.push(h('a', { href: '/login' }, h('span', {}, 'Sign in (Homeowner / Staff)'), h('span', { class: 'muted' }, '→')));
      }
      const panel = h('div', { class: 'nav-sheet-panel', role: 'dialog', 'aria-label': 'Menu' },
        h('div', { class: 'actions mt0' }, vaultBrandNode(cfg.company && cfg.company.name), h('button', { class: 'btn ghost small', type: 'button', onclick: close }, 'Close')),
        h('p', { class: 'small muted' }, '100% server-calculated AC pricing. Locked for 7 days with a refundable-style deposit.'),
        ...links);
      sheet = h('div', { class: 'nav-sheet', onclick: (e) => { if (e.target === sheet) close(); } }, panel);
      document.body.append(sheet);
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  }

  function makeMenuButton(cfg) {
    const btn = h('button', { type: 'button', class: 'menu-two', 'aria-label': 'Open menu', 'aria-expanded': 'false' }, h('span'), h('span'));
    attachMenuSheet(btn, cfg);
    return btn;
  }

  function setVaultStatus(sessionText, pillText) {
    const s = $('#vault-session');
    const p = $('#vault-pill');
    if (s && sessionText != null) s.textContent = sessionText;
    if (p && pillText != null) p.textContent = pillText;
  }

  /**
   * Renders the demo banner + page chrome. Returns /api/config payload.
   * opts:
   *  - { vault: true, session, pill }: Clarity-Vault device header inside #vault-header + banner in #chrome
   *  - { shell: true, title }: Dashboard top bar
   *  - default: Warm parchment top bar with shield-lock wordmark + "=" menu
   */
  async function initChrome(opts = {}) {
    let cfg = { demoMode: false, user: null, company: { name: 'CoolHome' } };
    try { cfg = await api('/api/config'); } catch { /* keep defaults */ }
    const holder = $('#chrome');
    if (holder) {
      holder.replaceChildren();
      if (cfg.demoMode) {
        holder.append(h('div', { class: 'banner', role: 'status' }, h('strong', {}, 'Demo mode'), 'Placeholder prices & simulated payments — no real charges.'));
      }
      const signOut = () => h('button', { class: 'btn ghost small', type: 'button', onclick: async () => { await api('/api/auth/logout', { method: 'POST' }); location.href = '/login'; } }, 'Sign out');
      if (opts.vault) {
        const vh = $('#vault-header');
        if (vh) {
          vh.replaceChildren(
            h('div', { class: 'vault-bar' },
              vaultBrandNode(cfg.company.name),
              h('div', { class: 'vault-center' },
                h('div', { class: 'vault-session', id: 'vault-session' }, opts.session || 'Active Session'),
                h('div', { class: 'vault-rule', 'aria-hidden': 'true' }),
                h('div', { class: 'vault-pill', id: 'vault-pill' }, opts.pill || '100% Private to You')),
              h('div', { class: 'vault-right' }, makeMenuButton(cfg))));
        }
      } else if (opts.shell) {
        const nav = h('nav', { class: 'nav', 'aria-label': 'Account' });
        if (cfg.user) nav.append(h('span', { class: 'muted small' }, cfg.user.name, ' ', h('span', { class: 'pill accent' }, cfg.user.role)), signOut());
        holder.append(h('div', { class: 'dash-top' }, h('strong', { class: 'serif' }, opts.title || document.title), nav));
      } else {
        const nav = h('nav', { class: 'nav', 'aria-label': 'Main' });
        if (opts.active === 'home') {
          nav.append(h('a', { class: 'hide-sm', href: '#how' }, 'How it works'), h('a', { class: 'hide-sm', href: '#fit' }, 'Budget studio'), h('a', { class: 'hide-sm', href: '#faq' }, 'FAQ'));
        }
        if (cfg.user) {
          nav.append(h('a', { class: 'btn secondary small', href: HOME[cfg.user.role] }, 'My area'));
        } else {
          nav.append(h('a', { class: 'btn ghost small hide-sm', href: '/login' }, 'Sign in'), h('a', { class: 'btn small', href: '/quote' }, 'Start quote'));
        }
        nav.append(makeMenuButton(cfg));
        holder.append(h('header', { class: 'topbar' }, vaultBrandNode(cfg.company.name), nav));
      }
    }
    if (window.FX) window.FX.reveal();
    return cfg;
  }

  /** Dashboard sidebar. items: [{ id, label, icon, href?, onSelect? }]. Returns setActive(id). */
  function sidebar(el, items, activeId, { foot } = {}) {
    const links = new Map();
    const setActive = (id) => links.forEach((a, k) => (k === id ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
    el.replaceChildren(
      vaultBrandNode('CoolHome'),
      h('div', { class: 'side-label' }, 'Workspace'),
      ...items.map((it) => {
        const a = it.href
          ? h('a', { class: 'side-link', href: it.href }, svgIcon(it.icon), it.label)
          : h('button', { class: 'side-link', type: 'button', onclick: () => { setActive(it.id); it.onSelect(); } }, svgIcon(it.icon), it.label);
        links.set(it.id, a);
        return a;
      }),
      foot ? h('div', { class: 'side-foot' }, foot) : null);
    setActive(activeId);
    return setActive;
  }

  window.App = {
    esc, money, money2, dateFmt, dateTimeFmt, $, $$, h, api,
    initChrome, setVaultStatus, vaultBrandNode, shieldLockSvg, makeMenuButton, createOrb,
    sidebar, icon, svgIcon, HOME,
  };
})();
