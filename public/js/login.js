(async function () {
  'use strict';
  const { $, $$, api, h, svgIcon } = App;
  const cfg = await App.initChrome({ vault: true, session: 'Vault Access', pill: 'Encrypted Session' });

  $('#ri-h').append(svgIcon('home'));
  $('#ri-s').append(svgIcon('users'));
  $('#ri-a').append(svgIcon('key'));

  if (new URLSearchParams(location.search).get('denied')) $('#denied').classList.remove('hidden');

  if (cfg.demoAutofill) {
    $('#demo').classList.remove('hidden');
    $$('[data-demo]').forEach((btn) => btn.addEventListener('click', () => {
      $$('[data-demo]').forEach((b) => b.classList.toggle('picked', b === btn));
      $('#email').value = btn.dataset.demo;
      $('#password').value = 'Demo@123';
      $('#submit').focus();
      FX.toast(`Autofilled ${btn.dataset.demo} — click Sign in`);
    }));
  }

  if (cfg.user && !new URLSearchParams(location.search).get('denied')) location.replace(App.HOME[cfg.user.role]);

  $('#pw-toggle').addEventListener('click', (e) => {
    const p = $('#password');
    const show = p.type === 'password';
    p.type = show ? 'text' : 'password';
    e.target.textContent = show ? 'Hide' : 'Show';
  });

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#error');
    err.classList.add('hidden');
    const btn = $('#submit');
    btn.disabled = true;
    btn.replaceChildren(h('span', { class: 'spinner' }), ' Signing in…');
    try {
      const r = await api('/api/auth/login', { method: 'POST', body: { email: $('#email').value, password: $('#password').value } });
      FX.toast(`Welcome, ${r.user.name}`, 'ok');
      const next = new URLSearchParams(location.search).get('next');
      const allowed = { '/sales': ['sales', 'admin'], '/admin': ['admin'], '/quote': ['homeowner', 'sales', 'admin'] };
      setTimeout(() => { location.href = next && allowed[next] && allowed[next].includes(r.user.role) ? next : r.redirect; }, 280);
    } catch (ex) {
      err.textContent = ex.message;
      err.classList.remove('hidden');
      btn.disabled = false;
      btn.textContent = 'Sign in';
    }
  });
})();
