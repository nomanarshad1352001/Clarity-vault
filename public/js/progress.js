/* Wizard progress indicator shared by /quote and /success. */
(function () {
  'use strict';
  const { h } = App;
  const STEPS = ['Budget', 'Address', 'System', 'Add-ons', 'Payment', 'Review', 'Deposit'];

  /** step: 1-based current step; step = STEPS.length + 1 renders everything as complete. */
  function renderProgress(el, step) {
    const pctDone = Math.min(100, Math.round(((step - 1) / (STEPS.length - 1)) * 100));
    const bar = h('div', { class: 'progress-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pctDone), 'aria-label': 'Quote progress' }, h('div', { class: 'progress-fill' }));
    bar.firstChild.style.width = `${Math.max(pctDone, 4)}%`; // CSSOM is allowed under strict CSP; inline style attributes are not
    const list = h('ol', { class: 'steps' }, STEPS.map((label, i) => {
      const n = i + 1;
      const cls = n < step ? 'done' : n === step ? 'current' : '';
      return h('li', { class: cls, 'aria-current': n === step ? 'step' : null }, h('span', { class: 'dot' }, n < step ? '✓' : String(n)), h('span', { class: 'lbl' }, label));
    }));
    el.replaceChildren(h('div', { class: 'step-count' }, step > STEPS.length ? 'All done' : `Step ${step} of ${STEPS.length} · ${STEPS[step - 1]}`), bar, list);
  }

  window.renderProgress = renderProgress;
})();
