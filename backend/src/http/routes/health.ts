import { Router } from 'express';

import { prisma } from '../../lib/prisma.js';
import { route } from '../route.js';

export const healthRouter = Router();

/** Liveness: no database round-trip, so it stays answerable under DB pressure. */
healthRouter.get(
  '/livez',
  route({
    handler: () => ({ status: 'ok' }),
  }),
);

/** Readiness: proves the process can actually reach PostgreSQL. */
healthRouter.get(
  '/readyz',
  route({
    handler: async () => {
      await prisma.$queryRaw`SELECT 1`;
      return { status: 'ready', database: 'reachable' };
    },
  }),
);
