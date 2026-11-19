'use strict';
/** Sales + Admin APIs. All routes are role-protected. */
const express = require('express');
const { z } = require('zod');
const adapters = require('../adapters');
const configStore = require('../services/configStore');
const orders = require('../services/orders');
const audit = require('../services/audit');
const queue = require('../services/queue');
const { REF_RE } = require('../services/tokens');
const pricing = require('../services/pricing');
const { requireRole } = require('../middleware/auth');

const sales = express.Router();
sales.use(requireRole('sales', 'admin'));

const filterSchema = z.object({
  status: z.enum(['locked', 'paid', 'expired']).optional(),
  brand: z.string().regex(/^[a-z0-9-]{1,40}$/).optional(),
  q: z.string().max(80).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const row = (o) => {
  const v = orders.staffView(o);
  return { ref: v.ref, status: v.status, lockedAt: v.lockedAt, expiresAt: v.expiresAt, customer: v.customer, address: v.address, system: v.quote.system, totalCents: v.quote.totalCents, depositCents: v.quote.depositCents, depositPaid: v.deposit.paid, paymentMethod: v.quote.paymentMethod, financingStatus: v.financingStatus };
};

sales.get('/orders', (req, res) => {
  const list = orders.list(filterSchema.parse(req.query));
  const all = orders.list({});
  res.json({
    orders: list.map(row),
    totals: {
      locked: all.filter((o) => orders.effectiveStatus(o) === 'locked').length,
      paid: all.filter((o) => o.status === 'paid').length,
      expired: all.filter((o) => orders.effectiveStatus(o) === 'expired').length,
      depositsCents: all.filter((o) => o.status === 'paid').reduce((s, o) => s + o.quote.depositCents, 0),
    },
  });
});

// CSV: neutralise spreadsheet formula injection (=, +, -, @) and quote every cell.
const cell = (v) => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};

sales.get('/orders.csv', (req, res) => {
  const list = orders.list(filterSchema.parse(req.query)).map(row);
  const head = ['Reference', 'Status', 'Locked at', 'Expires', 'Customer', 'Email', 'Phone', 'Address', 'ZIP', 'System', 'Tonnage', 'Total (USD)', 'Deposit (USD)', 'Deposit paid', 'Payment method', 'Financing'];
  const lines = [head.map(cell).join(',')];
  for (const r of list) {
    lines.push([r.ref, r.status, r.lockedAt, r.expiresAt, r.customer && r.customer.name, r.customer && r.customer.email, r.customer && r.customer.phone,
      r.address && [r.address.street, r.address.city, r.address.state].filter(Boolean).join(', '), r.address && r.address.zip,
      `${r.system.brandName} ${r.system.name}`, r.system.tonnage, (r.totalCents / 100).toFixed(2), (r.depositCents / 100).toFixed(2), r.depositPaid ? 'yes' : 'no', r.paymentMethod, r.financingStatus || ''].map(cell).join(','));
  }
  audit.record('export', req.user.email, null, { rows: list.length });
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="quotes.csv"' });
  res.send(lines.join('\r\n'));
});

sales.get('/orders/:ref', (req, res) => {
  if (!REF_RE.test(req.params.ref)) return res.status(400).json({ error: 'bad_ref', message: 'Invalid reference' });
  const o = orders.get(req.params.ref);
  if (!o) return res.status(404).json({ error: 'not_found', message: 'Order not found' });
  res.json({ order: orders.staffView(o) });
});

// ------------------------------------------------------------------ admin
const admin = express.Router();
admin.use(requireRole('admin'));

admin.get('/config', (req, res) => res.json({ catalog: configStore.getCatalog(), pricing: configStore.getPricing() }));

/** PUT { data, confirm }. Without confirm=true: validate and return a diff only (nothing is saved). */
const editBody = z.object({ data: z.record(z.string(), z.unknown()), confirm: z.boolean().default(false) });

for (const kind of ['catalog', 'pricing']) {
  admin.put(`/${kind}`, (req, res) => {
    const { data, confirm } = editBody.parse(req.body);
    const { changes } = configStore.update(kind, data, { save: confirm });
    if (confirm) audit.record('admin_change', req.user.email, null, { file: kind, changeCount: changes.length, changes: changes.slice(0, 30) });
    res.json({ saved: confirm && changes.length > 0, changes });
  });
}


/**
 * Demo helper: fills the in-memory store with realistic sample quotes (some paid, some expired) so dashboards can be
 * shown without clicking through the customer flow. Tagged source="seed"; never touches CRM/email/payment adapters.
 */
admin.post('/seed-demo', (req, res) => {
  const ctx = configStore.getContext();
  const systems = ctx.catalog.systems.filter((x) => x.active !== false);
  const addOns = ctx.catalog.addOns.filter((x) => x.active !== false);
  const zips = ctx.rules.serviceAreaZips;
  const people = ['Maria Torres', 'Devon Reyes', 'Priya Shah', 'Liam Walker', 'Sofia Nguyen', 'Noah Kim', 'Ava Patel', 'Ethan Brooks', 'Mia Fischer', 'Lucas Ortiz', 'Zoe Bennett', 'Omar Haddad', 'Chloe Martin', 'Jack Romero'];
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const terms = ctx.rules.financingTerms.map((t) => t.months);
  let created = 0;
  people.forEach((name, i) => {
    const system = pick(systems);
    const financing = Math.random() < 0.4;
    const input = {
      budget: 6000 + Math.round(Math.random() * 8000), budgetType: 'total', address: `${100 + i * 37} Demo St`, zip: pick(zips),
      homeSize: pick(ctx.rules.homeSizeMultipliers).id, systemId: system.id,
      addOnIds: addOns.filter(() => Math.random() < 0.25).map((a) => a.id).slice(0, 3),
      paymentMethod: financing ? 'financing' : 'full', ...(financing ? { termMonths: pick(terms) } : {}),
    };
    let quote;
    try { quote = pricing.calculateQuote(input, ctx); } catch { return; }
    const lockedAt = new Date(Date.now() - Math.floor(Math.random() * 13) * 86400000 - Math.floor(Math.random() * 20) * 3600000);
    const expiresAt = new Date(lockedAt.getTime() + ctx.rules.priceLockDays * 86400000);
    const ref = orders.newRef();
    const order = orders.createLocked({
      ref, quote, token: 'seed', source: 'seed', lockedAt: lockedAt.toISOString(), expiresAt: expiresAt.toISOString(),
      customer: { name, email: `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@example.com`, phone: `555-010-${String(1000 + i * 13).slice(-4)}` },
      address: { street: input.address, city: 'Austin', state: 'TX', zip: input.zip },
      financing: financing ? { status: 'approved', decisionId: `fin_demo_${i}`, termMonths: input.termMonths } : null,
    });
    if (Math.random() < 0.5) {
      orders.markPaid(ref, { paymentId: `seed_${i}`, amountCents: quote.depositCents, provider: 'seed' });
      order.payment.paidAt = new Date(lockedAt.getTime() + 2 * 3600000).toISOString();
    }
    created++;
  });
  audit.record('admin_change', req.user.email, null, { action: 'seed_demo', created });
  res.json({ created });
});

admin.get('/adapters', (req, res) => res.json({ adapters: adapters.status() }));

admin.post('/adapters/:name', (req, res) => {
  const { mode } = z.object({ mode: z.enum(['mock', 'live']) }).parse(req.body);
  const r = adapters.setMode(req.params.name, mode);
  if (!r.ok) return res.status(400).json({ error: 'cannot_switch', message: r.error });
  audit.record('admin_change', req.user.email, null, { adapter: req.params.name, from: r.from, to: r.to });
  res.json({ adapters: adapters.status() });
});

admin.get('/audit', (req, res) => {
  const { type } = z.object({ type: z.string().regex(/^[a-z_]{1,40}$/).optional() }).parse(req.query);
  res.json({ entries: audit.list({ type }) });
});

admin.get('/queue', (req, res) => res.json({ jobs: queue.jobs(), failures: queue.failures() }));
admin.get('/outbox', (req, res) => res.json({ messages: adapters.get('notifications').outbox() }));

module.exports = { sales, admin };
