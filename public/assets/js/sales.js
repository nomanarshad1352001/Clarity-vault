import { api, bootChrome, icon, fmtMoney2, fmtDateTime, fmtDate, escapeHtml, debounce, toast } from '/assets/js/shared.js';
import { countUp } from '/assets/js/fx.js';

const $ = (id) => document.getElementById(id);
let allOrders = [];
let orders = [];
let status = '';

function setSeg(seg, idx) {
  seg.style.setProperty('--n', String(seg.querySelectorAll('button').length));
  seg.style.setProperty('--i', String(idx));
  seg.querySelectorAll('button').forEach((b, i) => { b.classList.toggle('active', i === idx); b.setAttribute('aria-selected', String(i === idx)); });
}

function renderStats() {
  const paid = allOrders.filter((o) => o.status === 'paid');
  const locked = allOrders.filter((o) => o.status === 'locked');
  const revenue = paid.reduce((s, o) => s + o.deposit, 0);
  $('stats').innerHTML = `
    <div class="stat"><span class="stat-ic dark">${icon('file', 20)}</span><div><b class="num" id="stat-total">0</b><span>Total quotes</span></div></div>
    <div class="stat"><span class="stat-ic">${icon('lock', 20)}</span><div><b class="num" id="stat-locked">0</b><span>Open price locks</span></div></div>
    <div class="stat"><span class="stat-ic sage">${icon('dollar', 20)}</span><div><b class="num" id="stat-rev">$0.00</b><span>Deposits collected</span></div></div>`;
  countUp($('stat-total'), allOrders.length);
  countUp($('stat-locked'), locked.length);
  countUp($('stat-rev'), revenue, { format: (v) => fmtMoney2(Math.round(v * 100) / 100) });
}

function renderTable() {
  const host = $('orders-host');
  if (!orders.length) {
    host.innerHTML = `<div class="empty"><span class="empty-ic">${icon('file', 24)}</span><b>${allOrders.length ? 'No matches' : 'No quotes yet'}</b><p>${allOrders.length ? 'Try a different filter or search.' : 'Locked quotes appear here the moment a customer locks a price.'}</p></div>`;
    return;
  }
  host.innerHTML = `
    <div class="table-wrap">
      <table class="data clickable">
        <thead><tr><th>Ref</th><th>Customer</th><th>System</th><th>Total</th><th>Deposit</th><th>Status</th><th>Created</th></tr></thead>
        <tbody>
          ${orders.map((o) => `
            <tr data-id="${escapeHtml(o.id)}" tabindex="0">
              <td class="mono cell-strong">${escapeHtml(o.ref)}</td>
              <td><span class="cell-strong">${escapeHtml(o.customerName || '—')}</span><div class="cell-muted">${escapeHtml(o.customerEmail)}</div></td>
              <td>${escapeHtml(o.system)}<div class="cell-muted">${o.tons} t · ${o.paymentMethod === 'financing' ? 'Financing' : 'Pay in full'}</div></td>
              <td class="serif-num">${fmtMoney2(o.total)}</td>
              <td>${fmtMoney2(o.deposit)}</td>
              <td><span class="badge ${escapeHtml(o.status)}">${escapeHtml(o.status)}</span></td>
              <td class="cell-muted">${fmtDateTime(o.createdAt)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
  host.querySelectorAll('tbody tr').forEach((tr) => {
    tr.addEventListener('click', () => openDetail(tr.dataset.id));
    tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') openDetail(tr.dataset.id); });
  });
}

async function openDetail(id) {
  let order;
  try { order = (await api(`/api/orders/${encodeURIComponent(id)}`)).order; }
  catch (err) { toast(err.message, 'error'); return; }
  const q = order.quote;
  const wrap = document.createElement('div');
  wrap.className = 'drawer-overlay';
  wrap.innerHTML = `
    <aside class="drawer" role="dialog" aria-modal="true" aria-label="Order ${escapeHtml(order.ref)}">
      <div class="drawer-head">
        <div><span class="mini-label">Order</span><h2 class="drawer-title mono">${escapeHtml(order.ref)}</h2></div>
        <button class="menu-close" type="button" aria-label="Close">${icon('x', 22, 1.6)}</button>
      </div>
      <span class="badge ${escapeHtml(order.status)}">${escapeHtml(order.status)}</span>
      <span class="mini-label section-label">Customer</span>
      <div class="kv-card"><b>${escapeHtml(order.customerName || '—')}</b><span>${escapeHtml(order.customerEmail)}</span><span>ZIP ${escapeHtml(order.zip || '—')}</span></div>
      <span class="mini-label section-label">Quote</span>
      <div class="receipt">
        <div class="rline"><span class="k">${escapeHtml(q.system.brand)} ${escapeHtml(q.system.name)} · ${q.system.tons} t</span><span class="v">${fmtMoney2(q.system.price)}</span></div>
        ${q.addOns.map((a) => `<div class="rline dim"><span class="k">${escapeHtml(a.name)}</span><span class="v">${fmtMoney2(a.price)}</span></div>`).join('')}
        <div class="rline dim"><span class="k">Tax</span><span class="v">${fmtMoney2(q.tax)}</span></div>
        <div class="rline total"><span class="k">Total</span><span class="v">${fmtMoney2(q.total)}</span></div>
        <div class="rline deposit"><span class="k">Deposit</span><span class="v">${fmtMoney2(q.deposit)}</span></div>
        ${q.financing ? `<div class="rline dim"><span class="k">Financing</span><span class="v">${fmtMoney2(q.financing.monthlyPayment)}/mo · ${q.financing.months} mo</span></div>` : ''}
      </div>
      <span class="mini-label section-label">Activity</span>
      <div class="kv">
        <div><span>Created</span><b>${fmtDateTime(order.createdAt)}</b></div>
        <div><span>Lock expires</span><b>${order.lockExpiresAt ? fmtDate(order.lockExpiresAt) : '—'}</b></div>
        <div><span>Paid</span><b>${order.paidAt ? fmtDateTime(order.paidAt) : '—'}</b></div>
        <div><span>Payment ID</span><b class="mono">${escapeHtml(order.paymentId || '—')}</b></div>
        <div><span>CRM deal</span><b class="mono">${escapeHtml(order.crmDealId || 'pending')}</b></div>
      </div>
    </aside>`;
  document.body.appendChild(wrap);
  const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  wrap.querySelector('.menu-close').addEventListener('click', close);
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
  document.addEventListener('keydown', onKey);
  wrap.querySelector('.menu-close').focus({ preventScroll: true });
}

async function load() {
  const q = $('f-q').value.trim();
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (q) params.set('q', q);
  try {
    const filtered = Boolean(status || q);
    const [all, sub] = await Promise.all([api('/api/orders'), filtered ? api(`/api/orders?${params}`) : Promise.resolve(null)]);
    allOrders = all.orders;
    orders = sub ? sub.orders : all.orders;
    renderStats();
    renderTable();
  } catch (err) { toast(err.message, 'error'); }
}

(async function init() {
  try {
    const chrome = await bootChrome({ title: 'Sales Desk', active: 'sales', requireRoles: ['sales', 'admin'] });
    chrome.setPill('Live from the order store', 'sparkle');
    document.querySelectorAll('[data-icon]').forEach((el) => { el.outerHTML = icon(el.dataset.icon, 16); });
    const seg = $('f-status');
    setSeg(seg, 0);
    seg.querySelectorAll('button').forEach((b, i) => b.addEventListener('click', () => {
      status = b.dataset.status;
      setSeg(seg, i);
      load();
    }));
    $('f-q').addEventListener('input', debounce(load, 280));
    $('refresh-btn').addEventListener('click', async (e) => {
      const b = e.currentTarget;
      b.classList.add('loading');
      await load();
      b.classList.remove('loading');
      toast('Up to date', 'ok', 1800);
    });
    $('export-btn').addEventListener('click', () => { location.assign('/api/orders/export.csv'); });
    await load();
  } catch (err) {
    if (err && err.message === 'redirect') return;
    toast('Failed to load the sales desk.', 'error');
  }
})();
