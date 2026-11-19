import { api, setCsrfToken, bootChrome, icon, toast, roleHome, safeNext } from '/assets/js/shared.js';
import { attachRipple, shake, haptic, wait } from '/assets/js/fx.js';

const form = document.getElementById('login-form');
const btn = document.getElementById('login-btn');
const core = document.getElementById('orb-core');
const errBox = document.getElementById('login-error');
const email = document.getElementById('email');
const pass = document.getElementById('password');
const eye = document.getElementById('eye-btn');

function showError(msg) {
  errBox.innerHTML = `<div class="notice error">${icon('alert', 17)}<div class="js-msg"></div></div>`;
  errBox.querySelector('.js-msg').textContent = msg;
  shake(btn);
}

(async function init() {
  const next = safeNext(new URLSearchParams(location.search).get('next'));
  const chrome = await bootChrome({ title: 'Welcome', active: 'login' });
  if (chrome.user) { location.replace(next || roleHome(chrome.user.role)); return; }
  chrome.setPill('100% online — no sales visit', 'shield');

  core.innerHTML = icon('arrowRight', 30, 1.6);
  attachRipple(btn, core);

  eye.innerHTML = icon('eye', 19);
  eye.addEventListener('click', () => {
    const show = pass.type === 'password';
    pass.type = show ? 'text' : 'password';
    eye.innerHTML = icon(show ? 'eyeOff' : 'eye', 19);
    eye.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  });

  // "Demo as…" autofill (hidden in production with DEMO_AUTOFILL=false)
  if (chrome.appConfig.demoAutofill) {
    const demo = document.getElementById('demo-as');
    demo.hidden = false;
    demo.querySelectorAll('[data-icon]').forEach((el) => { el.outerHTML = icon(el.dataset.icon, 15); });
    demo.querySelectorAll('.chip-role').forEach((b) => b.addEventListener('click', () => {
      email.value = b.dataset.email;
      pass.value = 'Demo@123';
      demo.querySelectorAll('.chip-role').forEach((x) => x.classList.toggle('active', x === b));
      errBox.innerHTML = '';
      haptic();
      btn.focus({ preventScroll: true });
    }));
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errBox.innerHTML = '';
    if (!email.value.trim() || !pass.value) { showError('Enter your email and password.'); return; }
    btn.classList.add('loading');
    btn.disabled = true;
    try {
      const res = await api('/api/auth/login', { method: 'POST', body: { email: email.value.trim(), password: pass.value } });
      setCsrfToken(res.csrfToken);
      btn.classList.remove('loading');
      btn.classList.add('success', 'static');
      core.innerHTML = icon('check', 30, 2.2);
      haptic(16);
      toast(`Welcome, ${res.user.name}`, 'ok');
      await wait(480);
      location.replace(next || res.redirect);
    } catch (err) {
      btn.classList.remove('loading');
      btn.disabled = false;
      showError(err.message || 'Sign-in failed.');
    }
  });
})();
