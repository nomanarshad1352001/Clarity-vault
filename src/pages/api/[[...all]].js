/**
 * Next.js host adapter: every /api/* request is handed to the Express app.
 * The Express app is the real backend; this file only exists so the app can
 * run inside the platform's `next start` runtime. Running
 * `node server/index.js` serves the exact same app without Next.js.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
import appModule from '../../../server/app';

const app = appModule;

export const config = {
  api: {
    bodyParser: false, // Express does its own parsing (incl. raw Stripe webhook bodies)
    externalResolver: true,
  },
};

export default function handler(req, res) {
  return app(req, res);
}
