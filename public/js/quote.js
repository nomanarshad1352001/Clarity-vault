/* Homeowner quote wizard in the Clarity-Vault design language.
   Wizard state stays in sessionStorage; every price shown comes strictly from the server. */
(async function () {
  'use strict';
  const { h, $, api, money, money2, dateFmt, createOrb, setVaultStatus } = App;
  const KEY = 'ac_wizard_v1';
  const TOTAL_STEPS = 7;

  const PROMPTS = {
    1: ['What budget feels right?', 'Slide or type what’s comfortable for your home...'],
    2: ['Where is home?', 'Enter your street address and 5-digit ZIP...'],
    3: ['Which system fits best?', 'Goodman, Rheem, or Trane — tailored to your budget.'],
    4: ['Anything else to include?', 'Toggle only the extras you actually want...'],
    5: ['Pay in full, or monthly?', 'Preview financing terms with zero credit pull...'],
    6: ['Does everything look right?', 'Every line item calculated on our server...'],
    7: ['Ready to lock your price?', 'Held exclusively for you for 7 full days.'],
  };

  const FOOTERS = {
    1: '100% private to you · Zero sales calls',
    2: 'Checked instantly against our active service ZIPs',
    3: 'Installed prices include equipment, labor & tax',
    4: 'Live total updates straight from our pricing server',
    5: 'Pre-qualification uses your stated budget only',
    6: 'Nothing is charged until the next step',
    7: 'Cryptographically signed the second you lock it',
  };

  const fresh = () => ({
    step: 1,
    budget: { type: 'total', amount: 9000 },
    address: { street: '', city: '', state: '', zip: '' },
    areaOk: null,
    homeSize: null,
    systemId: null,
    tonnage: null,
    addOnIds: [],
    paymentMethod: 'full',
    termMonths: 36,
    decision: null,
    customer: { name: '', email: '', phone: '' },
    lock: null,
  });

  let state = fresh();
  try {
    const saved = JSON.parse(sessionStorage.getItem(KEY) || '{}');
    state = {
      ...state,
      ...saved,
      budget: { ...state.budget, ...(saved.budget || {}) },
      address: { ...state.address, ...(saved.address || {}) },
      customer: { ...state.customer, ...(saved.customer || {}) },
    };
  } catch { /* ignore */ }
  const save = () => sessionStorage.setItem(KEY, JSON.stringify(state));

  let catalog = null;
  let quote = null;
  let onlyFit = false;
  const stepEl = $('#step');
  const alertEl = $('#alert');
  const deviceEl = $('#vault-device');
  const footEl = $('#vault-foot');
  const toAnimate = new Set();
  const anim = (container) => { if (toAnimate.delete(state.step)) FX.stagger(container); return container; };

  const showError = (msg) => { alertEl.textContent = msg; alertEl.classList.remove('hidden'); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const clearError = () => alertEl.classList.add('hidden');

  await App.initChrome({ vault: true, session: 'Active Session', pill: '100% No Sales Visit' });
  await loadCatalog();
  if (!state.homeSize) state.homeSize = catalog.defaultHomeSize;

  const qs = new URLSearchParams(location.search);
  if (qs.get('resume') && state.lock) { state.step = 7; history.replaceState(null, '', '/quote'); }

  // ------------------------------------------------------------ data helpers
  async function loadCatalog() {
    const p = new URLSearchParams();
    if (state.budget.amount) { p.set('budget', state.budget.amount); p.set('budgetType', state.budget.type); }
    if (state.homeSize) p.set('homeSize', state.homeSize);
    catalog = await api(`/api/catalog?${p}`);
  }

  function quoteInput(extra = {}) {
    const s = state;
    const o = {
      budget: Number(s.budget.amount),
      budgetType: s.budget.type,
      address: s.address.street.trim(),
      zip: s.address.zip.trim(),
      homeSize: s.homeSize,
      systemId: s.systemId,
      addOnIds: s.addOnIds,
      paymentMethod: s.paymentMethod,
    };
    if (s.address.city.trim()) o.city = s.address.city.trim();
    if (/^[A-Za-z]{2}$/.test(s.address.state.trim())) o.state = s.address.state.trim();
    if (s.tonnage) o.tonnage = s.tonnage;
    if (s.paymentMethod === 'financing') o.termMonths = s.termMonths;
    return { ...o, ...extra };
  }

  function syncChromeStatus() {
    const pillText = quote && state.systemId
      ? `${money2(quote.totalCents)} · Server-Verified`
      : '100% No Sales Visit';
    setVaultStatus(`Active Session · Step ${state.step} of ${TOTAL_STEPS}`, pillText);
    footEl.textContent = FOOTERS[state.step] || '';
    deviceEl.classList.toggle('wide-step', state.step === 3);
  }

  async function fetchQuote() {
    quote = (await api('/api/quote', { method: 'POST', body: quoteInput() })).quote;
    syncChromeStatus();
    return quote;
  }

  const lockSignature = () => JSON.stringify([quoteInput(), state.customer]);

  function go(step) {
    state.step = Math.max(1, Math.min(TOTAL_STEPS, step));
    save();
    clearError();
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ------------------------------------------------------------ shared UI bits
  function head(step, customSub) {
    const [title, sub] = PROMPTS[step];
    return h('div', { class: 'vault-head' },
      h('h2', {}, title),
      h('p', { class: 'vault-prompt' }, customSub || sub));
  }

  function vaultNav({ back = true, iconName = 'arrow', nextLabel = 'Tap to continue', onNext, nextDisabled = false }) {
    const orb = createOrb({
      iconName,
      label: nextLabel,
      ariaLabel: nextLabel,
      disabled: nextDisabled,
      onClick: async () => {
        orb.btn.disabled = true;
        const prev = [...orb.btn.childNodes];
        orb.btn.replaceChildren(h('span', { class: 'spinner dark' }));
        try {
          await onNext();
        } catch (ex) {
          showError(ex.message);
        } finally {
          if (orb.btn.isConnected) {
            orb.btn.disabled = false;
            orb.btn.replaceChildren(...prev);
          }
        }
      },
    });
    if (back && state.step > 1) {
      orb.wrap.append(h('button', {
        class: 'btn ghost small',
        type: 'button',
        onclick: () => go(state.step - 1),
      }, '← Previous step'));
    }
    return orb.wrap;
  }

  function field(id, label, input, hint) {
    return h('div', { class: 'field' }, h('label', { for: id }, label), input, h('div', { class: 'field-error', id: `${id}-err`, role: 'alert' }), hint ? h('div', { class: 'hint' }, hint) : null);
  }
  const setErr = (id, msg) => {
    const e = $(`#${id}-err`);
    if (e) e.textContent = msg || '';
    const i = $(`#${id}`);
    if (i) i.setAttribute('aria-invalid', msg ? 'true' : 'false');
    return !msg;
  };

  // ------------------------------------------------------------ step 1: budget
  function stepBudget() {
    const isMonthly = state.budget.type === 'monthly';
    const range = { total: { min: 3000, max: 20000, step: 250 }, monthly: { min: 50, max: 500, step: 10 } }[state.budget.type];
    const big = h('div', { class: 'budget-big', 'aria-hidden': 'true' }, '');
    const show = () => FX.animateNumber(big, Number(state.budget.amount) || 0, { duration: 320, format: (v) => `${money(Math.round(v) * 100)}${isMonthly ? '/mo' : ''}` });
    const num = h('input', { id: 'budget', type: 'number', inputmode: 'numeric', min: range.min, max: 200000, step: range.step, value: state.budget.amount });
    const slider = h('input', { type: 'range', min: range.min, max: range.max, step: range.step, value: Math.min(Math.max(state.budget.amount, range.min), range.max), 'aria-label': 'Budget slider' });
    const fill = () => slider.style.setProperty('--fill', `${((slider.value - range.min) / (range.max - range.min)) * 100}%`);
    slider.addEventListener('input', () => { num.value = slider.value; state.budget.amount = Number(slider.value); fill(); show(); });
    num.addEventListener('input', () => { state.budget.amount = Number(num.value); slider.value = num.value; fill(); show(); });

    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Budget type' }, ['total', 'monthly'].map((t) => h('button', {
      type: 'button',
      'aria-pressed': String(state.budget.type === t),
      onclick: () => { state.budget.type = t; state.budget.amount = t === 'total' ? 9000 : 150; render(); },
    }, t === 'total' ? 'Total budget' : 'Monthly budget')));

    stepEl.replaceChildren(
      head(1),
      anim(h('div', {},
        seg,
        big,
        slider,
        h('div', { class: 'mt' }, field('budget', isMonthly ? 'Monthly comfort target (USD)' : 'Total installed target (USD)', num, 'You can adjust this at any point.')))),
      vaultNav({
        back: false,
        nextLabel: 'Continue to address',
        onNext: async () => {
          const v = Number(num.value);
          if (!(v > 0) || v > 200000) { setErr('budget', 'Enter a budget between $1 and $200,000.'); return; }
          state.budget.amount = v;
          state.lock = null;
          await loadCatalog();
          go(2);
        },
      }),
    );
    fill();
    show();
  }

  // ------------------------------------------------------------ step 2: address
  function stepAddress() {
    const a = state.address;
    const street = h('input', { id: 'street', type: 'text', autocomplete: 'street-address', value: a.street, maxlength: 100, placeholder: '1100 Congress Ave' });
    const city = h('input', { id: 'city', type: 'text', autocomplete: 'address-level2', value: a.city, maxlength: 60, placeholder: 'Austin' });
    const st = h('input', { id: 'state', type: 'text', autocomplete: 'address-level1', value: a.state, maxlength: 2, placeholder: 'TX' });
    const zip = h('input', { id: 'zip', type: 'text', inputmode: 'numeric', autocomplete: 'postal-code', value: a.zip, maxlength: 5, placeholder: '78701' });
    const home = h('select', { id: 'home' }, catalog.homeSizes.map((hs) => h('option', { value: hs.id, selected: hs.id === state.homeSize }, hs.label)));
    const areaMsg = h('div', { id: 'area-msg', role: 'status' });
    const list = h('ul', { class: 'hidden', role: 'listbox', 'aria-label': 'Address suggestions' });
    let timer;

    const checkZip = async () => {
      areaMsg.replaceChildren();
      if (!/^\d{5}$/.test(zip.value)) { state.areaOk = null; return null; }
      const r = await api(`/api/address/check?zip=${zip.value}`);
      state.areaOk = r.inServiceArea;
      areaMsg.replaceChildren(h('div', { class: `alert ${r.inServiceArea ? 'ok' : 'warn'}` }, r.message));
      return r.inServiceArea;
    };
    zip.addEventListener('input', () => { zip.value = zip.value.replace(/\D/g, ''); checkZip().catch(() => {}); });

    street.addEventListener('input', () => {
      clearTimeout(timer);
      const q = street.value.trim();
      if (q.length < 3) { list.classList.add('hidden'); return; }
      timer = setTimeout(async () => {
        try {
          const { suggestions } = await api(`/api/address/suggest?q=${encodeURIComponent(q)}`);
          list.replaceChildren(...suggestions.map((s) => h('li', { role: 'option' }, h('button', {
            type: 'button',
            onclick: async () => {
              const { address } = await api(`/api/address/details?id=${encodeURIComponent(s.id)}`);
              street.value = address.street; city.value = address.city; st.value = address.state; zip.value = address.zip;
              list.classList.add('hidden'); checkZip().catch(() => {});
            },
          }, s.description))));
          list.classList.toggle('hidden', suggestions.length === 0);
        } catch { list.classList.add('hidden'); }
      }, 220);
    });

    stepEl.replaceChildren(
      head(2),
      anim(h('div', {},
        h('div', { class: 'field' }, h('label', { for: 'street' }, 'Street address'), h('div', { class: 'suggest' }, street, list), h('div', { class: 'field-error', id: 'street-err', role: 'alert' })),
        h('div', { class: 'grid cols-3' }, field('city', 'City', city), field('state', 'State', st), field('zip', 'ZIP code', zip)),
        areaMsg,
        field('home', 'Approximate home size', home, 'Helps us suggest the right cooling capacity.'))),
      vaultNav({
        nextLabel: 'See matching systems',
        onNext: async () => {
          let ok = true;
          ok = setErr('street', /^\d[A-Za-z0-9\s.,#'\/-]{2,99}$/.test(street.value.trim()) ? '' : 'Enter a street address starting with the house number, e.g. 123 Main St.') && ok;
          ok = setErr('city', /^[\p{L}\p{M}\s.'-]{0,60}$/u.test(city.value.trim()) ? '' : 'Letters only, please.') && ok;
          ok = setErr('state', /^([A-Za-z]{2})?$/.test(st.value.trim()) ? '' : 'Use the 2-letter state code.') && ok;
          ok = setErr('zip', /^\d{5}$/.test(zip.value) ? '' : 'Enter a 5-digit ZIP code.') && ok;
          if (!ok) return;
          const inArea = await checkZip();
          if (!inArea) { setErr('zip', 'That ZIP is outside our current service area.'); return; }
          const changed = state.address.zip !== zip.value || state.homeSize !== home.value;
          state.address = { street: street.value.trim(), city: city.value.trim(), state: st.value.trim().toUpperCase(), zip: zip.value };
          state.homeSize = home.value;
          if (changed) { state.systemId = null; state.tonnage = null; quote = null; }
          state.lock = null;
          await loadCatalog();
          go(3);
        },
      }),
    );
    if (a.zip.length === 5) checkZip().catch(() => {});
  }

  // ------------------------------------------------------------ step 3: system
  const FIT = { within: ['ok', 'Fits budget'], stretch: ['warn', 'Small stretch'], over: ['bad', 'Over budget'] };
  const TIER_N = { Good: 1, Better: 2, Best: 3 };

  function systemCard(s, topPick) {
    const [cls, label] = FIT[s.fit] || ['', ''];
    const dim = s.fit === 'over';
    const tier = h('span', { class: 'tier' }, [1, 2, 3].map((n) => h('i', { class: n <= TIER_N[s.tier] ? 'on' : '' })), ` ${s.tier}`);
    const btn = h('button', { type: 'button', class: `sys${dim ? ' dim' : ''}`, 'aria-pressed': String(state.systemId === s.id) },
      topPick ? h('span', { class: 'ribbon' }, 'Recommended') : null,
      h('div', { class: 'brand-head mb0 mt0' }, tier, label ? h('span', { class: `pill ${cls}` }, label) : null),
      h('img', { src: s.image, alt: '', loading: 'lazy' }),
      h('div', {},
        h('div', { class: 'small muted' }, s.name),
        h('div', { class: 'price' }, money(s.estimate.totalCents)),
        h('div', { class: 'small muted' }, `installed incl. tax · ~${money(s.estimate.lowestMonthlyCents)}/mo`)),
      h('div', { class: 'specs' },
        h('div', {}, h('b', {}, s.seer2), 'SEER2'),
        h('div', {}, h('b', {}, `${s.noiseDb} dB`), 'Sound'),
        h('div', {}, h('b', {}, `${s.warrantyYears} yr`), 'Warranty')),
      h('ul', {}, s.highlights.map((x) => h('li', {}, x))));
    btn.addEventListener('click', () => {
      state.systemId = s.id;
      state.tonnage = s.estimate.tonnage;
      state.lock = null;
      state.decision = null;
      save();
      quote = null;
      stepSystem();
    });
    return btn;
  }

  async function stepSystem() {
    const sel = catalog.systems.find((s) => s.id === state.systemId);
    const within = catalog.systems.filter((s) => s.fit === 'within');
    const top = within.length ? [...within].sort((a, b) => b.seer2 - a.seer2)[0].id : null;

    const brandSections = catalog.brands.map((b) => {
      const systems = catalog.systems.filter((s) => s.brand === b.id && (!onlyFit || s.fit !== 'over'));
      if (!systems.length) return null;
      return h('section', {},
        h('div', { class: 'brand-head' }, h('h3', { class: 'mb0' }, b.name), h('span', { class: 'small muted' }, b.tagline)),
        h('div', { class: 'grid cols-3' }, systems.map((s) => systemCard(s, s.id === top))));
    });

    let tonnageBox = null;
    if (sel) {
      const ton = h('select', { id: 'ton' }, sel.tonnageOptions.map((t) => h('option', { value: t, selected: t === state.tonnage }, `${t} ton${t === sel.estimate.tonnage ? ' (recommended)' : ''}`)));
      const price = h('div', { class: 'mt center', 'aria-live': 'polite' });
      const refresh = async () => {
        try {
          await fetchQuote();
          price.replaceChildren(h('span', { class: 'vault-pill' }, `Server total: ${money2(quote.totalCents)} (incl. ${money2(quote.taxCents)} tax)`));
        } catch (ex) {
          price.replaceChildren(h('span', { class: 'field-error' }, ex.message));
        }
      };
      ton.addEventListener('change', () => { state.tonnage = Number(ton.value); state.lock = null; save(); refresh(); });
      tonnageBox = h('div', { class: 'card mt step-enter' },
        field('ton', `${sel.name} — cooling capacity`, ton, 'Sized from your home square footage. Larger tonnage adjusts the price.'),
        price);
      refresh();
    }

    const fitNote = within.length
      ? `${within.length} of ${catalog.systems.length} systems fit your ${money(state.budget.amount * 100)}${state.budget.type === 'monthly' ? '/mo' : ''} target.`
      : 'Closest options shown below — monthly financing can help stretch your budget.';

    stepEl.replaceChildren(
      head(3, fitNote),
      h('div', { class: 'center' },
        h('label', { class: 'small', for: 'only-fit' },
          h('input', { id: 'only-fit', type: 'checkbox', checked: onlyFit, onchange: (e) => { onlyFit = e.target.checked; stepSystem(); } }),
          ' Show only systems near my budget')),
      ...brandSections,
      tonnageBox,
      vaultNav({
        nextDisabled: !state.systemId,
        nextLabel: state.systemId ? 'Continue to add-ons' : 'Select a system above',
        onNext: async () => {
          if (!state.systemId) { showError('Please choose a system first.'); return; }
          await fetchQuote();
          go(4);
        },
      }),
    );
  }

  // ------------------------------------------------------------ step 4: add-ons
  async function stepAddOns() {
    const total = h('span', { class: 'serif' }, '…');
    const refresh = async () => {
      try {
        await fetchQuote();
        FX.animateNumber(total, quote.totalCents, { format: (v) => `${money2(Math.round(v))} incl. tax` });
      } catch (ex) { showError(ex.message); }
    };
    const cards = catalog.addOns.map((a) => {
      const btn = h('button', { type: 'button', class: 'toggle', 'aria-pressed': String(state.addOnIds.includes(a.id)) },
        h('span', { class: 'switch', 'aria-hidden': 'true' }),
        h('span', { class: 'grow' }, h('b', {}, a.name), h('div', { class: 'small muted' }, a.description)),
        h('span', { class: 'p' }, `+${money(a.priceCents)}`));
      btn.addEventListener('click', () => {
        const on = !state.addOnIds.includes(a.id);
        state.addOnIds = on ? [...state.addOnIds, a.id] : state.addOnIds.filter((x) => x !== a.id);
        btn.setAttribute('aria-pressed', String(on));
        state.lock = null;
        save();
        refresh();
      });
      return btn;
    });

    stepEl.replaceChildren(
      head(4),
      anim(h('div', { class: 'grid' }, cards)),
      h('div', { class: 'live-total' }, h('span', { class: 'muted small' }, 'Installed total'), total),
      vaultNav({
        nextLabel: 'Choose payment option',
        onNext: async () => { await fetchQuote(); go(5); },
      }),
    );
    refresh();
  }

  // ------------------------------------------------------------ step 5: payment method
  async function stepPayment() {
    await fetchQuote();
    const body = h('div');

    async function check() {
      const r = await api('/api/financing/prequalify', { method: 'POST', body: quoteInput() });
      state.decision = { terms: r.terms, disclosure: r.disclosure, termMonths: state.termMonths, method: state.paymentMethod };
      save();
      draw();
      return r.terms.find((t) => t.termMonths === state.termMonths);
    }

    function renderDecision(el) {
      const d = state.decision;
      if (!d) return;
      const sel = d.terms.find((t) => t.termMonths === state.termMonths);
      if (!sel) return;
      const reasons = h('ul', {}, sel.reasons.map((r) => h('li', {}, r)));
      if (sel.status === 'approved') {
        el.replaceChildren(h('div', { class: 'alert ok' }, h('b', {}, `Pre-approved for ${sel.termMonths} months`), reasons));
      } else if (sel.status === 'pending') {
        el.replaceChildren(h('div', { class: 'alert warn' }, h('b', {}, 'Pending quick review'), reasons, h('p', { class: 'small mb0' }, 'You can still lock your price today; our lender confirms within 1 business day.')));
      } else {
        const ok = d.terms.filter((t) => t.status !== 'declined');
        el.replaceChildren(h('div', { class: 'alert bad' }, h('b', {}, `Not approved for ${sel.termMonths} months`), reasons,
          h('div', { class: 'actions wrap' },
            ok.length ? h('button', { class: 'btn secondary small', type: 'button', onclick: () => { state.termMonths = ok[ok.length - 1].termMonths; save(); draw(); } }, `Try ${ok[ok.length - 1].termMonths} months`) : h('span'),
            h('button', { class: 'btn small', type: 'button', onclick: () => { state.paymentMethod = 'full'; state.decision = null; save(); render(); } }, 'Pay in full instead'))));
      }
      el.append(h('p', { class: 'hint' }, d.disclosure));
    }

    const draw = () => {
      body.replaceChildren();
      if (state.paymentMethod === 'full') {
        body.append(h('div', { class: 'alert info center' }, `Reserve today with a ${money2(quote.depositCents)} deposit (${quote.depositPercent}%). Balance of ${money2(quote.balanceCents)} is due at installation.`));
        return;
      }
      body.append(h('p', { class: 'muted small center' }, `After your ${money2(quote.depositCents)} deposit today, finance the remaining ${money2(quote.balanceCents)}:`));
      for (const o of quote.financingOptions) {
        const d = state.decision && state.decision.terms ? state.decision.terms.find((t) => t.termMonths === o.termMonths) : null;
        const pill = d ? h('span', { class: `pill ${d.status === 'approved' ? 'ok' : d.status === 'pending' ? 'warn' : 'bad'}` }, d.status) : null;
        const btn = h('button', { type: 'button', class: 'option', 'aria-pressed': String(state.termMonths === o.termMonths) },
          h('span', {}, h('b', {}, `${o.termMonths} months `), pill, h('div', { class: 'small muted' }, `${o.aprPercent}% APR · total interest ${money2(o.totalInterestCents)}`)),
          h('span', {}, h('b', {}, `${money2(o.monthlyPaymentCents)}/mo`)));
        btn.addEventListener('click', () => { state.termMonths = o.termMonths; save(); draw(); });
        body.append(btn);
      }
      const result = h('div', { id: 'fin-result' });
      body.append(
        h('div', { class: 'center mt' },
          h('button', { class: 'btn secondary small', type: 'button', onclick: async (e) => { e.currentTarget.disabled = true; try { await check(); } catch (ex) { showError(ex.message); } e.currentTarget.disabled = false; } }, 'Check my pre-qualification')),
        result);
      renderDecision(result);
    };

    const methodBtn = (m, title, sub) => {
      const b = h('button', { type: 'button', class: 'option', 'aria-pressed': String(state.paymentMethod === m) },
        h('span', {}, h('b', {}, title), h('div', { class: 'small muted' }, sub)));
      b.addEventListener('click', () => { state.paymentMethod = m; state.lock = null; save(); stepPayment(); });
      return b;
    };

    stepEl.replaceChildren(
      head(5),
      anim(h('div', {},
        methodBtn('full', 'Pay in full', `${money2(quote.totalCents)} total — zero interest`),
        methodBtn('financing', 'Monthly financing', `From ${money2(Math.min(...quote.financingOptions.map((o) => o.monthlyPaymentCents)))}/mo — soft budget check`))),
      body,
      vaultNav({
        nextLabel: 'Review itemized quote',
        onNext: async () => {
          if (state.paymentMethod === 'financing') {
            let sel = state.decision && state.decision.method === 'financing' ? state.decision.terms.find((t) => t.termMonths === state.termMonths) : null;
            if (!sel) sel = await check();
            if (sel.status === 'declined') { showError('Financing was not approved for that term. Pick another term or pay in full.'); return; }
          }
          await fetchQuote();
          go(6);
        },
      }),
    );
    draw();
  }

  // ------------------------------------------------------------ step 6: review
  async function stepReview() {
    await fetchQuote();
    const c = state.customer;
    const name = h('input', { id: 'cname', type: 'text', autocomplete: 'name', value: c.name, maxlength: 80, placeholder: 'Jane Homeowner' });
    const email = h('input', { id: 'cemail', type: 'email', autocomplete: 'email', value: c.email, maxlength: 120, placeholder: 'jane@example.com' });
    const phone = h('input', { id: 'cphone', type: 'tel', autocomplete: 'tel', value: c.phone, maxlength: 20, placeholder: '555-010-1234' });

    const rows = quote.items.map((i) => h('tr', {}, h('td', {}, i.label), h('td', {}, money2(i.amountCents))));
    const table = h('table', { class: 'summary' }, h('tbody', {}, ...rows,
      h('tr', { class: 'sub' }, h('td', {}, 'Subtotal'), h('td', {}, money2(quote.subtotalCents))),
      h('tr', { class: 'sub' }, h('td', {}, `Sales tax (${quote.taxRatePercent}%)`), h('td', {}, money2(quote.taxCents))),
      h('tr', { class: 'total' }, h('td', {}, 'Installed total'), h('td', {}, money2(quote.totalCents)))));

    stepEl.replaceChildren(
      head(6, `${state.address.street}, ${state.address.city ? `${state.address.city} ` : ''}${state.address.state} ${state.address.zip}`),
      table,
      h('div', { class: 'kv mt' },
        h('div', {}, h('span', {}, `Deposit (${quote.depositPercent}%)`), h('b', {}, money2(quote.depositCents))),
        h('div', {}, h('span', {}, 'Balance at install'), h('b', {}, money2(quote.balanceCents))),
        h('div', {}, h('span', {}, quote.financing ? 'Monthly plan' : 'Method'), h('b', {}, quote.financing ? `${money2(quote.financing.monthlyPaymentCents)}/mo × ${quote.financing.termMonths}` : 'Pay in full'))),
      h('h3', { class: 'mt2 center' }, 'Where should we send your price-lock certificate?'),
      field('cname', 'Full name', name),
      field('cemail', 'Email address', email),
      field('cphone', 'Mobile phone (optional)', phone, 'For a text link to verify your locked price.'),
      vaultNav({
        nextLabel: 'Proceed to price lock',
        onNext: async () => {
          let ok = true;
          ok = setErr('cname', /^[\p{L}\p{M}\s.'-]{2,80}$/u.test(name.value.trim()) ? '' : 'Enter your full name.') && ok;
          ok = setErr('cemail', /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim()) ? '' : 'Enter a valid email.') && ok;
          ok = setErr('cphone', phone.value.trim() === '' || /^[0-9+()\-.\s]{7,20}$/.test(phone.value.trim()) ? '' : 'Enter a valid phone number.') && ok;
          if (!ok) return;
          state.customer = { name: name.value.trim(), email: email.value.trim(), phone: phone.value.trim() };
          go(7);
        },
      }),
    );
  }

  // ------------------------------------------------------------ step 7: deposit + lock
  async function stepDeposit() {
    await fetchQuote();
    const lockValid = state.lock && state.lock.sig === lockSignature() && new Date(state.lock.expiresAt) > new Date();
    if (!lockValid) state.lock = null;
    const demo = !!App.$('#chrome .banner');
    if (qs.get('cancelled')) showError('Payment was cancelled. Your price is still locked — tap below whenever you are ready.');

    stepEl.replaceChildren(
      head(7),
      state.lock ? h('div', { class: 'alert ok center' }, h('b', {}, `Locked at ${money2(state.lock.totalCents)}`), h('div', { class: 'small' }, `Reference ${state.lock.ref} · valid through ${dateFmt(state.lock.expiresAt)}`)) : null,
      anim(h('div', { class: 'kv' },
        h('div', {}, h('span', {}, 'Locked price'), h('b', {}, money2(quote.totalCents))),
        h('div', {}, h('span', {}, 'Deposit today'), h('b', {}, money2(quote.depositCents))),
        h('div', {}, h('span', {}, 'Price guarantee'), h('b', {}, `${catalog.priceLockDays} days`)))),
      h('div', { class: 'alert info mt center' }, demo
        ? 'Demo mode: next is a simulated card screen (4242 4242 4242 4242 succeeds · 4000 0000 0000 0002 declines).'
        : 'Next you will complete your deposit through our secure payment checkout.'),
      vaultNav({
        iconName: 'lock',
        nextLabel: `Tap to lock & pay ${money2(quote.depositCents)} deposit`,
        onNext: async () => {
          clearError();
          try {
            if (!state.lock) {
              const body = { ...quoteInput(), customer: { name: state.customer.name, email: state.customer.email, ...(state.customer.phone ? { phone: state.customer.phone } : {}) } };
              const r = await api('/api/quote/lock', { method: 'POST', body });
              state.lock = { token: r.token, ref: r.ref, expiresAt: r.expiresAt, totalCents: r.quote.totalCents, sig: lockSignature() };
              save();
              FX.toast(`Price locked · ${r.ref}`, 'ok');
            }
            const s = await api('/api/payment/session', { method: 'POST', body: { token: state.lock.token } });
            location.href = s.url;
          } catch (ex) {
            if (ex.data && ex.data.error === 'financing_declined') {
              state.decision = null;
              showError('Financing was declined for this term. Go back one step to select another term or pay in full.');
            } else if (ex.data && ex.data.error === 'already_paid') {
              state.lock = null;
              showError('This quote deposit has already been paid.');
            } else throw ex;
          }
        },
      }),
    );
  }

  // ------------------------------------------------------------ router
  function render() {
    renderProgress($('#progress'), state.step);
    syncChromeStatus();
    toAnimate.add(state.step);
    stepEl.classList.remove('step-enter');
    void stepEl.offsetWidth;
    stepEl.classList.add('step-enter');
    const fn = { 1: stepBudget, 2: stepAddress, 3: stepSystem, 4: stepAddOns, 5: stepPayment, 6: stepReview, 7: stepDeposit }[state.step];
    Promise.resolve(fn()).catch((ex) => {
      if (ex.data && ex.data.error === 'outside_service_area') { state.step = 2; save(); render(); showError(ex.message); return; }
      if (ex.data && ['unknown_system', 'unknown_addon', 'bad_tonnage'].includes(ex.data.error)) { state.step = 3; state.systemId = null; state.addOnIds = []; save(); render(); showError('Some options changed. Please re-select your system.'); return; }
      showError(ex.message);
    });
  }

  render();
})();
