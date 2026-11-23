#!/usr/bin/env node
/**
 * The Vercel build (ADR 0028, docs/runbooks/vercel.md): `npm run build:vercel`, which
 * `vercel.json` names as the build command. Deliberately not called `vercel-build`: Vercel's Node
 * builder runs a script of that name again for the function, which would build twice and migrate
 * twice.
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
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// The CLIs' own entry files, run with this Node: no npx, no shell, the same on Windows and Linux.
const PRISMA = path.join(root, 'node_modules', 'prisma', 'build', 'index.js');
const TSC = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');

function run(script, args, env = process.env) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    stdio: 'inherit',
    env,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run(PRISMA, ['generate']);
run(TSC, ['-p', 'tsconfig.build.json']);

const production = process.env.VERCEL_ENV === 'production';
const skip = process.env.SKIP_DB_MIGRATIONS === 'true';

if (production && !skip) {
  const direct = process.env.DIRECT_DATABASE_URL?.trim();
  run(PRISMA, ['migrate', 'deploy'], {
    ...process.env,
    ...(direct ? { DATABASE_URL: direct } : {}),
  });
} else {
  process.stdout.write(
    `Skipping prisma migrate deploy (VERCEL_ENV=${process.env.VERCEL_ENV ?? 'unset'}` +
      `${skip ? ', SKIP_DB_MIGRATIONS=true' : ''}).\n`,
  );
}
