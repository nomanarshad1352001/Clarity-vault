(async function () {
  'use strict';
  const { h, $, api, money, svgIcon, vaultBrandNode, makeMenuButton, createOrb } = App;
  const cfg = await App.initChrome({ active: 'home' });

  // ---------------- Interactive Clarity-Vault Phone Preview
  const phoneTop = $('#phone-top');
  phoneTop.append(vaultBrandNode(cfg.company && cfg.company.name), makeMenuButton(cfg));

  const promptEl = $('#phone-prompt');
  const liveEl = $('#phone-live');
  let parsed = { budget: 9000, budgetType: 'total', zip: '' };

  function parseNaturalInput(txt) {
    const clean = txt.replace(/,/g, '');
    const zipMatch = /\b(\d{5})\b/.exec(clean);
    const zip = zipMatch ? zipMatch[1] : '';
    const withoutZip = zip ? clean.replace(zip, ' ') : clean;
    const numMatch = /\$?\s*(\d{2,6})/.exec(withoutZip);
    const monthly = /\b(mo|month|monthly)\b/i.test(clean);
    let amount = numMatch ? Number(numMatch[1]) : 9000;
    const type = monthly || (amount >= 50 && amount <= 600) ? 'monthly' : 'total';
    if (amount < 50) amount = 9000;
    return { budget: amount, budgetType: type, zip };
  }

  async function updatePhonePreview() {
    const val = promptEl.value.trim();
    if (!val) {
      liveEl.classList.add('hidden');
      orb.caption.textContent = hasSpeech ? 'Tap mic to speak, or tap to begin quote' : 'Tap to begin your private quote';
      return;
    }
    parsed = parseNaturalInput(val);
    orb.caption.textContent = 'Tap to continue with these details →';
    try {
      const cat = await api(`/api/catalog?budget=${parsed.budget}&budgetType=${parsed.budgetType}`);
      const fitCount = cat.systems.filter((s) => s.fit === 'within').length;
      const lowest = Math.min(...cat.systems.map((s) => s.estimate.totalCents));
      liveEl.replaceChildren(
        h('div', {},
          h('div', { class: 'muted small' }, parsed.zip ? `ZIP ${parsed.zip} · ${parsed.budgetType} budget` : `${parsed.budgetType === 'monthly' ? 'Monthly' : 'Total'} budget ${money(parsed.budget * 100)}`),
          h('span', {}, `${fitCount} of ${cat.systems.length} systems fit`)),
        h('b', {}, `from ${money(lowest)}`));
      liveEl.classList.remove('hidden');
    } catch { /* ignore */ }
  }

  function launchWizardWithParsed() {
    const val = promptEl.value.trim();
    if (val) parsed = parseNaturalInput(val);
    let prev = {};
    try { prev = JSON.parse(sessionStorage.getItem('ac_wizard_v1') || '{}'); } catch { /* ignore */ }
    const next = {
      ...prev,
      step: parsed.zip ? 2 : 1,
      budget: { type: parsed.budgetType, amount: parsed.budget },
      address: { street: (prev.address && prev.address.street) || '', city: (prev.address && prev.address.city) || '', state: (prev.address && prev.address.state) || '', zip: parsed.zip || ((prev.address && prev.address.zip) || '') },
    };
    sessionStorage.setItem('ac_wizard_v1', JSON.stringify(next));
    location.href = '/quote';
  }

  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  const hasSpeech = !!SpeechRec;
  let rec = null;
  let listening = false;

  const orb = createOrb({
    iconName: 'mic',
    label: hasSpeech ? 'Tap mic to speak, or tap to begin quote' : 'Tap to begin your private quote',
    ariaLabel: 'Start quote or speak budget',
    onClick: () => {
      if (promptEl.value.trim() || !hasSpeech) {
        launchWizardWithParsed();
        return;
      }
      if (listening && rec) { rec.stop(); return; }
      try {
        rec = new SpeechRec();
        rec.lang = 'en-US';
        rec.interimResults = true;
        listening = true;
        orb.btn.classList.add('listening');
        orb.caption.textContent = 'Listening… say your budget or ZIP';
        rec.onresult = (ev) => {
          const transcript = [...ev.results].map((r) => r[0].transcript).join(' ');
          promptEl.value = transcript;
          updatePhonePreview();
        };
        rec.onerror = () => { listening = false; orb.btn.classList.remove('listening'); launchWizardWithParsed(); };
        rec.onend = () => {
          listening = false;
          orb.btn.classList.remove('listening');
          if (promptEl.value.trim()) orb.caption.textContent = 'Tap again to open your quote →';
        };
        rec.start();
      } catch {
        launchWizardWithParsed();
      }
    },
  });
  $('#phone-orb').append(orb.wrap);
  promptEl.addEventListener('input', () => { clearTimeout(promptEl._t); promptEl._t = setTimeout(updatePhonePreview, 180); });
  promptEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); launchWizardWithParsed(); } });

  // ---------------- Timeline
  const steps = [
    ['dollar', 'Set budget', 'Monthly or total comfort target.'],
    ['pin', 'Check ZIP', 'Instant service-area verification.'],
    ['box', 'Pick system', 'Goodman, Rheem, or Trane tiers.'],
    ['plus', 'Choose add-ons', 'Toggle extras with a live total.'],
    ['lock', 'Lock 7 days', '10% deposit signs your exact price.'],
  ];
  $('#timeline').append(...steps.map(([ic, t, d]) => h('div', { class: 'tl-item' }, h('div', { class: 'tl-dot' }, svgIcon(ic)), h('h3', {}, t), h('p', {}, d))));

  // ---------------- Live Budget Studio (server-calculated)
  const range = $('#calc-range');
  const amount = $('#calc-amount');
  const list = $('#fit-list');
  const sum = $('#calc-sum');
  let type = 'total';
  let timer;
  let seq = 0;

  const fill = () => range.style.setProperty('--fill', `${((range.value - range.min) / (range.max - range.min)) * 100}%`);

  async function refresh() {
    fill();
    const v = Number(range.value);
    const mine = ++seq;
    amount.textContent = type === 'monthly' ? `${money(v * 100)}/mo` : money(v * 100);
    let cat;
    try { cat = await api(`/api/catalog?budget=${v}&budgetType=${type}`); } catch { return; }
    if (mine !== seq) return;
    const max = Math.max(...cat.systems.map((s) => s.estimate.totalCents));
    const within = cat.systems.filter((s) => s.fit === 'within');
    const sorted = [...cat.systems].sort((a, b) => a.estimate.totalCents - b.estimate.totalCents);
    list.replaceChildren(...sorted.map((s, i) => {
      const bar = h('i', {});
      bar.style.transform = `scaleX(${(s.estimate.totalCents / max).toFixed(3)})`;
      const row = h('div', { class: `fit-row${s.fit === 'over' ? ' over' : ''}` },
        h('b', {}, `${cat.brands.find((b) => b.id === s.brand).name} ${s.tier}`),
        h('span', { class: 'bar' }, bar),
        h('span', {}, type === 'monthly' ? `${money(s.estimate.lowestMonthlyCents)}/mo` : money(s.estimate.totalCents)));
      row.style.animation = `rise .35s ${i * 35}ms var(--ease) both`;
      return row;
    }));
    sum.textContent = within.length
      ? `${within.length} of ${cat.systems.length} systems fit — up to ${[...within].sort((a, b) => b.seer2 - a.seer2)[0].seer2} SEER2 efficiency.`
      : 'Above your target — 60-month financing in the quote flow can help bridge the gap.';
  }

  range.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(refresh, 90);
    fill();
    amount.textContent = type === 'monthly' ? `${money(range.value * 100)}/mo` : money(range.value * 100);
  });

  $('#calc-type').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    type = b.dataset.t;
    [...$('#calc-type').children].forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    Object.assign(range, type === 'total' ? { min: 3000, max: 20000, step: 250, value: 9000 } : { min: 50, max: 500, step: 10, value: 150 });
    refresh();
  });

  $('#calc-go').addEventListener('click', () => {
    sessionStorage.setItem('ac_wizard_v1', JSON.stringify({ step: 1, budget: { type, amount: Number(range.value) } }));
  });

  refresh();

  // ---------------- FAQ Accordion
  const faqs = [
    ['Is my locked price genuinely guaranteed?', 'Yes. When you lock a quote, our server signs the itemized total, tax, and deposit into a 7-day cryptographic token that anyone with your link can verify.'],
    ['Do I ever have to host a salesperson?', 'Never. You size, compare, choose add-ons, and reserve online at your own pace.'],
    ['Does checking monthly payments affect my credit?', 'No. Our pre-qualification step evaluates your stated budget with zero credit pull.'],
    ['What if my ZIP code is outside your service area?', 'Step 2 checks your 5-digit ZIP immediately against our active service list before you spend time configuring equipment.'],
  ];
  $('#faq-list').append(...faqs.map(([q, a]) => {
    const body = h('div', { class: 'faq-a' }, h('p', {}, a));
    const btn = h('button', { class: 'faq-q', type: 'button', 'aria-expanded': 'false' }, q);
    const item = h('div', { class: 'faq-item' }, btn, body);
    btn.addEventListener('click', () => {
      const open = item.classList.toggle('open');
      btn.setAttribute('aria-expanded', String(open));
      body.style.maxHeight = open ? `${body.scrollHeight}px` : '0px';
    });
    return item;
  }));
  FX.reveal();
})();
