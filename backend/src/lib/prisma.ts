import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

import { env, isProduction } from '../config/env.js';

/**
 * Prisma 7 takes the connection through a driver adapter instead of a schema `url`.
 * One client per process; a single pool keeps transactions short and bounded.
 */
const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });

export const prisma = new PrismaClient({
  adapter,
  log: isProduction ? ['warn', 'error'] : ['warn', 'error'],
});

export type Db = typeof prisma;
