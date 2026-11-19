import { api, bootChrome, icon, fmtDateTime, escapeHtml, toast } from '/assets/js/shared.js';
import { swapStep } from '/assets/js/fx.js';

const $ = (id) => document.getElementById(id);
const host = () => $('tab-host');
const clone = (o) => JSON.parse(JSON.stringify(o));
let catalog = null;
let catalogOriginal = null;
let rules = null;
let rulesOriginal = null;

function setSeg(seg, idx) {
  seg.style.setProperty('--n', String(seg.querySelectorAll('button').length));
  seg.style.setProperty('--i', String(idx));
  seg.querySelectorAll('button').forEach((b, i) => { b.classList.toggle('active', i === idx); b.setAttribute('aria-selected', String(i === idx)); });
}

function wrapTab(html) {
  return `<div class="step-panel stack">${html}</div>`;
}

function errMessage(err) {
  const d = err.details && err.details[0];
  return d ? `${err.message} (${d.path}: ${d.message})` : err.message;
}

/* ---------------- Confirm modal ---------------- */
function confirmModal(title, diffHtml, onConfirm) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-overlay';
  wrap.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="m-title">
      <h3 id="m-title"></h3>
      <p class="card-sub">Review the changes before they're written to the JSON config.</p>
      <div class="diff-list">${diffHtml}</div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="m-cancel" type="button"><span class="btn-label">Cancel</span></button>
        <button class="btn btn-dark" id="m-confirm" type="button"><span class="btn-label">Confirm &amp; save</span></button>
      </div>
    </div>`;
  wrap.querySelector('#m-title').textContent = title;
  document.body.appendChild(wrap);
  const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  wrap.querySelector('#m-cancel').addEventListener('click', close);
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
  const ok = wrap.querySelector('#m-confirm');
  ok.focus({ preventScroll: true });
  ok.addEventListener('click', async () => {
    ok.classList.add('loading');
    await onConfirm();
    close();
  });
}

/* ---------------- Catalog ---------------- */
async function renderCatalog() {
  const data = await api('/api/admin/catalog');
  catalog = clone(data.catalog);
  catalogOriginal = clone(data.catalog);
  swapStep(host(), () => {
    host().innerHTML = wrapTab(`
      <section class="wide-card">
        <div class="card-head">
          <div><h2 class="card-title">Systems</h2><p class="card-sub">${catalog.systems.length} systems · installed prices in USD</p></div>
          <button class="btn btn-dark" id="cat-save" type="button">${icon('check', 16)}<span class="btn-label">Save catalog</span></button>
        </div>
        <div class="table-wrap">
          <table class="data">
            <thead><tr><th>System</th><th>SEER2</th><th>Noise dB</th><th>Warranty</th><th>Base price $</th><th>Tonnages</th></tr></thead>
            <tbody>
              ${catalog.systems.map((s, i) => `
                <tr>
                  <td><span class="cell-strong">${escapeHtml(s.brand)} ${escapeHtml(s.name)}</span> <span class="tag ${escapeHtml(s.tier)}">${escapeHtml(s.tier)}</span><div class="cell-muted mono">${escapeHtml(s.id)}</div></td>
                  <td><input class="input input-sm w-xs" data-sys="${i}" data-f="seer2" type="number" step="0.1" min="10" max="30" value="${s.seer2}" aria-label="SEER2" /></td>
                  <td><input class="input input-sm w-xs" data-sys="${i}" data-f="noiseDb" type="number" min="40" max="90" value="${s.noiseDb}" aria-label="Noise dB" /></td>
                  <td><input class="input input-sm w-xs" data-sys="${i}" data-f="warrantyYears" type="number" min="1" max="25" value="${s.warrantyYears}" aria-label="Warranty years" /></td>
                  <td><input class="input input-sm w-sm" data-sys="${i}" data-f="baseInstalledPrice" type="number" min="1" max="100000" value="${s.baseInstalledPrice}" aria-label="Base price" /></td>
                  <td><input class="input input-sm w-md" data-sys="${i}" data-f="tonnageOptions" value="${s.tonnageOptions.join(', ')}" aria-label="Tonnage options" /></td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </section>
      <section class="wide-card">
        <div class="card-head"><div><h2 class="card-title">Add-ons</h2><p class="card-sub">${catalog.addOns.length} optional upgrades</p></div></div>
        <div class="table-wrap">
          <table class="data">
            <thead><tr><th>Add-on</th><th>Category</th><th>Price $</th></tr></thead>
            <tbody>
              ${catalog.addOns.map((a, i) => `
                <tr>
                  <td><span class="cell-strong">${escapeHtml(a.name)}</span><div class="cell-muted mono">${escapeHtml(a.id)}</div></td>
                  <td class="cell-muted">${escapeHtml(a.category)}</td>
                  <td><input class="input input-sm w-sm" data-addon="${i}" type="number" min="0" max="50000" value="${a.price}" aria-label="Price" /></td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </section>`);
    host().querySelectorAll('[data-sys]').forEach((inp) => inp.addEventListener('input', () => {
      const s = catalog.systems[Number(inp.dataset.sys)];
      if (inp.dataset.f === 'tonnageOptions') s.tonnageOptions = inp.value.split(',').map((x) => Number(x.trim())).filter((n) => n >= 1 && n <= 7.5);
      else s[inp.dataset.f] = Number(inp.value);
    }));
    host().querySelectorAll('[data-addon]').forEach((inp) => inp.addEventListener('input', () => {
      catalog.addOns[Number(inp.dataset.addon)].price = Number(inp.value);
    }));
    $('cat-save').addEventListener('click', saveCatalog);
  });
}

function saveCatalog() {
  const diffs = [];
  catalog.systems.forEach((s) => {
    const o = catalogOriginal.systems.find((x) => x.id === s.id);
    if (!o) return;
    ['seer2', 'noiseDb', 'warrantyYears', 'baseInstalledPrice'].forEach((f) => {
      if (o[f] !== s[f]) diffs.push(`<div><b>${escapeHtml(s.id)}</b> ${f}: ${o[f]} → <span class="chg">${s[f]}</span></div>`);
    });
    if (o.tonnageOptions.join() !== s.tonnageOptions.join()) diffs.push(`<div><b>${escapeHtml(s.id)}</b> tonnages: ${o.tonnageOptions.join('/')} → <span class="chg">${s.tonnageOptions.join('/')}</span></div>`);
  });
  catalog.addOns.forEach((a) => {
    const o = catalogOriginal.addOns.find((x) => x.id === a.id);
    if (o && o.price !== a.price) diffs.push(`<div>Add-on <b>${escapeHtml(a.id)}</b>: $${o.price} → <span class="chg">$${a.price}</span></div>`);
  });
  if (!diffs.length) { toast('No changes to save.'); return; }
  confirmModal('Save catalog changes?', diffs.join(''), async () => {
    try {
      await api('/api/admin/catalog', { method: 'PUT', body: { brands: catalog.brands, systems: catalog.systems, addOns: catalog.addOns } });
      catalogOriginal = clone(catalog);
      toast('Catalog saved to config/catalog.json', 'ok');
    } catch (err) { toast(errMessage(err), 'error', 6000); }
  });
}

/* ---------------- Pricing rules ---------------- */
async function renderPricing() {
  const data = await api('/api/admin/pricing-rules');
  rules = clone(data.pricingRules);
  rulesOriginal = clone(data.pricingRules);
  swapStep(host(), () => {
    host().innerHTML = wrapTab(`
      <div class="card-head">
        <p class="card-sub">Server-side pricing inputs — every quote is recomputed from these values.</p>
        <button class="btn btn-dark" id="rules-save" type="button">${icon('check', 16)}<span class="btn-label">Save rules</span></button>
      </div>
      <div class="grid-2">
        <section class="wide-card stack">
          <h2 class="card-title">Core rates</h2>
          <label class="field"><span class="field-label">Sales tax %</span><input class="input" id="p-tax" type="number" step="0.01" min="0" max="25" value="${(rules.taxRate * 100).toFixed(3)}" /></label>
          <label class="field"><span class="field-label">Deposit %</span><input class="input" id="p-dep" type="number" step="1" min="1" max="100" value="${Math.round(rules.depositPercent * 100)}" /></label>
          <label class="field"><span class="field-label">Price-lock days</span><input class="input" id="p-lock" type="number" min="1" max="30" value="${rules.priceLockDays}" /></label>
          <label class="field"><span class="field-label">Sq ft per ton</span><input class="input" id="p-sqft" type="number" min="200" max="1200" value="${rules.sqftPerTon}" /></label>
        </section>
        <section class="wide-card stack">
          <h2 class="card-title">Service area</h2>
          <label class="field"><span class="field-label">Area label</span><input class="input" id="p-label" value="${escapeHtml(rules.serviceAreaLabel)}" /></label>
          <label class="field"><span class="field-label">ZIP codes (comma separated)</span><textarea class="input" id="p-zips" rows="6">${escapeHtml(rules.serviceAreaZips.join(', '))}</textarea></label>
          <p class="hint">${rules.serviceAreaZips.length} ZIPs in the demo service area.</p>
        </section>
        <section class="wide-card">
          <h2 class="card-title">Financing</h2>
          <p class="card-sub">Term months · APR %</p>
          <div class="mt-16">${rules.financing.terms.map((t, i) => `
            <div class="term-row">
              <input class="input input-sm" data-term="${i}" data-f="months" type="number" min="3" max="120" value="${t.months}" aria-label="Months" />
              <input class="input input-sm" data-term="${i}" data-f="apr" type="number" step="0.01" min="0" max="35" value="${(t.apr * 100).toFixed(2)}" aria-label="APR percent" />
            </div>`).join('')}</div>
          <p class="card-sub mt-16">Mock lender · budget ratios (approve ≤ / review ≤)</p>
          <div class="term-row mt-16">
            <input class="input input-sm" id="p-approve" type="number" step="0.05" min="0.1" max="3" value="${rules.financing.mockRules.approveUpToBudgetRatio}" aria-label="Approve ratio" />
            <input class="input input-sm" id="p-review" type="number" step="0.05" min="0.1" max="3" value="${rules.financing.mockRules.reviewUpToBudgetRatio}" aria-label="Review ratio" />
          </div>
        </section>
        <section class="wide-card">
          <h2 class="card-title">Size adjustments</h2>
          <p class="card-sub">Home-size multipliers · max sq ft (blank = no cap)</p>
          <div class="mt-16">${rules.homeSizeMultipliers.map((m, i) => `
            <div class="mult-row">
              <input class="input input-sm" data-mult="${i}" data-f="maxSqft" type="number" placeholder="no cap" value="${m.maxSqft === null ? '' : m.maxSqft}" aria-label="Max sq ft" />
              <input class="input input-sm" data-mult="${i}" data-f="multiplier" type="number" step="0.01" min="0.5" max="2" value="${m.multiplier}" aria-label="Multiplier" />
            </div>`).join('')}</div>
          <p class="card-sub mt-16">Tonnage price deltas ($)</p>
          <div class="mt-16">${Object.entries(rules.tonnagePriceDelta).map(([k, v]) => `
            <div class="ton-row"><span>${escapeHtml(k)} t</span><input class="input input-sm" data-tons="${escapeHtml(k)}" type="number" step="50" value="${v}" aria-label="Delta for ${escapeHtml(k)} tons" /></div>`).join('')}</div>
        </section>
      </div>`);
    host().querySelectorAll('[data-term]').forEach((inp) => inp.addEventListener('input', () => {
      const t = rules.financing.terms[Number(inp.dataset.term)];
      if (inp.dataset.f === 'months') t.months = Number(inp.value);
      else t.apr = Number(inp.value) / 100;
    }));
    host().querySelectorAll('[data-mult]').forEach((inp) => inp.addEventListener('input', () => {
      const m = rules.homeSizeMultipliers[Number(inp.dataset.mult)];
      if (inp.dataset.f === 'maxSqft') m.maxSqft = inp.value === '' ? null : Number(inp.value);
      else m.multiplier = Number(inp.value);
    }));
    host().querySelectorAll('[data-tons]').forEach((inp) => inp.addEventListener('input', () => {
      rules.tonnagePriceDelta[inp.dataset.tons] = Number(inp.value);
    }));
    $('rules-save').addEventListener('click', saveRules);
  });
}

function saveRules() {
  const next = {
    currency: 'USD',
    taxRate: Number($('p-tax').value) / 100,
    depositPercent: Number($('p-dep').value) / 100,
    priceLockDays: Number($('p-lock').value),
    sqftPerTon: Number($('p-sqft').value),
    serviceAreaLabel: $('p-label').value.trim(),
    serviceAreaZips: [...new Set($('p-zips').value.split(/[\s,]+/).map((z) => z.trim()).filter(Boolean))],
    homeSizeMultipliers: rules.homeSizeMultipliers,
    tonnagePriceDelta: rules.tonnagePriceDelta,
    financing: {
      terms: rules.financing.terms,
      mockRules: { approveUpToBudgetRatio: Number($('p-approve').value), reviewUpToBudgetRatio: Number($('p-review').value) },
    },
  };
  const o = rulesOriginal;
  const diffs = [];
  if (next.taxRate !== o.taxRate) diffs.push(`<div>Tax rate: ${(o.taxRate * 100).toFixed(3)}% → <span class="chg">${(next.taxRate * 100).toFixed(3)}%</span></div>`);
  if (next.depositPercent !== o.depositPercent) diffs.push(`<div>Deposit: ${Math.round(o.depositPercent * 100)}% → <span class="chg">${Math.round(next.depositPercent * 100)}%</span></div>`);
  if (next.priceLockDays !== o.priceLockDays) diffs.push(`<div>Lock days: ${o.priceLockDays} → <span class="chg">${next.priceLockDays}</span></div>`);
  if (next.sqftPerTon !== o.sqftPerTon) diffs.push(`<div>Sq ft per ton: ${o.sqftPerTon} → <span class="chg">${next.sqftPerTon}</span></div>`);
  if (next.serviceAreaLabel !== o.serviceAreaLabel) diffs.push('<div>Service-area label changed</div>');
  if (next.serviceAreaZips.join() !== o.serviceAreaZips.join()) diffs.push(`<div>Service ZIPs: ${o.serviceAreaZips.length} → <span class="chg">${next.serviceAreaZips.length}</span></div>`);
  if (JSON.stringify(next.financing) !== JSON.stringify(o.financing)) diffs.push('<div>Financing terms / lender rules changed</div>');
  if (JSON.stringify(next.homeSizeMultipliers) !== JSON.stringify(o.homeSizeMultipliers)) diffs.push('<div>Home-size multipliers changed</div>');
  if (JSON.stringify(next.tonnagePriceDelta) !== JSON.stringify(o.tonnagePriceDelta)) diffs.push('<div>Tonnage deltas changed</div>');
  if (!diffs.length) { toast('No changes to save.'); return; }
  confirmModal('Save pricing rules?', diffs.join(''), async () => {
    try {
      await api('/api/admin/pricing-rules', { method: 'PUT', body: next });
      rulesOriginal = clone(next);
      toast('Pricing rules saved to config/pricing-rules.json', 'ok');
    } catch (err) { toast(errMessage(err), 'error', 6000); }
  });
}

/* ---------------- Integrations ---------------- */
async function renderIntegrations() {
  const { integrations, note } = await api('/api/admin/integrations');
  swapStep(host(), () => {
    host().innerHTML = wrapTab(`
      <div class="notice info">${icon('sparkle', 17)}<div class="js-note"></div></div>
      <div class="int-grid">
        ${integrations.map((i) => `
          <article class="int-card">
            <div class="int-top">
              <span class="int-name">${escapeHtml(i.domain)}</span>
              <span class="badge ${i.mode === 'live' ? 'live' : 'mock'}">${escapeHtml(i.mode)}</span>
              <span class="int-src">${i.source === 'override' ? 'runtime override' : 'from env'}</span>
            </div>
            <div class="env-list">
              ${i.requiredEnv.length
                ? i.requiredEnv.map((k) => `<span class="${i.liveConfigured ? 'set' : 'missing'}">${i.liveConfigured ? '✓' : '•'} ${escapeHtml(k)}</span>`).join('')
                : '<span>No live provider wired yet — interface ready.</span>'}
            </div>
            <button class="btn btn-sand btn-sm" data-toggle="${escapeHtml(i.domain)}" data-to="${i.mode === 'mock' ? 'live' : 'mock'}" type="button"><span class="btn-label">Switch to ${i.mode === 'mock' ? 'live' : 'mock'}</span></button>
          </article>`).join('')}
      </div>`);
    host().querySelector('.js-note').textContent = note;
    host().querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', async () => {
      b.classList.add('loading');
      try {
        await api('/api/admin/integrations', { method: 'POST', body: { domain: b.dataset.toggle, mode: b.dataset.to } });
        toast(`${b.dataset.toggle} → ${b.dataset.to}`, 'ok');
        renderIntegrations().catch((err) => toast(err.message, 'error'));
      } catch (err) {
        b.classList.remove('loading');
        toast(err.message, 'error', 6000);
      }
    }));
  });
}

/* ---------------- Audit ---------------- */
async function renderAudit() {
  const { entries } = await api('/api/admin/audit');
  swapStep(host(), () => {
    host().innerHTML = wrapTab(`
      <section class="sheet sheet-flat">
        ${entries.length ? `
        <div class="table-wrap">
          <table class="data">
            <thead><tr><th>Time</th><th>Event</th><th>Actor</th><th>Summary</th></tr></thead>
            <tbody>
              ${entries.map((e) => `<tr><td class="cell-muted mono">${fmtDateTime(e.ts)}</td><td><span class="badge neutral">${escapeHtml(e.type)}</span></td><td>${escapeHtml(e.actor)}</td><td>${escapeHtml(e.summary)}</td></tr>`).join('')}
            </tbody>
          </table>
        </div>` : `<div class="empty"><span class="empty-ic">${icon('file', 24)}</span><b>No audit entries yet</b><p>Locks, payments and admin edits will appear here.</p></div>`}
      </section>`);
  });
}

/* ---------------- Boot ---------------- */
(async function init() {
  try {
    const chrome = await bootChrome({ title: 'Admin Console', active: 'admin', requireRoles: ['admin'] });
    chrome.setPill('Changes write to config JSON', 'settings');
    const tabs = $('tabs');
    const renderers = { catalog: renderCatalog, pricing: renderPricing, integrations: renderIntegrations, audit: renderAudit };
    setSeg(tabs, 0);
    tabs.querySelectorAll('button').forEach((b, i) => b.addEventListener('click', () => {
      setSeg(tabs, i);
      renderers[b.dataset.tab]().catch((err) => toast(err.message, 'error'));
    }));
    await renderCatalog();
  } catch (err) {
    if (err && err.message === 'redirect') return;
    toast('Failed to load the admin console.', 'error');
  }
})();
