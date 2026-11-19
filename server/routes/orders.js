'use strict';
const express = require('express');
const { requireRole } = require('../middleware/auth');
const { AppError } = require('../errors');
const store = require('../services/store');

const router = express.Router();
router.use(requireRole('sales', 'admin'));

function dto(o) {
  return {
    id: o.id,
    ref: o.ref,
    status: o.status,
    createdAt: o.createdAt,
    paidAt: o.paidAt,
    lockExpiresAt: o.lockExpiresAt,
    customerEmail: o.customerEmail,
    customerName: o.customerName,
    zip: o.zip,
    system: `${o.quote.system.brand} ${o.quote.system.name}`,
    tons: o.quote.system.tons,
    total: o.quote.total,
    deposit: o.quote.deposit,
    paymentMethod: o.quote.paymentMethod,
    financingStatus: o.financingStatus,
    crmDealId: o.crmDealId,
  };
}

/** CSV cell escaping, including spreadsheet formula-injection protection. */
function csvCell(v) {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  if (/[",\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

router.get('/', (req, res) => {
  const { status, q } = req.query;
  const cleanStatus = ['locked', 'paid'].includes(status) ? status : null;
  const cleanQ = typeof q === 'string' ? q.slice(0, 120) : '';
  const orders = store.listOrders({ status: cleanStatus, q: cleanQ }).map(dto);
  res.json({ orders, count: orders.length });
});

router.get('/export.csv', (req, res) => {
  const orders = store.listOrders({});
  const header = ['ref', 'status', 'createdAt', 'paidAt', 'customerEmail', 'system', 'tons', 'total', 'deposit', 'paymentMethod'];
  const lines = [header.join(',')];
  for (const o of orders.map(dto)) {
    lines.push(header.map((k) => csvCell(o[k])).join(','));
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="airedirect-orders.csv"');
  res.send(lines.join('\n') + '\n');
});

router.get('/:id', (req, res, next) => {
  const order = store.getOrder(req.params.id);
  if (!order) return next(new AppError(404, 'ORDER_NOT_FOUND', 'Order not found.'));
  return res.json({ order });
});

module.exports = router;
