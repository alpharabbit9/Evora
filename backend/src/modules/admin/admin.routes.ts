import { Router } from 'express';

import { actorOf, requireAdmin, requireSuperadmin } from '../../http/guards.js';
import { paged, route } from '../../http/route.js';
import { idParams, pageMeta } from '../../http/schemas.js';
import { getOrderForAdmin } from '../orders/orders.service.js';
import {
  customerListQuery,
  updateCustomerRoleBody,
  updateCustomerStatusBody,
} from './admin.schemas.js';
import {
  type AdminActionContext,
  listCustomers,
  updateCustomerRole,
  updateCustomerStatus,
} from './customers.service.js';

/**
 * The admin subtree, `/api/v1/admin` (API_SPEC.md §8: "All routes require server-side admin
 * authorization").
 *
 * `requireAdmin` is applied to the router so authorization is the default for anything
 * mounted here, including an endpoint added later by someone who forgets. Routes that need
 * more than ADMIN add their own guard on top — `requireSuperadmin` on role assignment.
 *
 * SCOPE: product, category and inventory management are M3/M4 and are not implemented. When
 * they land they belong on this router, behind this guard, and their sensitive writes need
 * an audit row the way the two customer writes below do.
 */
export const adminRouter = Router();

adminRouter.use(requireAdmin);

/** Actor plus request metadata for the audit trail (invariant 8). */
function adminContext(req: Parameters<typeof actorOf>[0], requestId: string): AdminActionContext {
  const ipAddress = req.ip;

  return {
    actor: actorOf(req),
    requestId,
    ...(ipAddress === undefined ? {} : { ipAddress }),
  };
}

adminRouter.get(
  '/customers',
  route({
    query: customerListQuery,
    handler: async ({ query }) => {
      const { q, role, status, ...pagination } = query;
      const page = await listCustomers(pagination, {
        ...(q === undefined ? {} : { q }),
        ...(role === undefined ? {} : { role }),
        ...(status === undefined ? {} : { status }),
      });

      return paged(page.items, pageMeta(pagination, page.total));
    },
  }),
);

adminRouter.patch(
  '/customers/:userId/status',
  route({
    params: idParams('userId'),
    body: updateCustomerStatusBody,
    handler: ({ req, params, body, requestId }) =>
      updateCustomerStatus(params.userId, body.status, adminContext(req, requestId)),
  }),
);

/**
 * Granting a role is the one operation an ADMIN may not perform: if it could, an ADMIN
 * could mint more ADMINs and the ladder would mean nothing (PRD §4 FR-05, least privilege).
 */
adminRouter.patch(
  '/customers/:userId/role',
  requireSuperadmin,
  route({
    params: idParams('userId'),
    body: updateCustomerRoleBody,
    handler: ({ req, params, body, requestId }) =>
      updateCustomerRole(params.userId, body.role, adminContext(req, requestId)),
  }),
);

/** An admin may read any order; a customer reads only their own (`/api/v1/orders/:id`). */
adminRouter.get(
  '/orders/:orderId',
  route({
    params: idParams('orderId'),
    handler: ({ params }) => getOrderForAdmin(params.orderId),
  }),
);
