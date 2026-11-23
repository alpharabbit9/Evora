# CommerceCore API and worker (ADR 0024). One image, two commands:
#   docker run … commercecore-api                    → the HTTP API (dist/server.js)
#   docker run … commercecore-api node dist/worker.js → the outbox worker
# and a separate `migrate` target that carries the Prisma CLI, run once per release before the
# new API starts (architecture.md §15: migrations are not run by each app instance at boot).
#
# Configuration comes only from the environment at run time; nothing secret is built in.

ARG NODE_IMAGE=node:24-bookworm-slim

# Prisma detects the platform's OpenSSL; the slim image has none and Prisma warns without it.
FROM ${NODE_IMAGE} AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# ── Build: full dependencies, generated Prisma client, compiled JavaScript ───────────────────
FROM base AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY prisma ./prisma
COPY prisma.config.ts tsconfig.json tsconfig.build.json ./
# `prisma generate` reads the schema only; any syntactically valid URL satisfies the config.
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npx prisma generate
COPY src ./src
RUN npm run build
# Drop dev dependencies; the generated client in node_modules/.prisma stays.
RUN npm prune --omit=dev

# ── Migrate: one-shot `prisma migrate deploy` for a release ──────────────────────────────────
FROM base AS migrate
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci
COPY prisma ./prisma
COPY prisma.config.ts ./
USER node
CMD ["npx", "prisma", "migrate", "deploy"]

# ── Runtime: compiled code and production dependencies only, as a non-root user ──────────────
FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
# The shopping assistant's policy text, which the worker's index sweep embeds (ADR 0025).
COPY --chown=node:node content ./content
USER node
EXPOSE 4000
# Liveness without a database round-trip; orchestrators should use /api/v1/readyz for readiness.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/v1/livez').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
