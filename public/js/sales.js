(async function () {
  'use strict';
  const { h, $, api, money, money2, dateFmt, dateTimeFmt, svgIcon } = App;
  const cfg = await App.initChrome({ shell: true, title: 'Sales dashboard' });
  const isAdmin = cfg.user && cfg.user.role === 'admin';

  App.sidebar($('#side'), [
    { id: 'quotes', label: 'Quotes & deposits', icon: 'list', onSelect: () => window.scrollTo({ top: 0, behavior: 'smooth' }) },
    { id: 'flow', label: 'Customer flow', icon: 'home', href: '/quote' },
    ...(isAdmin ? [{ id: 'admin', label: 'Admin console', icon: 'sliders', href: '/admin' }] : []),
    { id: 'site', label: 'Public site', icon: 'globe', href: '/' },
  ], 'quotes', { foot: 'Tip: click any row for the full order detail.' });

  const cat = await api('/api/catalog');
  cat.brands.forEach((b) => $('#f-brand').append(h('option', { value: b.id }, b.name)));

  const pill = (s) => h('span', { class: `pill dot ${s === 'paid' ? 'ok' : s === 'expired' ? 'bad' : 'warn'}` }, s);

  function params() {
    const p = new URLSearchParams();
    for (const [k, id] of [['q', 'f-q'], ['status', 'f-status'], ['brand', 'f-brand'], ['from', 'f-from'], ['to', 'f-to']]) { const v = $(`#${id}`).value.trim(); if (v) p.set(k, v); }
    return p;
  }

  async function seed() {
    try { const r = await api('/api/admin/seed-demo', { method: 'POST' }); FX.toast(`Loaded ${r.created} demo quotes`, 'ok'); load(); } catch (ex) { FX.toast(ex.message, 'bad'); }
  }
  if (isAdmin) $('#hero-actions').append(h('button', { class: 'btn light small', type: 'button', onclick: seed }, svgIcon('seed'), ' Load demo data'));

  let firstPaint = true;
  function kpis(list, totals) {
    const open = list.filter((o) => o.status === 'locked');
    const pipeline = open.reduce((s, o) => s + o.totalCents, 0);
    const defs = [
      ['clock', 'Open price locks', open.length, (v) => String(Math.round(v))],
      ['check', 'Deposits paid', list.filter((o) => o.status === 'paid').length, (v) => String(Math.round(v))],
      ['chart', 'Open pipeline value', pipeline, (v) => money(Math.round(v))],
      ['dollar', 'Deposit revenue', totals.depositsCents, (v) => money(Math.round(v))],
    ];
    const cards = defs.map(([ic, label, val, fmt], i) => { const b = h('b', {}, fmt(0)); const c = h('div', { class: 'kpi' }, h('div', { class: 'ico' }, svgIcon(ic)), b, h('span', {}, label)); c.style.setProperty('--i', i); setTimeout(() => FX.animateNumber(b, val, { duration: 1100, format: fmt }), 120 + i * 80); return c; });
    $('#kpis').replaceChildren(...cards);
  }

  function charts(list) {
    const days = [...Array(14)].map((_, i) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (13 - i)); return d; });
    Charts.barChart($('#chart-days'), days.map((d) => {
      const n = list.filter((o) => { const l = new Date(o.lockedAt); return l >= d && l < new Date(d.getTime() + 86400000); }).length;
      return { label: `${d.getMonth() + 1}/${d.getDate()}`, value: n, tip: `${n} on ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` };
    }));
    const c = (s) => list.filter((o) => o.status === s).length;
    Charts.donut($('#chart-status'), [{ label: 'Locked', value: c('locked'), color: '#8b684c' }, { label: 'Paid', value: c('paid'), color: '#2f5c3f' }, { label: 'Expired', value: c('expired'), color: '#8e3529' }], 'quotes');
    Charts.hbars($('#chart-brand'), cat.brands.map((b) => { const rows = list.filter((o) => o.system.brand === b.id); return { label: b.name, value: rows.reduce((s, o) => s + o.totalCents, 0), display: `${rows.length} · ${money(rows.reduce((s, o) => s + o.totalCents, 0))}` }; }));
  }

  async function load() {
    const p = params();
    $('#export').href = `/api/sales/orders.csv?${p}`;
    try {
      const r = await api(`/api/sales/orders?${p}`);
      $('#alert').classList.add('hidden');
      if (firstPaint || r.orders.length !== load.n) { kpis(r.orders, r.totals); charts(r.orders); }
      firstPaint = false; load.n = r.orders.length;
      $('#rows').replaceChildren(...r.orders.map((o, i) => {
        const tr = h('tr', { class: 'clickable', tabindex: '0', role: 'button', 'aria-label': `Open ${o.ref}` },
          h('td', {}, h('b', {}, o.ref)), h('td', {}, pill(o.status)),
          h('td', {}, o.customer ? o.customer.name : '-', h('div', { class: 'small muted' }, o.customer ? o.customer.email : '')),
          h('td', {}, `${o.system.brandName} ${o.system.tier}`, h('div', { class: 'small muted' }, `${o.system.tonnage} ton · ${o.paymentMethod === 'financing' ? 'financed' : 'cash'}`)),
          h('td', {}, h('b', {}, money2(o.totalCents))), h('td', {}, money2(o.depositCents), h('div', { class: 'small muted' }, o.depositPaid ? 'paid' : 'unpaid')), h('td', {}, dateFmt(o.lockedAt)));
        tr.style.setProperty('--i', Math.min(i, 20));
        const open = () => detail(o.ref);
        tr.addEventListener('click', open);
        tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
        return tr;
      }));
      $('#empty').replaceChildren(...(r.orders.length ? [] : [h('div', { class: 'empty' }, h('div', { class: 'eic' }, svgIcon('list')), h('b', {}, 'No quotes yet'), h('p', {}, isAdmin ? 'Lock a quote in the customer flow, or click "Load demo data" above.' : 'Lock a quote in the customer flow to see it here.'))]));
    } catch (ex) { $('#alert').textContent = ex.message; $('#alert').classList.remove('hidden'); }
  }

  async function detail(ref) {
    const { order: o } = await api(`/api/sales/orders/${encodeURIComponent(ref)}`);
    const q = o.quote;
    const close = () => $('#drawer').classList.add('hidden');
    const kv = (k, v) => h('tr', {}, h('td', {}, k), h('td', {}, v == null || v === '' ? '-' : v));
    $('#drawer-panel').replaceChildren(
      h('div', { class: 'actions mt0' }, h('div', {}, h('h2', { class: 'mb0' }, o.ref), pill(o.status)), h('button', { class: 'btn ghost small', type: 'button', onclick: close }, 'Close ✕')),
      h('div', { class: 'kv mt' }, h('div', {}, h('span', {}, 'Total'), h('b', {}, money2(q.totalCents))), h('div', {}, h('span', {}, 'Deposit'), h('b', {}, money2(q.depositCents))), h('div', {}, h('span', {}, 'Expires'), h('b', {}, dateFmt(o.expiresAt)))),
      h('h3', { class: 'mt2' }, 'Customer'),
      h('table', { class: 'summary' }, h('tbody', {}, kv('Name', o.customer && o.customer.name), kv('Email', o.customer && o.customer.email), kv('Phone', o.customer && o.customer.phone),
        kv('Address', o.address && [o.address.street, o.address.city, o.address.state, o.address.zip].filter(Boolean).join(', ')))),
      h('h3', { class: 'mt' }, 'Quote'),
      h('table', { class: 'summary' }, h('tbody', {}, ...q.items.map((i) => kv(i.label, money2(i.amountCents))), kv('Tax', money2(q.taxCents)), h('tr', { class: 'total' }, h('td', {}, 'Total'), h('td', {}, money2(q.totalCents))))),
      h('h3', { class: 'mt' }, 'Payment & financing'),
      h('table', { class: 'summary' }, h('tbody', {}, kv('Deposit', o.deposit.paid ? `paid ${dateTimeFmt(o.payment.paidAt)} via ${o.payment.provider}` : 'unpaid'),
        kv('Method', q.paymentMethod === 'financing' ? `Financing ${q.financing.termMonths} mo @ ${q.financing.aprPercent}% - ${money2(q.financing.monthlyPaymentCents)}/mo` : 'Pay in full'), kv('Financing decision', o.financing && `${o.financing.status} (${o.financing.decisionId})`),
        kv('Budget', `${money2(q.budget.amount * 100)} ${q.budget.type}`))),
      h('h3', { class: 'mt' }, 'Lock & integrations'),
      h('table', { class: 'summary' }, h('tbody', {}, kv('Locked', dateTimeFmt(o.lockedAt)), kv('Source', o.source), kv('CRM deal', o.crm.dealId), kv('Notifications sent', (o.notifications || []).map((n) => n.channel).join(', ')))),
    );
    $('#drawer').classList.remove('hidden');
  }

  $('#drawer').addEventListener('click', (e) => { if (e.target.id === 'drawer') e.target.classList.add('hidden'); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#drawer').classList.add('hidden'); });
  $('#filters').addEventListener('input', () => { clearTimeout(load.t); load.t = setTimeout(() => { firstPaint = true; load(); }, 250); });
  $('#filters').addEventListener('submit', (e) => e.preventDefault());
  $('#reset').addEventListener('click', () => { $('#filters').reset(); firstPaint = true; load(); });
  load();
  setInterval(load, 15000);
})();
