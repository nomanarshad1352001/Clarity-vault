'use strict';
/** Small fetch wrapper for live adapters: timeout, JSON, and errors that never echo secrets. */

async function request(url, { method = 'GET', headers = {}, body, timeoutMs = 8000, form = false } = {}) {
  const res = await fetch(url, {
    method,
    headers: { Accept: 'application/json', ...(body && !form ? { 'Content-Type': 'application/json' } : {}), ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}), ...headers },
    body: body ? (form ? new URLSearchParams(body).toString() : JSON.stringify(body)) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 200) }; }
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} from ${new URL(url).host}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

/** Returns true with probability MOCK_FAILURE_RATE (0..1) - lets you demo the retry queue in mock mode. */
function shouldMockFail() {
  const rate = parseFloat(process.env.MOCK_FAILURE_RATE || '0');
  return rate > 0 && Math.random() < rate;
}

module.exports = { request, shouldMockFail };
