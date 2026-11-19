/* Simulated card form (PAYMENTS_MODE=mock) inside the Clarity-Vault frame. */
(async function () {
  'use strict';
  const { h, $, api, money2, setVaultStatus } = App;
  await App.initChrome({ vault: true, session: 'Deposit Session', pill: '100% Server-Calculated' });
  const box = $('#box');
  const id = new URLSearchParams(location.search).get('session');
  let s;
  try {
    s = (await api(`/api/payment/mock/session?id=${encodeURIComponent(id || '')}`)).session;
  } catch (ex) {
    box.replaceChildren(h('div', { class: 'alert bad' }, ex.message), h('a', { class: 'btn block', href: '/quote' }, 'Return to quote'));
    return;
  }
  if (s.status === 'paid') { location.replace(`/success?session_id=${encodeURIComponent(s.id)}`); return; }
  setVaultStatus('Deposit Session', `${money2(s.amountCents)} Due Today`);

  const inp = (idv, label, attrs) => h('div', { class: 'field' }, h('label', { for: idv }, label), h('input', { id: idv, type: 'text', ...attrs }));
  const err = h('div', { class: 'alert bad hidden', role: 'alert' });
  const btn = h('button', { class: 'btn block lg', type: 'submit' }, `Pay ${money2(s.amountCents)} deposit`);
  const cn = h('div', { class: 'cn' }, '•••• •••• •••• ••••');
  const cname = h('span', {}, 'CARDHOLDER');
  const cexp = h('span', {}, 'MM/YY');
  const preview = h('div', { class: 'ccard', 'aria-hidden': 'true' }, h('div', { class: 'chipimg' }), cn, h('div', { class: 'cr' }, cname, cexp));

  const form = h('form', { novalidate: true },
    h('div', { class: 'vault-head' },
      h('h1', {}, 'Reserve your price.'),
      h('p', { class: 'vault-prompt' }, s.description)),
    preview,
    inp('name', 'Name on card', { autocomplete: 'cc-name', maxlength: '80', placeholder: 'Jane Homeowner' }),
    inp('number', 'Card number', { autocomplete: 'cc-number', inputmode: 'numeric', placeholder: '4242 4242 4242 4242', maxlength: '23' }),
    h('div', { class: 'grid cols-2' },
      inp('expiry', 'Expiry (MM/YY)', { autocomplete: 'cc-exp', placeholder: '12/34', maxlength: '5' }),
      inp('cvc', 'Security code', { autocomplete: 'cc-csc', inputmode: 'numeric', maxlength: '4', placeholder: '123' })),
    err,
    btn,
    h('div', { class: 'mock-card-note mt' },
      h('b', {}, 'Simulated checkout: '),
      h('code', {}, '4242 4242 4242 4242'), ' approves · ',
      h('code', {}, '4000 0000 0000 0002'), ' declines · ',
      h('code', {}, '4000 0000 0000 9995'), ' insufficient funds.'),
    h('p', { class: 'center small mt mb0' }, h('a', { href: '/quote?resume=1' }, '← Return to quote')));
  box.replaceChildren(form);

  $('#number').addEventListener('input', (e) => {
    const d = e.target.value.replace(/\D/g, '').slice(0, 19);
    e.target.value = d.replace(/(.{4})/g, '$1 ').trim();
    cn.textContent = (d + '•'.repeat(16)).slice(0, Math.max(16, d.length)).replace(/(.{4})/g, '$1 ').trim();
  });
  $('#name').addEventListener('input', (e) => { cname.textContent = e.target.value.toUpperCase() || 'CARDHOLDER'; });
  $('#expiry').addEventListener('input', (e) => {
    let v = e.target.value.replace(/[^\d]/g, '').slice(0, 4);
    if (v.length > 2) v = `${v.slice(0, 2)}/${v.slice(2)}`;
    e.target.value = v;
    cexp.textContent = v || 'MM/YY';
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.classList.add('hidden');
    btn.disabled = true;
    btn.replaceChildren(h('span', { class: 'spinner' }), ' Confirming…');
    try {
      const r = await api('/api/payment/mock/complete', {
        method: 'POST',
        body: { sessionId: s.id, card: { name: $('#name').value, number: $('#number').value, expiry: $('#expiry').value, cvc: $('#cvc').value } },
      });
      location.href = r.redirect;
    } catch (ex) {
      err.textContent = ex.message;
      err.classList.remove('hidden');
      btn.disabled = false;
      btn.textContent = `Pay ${money2(s.amountCents)} deposit`;
      FX.toast(ex.message, 'bad');
    }
  });
})();
