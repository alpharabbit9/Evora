import express, { type Express } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** The session is the only thing stubbed; the guards, route adapter and error envelope are real. */
const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));

vi.mock('../src/lib/auth.js', () => ({ auth: { api: { getSession } } }));

const { errorHandler, notFoundHandler } = await import('../src/http/error-handler.js');
const { requestContext } = await import('../src/http/request-context.js');
const { route } = await import('../src/http/route.js');
const {
  actorOf,
  assertOwner,
  hasAtLeastRole,
  requireAdmin,
  requireAuth,
  requireSuperadmin,
  roleRank,
  toRole,
  withActor,
} = await import('../src/http/guards.js');
const { AppError } = await import('../src/http/errors.js');

type Actor = ReturnType<typeof actorOf>;

function sessionFor(overrides: Record<string, unknown> = {}): unknown {
  return {
    session: { id: 'sess_1' },
    user: {
      id: 'user_1',
      email: 'shopper@example.com',
      role: 'CUSTOMER',
      status: 'ACTIVE',
      ...overrides,
    },
  };
}

function actor(overrides: Partial<Actor> = {}): Actor {
  return {
    id: 'user_1',
    email: 'shopper@example.com',
    role: 'CUSTOMER',
    isAdmin: false,
    sessionId: 'sess_1',
    ...overrides,
  };
}

const app: Express = (() => {
  const instance = express();
  instance.use(requestContext);

  instance.get('/me', requireAuth, route({ handler: ({ req }) => actorOf(req) }));

  instance.get(
    '/admin/reports',
    requireAdmin,
    route({ handler: ({ req }) => ({ for: actorOf(req).id }) }),
  );

  instance.get(
    '/admin/roles',
    requireSuperadmin,
    route({ handler: ({ req }) => ({ for: actorOf(req).id }) }),
  );

  instance.get(
    '/catalog',
    withActor,
    route({ handler: ({ req }) => ({ signedIn: req.actor !== undefined }) }),
  );

  // Deliberately unguarded: proves a forgotten guard fails closed instead of
  // acting for an anonymous caller.
  instance.get('/unguarded', route({ handler: ({ req }) => actorOf(req) }));

  instance.use(notFoundHandler);
  instance.use(errorHandler);
  return instance;
})();

beforeEach(() => {
  getSession.mockReset();
});

describe('requireAuth', () => {
  it('answers 401 when there is no session', async () => {
    getSession.mockResolvedValue(null);

    const res = await request(app).get('/me');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('exposes the session user as the actor', async () => {
    getSession.mockResolvedValue(sessionFor());

    const res = await request(app).get('/me');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      id: 'user_1',
      email: 'shopper@example.com',
      role: 'CUSTOMER',
      isAdmin: false,
      sessionId: 'sess_1',
    });
  });

  it('refuses a suspended account', async () => {
    getSession.mockResolvedValue(sessionFor({ status: 'SUSPENDED' }));

    const res = await request(app).get('/me');

    expect(res.status).toBe(403);
    expect(res.body.error.message).toContain('suspended');
  });

  it('fails closed when the session carries no recognisable status', async () => {
    getSession.mockResolvedValue(sessionFor({ status: undefined }));

    const res = await request(app).get('/me');

    expect(res.status).toBe(403);
  });
});

describe('requireAdmin', () => {
  it('denies a customer', async () => {
    getSession.mockResolvedValue(sessionFor());

    const res = await request(app).get('/admin/reports');

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('allows an admin', async () => {
    getSession.mockResolvedValue(sessionFor({ id: 'user_admin', role: 'ADMIN' }));

    const res = await request(app).get('/admin/reports');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ for: 'user_admin' });
  });

  it('treats an unrecognised role as the least privileged one', async () => {
    getSession.mockResolvedValue(sessionFor({ role: 'admin' }));

    const res = await request(app).get('/admin/reports');

    expect(res.status).toBe(403);
  });
});

describe('withActor', () => {
  it('lets an anonymous caller through', async () => {
    getSession.mockResolvedValue(null);

    const res = await request(app).get('/catalog');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ signedIn: false });
  });

  it('attaches the actor when a session exists', async () => {
    getSession.mockResolvedValue(sessionFor());

    const res = await request(app).get('/catalog');

    expect(res.body.data).toEqual({ signedIn: true });
  });
});

describe('actorOf', () => {
  it('answers 401 rather than acting without a guard', async () => {
    getSession.mockResolvedValue(sessionFor());

    const res = await request(app).get('/unguarded');

    expect(res.status).toBe(401);
    expect(getSession).not.toHaveBeenCalled();
  });
});

describe('assertOwner', () => {
  it('passes for the owner', () => {
    expect(() => {
      assertOwner('user_1', actor());
    }).not.toThrow();
  });

  it('hides someone else resource behind a 404 by default', () => {
    try {
      assertOwner('user_2', actor());
      expect.unreachable('expected assertOwner to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as InstanceType<typeof AppError>).status).toBe(404);
    }
  });

  it('can answer 403 where the resource is known to exist', () => {
    try {
      assertOwner('user_2', actor(), { reveal: true });
      expect.unreachable('expected assertOwner to throw');
    } catch (error) {
      expect((error as InstanceType<typeof AppError>).code).toBe('FORBIDDEN');
    }
  });

  it('does not let an admin through unless the call opts in', () => {
    const admin = actor({ id: 'user_admin', role: 'ADMIN', isAdmin: true });

    expect(() => {
      assertOwner('user_1', admin);
    }).toThrow();
    expect(() => {
      assertOwner('user_1', admin, { allowAdmin: true });
    }).not.toThrow();
  });
});

describe('the role ladder', () => {
  it('ranks customer below admin below superadmin', () => {
    expect(roleRank('CUSTOMER')).toBeLessThan(roleRank('ADMIN'));
    expect(roleRank('ADMIN')).toBeLessThan(roleRank('SUPERADMIN'));
  });

  it('treats an unknown or missing role as the least privileged one', () => {
    // Fail closed: a role the server does not recognise must never be read as elevated.
    expect(toRole('admin')).toBe('CUSTOMER');
    expect(toRole('OWNER')).toBe('CUSTOMER');
    expect(toRole(undefined)).toBe('CUSTOMER');
    expect(toRole(null)).toBe('CUSTOMER');
    expect(toRole(42)).toBe('CUSTOMER');
    expect(toRole({ role: 'ADMIN' })).toBe('CUSTOMER');
  });

  it('reads a known role faithfully', () => {
    expect(toRole('ADMIN')).toBe('ADMIN');
    expect(toRole('SUPERADMIN')).toBe('SUPERADMIN');
  });

  it('answers a minimum, not an exact match', () => {
    const admin = actor({ role: 'ADMIN', isAdmin: true });
    const owner = actor({ role: 'SUPERADMIN', isAdmin: true });

    expect(hasAtLeastRole(actor(), 'ADMIN')).toBe(false);
    expect(hasAtLeastRole(admin, 'ADMIN')).toBe(true);
    expect(hasAtLeastRole(owner, 'ADMIN')).toBe(true);
    expect(hasAtLeastRole(admin, 'SUPERADMIN')).toBe(false);
    expect(hasAtLeastRole(owner, 'SUPERADMIN')).toBe(true);
  });
});

describe('requireSuperadmin', () => {
  it('denies an admin', async () => {
    getSession.mockResolvedValue(sessionFor({ id: 'user_admin', role: 'ADMIN' }));

    const res = await request(app).get('/admin/roles');

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('allows a superadmin', async () => {
    getSession.mockResolvedValue(sessionFor({ id: 'user_owner', role: 'SUPERADMIN' }));

    const res = await request(app).get('/admin/roles');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ for: 'user_owner' });
  });

  it('answers 401, not 403, without a session', async () => {
    getSession.mockResolvedValue(null);

    const res = await request(app).get('/admin/roles');

    expect(res.status).toBe(401);
  });
});

describe('requireAdmin', () => {
  it('admits a superadmin, because the ladder is a minimum', async () => {
    getSession.mockResolvedValue(sessionFor({ id: 'user_owner', role: 'SUPERADMIN' }));

    const res = await request(app).get('/admin/reports');

    expect(res.status).toBe(200);
  });

  it('marks a superadmin as an admin on the actor', async () => {
    getSession.mockResolvedValue(sessionFor({ role: 'SUPERADMIN' }));

    const res = await request(app).get('/me');

    expect(res.body.data.isAdmin).toBe(true);
    expect(res.body.data.role).toBe('SUPERADMIN');
  });
});

describe('internal failures are not disguised as 401', () => {
  it('answers 500 when the session store cannot be reached', async () => {
    // An unauthenticated caller and a broken session store are different problems; a 401
    // here would send the user to sign in again over a database outage.
    getSession.mockRejectedValue(new Error('connection terminated unexpectedly'));

    const res = await request(app).get('/me');

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    // The client gets generic wording and no stack trace. The `debug` field alongside it is
    // the error middleware's development-only aid and is absent when NODE_ENV=production.
    expect(res.body.error.message).toBe('The request could not be processed.');
    expect(JSON.stringify(res.body)).not.toMatch(/node_modules|at Object|\.ts:/);
  });
});
