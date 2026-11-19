'use strict';
/**
 * In-memory retry queue with exponential backoff + jitter and a failure log.
 * Used for CRM / email / SMS calls so a failing third party never blocks a customer.
 * Replace with BullMQ / SQS / a DB-backed queue when you need durability.
 */
const config = require('../config');
const log = require('./logger');

const jobs = [];
const failures = [];
let nextId = 1;
let pending = 0;
let idleWaiters = [];

function settle() {
  if (pending === 0) { idleWaiters.forEach((r) => r()); idleWaiters = []; }
}

function enqueue(name, fn, opts = {}) {
  const maxAttempts = opts.maxAttempts || config.queue.maxAttempts;
  const baseDelayMs = opts.baseDelayMs ?? config.queue.baseDelayMs;
  const maxDelayMs = opts.maxDelayMs ?? config.queue.maxDelayMs;
  const job = { id: nextId++, name, ref: opts.ref || null, status: 'queued', attempts: 0, createdAt: new Date().toISOString(), lastError: null, nextAttemptAt: null };
  jobs.push(job);
  if (jobs.length > 500) jobs.shift();
  pending++;

  const run = async () => {
    job.attempts++;
    job.status = 'running';
    try {
      await fn();
      job.status = 'done';
      job.nextAttemptAt = null;
      pending--; settle();
    } catch (err) {
      job.lastError = log.redactString(err && err.message ? err.message : String(err)).slice(0, 300);
      if (job.attempts >= maxAttempts) {
        job.status = 'failed';
        failures.push({ ts: new Date().toISOString(), job: name, ref: job.ref, attempts: job.attempts, error: job.lastError });
        if (failures.length > 500) failures.shift();
        log.error(`queue job failed permanently: ${name}`, { attempts: job.attempts, error: job.lastError });
        pending--; settle();
      } else {
        const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** (job.attempts - 1));
        const jittered = Math.round(delay * (0.75 + Math.random() * 0.25));
        job.status = 'retrying';
        job.nextAttemptAt = new Date(Date.now() + jittered).toISOString();
        log.warn(`queue job retry scheduled: ${name}`, { attempt: job.attempts, inMs: jittered });
        setTimeout(run, jittered);
      }
    }
  };
  setImmediate(run); // never block the request that enqueued the job
  return job;
}

module.exports = {
  enqueue,
  jobs: () => jobs.slice(-100).reverse(),
  failures: () => failures.slice().reverse(),
  idle: () => (pending === 0 ? Promise.resolve() : new Promise((r) => idleWaiters.push(r))),
};
