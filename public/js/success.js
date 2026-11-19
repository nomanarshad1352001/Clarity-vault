(async function () {
  'use strict';
  const { h, $, api, money2, dateFmt, setVaultStatus } = App;
  await App.initChrome({ vault: true, session: 'Locked Certificate', pill: 'Deposit Confirmed' });
  const box = $('#content');
  const sessionId = new URLSearchParams(location.search).get('session_id');
  renderProgress($('#progress'), 7);

  const checkSvg = () => {
    const s = h('div', { class: 'check-draw' });
    s.innerHTML = '<svg viewBox="0 0 84 84" width="76" height="76" aria-hidden="true"><circle cx="42" cy="42" r="30"/><path d="M29 43l9 9 18-20"/></svg>';
    return s;
  };

  if (!sessionId) {
    box.replaceChildren(h('p', { class: 'center' }, 'No payment session found.'), h('a', { class: 'btn block', href: '/quote' }, 'Start a quote'));
    return;
  }

  async function load(attempt) {
    let r;
    try {
      r = await api(`/api/payment/confirm?session_id=${encodeURIComponent(sessionId)}`);
    } catch (ex) {
      box.replaceChildren(h('div', { class: 'alert bad' }, ex.message), h('a', { class: 'btn block', href: '/quote' }, 'Return to quote'));
      return;
    }
    const o = r.order;
    if (!o.deposit.paid) {
      if (attempt < 8) { setTimeout(() => load(attempt + 1), 1500); return; }
      box.replaceChildren(h('div', { class: 'alert warn' }, 'Awaiting payment confirmation. Your price lock is safe — refresh shortly or reference ', h('b', {}, o.ref), '.'));
      return;
    }
    renderProgress($('#progress'), 8);
    sessionStorage.removeItem('ac_wizard_v1');
    const q = o.quote;
    setVaultStatus('Locked Certificate', `Valid Until ${dateFmt(o.expiresAt)}`);

    const totalEl = h('b', {}, '$0');
    const rows = q.items.map((i) => h('tr', {}, h('td', {}, i.label), h('td', {}, money2(i.amountCents))));
    const table = h('table', { class: 'summary mt' }, h('tbody', {}, ...rows,
      h('tr', { class: 'sub' }, h('td', {}, `Sales tax (${q.taxRatePercent}%)`), h('td', {}, money2(q.taxCents))),
      h('tr', { class: 'total' }, h('td', {}, 'Locked total'), h('td', {}, money2(q.totalCents)))));

    box.replaceChildren(
      h('div', { class: 'center' },
        checkSvg(),
        h('div', { class: 'pill ok dot' }, 'Deposit received'),
        h('h1', { class: 'mt' }, 'Your price is locked.'),
        h('div', { class: 'big-ref', 'aria-label': 'Reference number' }, o.ref),
        h('p', { class: 'vault-prompt' }, 'Save this reference — your exact total cannot change.')),
      h('div', { class: 'kv mt' },
        h('div', {}, h('span', {}, 'Locked price'), totalEl),
        h('div', {}, h('span', {}, 'Valid through'), h('b', {}, dateFmt(o.expiresAt))),
        h('div', {}, h('span', {}, 'Deposit paid'), h('b', {}, money2(o.deposit.amountCents)))),
      table,
      q.financing ? h('p', { class: 'muted small mt center' }, `Financing plan: ${money2(q.financing.monthlyPaymentCents)}/mo × ${q.financing.termMonths} months (${o.financingStatus === 'pending' ? 'pending lender review' : 'pre-approved'}).`) : null,
      h('div', { class: 'actions wrap' },
        h('a', { class: 'btn secondary', href: `/verify?token=${encodeURIComponent(r.token)}` }, 'Verify certificate'),
        h('a', { class: 'btn', href: '/' }, 'Done')));
    FX.animateNumber(totalEl, q.totalCents, { duration: 1200, format: (v) => money2(Math.round(v)) });
    FX.confetti();
  }
  load(0);
})();
