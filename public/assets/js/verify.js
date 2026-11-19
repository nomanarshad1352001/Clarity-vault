import { api, bootChrome, icon, fmtMoney2, fmtDate, escapeHtml } from '/assets/js/shared.js';
import { swapStep, haptic, shake, attachRipple } from '/assets/js/fx.js';

const $ = (id) => document.getElementById(id);
let chrome = null;

function panel(heading, sub, body) {
  return `<div class="step-panel">
    <div class="sheet-head"><h1 class="sheet-title">${heading}</h1>${sub ? `<p class="sheet-sub">${sub}</p>` : ''}</div>
    <div class="sheet-body stagger">${body}</div>
  </div>`;
}

function setOrb({ label, iconName, mode = '', disabled = false }) {
  const orb = $('btn-next');
  $('orb-label').textContent = label;
  orb.setAttribute('aria-label', label);
  $('orb-core').innerHTML = icon(iconName, 30, mode.includes('success') ? 2.2 : 1.6);
  orb.className = `orb ${mode}`.trim();
  orb.disabled = disabled;
}

/** Accepts a full verification URL or a bare token. */
function extractToken(raw) {
  const v = String(raw || '').trim();
  if (!v) return '';
  try {
    const t = new URL(v, location.origin).searchParams.get('token');
    if (t) return t;
  } catch { /* not a URL */ }
  return v;
}

function renderAsk() {
  chrome.setPill('Signed & tamper-proof', 'shield');
  swapStep($('sheet-inner'), () => {
    $('sheet-inner').innerHTML = panel('Verify a price lock', 'Paste the link from your confirmation…', `
      <div class="ghost-field">
        <label class="sr-only" for="token-input">Verification link</label>
        <textarea class="ghost-input ghost-area" id="token-input" rows="3" placeholder="Paste your verification link"></textarea>
      </div>
      <p class="hint">Every lock is signed by our server — changing a single character breaks the signature.</p>`);
  });
  setOrb({ label: 'Verify', iconName: 'shield' });
}

async function check(token) {
  setOrb({ label: 'Checking…', iconName: 'shield', mode: 'loading', disabled: true });
  try {
    const r = await api(`/api/quote/verify?token=${encodeURIComponent(token)}`);
    const q = r.quote;
    haptic(12);
    chrome.setPill(`Verified · ${r.ref}`, 'check');
    swapStep($('sheet-inner'), () => {
      $('sheet-inner').innerHTML = panel('This price is locked.', `Guaranteed until ${fmtDate(r.expiresAt)}.`, `
        <div class="receipt">
          <div class="rline"><span class="k">Reference</span><span class="v mono">${escapeHtml(r.ref)}</span></div>
          <div class="rline"><span class="k">System</span><span class="v">${escapeHtml(q.system.brand)} ${escapeHtml(q.system.name)} · ${q.system.tons} t</span></div>
          <div class="rline"><span class="k">Deposit</span><span class="v">${fmtMoney2(q.deposit)}</span></div>
          <div class="rline"><span class="k">Status</span><span class="v"><span class="badge ${r.status === 'paid' ? 'paid' : 'locked'}">${escapeHtml(r.status)}</span></span></div>
          <div class="rline total"><span class="k">Locked total</span><span class="v">${fmtMoney2(q.total)}</span></div>
        </div>
        <div class="link-row"><a class="btn btn-ghost btn-sm" href="/verify">${icon('refresh', 15)}<span class="btn-label">Check another lock</span></a></div>`);
    });
    setOrb({ label: 'Verified just now', iconName: 'check', mode: 'success static' });
  } catch (err) {
    const expired = err.status === 410;
    chrome.setPill(expired ? 'Lock expired' : 'Signature check failed', 'alert');
    swapStep($('sheet-inner'), () => {
      $('sheet-inner').innerHTML = expired
        ? panel('This lock has expired.', 'Price locks last a limited time. Build a new quote for a fresh guarantee.', `<div class="link-row"><a class="btn btn-dark btn-sm" href="/quote">${icon('arrowRight', 15)}<span class="btn-label">Start a new quote</span></a></div>`)
        : panel('We can’t verify this lock.', 'The link isn’t authentic or was altered.', `<div class="link-row"><a class="btn btn-sand btn-sm" href="/verify">${icon('refresh', 15)}<span class="btn-label">Try another link</span></a></div>`);
    });
    setOrb({ label: expired ? 'Expired' : 'Not verified', iconName: 'alert', mode: `${expired ? 'warn' : 'error'} static` });
  }
}

(async function init() {
  chrome = await bootChrome({ title: 'Verify', active: 'verify' });
  chrome.setProgress(1);
  const orb = $('btn-next');
  attachRipple(orb, () => $('orb-core'));
  orb.addEventListener('click', () => {
    const input = $('token-input');
    if (!input) return;
    const t = extractToken(input.value);
    if (!t) { shake(orb); input.focus(); return; }
    history.replaceState(null, '', `/verify?token=${encodeURIComponent(t)}`);
    check(t);
  });
  const token = new URLSearchParams(location.search).get('token');
  if (token) check(token);
  else renderAsk();
})();
