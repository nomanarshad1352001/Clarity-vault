(async function () {
  'use strict';
  const { h, $, api, money2, dateFmt, setVaultStatus } = App;
  await App.initChrome({ vault: true, session: 'Verification', pill: 'Signature Check' });
  const box = $('#content');
  const token = new URLSearchParams(location.search).get('token');
  const art = () => {
    const s = h('div', { class: 'check-draw' });
    s.innerHTML = '<svg viewBox="0 0 84 84" width="76" height="76" aria-hidden="true"><circle cx="42" cy="42" r="30"/><path d="M29 43l9 9 18-20"/></svg>';
    return s;
  };
  if (!token) {
    box.replaceChildren(h('div', { class: 'alert bad center' }, 'No price-lock token found in this link.'));
    return;
  }
  try {
    const r = await api(`/api/quote/verify?token=${encodeURIComponent(token)}`);
    const q = r.quote;
    setVaultStatus('Verified Lock', r.ref);
    const total = h('h1', {}, '$0');
    const rows = q.items.map((i) => h('tr', {}, h('td', {}, i.label), h('td', {}, money2(i.amountCents))));
    const table = h('table', { class: 'summary mt' }, h('tbody', {}, ...rows,
      h('tr', { class: 'sub' }, h('td', {}, `Sales tax (${q.taxRatePercent}%)`), h('td', {}, money2(q.taxCents))),
      h('tr', { class: 'total' }, h('td', {}, 'Locked total'), h('td', {}, money2(q.totalCents)))));

    box.replaceChildren(
      h('div', { class: 'center' },
        art(),
        h('div', { class: 'pill ok dot' }, 'Signature verified'),
        h('div', { class: 'mt' }, total),
        h('p', { class: 'vault-prompt' }, `${q.system.brandName} ${q.system.name} · ${q.system.tonnage} ton`)),
      h('div', { class: 'kv mt' },
        h('div', {}, h('span', {}, 'Reference'), h('b', {}, r.ref)),
        h('div', {}, h('span', {}, 'Locked until'), h('b', {}, dateFmt(r.expiresAt))),
        h('div', {}, h('span', {}, 'Deposit'), h('b', {}, r.depositPaid ? `${money2(q.depositCents)} paid` : `${money2(q.depositCents)} due`))),
      table);
    FX.animateNumber(total, q.totalCents, { duration: 1100, format: (v) => money2(Math.round(v)) });
  } catch (ex) {
    const expired = ex.data && ex.data.error === 'token_expired';
    setVaultStatus('Verification', expired ? 'Expired Lock' : 'Invalid Token');
    box.replaceChildren(h('div', { class: 'center' },
      h('div', { class: 'pill bad' }, expired ? 'Expired' : 'Invalid'),
      h('h1', { class: 'mt' }, expired ? 'This price lock has expired.' : 'Could not verify link.'),
      h('p', { class: 'vault-prompt' }, expired ? 'Build a fresh 7-day quote in a few minutes.' : 'The token appears altered or incomplete.'),
      h('a', { class: 'btn mt', href: '/quote' }, 'Start a new quote')));
  }
})();
