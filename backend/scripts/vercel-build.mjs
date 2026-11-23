#!/usr/bin/env node
/**
 * The Vercel build (ADR 0028, docs/runbooks/vercel.md): `npm run vercel-build`.
 *
 *   1. `prisma generate`: the client the API imports.
 *   2. `tsc -p tsconfig.build.json`: `dist/`, which `api/index.js` serves.
 *   3. `prisma migrate deploy`, on production builds only, and only after the code compiled.
 *
 * Migrations run here, once per release before the new deployment takes traffic, which is what
 * docs/runbooks/deploy.md asks for. A failed migration fails the build, so the previous deployment
 * keeps serving. Preview builds never migrate: they would otherwise change the production database
 * whenever a branch is pushed. Set SKIP_DB_MIGRATIONS=true to skip the step on a production build.
 *
 * Migrations need a direct connection (they take an advisory lock, which a transaction-mode pooler
 * cannot hold). DIRECT_DATABASE_URL, when set, is used for this step only; the running API keeps
 * using the pooled DATABASE_URL.
 */
import { spawnSync } from 'node:child_process';

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env,
    // npx is a .cmd shim on Windows; on Linux (where Vercel builds) no shell is involved.
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run('npx', ['prisma', 'generate']);
run('npx', ['tsc', '-p', 'tsconfig.build.json']);

const production = process.env.VERCEL_ENV === 'production';
const skip = process.env.SKIP_DB_MIGRATIONS === 'true';

if (production && !skip) {
  const direct = process.env.DIRECT_DATABASE_URL?.trim();
  run('npx', ['prisma', 'migrate', 'deploy'], {
    ...process.env,
    ...(direct ? { DATABASE_URL: direct } : {}),
  });
} else {
  process.stdout.write(
    `Skipping prisma migrate deploy (VERCEL_ENV=${process.env.VERCEL_ENV ?? 'unset'}` +
      `${skip ? ', SKIP_DB_MIGRATIONS=true' : ''}).\n`,
  );
}
