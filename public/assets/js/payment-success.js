import { api, bootChrome, icon, escapeHtml } from '/assets/js/shared.js';
import { swapStep, confettiBurst } from '/assets/js/fx.js';

const $ = (id) => document.getElementById(id);

function show({ heading, sub, mode, iconName, label, cta }) {
  swapStep($('sheet-inner'), () => {
    $('sheet-inner').innerHTML = `<div class="step-panel">
      <div class="sheet-head"><h1 class="sheet-title">${escapeHtml(heading)}</h1><p class="sheet-sub">${escapeHtml(sub)}</p></div>
      <div class="sheet-body stagger"><div class="link-row"><a class="btn btn-dark btn-sm" href="${cta.href}"><span class="btn-label">${escapeHtml(cta.label)}</span></a></div></div>
    </div>`;
  });
  const orb = $('btn-next');
  orb.className = `orb static ${mode}`;
  $('orb-core').innerHTML = icon(iconName, 30, mode === 'success' ? 2.2 : 1.6);
  $('orb-label').textContent = label;
  orb.setAttribute('aria-label', label);
}

(async function init() {
  const chrome = await bootChrome({ title: 'Payment', active: 'quote' }).catch(() => null);
  if (chrome) { chrome.setPill('Secure checkout', 'lock'); chrome.setProgress(1); }
  $('orb-core').innerHTML = icon('card', 30, 1.6);
  $('btn-next').classList.add('loading');
  const sessionId = new URLSearchParams(location.search).get('session_id');
  if (!sessionId) {
    show({ heading: 'Nothing to confirm.', sub: 'No checkout session was provided.', mode: 'warn', iconName: 'alert', label: 'No session', cta: { href: '/quote', label: 'Back to my quote' } });
    return;
  }
  try {
    const r = await api(`/api/payments/session-status?session_id=${encodeURIComponent(sessionId)}`);
    if (r.status === 'paid') {
      show({ heading: 'Deposit received.', sub: `Reference ${r.ref || ''} — your install team reaches out within one business day.`, mode: 'success', iconName: 'check', label: 'Paid', cta: { href: '/quote', label: 'View my confirmation' } });
      setTimeout(() => confettiBurst(), 250);
    } else {
      show({ heading: 'Payment not completed.', sub: `Status: ${r.status}. If you were charged, contact support with your reference.`, mode: 'warn', iconName: 'alert', label: 'Not completed', cta: { href: '/quote', label: 'Try again' } });
    }
  } catch (err) {
    if (err.status === 401) show({ heading: 'Sign in required.', sub: 'Please sign in to confirm your payment.', mode: 'warn', iconName: 'alert', label: 'Sign in', cta: { href: '/login?next=/quote', label: 'Sign in' } });
    else show({ heading: 'Could not confirm.', sub: err.message, mode: 'error', iconName: 'alert', label: 'Error', cta: { href: '/quote', label: 'Back to my quote' } });
  }
})();
