(async function () {
  'use strict';
  const { h, $, api, money2, dateTimeFmt, svgIcon } = App;
  await App.initChrome({ shell: true, title: 'Admin console' });
  const panel = $('#panel');
  const alertEl = $('#alert');
  const showError = (m) => { alertEl.textContent = m; alertEl.classList.remove('hidden'); window.scrollTo({ top: 0 }); };
  const clearError = () => alertEl.classList.add('hidden');

  // ---------------------------------------------------------- form helpers (bind inputs straight onto a draft object)
  function input(obj, key, label, kind = 'text', attrs = {}) {
    let el;
    if (kind === 'bool') {
      el = h('input', { type: 'checkbox', checked: !!obj[key] });
      el.addEventListener('change', () => { obj[key] = el.checked; });
      return h('div', { class: 'field' }, h('label', {}, el, ` ${label}`));
    }
    const value = kind === 'list' ? (obj[key] || []).join(', ') : obj[key];
    el = h('input', { type: kind === 'number' ? 'number' : 'text', value: value ?? '', step: kind === 'number' ? 'any' : null, ...attrs });
    el.addEventListener('input', () => {
      if (kind === 'number') obj[key] = el.value === '' ? NaN : Number(el.value);
      else if (kind === 'list') obj[key] = el.value.split(/[\s,]+/).filter(Boolean).map((x) => (attrs['data-num'] ? Number(x) : x));
      else obj[key] = el.value;
    });
    return h('div', { class: 'field' }, h('label', {}, label), el);
  }

  /** Validate -> show diff -> confirm -> save. */
  async function reviewAndSave(kind, draft, out) {
    clearError();
    out.replaceChildren(h('p', { class: 'muted' }, 'Validating…'));
    let r;
    try { r = await api(`/api/admin/${kind}`, { method: 'PUT', body: { data: JSON.parse(JSON.stringify(draft, (k, v) => (typeof v === 'number' && !Number.isFinite(v) ? null : v))), confirm: false } }); } catch (ex) {
      const details = ex.data && ex.data.details ? ex.data.details.slice(0, 8).map((d) => h('li', {}, `${d.path || 'config'}: ${d.message}`)) : [];
      out.replaceChildren(h('div', { class: 'alert bad' }, h('b', {}, 'Please fix these problems:'), h('ul', {}, details.length ? details : [h('li', {}, ex.message)])));
      return;
    }
    if (!r.changes.length) { out.replaceChildren(h('div', { class: 'alert info' }, 'No changes to save.')); return; }
    const confirmBtn = h('button', { class: 'btn', type: 'button' }, `Confirm & save ${r.changes.length} change${r.changes.length > 1 ? 's' : ''}`);
    confirmBtn.addEventListener('click', async () => {
      confirmBtn.disabled = true;
      try {
        await api(`/api/admin/${kind}`, { method: 'PUT', body: { data: JSON.parse(JSON.stringify(draft)), confirm: true } });
        out.replaceChildren(h('div', { class: 'alert ok' }, 'Saved. New quotes use these values immediately; existing locked prices are unaffected.'));
      } catch (ex) { showError(ex.message); confirmBtn.disabled = false; }
    });
    out.replaceChildren(
      h('div', { class: 'alert warn' }, h('b', {}, 'Review your changes before saving')),
      h('div', { class: 'diff' }, r.changes.slice(0, 60).map((c) => h('div', {}, `${c.path}: `, h('span', { class: 'from' }, JSON.stringify(c.from)), ' → ', h('span', { class: 'to' }, JSON.stringify(c.to))))),
      h('div', { class: 'actions' }, h('button', { class: 'btn ghost', type: 'button', onclick: () => out.replaceChildren() }, 'Keep editing'), confirmBtn));
  }

  function saveBar(kind, draft) {
    const out = h('div');
    return h('div', { class: 'mt2' }, h('button', { class: 'btn', type: 'button', onclick: () => reviewAndSave(kind, draft, out) }, 'Review changes'), out);
  }

  // ---------------------------------------------------------- tabs
  async function catalogTab() {
    const { catalog } = await api('/api/admin/config');
    const d = JSON.parse(JSON.stringify(catalog));
    panel.replaceChildren(
      h('div', { class: 'alert warn' }, 'All catalog values are PLACEHOLDERS. Replace with real products and prices.'),
      h('h2', {}, 'Company'), h('div', { class: 'grid cols-3' }, input(d.company, 'name', 'Name'), input(d.company, 'phone', 'Phone'), input(d.company, 'email', 'Email')),
      h('h2', { class: 'mt2' }, 'Systems'),
      ...d.systems.map((s) => h('div', { class: 'edit-row' },
        h('div', { class: 'full' }, h('b', {}, `${s.brand} · ${s.tier}`), ' ', h('span', { class: 'muted small' }, s.id)),
        input(s, 'name', 'Model name'), input(s, 'basePrice', 'Base installed price ($)', 'number'), input(s, 'seer2', 'SEER2', 'number'), input(s, 'noiseDb', 'Noise (dB)', 'number'),
        input(s, 'warrantyYears', 'Warranty (yrs)', 'number'), input(s, 'tonnageOptions', 'Tonnage options', 'list', { 'data-num': '1' }), input(s, 'active', 'Active', 'bool'))),
      h('h2', { class: 'mt2' }, 'Add-ons'),
      ...d.addOns.map((a) => h('div', { class: 'edit-row' }, input(a, 'name', 'Name'), input(a, 'price', 'Price ($)', 'number'), input(a, 'active', 'Active', 'bool'), h('div', { class: 'full' }, input(a, 'description', 'Description')))),
      saveBar('catalog', d));
  }

  async function pricingTab() {
    const { pricing } = await api('/api/admin/config');
    const d = JSON.parse(JSON.stringify(pricing));
    const surcharges = Object.keys(d.tonnageSurcharges).map((k) => input(d.tonnageSurcharges, k, `${k}-ton surcharge ($)`, 'number'));
    panel.replaceChildren(
      h('div', { class: 'alert warn' }, 'All pricing rules are PLACEHOLDERS. Replace with real business rules.'),
      h('div', { class: 'grid cols-3' }, input(d, 'taxRatePercent', 'Sales tax (%)', 'number'), input(d, 'depositPercent', 'Deposit (%)', 'number'), input(d, 'priceLockDays', 'Price-lock days', 'number')),
      h('h2', { class: 'mt2' }, 'Financing terms'),
      ...d.financingTerms.map((t) => h('div', { class: 'grid cols-2' }, input(t, 'months', 'Term (months)', 'number'), input(t, 'aprPercent', 'APR (%)', 'number'))),
      h('h2', { class: 'mt2' }, 'Mock financing decision rules'),
      h('div', { class: 'grid cols-2' }, input(d.financingRules, 'maxPaymentPercentOfMonthlyBudget', 'Decline if payment exceeds % of monthly budget', 'number'), input(d.financingRules, 'impliedMonthsForTotalBudget', 'Months used to convert a total budget', 'number'),
        input(d.financingRules, 'manualReviewAboveCents', 'Manual review above (cents)', 'number'), input(d.financingRules, 'minimumFinancedCents', 'Minimum financed (cents)', 'number')),
      h('h2', { class: 'mt2' }, 'Service area'),
      input(d, 'serviceAreaZips', 'ZIP codes (comma or space separated)', 'list'),
      h('h2', { class: 'mt2' }, 'Home size multipliers'),
      ...d.homeSizeMultipliers.map((hs) => h('div', { class: 'grid cols-3' }, input(hs, 'label', `Label (${hs.id})`), input(hs, 'multiplier', 'Price multiplier', 'number'), input(hs, 'suggestedTonnage', 'Suggested tonnage', 'number'))),
      h('h2', { class: 'mt2' }, 'Tonnage surcharges'), h('div', { class: 'grid cols-3' }, surcharges),
      saveBar('pricing', d));
  }

  async function integrationsTab() {
    const { adapters } = await api('/api/admin/adapters');
    const wrap = h('div', { class: 'grid' }, adapters.map((a) => {
      const live = a.mode === 'live'; const target = live ? 'mock' : 'live';
      const sw = h('button', { class: 'switch-big', type: 'button', role: 'switch', 'aria-checked': String(live), 'aria-label': `${a.label}: ${a.mode}`, disabled: target === 'live' && !a.liveReady });
      sw.addEventListener('click', async () => {
        if (!confirm(`Switch "${a.label}" to ${target.toUpperCase()}?${target === 'live' ? ' Real external calls will be made.' : ''}`)) return;
        try { clearError(); await api(`/api/admin/adapters/${a.name}`, { method: 'POST', body: { mode: target } }); FX.toast(`${a.label} → ${target}`, 'ok'); integrationsTab(); } catch (ex) { showError(ex.message); }
      });
      return h('div', { class: 'card lift' }, h('div', { class: 'adapter' }, h('div', {}, h('b', {}, a.label), h('div', { class: 'small muted' }, a.liveReady ? 'Live credentials detected' : `Live needs: ${a.missingEnv.join(', ')}`)),
        h('div', { class: 'id-card' }, h('span', { class: `pill dot ${live ? 'ok' : 'warn'}` }, a.mode), sw)));
    }));
    FX.stagger(wrap);
    panel.replaceChildren(h('p', { class: 'muted' }, 'Switch each external system between mock and live. Live needs its environment variables set on the server. Runtime toggles reset to the env value on restart.'), wrap);
  }

  async function auditTab() {
    const types = ['', 'price_lock', 'payment_session', 'payment', 'payment_mismatch', 'webhook_rejected', 'admin_change', 'login', 'login_failed', 'export'];
    const sel = h('select', { 'aria-label': 'Filter by event type' }, types.map((t) => h('option', { value: t }, t || 'All events')));
    const body = h('tbody');
    const load = async () => {
      const { entries } = await api(`/api/admin/audit${sel.value ? `?type=${sel.value}` : ''}`);
      body.replaceChildren(...entries.map((e) => h('tr', {}, h('td', {}, dateTimeFmt(e.ts)), h('td', {}, h('span', { class: 'pill accent' }, e.type)), h('td', {}, e.actor), h('td', {}, e.ref || '-'), h('td', {}, h('code', { class: 'small' }, JSON.stringify(e.details).slice(0, 220))))));
      if (!entries.length) body.append(h('tr', {}, h('td', { colspan: '5', class: 'muted' }, 'No events yet.')));
    };
    sel.addEventListener('change', load);
    panel.replaceChildren(h('div', { class: 'actions' }, sel, h('button', { class: 'btn secondary', type: 'button', onclick: load }, 'Refresh')),
      h('div', { class: 'table-wrap mt' }, h('table', { class: 'data' }, h('thead', {}, h('tr', {}, ['Time', 'Event', 'Actor', 'Ref', 'Details'].map((x) => h('th', {}, x)))), body)));
    load();
  }

  async function deliveryTab() {
    const [{ jobs, failures }, { messages }] = await Promise.all([api('/api/admin/queue'), api('/api/admin/outbox')]);
    const tbl = (head, rows) => h('div', { class: 'table-wrap mt' }, h('table', { class: 'data' }, h('thead', {}, h('tr', {}, head.map((x) => h('th', {}, x)))), h('tbody', {}, rows.length ? rows : h('tr', {}, h('td', { colspan: String(head.length), class: 'muted' }, 'Nothing here.')))));
    panel.replaceChildren(
      h('h2', {}, 'Failure log'), h('p', { class: 'muted small' }, 'Jobs that failed all retries (exponential backoff). Customers are never blocked by these.'),
      tbl(['Time', 'Job', 'Ref', 'Attempts', 'Error'], failures.map((f) => h('tr', {}, h('td', {}, dateTimeFmt(f.ts)), h('td', {}, f.job), h('td', {}, f.ref || '-'), h('td', {}, f.attempts), h('td', {}, f.error)))),
      h('h2', { class: 'mt2' }, 'Recent jobs'),
      tbl(['Job', 'Ref', 'Status', 'Attempts', 'Next attempt', 'Last error'], jobs.slice(0, 30).map((j) => h('tr', {}, h('td', {}, j.name), h('td', {}, j.ref || '-'), h('td', {}, h('span', { class: `pill ${j.status === 'done' ? 'ok' : j.status === 'failed' ? 'bad' : 'warn'}` }, j.status)), h('td', {}, j.attempts), h('td', {}, j.nextAttemptAt ? dateTimeFmt(j.nextAttemptAt) : '-'), h('td', {}, j.lastError || '-')))),
      h('h2', { class: 'mt2' }, 'Mock outbox (email / SMS)'),
      tbl(['Time', 'Channel', 'To', 'Subject', 'Body'], messages.slice(0, 20).map((m) => h('tr', {}, h('td', {}, dateTimeFmt(m.ts)), h('td', {}, m.channel), h('td', {}, m.to), h('td', {}, m.subject || '-'), h('td', {}, h('pre', { class: 'small' }, m.body))))),
      h('div', { class: 'mt' }, h('button', { class: 'btn secondary', type: 'button', onclick: deliveryTab }, 'Refresh')));
  }

  const TABS = [
    ['catalog', 'Catalog', 'tag', catalogTab, 'Products and add-ons. All values are placeholders until you replace them.'],
    ['pricing', 'Pricing rules', 'dollar', pricingTab, 'Tax, deposit, financing terms, service area and size multipliers.'],
    ['integrations', 'Integrations', 'plug', integrationsTab, 'Toggle payments, financing, CRM, email/SMS and address lookup between mock and live.'],
    ['audit', 'Audit log', 'shield', auditTab, 'Every price lock, payment, login and admin change.'],
    ['delivery', 'CRM & email queue', 'mail', deliveryTab, 'Background jobs with exponential-backoff retries, plus the mock outbox.'],
  ];
  const setActive = App.sidebar($('#side'), [
    ...TABS.map(([id, label, icon]) => ({ id, label, icon, onSelect: () => select(id) })),
    { id: 'sales', label: 'Sales dashboard', icon: 'chart', href: '/sales' },
    { id: 'flow', label: 'Customer flow', icon: 'home', href: '/quote' },
  ], 'catalog', { foot: 'Edits write to /config/*.json after a confirm step.' });

  async function overview() {
    try {
      const { catalog, pricing } = await api('/api/admin/config');
      const { adapters } = await api('/api/admin/adapters');
      const defs = [['tag', 'Active systems', catalog.systems.filter((x) => x.active).length], ['plus', 'Active add-ons', catalog.addOns.filter((x) => x.active).length], ['pin', 'Service-area ZIPs', pricing.serviceAreaZips.length], ['plug', 'Adapters live', adapters.filter((a) => a.mode === 'live').length]];
      $('#kpis').replaceChildren(...defs.map(([ic, label, val], i) => { const b = h('b', {}, '0'); const c = h('div', { class: 'kpi' }, h('div', { class: 'ico' }, svgIcon(ic)), b, h('span', {}, label)); c.style.setProperty('--i', i); setTimeout(() => FX.animateNumber(b, val, { duration: 900 }), 100 + i * 80); return c; }));
    } catch { /* non-critical */ }
  }

  function select(id) {
    clearError();
    const t = TABS.find((x) => x[0] === id);
    setActive(id);
    $('#section-title').textContent = t[1]; $('#section-sub').textContent = t[4];
    history.replaceState(null, '', `#${id}`);
    panel.classList.remove('page-fade'); void panel.offsetWidth; panel.classList.add('page-fade');
    t[3]().catch((ex) => showError(ex.message));
  }
  overview();
  select(TABS.some((t) => `#${t[0]}` === location.hash) ? location.hash.slice(1) : 'catalog');
})();
