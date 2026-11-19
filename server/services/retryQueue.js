'use strict';
/**
 * retryQueue — in-memory background job queue with exponential backoff.
 * External side effects (CRM, email, SMS) are enqueued here so a failing
 * integration NEVER blocks or fails the customer-facing request. After
 * MAX_ATTEMPTS the failure is written to the audit log.
 */
const crypto = require('crypto');
const logger = require('../logger');
const store = require('./store');

const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = Number(process.env.RETRY_BASE_DELAY_MS || 2000); // demo-friendly; raise in prod

const g = (globalThis.__airedirect = globalThis.__airedirect || {});
g.retryQueue = g.retryQueue || { jobs: [], timer: null, running: false };
const queue = g.retryQueue;

function enqueue(name, fn, meta = {}) {
  queue.jobs.push({
    id: `job_${crypto.randomBytes(5).toString('hex')}`,
    name,
    fn,
    meta,
    attempt: 0,
    nextRun: Date.now(),
  });
  schedule();
  return true;
}

function schedule() {
  if (queue.timer) return;
  queue.timer = setTimeout(runDue, 250);
  if (queue.timer.unref) queue.timer.unref();
}

async function runDue() {
  queue.timer = null;
  if (queue.running) return;
  queue.running = true;
  try {
    const now = Date.now();
    const due = queue.jobs.filter((j) => j.nextRun <= now);
    for (const job of due) {
      queue.jobs.splice(queue.jobs.indexOf(job), 1);
      job.attempt += 1;
      try {
        await job.fn();
        logger.info('integration_job_ok', { name: job.name, attempt: job.attempt });
      } catch (err) {
        logger.warn('integration_job_failed', {
          name: job.name,
          attempt: job.attempt,
          error: err && err.message,
        });
        if (job.attempt >= MAX_ATTEMPTS) {
          store.addAudit({
            type: 'INTEGRATION_FAILED',
            actor: 'system',
            summary: `${job.name} failed permanently after ${job.attempt} attempts`,
            meta: { error: err && err.message },
          });
        } else {
          job.nextRun = Date.now() + BASE_DELAY_MS * 2 ** (job.attempt - 1); // 2s, 4s, 8s, 16s…
          queue.jobs.push(job);
        }
      }
    }
  } finally {
    queue.running = false;
    if (queue.jobs.length) schedule();
  }
}

function pendingCount() {
  return queue.jobs.length;
}

module.exports = { enqueue, pendingCount, MAX_ATTEMPTS };
