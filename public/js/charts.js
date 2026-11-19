/* Dependency-free warm editorial chart helpers (DOM/SVG, CSP-safe). */
(function () {
  'use strict';
  const { h } = App;
  const NS = 'http://www.w3.org/2000/svg';
  const svg = (tag, attrs = {}) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };

  function barChart(el, bars) {
    const max = Math.max(1, ...bars.map((b) => b.value));
    if (!bars.some((b) => b.value > 0)) { el.replaceChildren(h('div', { class: 'empty' }, 'No quotes in this period.')); return; }
    el.replaceChildren(h('div', { class: 'bars' }, bars.map((b, i) => {
      const bar = h('i', {}); bar.style.height = `${Math.max(3, (b.value / max) * 100)}%`; bar.style.setProperty('--i', i);
      return h('div', { class: 'bar-col' }, h('span', { class: 'tip' }, b.tip || String(b.value)), bar, h('em', {}, i % 2 === 0 ? b.label : ''));
    })));
  }

  function donut(el, segments, centerLabel) {
    const total = segments.reduce((s, x) => s + x.value, 0);
    if (!total) { el.replaceChildren(h('div', { class: 'empty' }, 'No data yet.')); return; }
    const R = 54; const C = 2 * Math.PI * R; let acc = 0;
    const s = svg('svg', { viewBox: '0 0 140 140', class: 'donut', role: 'img', 'aria-label': 'Status distribution' });
    s.append(svg('circle', { cx: 70, cy: 70, r: R, stroke: '#efe3d6' }));
    for (const seg of segments) {
      if (!seg.value) continue;
      const len = (seg.value / total) * C;
      s.append(svg('circle', { class: 'seg-arc', cx: 70, cy: 70, r: R, stroke: seg.color, 'stroke-dasharray': `${len - 2} ${C - len + 2}`, 'stroke-dashoffset': -acc }));
      acc += len;
    }
    const mid = h('div', { class: 'mid' }, h('b', {}, String(total)), h('span', {}, centerLabel || 'total'));
    el.replaceChildren(h('div', { class: 'donut-wrap' }, h('div', { class: 'donut-center' }, s, mid),
      h('div', { class: 'legend' }, segments.map((x) => { const sw = h('i', {}); sw.style.background = x.color; return h('div', {}, sw, `${x.label}: `, h('b', {}, String(x.value))); }))));
  }

  function hbars(el, rows) {
    const max = Math.max(1, ...rows.map((r) => r.value));
    if (!rows.some((r) => r.value > 0)) { el.replaceChildren(h('div', { class: 'empty' }, 'No data yet.')); return; }
    el.replaceChildren(h('div', { class: 'hbar' }, rows.map((r, i) => {
      const fill = h('i', {}); fill.style.width = `${(r.value / max) * 100}%`; fill.style.setProperty('--i', i);
      return h('div', { class: 'r' }, h('div', {}, h('span', {}, r.label), h('b', {}, r.display || String(r.value))), h('div', { class: 't' }, fill));
    })));
  }

  window.Charts = { barChart, donut, hbars };
})();
