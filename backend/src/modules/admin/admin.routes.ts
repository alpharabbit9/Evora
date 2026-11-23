import { Router } from 'express';

import { actorOf, requireAdmin, requireSuperadmin } from '../../http/guards.js';
import { created, noContent, paged, respond, route } from '../../http/route.js';
import { idParams, idempotencyKey, pageMeta } from '../../http/schemas.js';
import { requestIdOf } from '../../http/request-context.js';
import { parseOrThrow } from '../../http/validation.js';
import {
  adminOrderListQuery,
  adminRefundBody,
  adminTransitionBody,
  holdResolutionBody,
} from '../orders/order-management.schemas.js';
import {
  recordCodCollection,
  resolveHeldPayment,
  transitionOrder,
} from '../orders/order-management.service.js';
import { getOrderForAdmin, listOrdersForAdmin } from '../orders/orders.service.js';
import { requestRefund } from '../refunds/refunds.service.js';
import {
  getConversationForAdmin,
  listConversationsForAdmin,
} from '../assistant/assistant-admin.service.js';
import { adminConversationListQuery } from '../assistant/assistant.schemas.js';
import {
  adminCategoryCreateBody,
  adminCategoryListQuery,
  adminCategoryUpdateBody,
  adminImageCreateBody,
  adminImageUpdateBody,
  adminProductCreateBody,
  adminProductListQuery,
  adminProductUpdateBody,
  adminVariantCreateBody,
  adminVariantUpdateBody,
} from './admin-catalog.schemas.js';
import {
  adminArchiveProduct,
  adminCreateImage,
  adminCreateProduct,
  adminCreateVariant,
  adminDeleteImage,
  adminGetProduct,
  adminListProducts,
  adminUpdateImage,
  adminUpdateProduct,
  adminUpdateVariant,
} from './admin-catalog.service.js';
import {
  adminCreateCategory,
  adminGetCategory,
  adminListCategories,
  adminUpdateCategory,
} from './admin-categories.service.js';
import {
  adminInventoryListQuery,
  adminMovementListQuery,
  adminStockAdjustmentBody,
} from '../inventory/inventory.schemas.js';
import {
  adminAdjustStock,
  adminGetVariantStock,
  adminListInventory,
  adminListMovements,
} from '../inventory/inventory.service.js';
import { getOverview } from '../analytics/analytics.service.js';
import { dateRangeQuery, resolveRange } from '../analytics/date-range.js';
import { exportOrders, orderExportQuery } from '../analytics/order-export.service.js';
import { auditLogQuery, listAuditLogs } from '../audit/audit-log.service.js';
import {
  adminCouponCreateBody,
  adminCouponListQuery,
  adminCouponUpdateBody,
} from '../coupons/coupons.schemas.js';
import { createCoupon, getCoupon, listCoupons, updateCoupon } from '../coupons/coupons.service.js';
import {
  getStoreSettings,
  storeSettingsBody,
  updateStoreSettings,
} from '../settings/settings.service.js';
import { adminBulkRetryBody, adminJobListQuery } from '../jobs/jobs.schemas.js';
import { jobSummary, listJobs, retryDeadJobs, retryJob } from '../jobs/jobs.service.js';
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
 * Catalog and category management (M3) are implemented below. Every sensitive write records
 * an audit row in the same transaction as the change (invariant 8).
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

// ---------------------------------------------------------------------------
// Orders, fulfilment and refunds (M8, ADR 0020)
// ---------------------------------------------------------------------------

adminRouter.get(
  '/orders',
  route({
    query: adminOrderListQuery,
    handler: async ({ query }) => {
      const { q, status, paymentStatus, paymentMethod, ...pagination } = query;
      const page = await listOrdersForAdmin(pagination, {
        ...(q === undefined ? {} : { q }),
        ...(status === undefined ? {} : { status }),
        ...(paymentStatus === undefined ? {} : { paymentStatus }),
        ...(paymentMethod === undefined ? {} : { paymentMethod }),
      });
      return paged(page.items, pageMeta(pagination, page.total));
    },
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

adminRouter.post(
  '/orders/:orderId/transitions',
  route({
    params: idParams('orderId'),
    body: adminTransitionBody,
    handler: ({ req, params, body, requestId }) =>
      transitionOrder(params.orderId, body, adminContext(req, requestId)),
  }),
);

adminRouter.post(
  '/orders/:orderId/cod-collection',
  route({
    params: idParams('orderId'),
    handler: ({ req, params, requestId }) =>
      recordCodCollection(params.orderId, adminContext(req, requestId)),
  }),
);

/**
 * `Idempotency-Key` is required: a refund repeated because a response was lost must find the first
 * refund, not make a second one.
 */
adminRouter.post(
  '/orders/:orderId/refunds',
  route({
    params: idParams('orderId'),
    body: adminRefundBody,
    handler: async ({ req, params, body, requestId }) => {
      const key = parseOrThrow(idempotencyKey, req.get('idempotency-key'), 'Idempotency-Key');
      const { refund, replayed } = await requestRefund(
        params.orderId,
        key,
        body,
        adminContext(req, requestId),
      );

      return replayed ? respond(refund, { meta: { replayed: true } }) : created(refund);
    },
  }),
);

adminRouter.post(
  '/payments/:paymentId/hold-resolution',
  route({
    params: idParams('paymentId'),
    body: holdResolutionBody,
    handler: ({ req, params, body, requestId }) =>
      resolveHeldPayment(params.paymentId, body.decision, body.note, adminContext(req, requestId)),
  }),
);

// ---------------------------------------------------------------------------
// Overview, reports and the audit log (M10, ADR 0022)
// ---------------------------------------------------------------------------

adminRouter.get(
  '/overview',
  route({
    query: dateRangeQuery,
    handler: ({ query }) => getOverview(resolveRange(query, { defaultDays: 30 })),
  }),
);

/**
 * A file, not the JSON envelope. `no-store`: it holds customers' email addresses, and a shared
 * cache or the browser's disk cache has no business keeping a copy.
 */
adminRouter.get('/reports/orders.csv', async (req, res) => {
  const query = parseOrThrow(orderExportQuery, req.query, 'query');
  const { filename, csv } = await exportOrders(query, adminContext(req, requestIdOf(res)));

  res
    .status(200)
    .set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    })
    .send(csv);
});

adminRouter.get(
  '/audit-logs',
  route({
    query: auditLogQuery,
    handler: async ({ req, query }) => {
      const { page, pageSize, ...filters } = query;
      const result = await listAuditLogs({ page, pageSize }, filters, actorOf(req));
      return paged(result.items, pageMeta({ page, pageSize }, result.total));
    },
  }),
);

// ---------------------------------------------------------------------------
// Store settings (M10, ADR 0022)
// ---------------------------------------------------------------------------

adminRouter.get('/settings', route({ handler: () => getStoreSettings() }));

adminRouter.put(
  '/settings',
  route({
    body: storeSettingsBody,
    handler: ({ req, body, requestId }) => updateStoreSettings(body, adminContext(req, requestId)),
  }),
);

// ---------------------------------------------------------------------------
// Coupons (M10, ADR 0022)
// ---------------------------------------------------------------------------

adminRouter.get(
  '/coupons',
  route({
    query: adminCouponListQuery,
    handler: async ({ query }) => {
      const { q, state, ...pagination } = query;
      const page = await listCoupons(pagination, {
        ...(q === undefined ? {} : { q }),
        ...(state === undefined ? {} : { state }),
      });
      return paged(page.items, pageMeta(pagination, page.total));
    },
  }),
);

adminRouter.post(
  '/coupons',
  route({
    body: adminCouponCreateBody,
    handler: async ({ req, body, requestId }) =>
      created(await createCoupon(body, adminContext(req, requestId))),
  }),
);

adminRouter.get(
  '/coupons/:couponId',
  route({ params: idParams('couponId'), handler: ({ params }) => getCoupon(params.couponId) }),
);

adminRouter.patch(
  '/coupons/:couponId',
  route({
    params: idParams('couponId'),
    body: adminCouponUpdateBody,
    handler: ({ req, params, body, requestId }) =>
      updateCoupon(params.couponId, body, adminContext(req, requestId)),
  }),
);

// ---------------------------------------------------------------------------
// Background jobs: failed-job visibility and manual retry (M9, ADR 0021)
// ---------------------------------------------------------------------------

adminRouter.get(
  '/jobs',
  route({
    query: adminJobListQuery,
    handler: async ({ query }) => {
      const { status, type, ...pagination } = query;
      const page = await listJobs(pagination, {
        ...(status === undefined ? {} : { status }),
        ...(type === undefined ? {} : { type }),
      });
      return paged(page.items, pageMeta(pagination, page.total));
    },
  }),
);

adminRouter.get('/jobs/summary', route({ handler: () => jobSummary() }));

/** Every DEAD job (of one type), after the outage that killed them is over. */
adminRouter.post(
  '/jobs/retry',
  route({
    body: adminBulkRetryBody,
    handler: ({ req, body, requestId }) =>
      retryDeadJobs(
        { ...(body.type === undefined ? {} : { type: body.type }) },
        adminContext(req, requestId),
      ),
  }),
);

adminRouter.post(
  '/jobs/:jobId/retry',
  route({
    params: idParams('jobId'),
    handler: ({ req, params, requestId }) => retryJob(params.jobId, adminContext(req, requestId)),
  }),
);

// ---------------------------------------------------------------------------
// Catalog — products (M3)
// ---------------------------------------------------------------------------

adminRouter.get(
  '/products',
  route({
    query: adminProductListQuery,
    handler: async ({ query }) => {
      const { q, status, categoryId, gender, ...pagination } = query;
      const page = await adminListProducts(pagination, {
        ...(q === undefined ? {} : { q }),
        ...(status === undefined ? {} : { status }),
        ...(categoryId === undefined ? {} : { categoryId }),
        ...(gender === undefined ? {} : { gender }),
      });
      return paged(page.items, pageMeta(pagination, page.total));
    },
  }),
);

adminRouter.post(
  '/products',
  route({
    body: adminProductCreateBody,
    handler: async ({ req, body, requestId }) =>
      created(await adminCreateProduct(body, adminContext(req, requestId))),
  }),
);

adminRouter.get(
  '/products/:productId',
  route({
    params: idParams('productId'),
    handler: ({ params }) => adminGetProduct(params.productId),
  }),
);

adminRouter.patch(
  '/products/:productId',
  route({
    params: idParams('productId'),
    body: adminProductUpdateBody,
    handler: ({ req, params, body, requestId }) =>
      adminUpdateProduct(params.productId, body, adminContext(req, requestId)),
  }),
);

adminRouter.post(
  '/products/:productId/archive',
  route({
    params: idParams('productId'),
    handler: ({ req, params, requestId }) =>
      adminArchiveProduct(params.productId, adminContext(req, requestId)),
  }),
);

// ---------------------------------------------------------------------------
// Catalog — variants (M3)
// ---------------------------------------------------------------------------

const productVariantParams = idParams('productId').extend({
  variantId: idParams('variantId').shape.variantId,
});

adminRouter.post(
  '/products/:productId/variants',
  route({
    params: idParams('productId'),
    body: adminVariantCreateBody,
    handler: async ({ req, params, body, requestId }) =>
      created(await adminCreateVariant(params.productId, body, adminContext(req, requestId))),
  }),
);

adminRouter.patch(
  '/products/:productId/variants/:variantId',
  route({
    params: productVariantParams,
    body: adminVariantUpdateBody,
    handler: ({ req, params, body, requestId }) =>
      adminUpdateVariant(params.productId, params.variantId, body, adminContext(req, requestId)),
  }),
);

// ---------------------------------------------------------------------------
// Catalog — images (M3)
// ---------------------------------------------------------------------------

const productImageParams = idParams('productId').extend({
  imageId: idParams('imageId').shape.imageId,
});

adminRouter.post(
  '/products/:productId/images',
  route({
    params: idParams('productId'),
    body: adminImageCreateBody,
    handler: async ({ req, params, body, requestId }) =>
      created(await adminCreateImage(params.productId, body, adminContext(req, requestId))),
  }),
);

adminRouter.patch(
  '/products/:productId/images/:imageId',
  route({
    params: productImageParams,
    body: adminImageUpdateBody,
    handler: ({ req, params, body, requestId }) =>
      adminUpdateImage(params.productId, params.imageId, body, adminContext(req, requestId)),
  }),
);

adminRouter.delete(
  '/products/:productId/images/:imageId',
  route({
    params: productImageParams,
    handler: async ({ req, params, requestId }) => {
      await adminDeleteImage(params.productId, params.imageId, adminContext(req, requestId));
      return noContent();
    },
  }),
);

// ---------------------------------------------------------------------------
// Catalog — categories (M3)
// ---------------------------------------------------------------------------

adminRouter.get(
  '/categories',
  route({
    query: adminCategoryListQuery,
    handler: async ({ query }) => {
      const { q, includeInactive, ...pagination } = query;
      const page = await adminListCategories(pagination, {
        ...(q === undefined ? {} : { q }),
        includeInactive,
      });
      return paged(page.items, pageMeta(pagination, page.total));
    },
  }),
);

adminRouter.get(
  '/categories/:categoryId',
  route({
    params: idParams('categoryId'),
    handler: ({ params }) => adminGetCategory(params.categoryId),
  }),
);

adminRouter.post(
  '/categories',
  route({
    body: adminCategoryCreateBody,
    handler: async ({ req, body, requestId }) =>
      created(await adminCreateCategory(body, adminContext(req, requestId))),
  }),
);

adminRouter.patch(
  '/categories/:categoryId',
  route({
    params: idParams('categoryId'),
    body: adminCategoryUpdateBody,
    handler: ({ req, params, body, requestId }) =>
      adminUpdateCategory(params.categoryId, body, adminContext(req, requestId)),
  }),
);

// ---------------------------------------------------------------------------
// Inventory (M4)
// ---------------------------------------------------------------------------

adminRouter.get(
  '/inventory',
  route({
    query: adminInventoryListQuery,
    handler: async ({ query }) => {
      const { q, lowStockOnly, categoryId, ...pagination } = query;
      const page = await adminListInventory(pagination, {
        ...(q === undefined ? {} : { q }),
        lowStockOnly,
        ...(categoryId === undefined ? {} : { categoryId }),
      });
      return paged(page.items, pageMeta(pagination, page.total));
    },
  }),
);

adminRouter.post(
  '/inventory/adjustments',
  route({
    body: adminStockAdjustmentBody,
    handler: async ({ req, body, requestId }) =>
      created(await adminAdjustStock(body, adminContext(req, requestId))),
  }),
);

adminRouter.get(
  '/inventory/movements',
  route({
    query: adminMovementListQuery,
    handler: async ({ query }) => {
      const { variantId, reason, ...pagination } = query;
      const page = await adminListMovements(pagination, {
        ...(variantId === undefined ? {} : { variantId }),
        ...(reason === undefined ? {} : { reason }),
      });
      return paged(page.items, pageMeta(pagination, page.total));
    },
  }),
);

adminRouter.get(
  '/inventory/:variantId',
  route({
    params: idParams('variantId'),
    handler: ({ params }) => adminGetVariantStock(params.variantId),
  }),
);

// ---------------------------------------------------------------------------
// Shopping assistant review (M13, ADR 0025). Opening a conversation is audited.
// ---------------------------------------------------------------------------

adminRouter.get(
  '/assistant/conversations',
  route({
    query: adminConversationListQuery,
    handler: async ({ query }) => {
      const { page, pageSize, failed, owner } = query;
      const result = await listConversationsForAdmin(
        { page, pageSize },
        {
          ...(failed === undefined ? {} : { failedOnly: failed }),
          ...(owner === undefined ? {} : { owner }),
        },
      );
      return paged(result.items, pageMeta({ page, pageSize }, result.total));
    },
  }),
);

adminRouter.get(
  '/assistant/conversations/:conversationId',
  route({
    params: idParams('conversationId'),
    handler: ({ req, params, requestId }) =>
      getConversationForAdmin(params.conversationId, adminContext(req, requestId)),
  }),
);
