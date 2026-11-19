/**
 * quote.js — the 7-step quote wizard, Linen edition.
 * Wizard state lives in sessionStorage; every price shown at decision points
 * comes from POST /api/quote (server-computed from config). The browser only
 * ever sends IDs — never a price. Display-only estimates are labelled "est.".
 */
import { api, bootChrome, icon, fmtMoney, fmtMoney2, fmtDate, escapeHtml, debounce, toast, copyText } from '/assets/js/shared.js';
import { countUp, morphText, swapStep, confettiBurst, attachRipple, haptic, shake, wait } from '/assets/js/fx.js';

const STEPS = [
  { key: 'budget', pill: ['sparkle', 'No sales visit — ever'], heading: "What's your budget?", sub: 'Slide to set it. You can change it anytime.', cta: 'Continue', orb: 'arrowRight', foot: 'Your price is locked the moment you confirm' },
  { key: 'address', pill: ['pin', 'We only use your ZIP for coverage'], heading: "Where's home?", sub: "We'll check that we install in your area.", cta: 'Check address', orb: 'arrowRight', foot: 'Your address stays with this quote only' },
  { key: 'system', pill: ['layers', 'Installed prices · labor included'], heading: 'Pick your system', sub: 'Three trusted brands. Good, better, best.', cta: 'Continue', orb: 'arrowRight', foot: 'Every final price is computed on our server' },
  { key: 'addons', pill: ['plus', 'Optional — skip any of them'], heading: 'Anything extra?', sub: 'Tap to add. Your total updates live.', cta: 'Continue', orb: 'arrowRight', foot: 'Add-ons are installed the same day' },
  { key: 'payment', pill: ['calendar', '0% APR for 12 months'], heading: 'How would you like to pay?', sub: 'Priced on our server for your exact picks.', cta: 'Continue', orb: 'arrowRight', foot: 'Pre-qualification takes about a second' },
  { key: 'review', pill: ['shield', 'Calculated on our server'], heading: "Here's your price", sub: '', cta: 'Lock this price', orb: 'lock', foot: 'Nothing is charged until the deposit step' },
  { key: 'deposit', pill: ['lock', 'Price locked'], heading: 'Pay your deposit', sub: '', cta: 'Pay deposit', orb: 'card', foot: 'Secure checkout · demo cards only' },
];
const STORE_KEY = 'ad_wizard_v1';
const ADDON_ICONS = { comfort: 'thermometer', 'air-quality': 'wind', protection: 'shield', efficiency: 'zap', install: 'box' };
const FIT_LABEL = { within: 'Within budget', stretch: 'Slight stretch', over: 'Over budget' };
const defaults = {
  step: 0,
  budget: { type: 'monthly', amount: 200 },
  address: '', zip: '', homeSqft: 2000,
  systemId: null, tons: null, brand: null,
  addOnIds: [],
  paymentMethod: 'full', termMonths: 60, statedMonthly: null,
  lock: null, paid: null,
};

let state = load();
let catalog = null;
let quote = null;
let prequal = null;
let paymentsConfig = null;
let chrome = null;
let addrChecked = null;
let busy = false;
let seq = 0;

const $ = (id) => document.getElementById(id);
const inner = () => $('sheet-inner');

function load() {
  try { return { ...defaults, ...JSON.parse(sessionStorage.getItem(STORE_KEY) || '{}') }; }
  catch { return { ...defaults }; }
}
function save() { sessionStorage.setItem(STORE_KEY, JSON.stringify(state)); }

/* ---------------- Display estimates (the server stays authoritative) ---------------- */
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const findSystem = (id) => catalog.systems.find((s) => s.id === id) || null;
function multFor(sqft) {
  const m = catalog.pricing.homeSizeMultipliers.find((x) => x.maxSqft === null || sqft <= x.maxSqft);
  return m ? m.multiplier : 1;
}
function estSystemPrice(sys, tons) {
  const delta = Number(catalog.pricing.tonnagePriceDelta[String(tons)] || 0);
  return round2((sys.baseInstalledPrice + delta) * multFor(state.homeSqft));
}
function estAddOns() {
  return round2(state.addOnIds.reduce((sum, id) => sum + ((catalog.addOns.find((a) => a.id === id) || {}).price || 0), 0));
}
function estTotal() {
  const sys = findSystem(state.systemId);
  if (!sys) return null;
  return round2((estSystemPrice(sys, state.tons) + estAddOns()) * (1 + catalog.pricing.taxRate));
}
function amortize(principal, apr, months) {
  if (principal <= 0) return 0;
  const r = apr / 12;
  return r === 0 ? round2(principal / months) : round2((principal * r) / (1 - Math.pow(1 + r, -months)));
}
function estMonthlyFor(sys) {
  const t = catalog.pricing.financingTerms[catalog.pricing.financingTerms.length - 1];
  const total = round2(sys.baseInstalledPrice * (1 + catalog.pricing.taxRate));
  return amortize(round2(total - total * catalog.pricing.depositPercent), t.apr, t.months);
}
function recommendedTons() {
  const raw = Math.ceil((state.homeSqft / catalog.pricing.sqftPerTon) * 2) / 2;
  return Math.min(5, Math.max(1.5, raw));
}
function defaultTons(sys) {
  const rec = recommendedTons();
  if (sys.tonnageOptions.includes(rec)) return rec;
  return sys.tonnageOptions.reduce((best, t) => (Math.abs(t - rec) < Math.abs(best - rec) ? t : best), sys.tonnageOptions[0]);
}
function fitFor(sys) {
  if (!state.budget || !state.budget.amount) return null;
  if (state.budget.type === 'total') {
    const est = sys.baseInstalledPrice * (1 + catalog.pricing.taxRate);
    return est <= state.budget.amount ? 'within' : est <= state.budget.amount * 1.1 ? 'stretch' : 'over';
  }
  const mo = estMonthlyFor(sys);
  return mo <= state.budget.amount ? 'within' : mo <= state.budget.amount * 1.1 ? 'stretch' : 'over';
}
function quotePayload(method) {
  const m = method || state.paymentMethod;
  return {
    budget: state.budget,
    address: state.address,
    zip: state.zip,
    homeSqft: Number(state.homeSqft),
    systemId: state.systemId,
    tonnageTons: state.tons,
    addOnIds: state.addOnIds,
    paymentMethod: m,
    termMonths: m === 'financing' ? state.termMonths : null,
  };
}

/* ---------------- Small view helpers ---------------- */
function panel(heading, sub, body) {
  return `<div class="step-panel">
    <div class="sheet-head"><h1 class="sheet-title">${heading}</h1>${sub ? `<p class="sheet-sub">${sub}</p>` : ''}</div>
    <div class="sheet-body stagger">${body}</div>
  </div>`;
}
function noticeHtml(type, iconName, html) {
  return `<div class="notice ${type}">${icon(iconName, 17)}<div>${html}</div></div>`;
}
function setSeg(seg, idx) {
  seg.style.setProperty('--n', String(seg.querySelectorAll('button').length));
  seg.style.setProperty('--i', String(idx));
  seg.querySelectorAll('button').forEach((b, i) => { b.classList.toggle('active', i === idx); b.setAttribute('aria-selected', String(i === idx)); });
}
function setOrb({ label, iconName, mode = '', disabled = false } = {}) {
  const orb = $('btn-next');
  if (label !== undefined) { morphText($('orb-label'), label); orb.setAttribute('aria-label', label); }
  if (iconName) $('orb-core').innerHTML = icon(iconName, 30, mode.includes('success') ? 2.2 : 1.6);
  orb.classList.remove('loading', 'success', 'static', 'warn', 'error');
  mode.split(' ').filter(Boolean).forEach((m) => orb.classList.add(m));
  orb.disabled = !!disabled;
}
function setLoading(on) {
  const orb = $('btn-next');
  orb.classList.toggle('loading', on);
  orb.disabled = on;
}
function scrollTop() {
  const sc = $('screen-scroll');
  if (sc) sc.scrollTo({ top: 0, behavior: 'smooth' });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function errorText(err) {
  const names = { 'card.name': 'Name', 'card.number': 'Card number', 'card.exp': 'Expiry', 'card.cvc': 'CVC' };
  if (err && err.code === 'VALIDATION_ERROR' && Array.isArray(err.details) && err.details.length) {
    return err.details.map((d) => `${names[d.path] || d.path}: ${d.message}`).join(' · ');
  }
  return (err && err.message) || 'Something went wrong.';
}

/* ---------------- Step 1 · Budget ---------------- */
const BUDGET_MODES = {
  monthly: { min: 50, max: 500, step: 5, unit: '/ month', start: 200, hint: 'Based on our longest financing term. Tax included.' },
  total: { min: 3000, max: 20000, step: 100, unit: 'total', start: 9000, hint: 'Installed price including tax, before add-ons.' },
};
function renderBudget() {
  const s = STEPS[0];
  inner().innerHTML = panel(s.heading, s.sub, `
    <div class="seg" id="budget-seg" role="tablist" aria-label="Budget type">
      <span class="seg-thumb" aria-hidden="true"></span>
      <button type="button" role="tab" data-type="monthly">Per month</button>
      <button type="button" role="tab" data-type="total">Total price</button>
    </div>
    <div class="big-value"><span class="num" id="budget-value"></span><small id="budget-unit"></small></div>
    <div>
      <input type="range" class="slider" id="budget-slider" aria-label="Budget amount" />
      <div class="scale"><span id="scale-min"></span><span id="scale-max"></span></div>
    </div>
    <div class="fit-summary" id="fit-summary" aria-live="polite"></div>
    <p class="hint center" id="budget-hint"></p>`);
  const seg = $('budget-seg');
  const slider = $('budget-slider');
  const apply = () => {
    const mode = BUDGET_MODES[state.budget.type];
    state.budget.amount = Math.min(mode.max, Math.max(mode.min, Number(state.budget.amount) || mode.start));
    setSeg(seg, state.budget.type === 'monthly' ? 0 : 1);
    slider.min = String(mode.min);
    slider.max = String(mode.max);
    slider.step = String(mode.step);
    slider.value = String(state.budget.amount);
    $('scale-min').textContent = fmtMoney(mode.min);
    $('scale-max').textContent = fmtMoney(mode.max);
    $('budget-unit').textContent = mode.unit;
    $('budget-hint').textContent = mode.hint;
    paint();
  };
  const paint = () => {
    const mode = BUDGET_MODES[state.budget.type];
    const v = Number(slider.value);
    $('budget-value').textContent = fmtMoney(v);
    slider.style.setProperty('--fill', `${((v - mode.min) / (mode.max - mode.min)) * 100}%`);
    const counts = { within: 0, stretch: 0 };
    catalog.systems.forEach((sys) => { const f = fitFor(sys); if (f in counts) counts[f] += 1; });
    $('fit-summary').innerHTML = `<span class="fit within">${counts.within} of ${catalog.systems.length} within budget</span>${counts.stretch ? `<span class="fit stretch">${counts.stretch} a slight stretch</span>` : ''}`;
  };
  slider.addEventListener('input', () => { state.budget.amount = Number(slider.value); save(); paint(); });
  seg.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.type === state.budget.type) return;
    state.budget = { type: b.dataset.type, amount: BUDGET_MODES[b.dataset.type].start };
    save(); haptic(); apply();
  }));
  apply();
}

/* ---------------- Step 2 · Address ---------------- */
function renderAddress() {
  const s = STEPS[1];
  inner().innerHTML = panel(s.heading, s.sub, `
    <div class="ghost-field">
      <label class="sr-only" for="addr">Street address</label>
      <input class="ghost-input" id="addr" autocomplete="off" placeholder="Start typing your street…" value="${escapeHtml(state.address)}" />
      <div class="suggest" id="suggest-box" role="listbox" aria-label="Address suggestions"></div>
    </div>
    <div class="field-row">
      <label class="field"><span class="field-label">ZIP code</span><input class="input" id="zip" inputmode="numeric" autocomplete="postal-code" maxlength="5" placeholder="75201" value="${escapeHtml(state.zip)}" /></label>
      <label class="field"><span class="field-label">Home size · sq ft</span><input class="input" id="sqft" type="number" inputmode="numeric" min="300" max="15000" step="50" value="${Number(state.homeSqft) || 2000}" /></label>
    </div>
    <p class="hint" id="tons-hint"></p>
    <div id="addr-result"></div>`);
  const addr = $('addr');
  const zip = $('zip');
  const sqft = $('sqft');
  const box = $('suggest-box');
  const hide = () => { box.classList.remove('show'); box.innerHTML = ''; };
  const paintTons = () => { $('tons-hint').textContent = `Suggested capacity: about ${recommendedTons()} tons for ${Number(state.homeSqft).toLocaleString()} sq ft.`; };
  const pick = (sg) => {
    addr.value = sg.label;
    if (sg.zip) zip.value = sg.zip;
    state.address = addr.value; state.zip = zip.value; addrChecked = null; save();
    hide(); haptic();
  };
  const suggest = debounce(async () => {
    const q = addr.value.trim();
    if (q.length < 3) { hide(); return; }
    try {
      const { suggestions } = await api(`/api/address/suggest?q=${encodeURIComponent(q)}`);
      if (!suggestions.length || document.activeElement !== addr) { hide(); return; }
      box.innerHTML = suggestions.map(() => `<button type="button" class="suggest-item" role="option">${icon('pin', 15)}<span></span></button>`).join('');
      box.querySelectorAll('.suggest-item').forEach((el, i) => {
        el.querySelector('span').textContent = suggestions[i].label;
        el.addEventListener('pointerdown', (e) => { e.preventDefault(); pick(suggestions[i]); });
      });
      box.classList.add('show');
    } catch { hide(); }
  }, 220);
  addr.addEventListener('input', () => { state.address = addr.value; addrChecked = null; save(); suggest(); });
  addr.addEventListener('blur', () => setTimeout(hide, 120));
  zip.addEventListener('input', () => { state.zip = zip.value.replace(/\D/g, '').slice(0, 5); zip.value = state.zip; addrChecked = null; save(); });
  sqft.addEventListener('input', () => { state.homeSqft = Math.min(15000, Math.max(300, Number(sqft.value) || 300)); save(); paintTons(); });
  paintTons();
}

async function checkAddressStep() {
  const box = $('addr-result');
  if (state.address.trim().length < 3) { toast('Enter your street address.', 'error'); $('addr').focus(); return false; }
  if (!/^\d{5}$/.test(state.zip)) { toast('Enter a valid 5-digit ZIP.', 'error'); $('zip').focus(); return false; }
  if (addrChecked && addrChecked.zip === state.zip) return addrChecked.serviceable;
  const res = await api('/api/address/check', { method: 'POST', body: { zip: state.zip } });
  addrChecked = { zip: state.zip, ...res };
  if (!res.serviceable) {
    box.innerHTML = noticeHtml('warn', 'pin', '<span class="js-msg"></span><div class="notice-actions"><button class="btn btn-sand btn-sm" id="addr-retry" type="button">Try another ZIP</button></div>');
    box.querySelector('.js-msg').textContent = res.message;
    box.querySelector('#addr-retry').addEventListener('click', () => { box.innerHTML = ''; $('zip').select(); });
    shake($('btn-next'));
    return false;
  }
  box.innerHTML = noticeHtml('ok', 'check', '<span class="js-msg"></span>');
  box.querySelector('.js-msg').textContent = res.message;
  return true;
}

/* ---------------- Step 3 · System ---------------- */
function optionHtml(sys) {
  const selected = state.systemId === sys.id;
  const tons = selected && state.tons ? state.tons : defaultTons(sys);
  const fit = fitFor(sys);
  return `
  <div class="option ${selected ? 'selected open' : ''}" data-id="${escapeHtml(sys.id)}">
    <button type="button" class="option-head" aria-pressed="${selected}">
      <span class="radio" aria-hidden="true"></span>
      <span class="option-main">
        <span class="option-title">${escapeHtml(sys.name)} <span class="tag ${escapeHtml(sys.tier)}">${escapeHtml(sys.tier)}</span></span>
        <span class="option-meta">${sys.seer2} SEER2 · ${sys.noiseDb} dB · ${sys.warrantyYears}-yr warranty</span>
        ${fit ? `<span><span class="fit ${fit}">${FIT_LABEL[fit]}</span></span>` : ''}
      </span>
      <span class="option-price"><span class="num js-price">${fmtMoney(estSystemPrice(sys, tons))}</span><small>${fmtMoney(estMonthlyFor(sys))}/mo</small></span>
    </button>
    <div class="expand"><div><div class="expand-inner">
      <div class="option-figure"><img src="${escapeHtml(sys.image)}" alt="${escapeHtml(sys.brand)} ${escapeHtml(sys.name)} condenser" loading="lazy" /></div>
      <p class="option-blurb">${escapeHtml(sys.blurb || '')}</p>
      <span class="mini-label">Capacity</span>
      <div class="chips">${sys.tonnageOptions.map((t) => `<button type="button" class="chip ${t === tons ? 'active' : ''}" data-tons="${t}">${t} tons</button>`).join('')}</div>
    </div></div></div>
  </div>`;
}

function renderSystem() {
  const s = STEPS[2];
  const brands = catalog.brands;
  if (!state.brand || !brands.includes(state.brand)) {
    const sel = findSystem(state.systemId);
    state.brand = sel ? sel.brand : brands[0];
  }
  inner().innerHTML = panel(s.heading, s.sub, `
    <div class="seg" id="brand-seg" role="tablist" aria-label="Brand">
      <span class="seg-thumb" aria-hidden="true"></span>
      ${brands.map((b) => `<button type="button" role="tab" data-brand="${escapeHtml(b)}">${escapeHtml(b)}</button>`).join('')}
    </div>
    <div class="options" id="sys-options"></div>
    <div class="estimate-row" id="sys-estimate"></div>`);
  const seg = $('brand-seg');
  setSeg(seg, brands.indexOf(state.brand));
  paintOptions(false);
  seg.querySelectorAll('button').forEach((b, i) => b.addEventListener('click', () => {
    if (state.brand === b.dataset.brand) return;
    state.brand = b.dataset.brand; save(); haptic();
    setSeg(seg, i);
    paintOptions(true);
  }));
  updateSystemEstimate();
}

function paintOptions(animate) {
  const list = $('sys-options');
  const fill = () => {
    list.innerHTML = catalog.systems.filter((x) => x.brand === state.brand).map(optionHtml).join('');
    bindOptions();
    paintBrandDots();
  };
  if (!animate) { fill(); return; }
  list.classList.add('swap-out');
  setTimeout(() => {
    fill();
    list.classList.remove('swap-out');
    list.classList.add('swap-in');
    setTimeout(() => list.classList.remove('swap-in'), 500);
  }, 160);
}

function paintBrandDots() {
  const sel = findSystem(state.systemId);
  $('brand-seg').querySelectorAll('button').forEach((b) => b.classList.toggle('has-sel', !!sel && sel.brand === b.dataset.brand));
}

function bindOptions() {
  $('sys-options').querySelectorAll('.option').forEach((opt) => {
    const sys = findSystem(opt.dataset.id);
    opt.querySelector('.option-head').addEventListener('click', () => {
      if (state.systemId === sys.id) return;
      state.systemId = sys.id;
      state.tons = defaultTons(sys);
      save(); haptic();
      $('sys-options').querySelectorAll('.option').forEach((o) => {
        const on = o.dataset.id === sys.id;
        o.classList.toggle('selected', on);
        o.classList.toggle('open', on);
        o.querySelector('.option-head').setAttribute('aria-pressed', String(on));
      });
      opt.querySelectorAll('.chip[data-tons]').forEach((c) => c.classList.toggle('active', Number(c.dataset.tons) === state.tons));
      morphText(opt.querySelector('.js-price'), fmtMoney(estSystemPrice(sys, state.tons)));
      paintBrandDots();
      updateSystemEstimate();
    });
    opt.querySelectorAll('.chip[data-tons]').forEach((chip) => chip.addEventListener('click', () => {
      state.tons = Number(chip.dataset.tons); save(); haptic();
      opt.querySelectorAll('.chip[data-tons]').forEach((c) => c.classList.toggle('active', c === chip));
      morphText(opt.querySelector('.js-price'), fmtMoney(estSystemPrice(sys, state.tons)));
      updateSystemEstimate();
    }));
  });
}

function updateSystemEstimate() {
  const el = $('sys-estimate');
  if (!el) return;
  const sys = findSystem(state.systemId);
  if (!sys) {
    el.classList.add('empty-est');
    el.innerHTML = '<span class="k">Choose a system to see your estimate</span>';
    return;
  }
  el.classList.remove('empty-est');
  if (!el.querySelector('.js-est')) el.innerHTML = '<span class="k"><span class="js-est-name"></span><small>Est. installed, incl. tax</small></span><b class="num js-est"></b>';
  el.querySelector('.js-est-name').textContent = `${sys.brand} ${sys.name} · ${state.tons} t`;
  morphText(el.querySelector('.js-est'), fmtMoney(estTotal()));
}

/* ---------------- Step 4 · Add-ons ---------------- */
function renderAddons() {
  const s = STEPS[3];
  inner().innerHTML = panel(s.heading, s.sub, `
    <div class="options">
      ${catalog.addOns.map((a) => {
        const on = state.addOnIds.includes(a.id);
        return `<button type="button" class="choice addon ${on ? 'selected' : ''}" data-id="${escapeHtml(a.id)}" aria-pressed="${on}">
          <span class="choice-icon">${icon(ADDON_ICONS[a.category] || 'plus', 19)}</span>
          <span class="choice-main"><span class="choice-title">${escapeHtml(a.name)}</span><span class="choice-meta">${escapeHtml(a.description)}</span></span>
          <span class="choice-side"><span class="choice-price">+${fmtMoney(a.price)}</span><span class="switch" aria-hidden="true"></span></span>
        </button>`;
      }).join('')}
    </div>
    <div class="estimate-row"><span class="k"><span id="addon-count"></span><small>Est. total, incl. tax</small></span><b class="num" id="addon-total"></b></div>`);
  const paint = () => {
    const n = state.addOnIds.length;
    $('addon-count').textContent = `${n} add-on${n === 1 ? '' : 's'} · +${fmtMoney(estAddOns())}`;
    const total = estTotal();
    morphText($('addon-total'), total === null ? fmtMoney(estAddOns()) : fmtMoney(total));
  };
  inner().querySelectorAll('.choice.addon').forEach((c) => c.addEventListener('click', () => {
    const id = c.dataset.id;
    state.addOnIds = state.addOnIds.includes(id) ? state.addOnIds.filter((x) => x !== id) : [...state.addOnIds, id];
    const on = state.addOnIds.includes(id);
    c.classList.toggle('selected', on);
    c.setAttribute('aria-pressed', String(on));
    prequal = null; save(); haptic(); paint();
  }));
  paint();
}

/* ---------------- Step 5 · Payment ---------------- */
async function renderPayment(my) {
  const s = STEPS[4];
  inner().innerHTML = panel(s.heading, s.sub, '<div class="skeleton sk-row"></div><div class="skeleton sk-row"></div>');
  let fullQ;
  let finQ;
  try {
    [fullQ, finQ] = await Promise.all([
      api('/api/quote', { method: 'POST', body: quotePayload('full') }).then((r) => r.quote),
      api('/api/quote', { method: 'POST', body: quotePayload('financing') }).then((r) => r.quote),
    ]);
  } catch (err) {
    if (my !== seq) return;
    inner().querySelector('.sheet-body').innerHTML = noticeHtml('error', 'alert', escapeHtml(err.message));
    setOrb({ disabled: true });
    return;
  }
  if (my !== seq) return;
  quote = state.paymentMethod === 'financing' ? finQ : fullQ;
  const terms = catalog.pricing.financingTerms;
  const fin = state.paymentMethod === 'financing';
  inner().querySelector('.sheet-body').innerHTML = `
    <div class="options">
      <button type="button" class="choice ${fin ? '' : 'selected'}" data-m="full">
        <span class="radio" aria-hidden="true"></span>
        <span class="choice-main"><span class="choice-title">Pay in full</span><span class="choice-meta">Deposit today, the rest at install.</span></span>
        <span class="choice-price"><span>${fmtMoney2(fullQ.total)}</span><small>total</small></span>
      </button>
      <button type="button" class="choice ${fin ? 'selected' : ''}" data-m="financing">
        <span class="radio" aria-hidden="true"></span>
        <span class="choice-main"><span class="choice-title">Monthly financing</span><span class="choice-meta">Fixed payments after your deposit.</span></span>
        <span class="choice-price"><span class="num" id="fin-monthly">${fmtMoney2(finQ.financing.monthlyPayment)}</span><small id="fin-term">/mo · ${finQ.financing.months} mo</small></span>
      </button>
    </div>
    <div class="expand ${fin ? 'open' : ''}" id="term-expand"><div><div class="expand-inner flush">
      <span class="mini-label">Term</span>
      <div class="chips" id="term-chips">${terms.map((t) => `<button type="button" class="chip ${t.months === state.termMonths ? 'active' : ''}" data-mo="${t.months}">${t.months} mo <small>${(t.apr * 100).toFixed(2)}% APR</small></button>`).join('')}</div>
      ${state.budget.type === 'monthly'
        ? `<p class="hint">We'll compare it to your ${fmtMoney(state.budget.amount)}/mo budget.</p>`
        : `<label class="field"><span class="field-label">Max comfortable monthly payment</span><input class="input" id="stated-monthly" type="number" inputmode="numeric" min="1" max="100000" step="5" value="${state.statedMonthly || Math.ceil(finQ.financing.monthlyPayment)}" /></label>`}
    </div></div></div>
    <div id="prequal-result"></div>`;

  if (!terms.some((t) => t.months === state.termMonths)) { state.termMonths = terms[terms.length - 1].months; save(); }
  const choices = inner().querySelectorAll('.choice[data-m]');
  choices.forEach((c) => c.addEventListener('click', () => {
    state.paymentMethod = c.dataset.m; prequal = null; save(); haptic();
    choices.forEach((x) => x.classList.toggle('selected', x === c));
    $('term-expand').classList.toggle('open', state.paymentMethod === 'financing');
    quote = state.paymentMethod === 'financing' ? finQ : fullQ;
    $('prequal-result').innerHTML = '';
  }));
  inner().querySelectorAll('#term-chips .chip').forEach((chip) => chip.addEventListener('click', async () => {
    state.termMonths = Number(chip.dataset.mo); prequal = null; save(); haptic();
    inner().querySelectorAll('#term-chips .chip').forEach((x) => x.classList.toggle('active', x === chip));
    $('prequal-result').innerHTML = '';
    try {
      finQ = (await api('/api/quote', { method: 'POST', body: quotePayload('financing') })).quote;
      if (state.paymentMethod === 'financing') quote = finQ;
      morphText($('fin-monthly'), fmtMoney2(finQ.financing.monthlyPayment));
      $('fin-term').textContent = `/mo · ${finQ.financing.months} mo`;
    } catch (err) { toast(err.message, 'error'); }
  }));
  const sm = $('stated-monthly');
  if (sm) sm.addEventListener('input', () => { state.statedMonthly = Number(sm.value) || null; prequal = null; save(); });
}

async function checkPaymentStep() {
  if (state.paymentMethod !== 'financing') return true;
  const stated = state.budget.type === 'monthly' ? state.budget.amount : state.statedMonthly;
  if (!stated || stated <= 0) { toast('Tell us your max comfortable monthly payment.', 'error'); return false; }
  const key = [state.systemId, state.tons, state.termMonths, stated, state.addOnIds.join(','), state.homeSqft].join('|');
  if (prequal && prequal._for === key) return prequal.status !== 'declined';
  const box = $('prequal-result');
  box.innerHTML = noticeHtml('info', 'refresh', 'Checking pre-qualification…');
  const { result } = await api('/api/financing/prequalify', { method: 'POST', body: { quote: quotePayload('financing'), statedMonthlyBudget: stated } });
  result._for = key;
  prequal = result;
  if (result.status === 'approved' || result.status === 'pending_review') {
    const ok = result.status === 'approved';
    box.innerHTML = noticeHtml(ok ? 'ok' : 'warn', ok ? 'check' : 'alert', `<b>${ok ? 'Pre-approved.' : 'Pending review.'}</b> <span class="js-msg"></span>`);
    box.querySelector('.js-msg').textContent = ok
      ? `${fmtMoney2(result.offer.monthlyPayment)}/mo for ${result.offer.termMonths} months at ${(result.offer.apr * 100).toFixed(2)}% APR.`
      : result.message;
    haptic(12);
    await wait(500);
    return true;
  }
  const terms = catalog.pricing.financingTerms;
  const idx = terms.findIndex((t) => t.months === state.termMonths);
  const longer = idx >= 0 && idx < terms.length - 1 ? terms[idx + 1] : null;
  box.innerHTML = noticeHtml('error', 'alert', `<b>Not approved for this term.</b> <span class="js-msg"></span>
    <div class="notice-actions">
      ${longer ? `<button class="btn btn-sand btn-sm" id="pq-longer" type="button">Try ${longer.months} months</button>` : ''}
      <button class="btn btn-dark btn-sm" id="pq-full" type="button">Pay in full instead</button>
    </div>`);
  box.querySelector('.js-msg').textContent = result.message;
  box.querySelector('#pq-full').addEventListener('click', () => { state.paymentMethod = 'full'; prequal = null; save(); renderPayment(seq); });
  const lb = box.querySelector('#pq-longer');
  if (lb) lb.addEventListener('click', () => { state.termMonths = longer.months; prequal = null; save(); renderPayment(seq); });
  shake($('btn-next'));
  return false;
}

/* ---------------- Step 6 · Review ---------------- */
async function renderReview(my) {
  const s = STEPS[5];
  const sub = `Lock it and it's guaranteed for ${catalog.pricing.priceLockDays} days.`;
  inner().innerHTML = panel(s.heading, sub, '<div class="skeleton sk-block"></div>');
  try {
    quote = (await api('/api/quote', { method: 'POST', body: quotePayload() })).quote;
  } catch (err) {
    if (my !== seq) return;
    inner().querySelector('.sheet-body').innerHTML = noticeHtml('error', 'alert', escapeHtml(err.message));
    setOrb({ disabled: true });
    return;
  }
  if (my !== seq) return;
  const q = quote;
  const sys = findSystem(q.system.id);
  const line = (k, v, cls = '', sub2 = '') => `<div class="rline ${cls}"><span class="k">${k}${sub2 ? `<small>${sub2}</small>` : ''}</span><span class="v">${v}</span></div>`;
  inner().querySelector('.sheet-body').innerHTML = `
    <div class="receipt">
      <div class="receipt-head">
        ${sys ? `<img src="${escapeHtml(sys.image)}" alt="" />` : ''}
        <div><b>${escapeHtml(q.system.brand)} ${escapeHtml(q.system.name)}</b><small>${q.system.tons} tons · ${q.system.seer2} SEER2 · ${q.system.warrantyYears}-yr warranty</small></div>
        <span class="tag ${escapeHtml(q.system.tier)}">${escapeHtml(q.system.tier)}</span>
      </div>
      ${line('System, installed', fmtMoney2(q.system.baseInstalledPrice))}
      ${q.adjustments.map((a) => line(escapeHtml(a.label), `${a.amount >= 0 ? '+' : '−'}${fmtMoney2(Math.abs(a.amount))}`, 'dim')).join('')}
      ${q.addOns.map((a) => line(escapeHtml(a.name), fmtMoney2(a.price), 'dim')).join('')}
      ${line('Subtotal', fmtMoney2(q.subtotal))}
      ${line(`Sales tax (${(q.taxRate * 100).toFixed(2)}%)`, fmtMoney2(q.tax), 'dim')}
      <div class="rline total"><span class="k">Total</span><span class="v num" id="review-total">${fmtMoney2(0)}</span></div>
      ${line(`Due today · ${Math.round(q.depositPercent * 100)}% deposit`, fmtMoney2(q.deposit), 'deposit')}
      ${q.financing ? line(`Financing · ${q.financing.months} mo at ${(q.financing.apr * 100).toFixed(2)}% APR`, `${fmtMoney2(q.financing.monthlyPayment)}/mo`, 'dim', `${fmtMoney2(q.financing.principal)} financed after deposit`) : ''}
    </div>
    ${prequal && state.paymentMethod === 'financing' ? noticeHtml(prequal.status === 'approved' ? 'ok' : 'warn', prequal.status === 'approved' ? 'check' : 'alert', `Financing ${escapeHtml(prequal.status.replace('_', ' '))} — ${fmtMoney2(q.financing.monthlyPayment)}/mo.`) : ''}
    <p class="hint center">Includes equipment, standard installation, permits and haul-away.</p>`;
  countUp($('review-total'), q.total, { format: (v) => fmtMoney2(v), duration: 850 });
}

async function doLock() {
  const res = await api('/api/quote/lock', { method: 'POST', body: quotePayload() });
  state.lock = { token: res.token, ref: res.ref, expiresAt: res.expiresAt, quote: res.quote };
  state.paid = null;
  save();
  haptic(14);
  toast(`Price locked — ${res.ref}`, 'ok');
  go(6);
}

/* ---------------- Step 7 · Deposit (live card preview) ---------------- */
function renderDeposit() {
  const s = STEPS[6];
  const L = state.lock;
  const live = paymentsConfig && paymentsConfig.mode === 'live';
  chrome.setPill(`Price locked · ${L.ref}`, 'lock');
  const sub = `${fmtMoney2(L.quote.deposit)} holds your price until ${fmtDate(L.expiresAt)}.`;
  if (live) {
    inner().innerHTML = panel(s.heading, escapeHtml(sub), noticeHtml('info', 'lock', "You'll finish on Stripe's secure checkout, then come right back here."));
    setOrb({ label: 'Continue to checkout', iconName: 'arrowRight' });
    return;
  }
  inner().innerHTML = panel(s.heading, escapeHtml(sub), `
    <div class="cc" id="cc" aria-hidden="true">
      <div class="cc-inner">
        <div class="cc-face cc-front">
          <div class="cc-top"><span class="cc-brand">AireDirect</span>${icon('wifi', 20, 1.6)}</div>
          <span class="cc-chip"></span>
          <div class="cc-number" id="cc-num-view">•••• •••• •••• ••••</div>
          <div class="cc-bottom">
            <div>Card holder<b id="cc-name-view">Your name</b></div>
            <div>Expires<b id="cc-exp-view">MM/YY</b></div>
          </div>
        </div>
        <div class="cc-face cc-back">
          <div class="cc-stripe"></div>
          <div class="cc-sign"><span id="cc-cvc-view">•••</span></div>
          <small>Demo card · no real charges are made</small>
        </div>
      </div>
    </div>
    <form id="card-form" class="stack-sm" novalidate>
      <label class="field"><span class="field-label">Name on card</span><input class="input" id="cc-name" autocomplete="cc-name" placeholder="Harper Homeowner" /></label>
      <label class="field"><span class="field-label">Card number</span><input class="input mono-input" id="cc-num" inputmode="numeric" autocomplete="cc-number" placeholder="4242 4242 4242 4242" maxlength="23" /></label>
      <div class="field-row">
        <label class="field"><span class="field-label">Expiry</span><input class="input" id="cc-exp" inputmode="numeric" autocomplete="cc-exp" placeholder="MM/YY" maxlength="5" /></label>
        <label class="field"><span class="field-label">CVC</span><input class="input" id="cc-cvc" inputmode="numeric" autocomplete="cc-csc" placeholder="123" maxlength="4" /></label>
      </div>
      <button type="submit" class="sr-only" tabindex="-1">Pay deposit</button>
    </form>
    <div id="pay-error"></div>
    <div class="test-cards">
      <span class="mini-label">Demo cards · tap to fill</span>
      <div class="chips">
        <button class="chip" id="fill-success" type="button">4242 · approves</button>
        <button class="chip" id="fill-decline" type="button">0002 · declines</button>
      </div>
    </div>`);
  setOrb({ label: `Pay ${fmtMoney2(L.quote.deposit)}`, iconName: 'card' });

  const cc = $('cc');
  const name = $('cc-name');
  const num = $('cc-num');
  const exp = $('cc-exp');
  const cvc = $('cc-cvc');
  const paintCard = () => {
    const digits = num.value.replace(/\D/g, '');
    $('cc-num-view').textContent = digits ? (digits + '•'.repeat(Math.max(0, 16 - digits.length))).replace(/(.{4})/g, '$1 ').trim() : '•••• •••• •••• ••••';
    $('cc-name-view').textContent = name.value.trim() || 'Your name';
    $('cc-exp-view').textContent = exp.value || 'MM/YY';
    $('cc-cvc-view').textContent = cvc.value ? cvc.value.replace(/./g, '•') : '•••';
  };
  num.addEventListener('input', () => { num.value = num.value.replace(/\D/g, '').slice(0, 19).replace(/(.{4})/g, '$1 ').trim(); paintCard(); });
  exp.addEventListener('input', () => {
    let v = exp.value.replace(/\D/g, '').slice(0, 4);
    if (v.length >= 3) v = `${v.slice(0, 2)}/${v.slice(2)}`;
    exp.value = v; paintCard();
  });
  cvc.addEventListener('input', () => { cvc.value = cvc.value.replace(/\D/g, '').slice(0, 4); paintCard(); });
  name.addEventListener('input', paintCard);
  cvc.addEventListener('focus', () => cc.classList.add('flipped'));
  cvc.addEventListener('blur', () => cc.classList.remove('flipped'));
  const fill = (n) => {
    if (!name.value) name.value = 'Harper Homeowner';
    num.value = n.replace(/(.{4})/g, '$1 ').trim();
    if (!exp.value) exp.value = '12/28';
    if (!cvc.value) cvc.value = '123';
    paintCard(); haptic();
  };
  $('fill-success').addEventListener('click', () => fill('4242424242424242'));
  $('fill-decline').addEventListener('click', () => fill('4000000000000002'));
  $('card-form').addEventListener('submit', (e) => { e.preventDefault(); next(); });
}

async function doPay() {
  const L = state.lock;
  if (paymentsConfig && paymentsConfig.mode === 'live') {
    const res = await api('/api/payments/deposit', { method: 'POST', body: { lockToken: L.token } });
    if (res.checkoutUrl) { location.assign(res.checkoutUrl); return; }
    if (res.status === 'already_paid') { state.paid = { at: res.order.paidAt, deposit: L.quote.deposit }; save(); renderConfirmation(false); }
    return;
  }
  const errBox = $('pay-error');
  errBox.innerHTML = '';
  try {
    const res = await api('/api/payments/deposit', {
      method: 'POST',
      body: { lockToken: L.token, card: { name: $('cc-name').value, number: $('cc-num').value, exp: $('cc-exp').value, cvc: $('cc-cvc').value } },
    });
    state.paid = { at: res.order.paidAt, paymentId: res.paymentId || null, deposit: res.deposit || L.quote.deposit };
    save();
    setOrb({ label: 'Paid', iconName: 'check', mode: 'success static' });
    haptic(20);
    await wait(650);
    renderConfirmation(true);
  } catch (err) {
    errBox.innerHTML = noticeHtml('error', 'alert', '<span class="js-msg"></span>');
    errBox.querySelector('.js-msg').textContent = errorText(err);
    shake($('btn-next'));
  }
}

/* ---------------- Confirmation ---------------- */
function renderConfirmation(celebrate) {
  const L = state.lock;
  const q = L.quote;
  seq += 1;
  chrome.setTitle('Confirmed');
  chrome.setProgress(1);
  chrome.setPill('Deposit received', 'check');
  chrome.setFoot('Verify your locked price anytime');
  $('btn-back').classList.add('hidden');
  setOrb({ label: 'All set', iconName: 'check', mode: 'success static' });
  swapStep(inner(), () => {
    inner().innerHTML = panel('Price locked.', `Your ${escapeHtml(q.system.brand)} ${escapeHtml(q.system.name)} is guaranteed at <b class="ink">${fmtMoney2(q.total)}</b> until ${fmtDate(L.expiresAt)}.`, `
      <button class="ref-chip" id="copy-ref" type="button" aria-label="Copy reference ${escapeHtml(L.ref)}"><span class="mini-label">Reference</span><b>${escapeHtml(L.ref)}</b>${icon('copy', 16)}</button>
      <div class="receipt">
        <div class="rline"><span class="k">Locked total</span><span class="v">${fmtMoney2(q.total)}</span></div>
        <div class="rline dim"><span class="k">Deposit paid</span><span class="v">${fmtMoney2(state.paid.deposit)}</span></div>
        <div class="rline"><span class="k">Balance at install</span><span class="v">${fmtMoney2(round2(q.total - q.deposit))}</span></div>
        ${q.financing ? `<div class="rline dim"><span class="k">Financing</span><span class="v">${fmtMoney2(q.financing.monthlyPayment)}/mo · ${q.financing.months} mo</span></div>` : ''}
        <div class="rline"><span class="k">Lock expires</span><span class="v">${fmtDate(L.expiresAt)}</span></div>
      </div>
      <div class="timeline">
        <div class="tl-item done"><span class="tl-dot">${icon('check', 14, 2.4)}</span><div><h5>Deposit received</h5><p>A receipt is on its way to your inbox.</p></div></div>
        <div class="tl-item"><span class="tl-dot">2</span><div><h5>Scheduling call</h5><p>Our install team reaches out within one business day.</p></div></div>
        <div class="tl-item"><span class="tl-dot">3</span><div><h5>Install day</h5><p>Most installs finish in a day. Balance due on completion.</p></div></div>
      </div>
      <div class="link-row">
        <a class="btn btn-sand btn-sm" href="/verify?token=${encodeURIComponent(L.token)}">${icon('shield', 15)}<span class="btn-label">Verification page</span></a>
        <button class="btn btn-ghost btn-sm" id="new-quote" type="button">${icon('refresh', 15)}<span class="btn-label">New quote</span></button>
      </div>`);
    $('copy-ref').addEventListener('click', () => copyText(L.ref));
    $('new-quote').addEventListener('click', startOver);
  }, 'forward');
  scrollTop();
  if (celebrate) setTimeout(() => confettiBurst(), 200);
}

/* ---------------- Navigation ---------------- */
function render(direction = 'forward') {
  const s = STEPS[state.step];
  const my = ++seq;
  chrome.setTitle(`Step ${state.step + 1} of ${STEPS.length}`);
  chrome.setProgress((state.step + 1) / STEPS.length);
  chrome.setPill(s.pill[1], s.pill[0]);
  chrome.setFoot(s.foot);
  setOrb({ label: s.cta, iconName: s.orb });
  $('btn-back').classList.toggle('hidden', state.step === 0);
  swapStep(inner(), () => {
    if (my !== seq) return;
    switch (state.step) {
      case 0: renderBudget(); break;
      case 1: renderAddress(); break;
      case 2: renderSystem(); break;
      case 3: renderAddons(); break;
      case 4: renderPayment(my); break;
      case 5: renderReview(my); break;
      case 6:
        if (!state.lock) { state.step = 5; save(); render('back'); return; }
        renderDeposit();
        break;
      default: break;
    }
  }, direction);
  scrollTop();
}

function go(i, dir) {
  const d = dir || (i >= state.step ? 'forward' : 'back');
  state.step = i;
  save();
  render(d);
}

function goBack() {
  if (busy || state.step === 0 || state.paid) return;
  haptic();
  go(state.step - 1, 'back');
}

function startOver() {
  sessionStorage.removeItem(STORE_KEY);
  location.replace('/quote');
}

async function next() {
  if (busy || state.paid) return;
  busy = true;
  const orb = $('btn-next');
  try {
    switch (state.step) {
      case 0: haptic(); go(1); break;
      case 1:
        setLoading(true);
        if (await checkAddressStep()) { haptic(12); await wait(450); go(2); }
        break;
      case 2:
        if (!state.systemId) { toast('Choose a system to continue.', 'error'); shake(orb); }
        else { haptic(); go(3); }
        break;
      case 3: haptic(); go(4); break;
      case 4:
        setLoading(true);
        if (await checkPaymentStep()) go(5);
        break;
      case 5: setLoading(true); await doLock(); break;
      case 6: setLoading(true); await doPay(); break;
      default: break;
    }
  } catch (err) {
    toast(errorText(err), 'error');
    shake(orb);
  } finally {
    busy = false;
    if (orb.classList.contains('loading')) setLoading(false);
  }
}

/* ---------------- Boot ---------------- */
(async function init() {
  try {
    chrome = await bootChrome({
      title: 'Your quote',
      active: 'quote',
      requireRoles: ['homeowner', 'sales', 'admin'],
      menuExtras: [{ label: 'Start over', sub: 'Clear this quote', icon: 'refresh', onClick: startOver }],
    });
    [catalog, paymentsConfig] = await Promise.all([
      api('/api/catalog'),
      api('/api/payments/config').catch(() => ({ mode: 'mock' })),
    ]);
    $('btn-back').innerHTML = icon('chevronL', 20, 1.8);
    $('btn-back').addEventListener('click', goBack);
    $('btn-next').addEventListener('click', next);
    attachRipple($('btn-next'), () => $('orb-core'));
    if (new URLSearchParams(location.search).get('canceled')) toast('Checkout canceled — your price lock is still saved.', 'error', 5000);
    if (state.step === 6 && state.lock && state.paid) renderConfirmation(false);
    else render('forward');
  } catch (err) {
    if (err && err.message === 'redirect') return;
    inner().innerHTML = panel('Something went wrong', 'Please refresh the page.', '');
  }
})();
