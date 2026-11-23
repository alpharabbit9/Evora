/**
 * Vercel entry point (ADR 0028, docs/runbooks/vercel.md).
 *
 * `vercel.json` rewrites every path to this one function, which serves the whole Express app with
 * the request's original URL. The app is the compiled `dist/` that `npm run vercel-build` produces,
 * the same JavaScript `node dist/server.js` runs locally and in the container image, so Vercel never
 * has to compile the TypeScript itself.
 *
 * A function is never development: NODE_ENV defaults to production before the configuration is
 * read (an explicit value still wins, and `src/config/env.ts` refuses anything else on Vercel).
 * That is why the app is imported dynamically: a static import would be evaluated first.
 */
process.env.NODE_ENV ??= 'production';

const { createApp } = await import('../dist/app.js');

export default createApp();
