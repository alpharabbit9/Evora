/**
 * What the admin API answers with (API_SPEC.md §8), as the dashboard reads it. Declared by hand
 * rather than shared with the backend, like `lib/catalog/types.ts` (ADR 0006).
 *
 * Roles, statuses and stock here are for rendering only: every write is authorized and validated
 * again by the API, which is the authority on all of them.
 */
import type { OrderDetail, OrderStatus, OrderSummary, RefundStatus } from '@/lib/checkout/types';

export type ProductStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
export type ProductGender = 'MEN' | 'WOMEN' | 'UNISEX';
export type VariantStatus = 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
export type ImageKind = 'PHOTO' | 'CUTOUT';
export type UserRole = 'CUSTOMER' | 'ADMIN' | 'SUPERADMIN';
export type UserStatus = 'ACTIVE' | 'SUSPENDED';

/** The reasons an admin may give. The rest are written by checkout and order handling. */
export type AdjustmentReason = 'ADMIN_ADJUSTMENT' | 'DAMAGE' | 'RETURN' | 'IMPORT_CORRECTION';
export type MovementReason =
  AdjustmentReason | 'ORDER_PLACED' | 'ORDER_CANCELLED' | 'REFUND_RESTOCK';

interface CategoryRef {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
}

export interface AdminProductListItem {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly brand: string | null;
  readonly status: ProductStatus;
  readonly gender: ProductGender | null;
  readonly category: CategoryRef;
  readonly variantCount: number;
  readonly imageCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly publishedAt: string | null;
}

export interface AdminVariant {
  readonly id: string;
  readonly sku: string;
  readonly optionKey: string;
  readonly options: Record<string, string>;
  readonly priceMinor: number;
  readonly compareAtPriceMinor: number | null;
  readonly stockQuantity: number;
  readonly lowStockThreshold: number;
  readonly weightGrams: number | null;
  readonly status: VariantStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AdminImage {
  readonly id: string;
  readonly objectKey: string;
  readonly url: string;
  readonly altText: string;
  readonly sortOrder: number;
  readonly kind: ImageKind;
  readonly variantId: string | null;
  readonly createdAt: string;
}

export interface AdminProduct {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string | null;
  readonly brand: string | null;
  readonly status: ProductStatus;
  readonly gender: ProductGender | null;
  readonly featuredRank: number | null;
  readonly publishedAt: string | null;
  readonly sourceProvider: string | null;
  readonly currency: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly category: CategoryRef & { readonly parent: CategoryRef | null };
  readonly variants: readonly AdminVariant[];
  readonly images: readonly AdminImage[];
}

export interface AdminCategory {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string | null;
  readonly parentId: string | null;
  readonly isActive: boolean;
  readonly sortOrder: number;
  readonly parent: CategoryRef | null;
  readonly productCount: number;
  readonly childCount: number;
}

export interface InventoryRow {
  readonly id: string;
  readonly sku: string;
  readonly options: Record<string, string>;
  readonly priceMinor: number;
  readonly stockQuantity: number;
  readonly lowStockThreshold: number;
  readonly isLowStock: boolean;
  readonly status: VariantStatus;
  readonly updatedAt: string;
  readonly product: { readonly id: string; readonly name: string; readonly slug: string };
}

export interface StockAdjustmentResult {
  readonly id: string;
  readonly sku: string;
  readonly stockQuantity: number;
  readonly lowStockThreshold: number;
}

export interface InventoryMovement {
  readonly id: string;
  readonly variantId: string;
  readonly delta: number;
  readonly resultingQuantity: number;
  readonly reason: MovementReason;
  readonly note: string | null;
  readonly orderId: string | null;
  readonly createdAt: string;
  readonly variant: {
    readonly sku: string;
    readonly product: { readonly id: string; readonly name: string };
  };
  /** Null for a movement no person made: checkout and order handling write those. */
  readonly actor: { readonly id: string; readonly name: string; readonly email: string } | null;
}

export interface AdminCustomer {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly role: UserRole;
  readonly status: UserStatus;
  readonly createdAt: string;
}

// ---------------------------------------------------------------------------
// Orders (M8, ADR 0020)
// ---------------------------------------------------------------------------

export type PaymentStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELLED'
  | 'PARTIALLY_REFUNDED'
  | 'REFUNDED';

export interface AdminOrderListItem extends OrderSummary {
  readonly contactEmail: string;
  readonly itemCount: number;
}

export interface AdminOrder extends OrderDetail {
  readonly customer: { readonly id: string | null; readonly email: string };
  /** What the API will accept next. Rendering only: the API checks again. */
  readonly allowedTransitions: readonly OrderStatus[];
  readonly history: readonly {
    readonly fromStatus: OrderStatus | null;
    readonly toStatus: OrderStatus;
    readonly reason: string | null;
    readonly isSystem: boolean;
    readonly actorEmail: string | null;
    readonly at: string;
  }[];
  readonly payments: readonly {
    readonly id: string;
    readonly provider: string;
    readonly method: 'COD' | 'ONLINE';
    readonly status: PaymentStatus;
    readonly amountMinor: number;
    readonly failureCode: string | null;
    readonly createdAt: string;
  }[];
  readonly refundsDetail: readonly {
    readonly id: string;
    readonly paymentId: string;
    readonly amountMinor: number;
    readonly status: RefundStatus;
    readonly reason: string | null;
    readonly providerAcknowledged: boolean;
    readonly requestedByEmail: string | null;
    readonly createdAt: string;
  }[];
}

export interface AdminRefund {
  readonly id: string;
  readonly amountMinor: number;
  readonly status: RefundStatus;
  readonly providerAcknowledged: boolean;
}

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  PENDING: 'Pending',
  PROCESSING: 'Held for review',
  SUCCEEDED: 'Paid',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
  PARTIALLY_REFUNDED: 'Partly refunded',
  REFUNDED: 'Refunded',
};

/** Why a payment is held or failed, in the words an operator needs. */
export const FAILURE_CODE_LABEL: Record<string, string> = {
  RISK_REVIEW: 'The provider flagged this payment as risky',
  AMOUNT_MISMATCH: 'The amount received differs from what was charged',
  FAILED: 'Declined by the bank',
  CANCELLED: 'Cancelled by the customer at the gateway',
  EXPIRED: 'Not paid in time',
  ORDER_CANCELLED: 'The order was cancelled before payment',
};

export const REFUND_STATUS_ADMIN_LABEL: Record<RefundStatus, string> = {
  PENDING: 'In progress',
  SUCCEEDED: 'Refunded',
  FAILED: 'Failed',
};

export const PRODUCT_STATUS_LABEL: Record<ProductStatus, string> = {
  DRAFT: 'Draft',
  PUBLISHED: 'Published',
  ARCHIVED: 'Archived',
};

export const GENDER_LABEL: Record<ProductGender, string> = {
  MEN: 'Men',
  WOMEN: 'Women',
  UNISEX: 'Unisex',
};

export const VARIANT_STATUS_LABEL: Record<VariantStatus, string> = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  ARCHIVED: 'Archived',
};

export const IMAGE_KIND_LABEL: Record<ImageKind, string> = {
  PHOTO: 'Photo',
  CUTOUT: 'Cut-out',
};

export const ROLE_LABEL: Record<UserRole, string> = {
  CUSTOMER: 'Customer',
  ADMIN: 'Admin',
  SUPERADMIN: 'Superadmin',
};

export const USER_STATUS_LABEL: Record<UserStatus, string> = {
  ACTIVE: 'Active',
  SUSPENDED: 'Suspended',
};

export const ADJUSTMENT_REASON_LABEL: Record<AdjustmentReason, string> = {
  ADMIN_ADJUSTMENT: 'Manual correction',
  DAMAGE: 'Damaged',
  RETURN: 'Customer return',
  IMPORT_CORRECTION: 'Import correction',
};

export const MOVEMENT_REASON_LABEL: Record<MovementReason, string> = {
  ...ADJUSTMENT_REASON_LABEL,
  ORDER_PLACED: 'Order placed',
  ORDER_CANCELLED: 'Order cancelled',
  REFUND_RESTOCK: 'Refund restock',
};

// ---------------------------------------------------------------------------
// Background jobs (M9, ADR 0021)
// ---------------------------------------------------------------------------

export type JobStatus = 'PENDING' | 'PROCESSING' | 'SENT' | 'FAILED' | 'DEAD';
export type JobType =
  | 'ORDER_RECEIPT'
  | 'SHIPPING_UPDATE'
  | 'ORDER_CANCELLED'
  | 'REFUND_UPDATE'
  | 'LOW_STOCK_ALERT'
  | 'PAYMENT_REVIEW_REQUIRED'
  | 'EMAIL_VERIFICATION'
  | 'PASSWORD_RESET'
  | 'PAYMENT_RECONCILIATION'
  | 'ASSISTANT_INDEX_SWEEP'
  | 'ASSISTANT_RETENTION';

/** A job as the API describes it: identifiers only, never its payload. */
export interface AdminJob {
  readonly id: string;
  readonly eventType: JobType;
  readonly status: JobStatus;
  readonly recurring: boolean;
  readonly attemptCount: number;
  readonly maxAttempts: number | null;
  readonly nextAttemptAt: string | null;
  readonly lastError: string | null;
  readonly processedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly subject: {
    readonly orderId?: string;
    readonly orderNumber?: string;
    readonly refundId?: string;
    readonly paymentId?: string;
    readonly variantId?: string;
    readonly sku?: string;
  };
  readonly retryable: boolean;
}

export interface AdminJobSummary {
  readonly counts: Readonly<Record<JobStatus, number>>;
  readonly due: number;
  /** DEAD jobs a bulk retry would requeue; expired account emails are not among them. */
  readonly retryableDead: number;
  readonly oldestDueAt: string | null;
  readonly reconciliation: {
    readonly status: JobStatus;
    readonly lastRunAt: string | null;
    readonly nextRunAt: string;
    readonly failingRuns: number;
    readonly lastError: string | null;
  } | null;
}

export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  PENDING: 'Waiting',
  PROCESSING: 'Running',
  SENT: 'Done',
  FAILED: 'Retrying',
  DEAD: 'Gave up',
};

export const JOB_TYPE_LABEL: Record<JobType, string> = {
  ORDER_RECEIPT: 'Order receipt',
  SHIPPING_UPDATE: 'Shipping update',
  ORDER_CANCELLED: 'Cancellation notice',
  REFUND_UPDATE: 'Refund update',
  LOW_STOCK_ALERT: 'Low-stock alert',
  PAYMENT_REVIEW_REQUIRED: 'Payment review alert',
  EMAIL_VERIFICATION: 'Email confirmation',
  PASSWORD_RESET: 'Password reset',
  PAYMENT_RECONCILIATION: 'Payment sweep',
  ASSISTANT_INDEX_SWEEP: 'Assistant index refresh',
  ASSISTANT_RETENTION: 'Assistant chat clean-up',
};

// ---------------------------------------------------------------------------
// Overview, coupons, settings, audit log (M10, ADR 0022)
// ---------------------------------------------------------------------------

export interface AdminOverview {
  readonly range: { readonly from: string; readonly to: string };
  readonly currency: string;
  readonly ordersPlaced: number;
  readonly ordersCounted: number;
  readonly salesMinor: number;
  readonly refundsMinor: number;
  readonly netMinor: number;
  readonly discountsMinor: number;
  readonly averageOrderMinor: number | null;
  readonly byStatus: Readonly<Partial<Record<OrderStatus, number>>>;
  readonly daily: readonly {
    readonly date: string;
    readonly orders: number;
    readonly salesMinor: number;
  }[];
  readonly topProducts: readonly {
    readonly productId: string | null;
    readonly name: string;
    readonly units: number;
    readonly salesMinor: number;
  }[];
  readonly lowStockVariants: number;
  readonly recentOrders: readonly {
    readonly id: string;
    readonly orderNumber: string;
    readonly status: OrderStatus;
    readonly totalMinor: number;
    readonly createdAt: string;
  }[];
}

export type CouponType = 'PERCENT' | 'FIXED';
export type CouponState = 'active' | 'scheduled' | 'expired' | 'inactive' | 'used_up';

export interface AdminCoupon {
  readonly id: string;
  readonly code: string;
  readonly type: CouponType;
  readonly percentBps: number | null;
  readonly valueMinor: number | null;
  readonly currency: string | null;
  readonly minimumSpendMinor: number | null;
  readonly maxDiscountMinor: number | null;
  readonly startsAt: string | null;
  readonly endsAt: string | null;
  readonly usageLimit: number | null;
  readonly perUserLimit: number | null;
  readonly usedCount: number;
  readonly isActive: boolean;
  readonly appliesToAllProducts: boolean;
  readonly products: readonly {
    readonly id: string;
    readonly name: string;
    readonly slug: string;
  }[];
  readonly state: CouponState;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export const COUPON_STATE_LABEL: Record<CouponState, string> = {
  active: 'Active',
  scheduled: 'Scheduled',
  expired: 'Expired',
  inactive: 'Switched off',
  used_up: 'Used up',
};

export interface StoreSettings {
  readonly storeName: string;
  readonly supportEmail: string | null;
  readonly standardFeeDhakaMinor: number;
  readonly standardFeeNationalMinor: number;
  readonly expressEnabled: boolean;
  readonly expressFeeDhakaMinor: number;
  readonly expressFeeNationalMinor: number;
  readonly freeShippingThresholdMinor: number | null;
  readonly taxRateBps: number;
  /** 0 while the built-in defaults apply. */
  readonly version: number;
  readonly updatedAt: string | null;
  readonly updatedBy: { readonly id: string; readonly name: string } | null;
}

export interface AuditEntry {
  readonly id: string;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string | null;
  readonly isSystem: boolean;
  readonly actor: { readonly id: string; readonly name: string; readonly email: string } | null;
  readonly actorRole: UserRole | null;
  readonly before: unknown;
  readonly after: unknown;
  readonly requestId: string | null;
  readonly ipAddress?: string | null;
  readonly createdAt: string;
}

/** Every action the API records (`AuditAction` in the backend), worded for people. */
export const AUDIT_ACTION_LABEL: Record<string, string> = {
  'customer.status.updated': 'Account status changed',
  'customer.role.updated': 'Role changed',
  'product.created': 'Product created',
  'product.updated': 'Product updated',
  'product.archived': 'Product archived',
  'variant.created': 'Variant created',
  'variant.updated': 'Variant updated',
  'image.created': 'Image added',
  'image.updated': 'Image updated',
  'image.deleted': 'Image deleted',
  'category.created': 'Category created',
  'category.updated': 'Category updated',
  'inventory.stock.adjusted': 'Stock adjusted',
  'order.transitioned': 'Order status changed',
  'order.cod.collected': 'Cash collected',
  'refund.requested': 'Refund issued',
  'payment.hold.resolved': 'Held payment decided',
  'outbox.job.retried': 'Job retried',
  'outbox.jobs.bulk_retried': 'Jobs retried in bulk',
  'coupon.created': 'Coupon created',
  'coupon.updated': 'Coupon updated',
  'settings.updated': 'Settings changed',
  'orders.exported': 'Orders exported',
  'assistant.conversation.viewed': 'Assistant chat viewed',
};

// ---------------------------------------------------------------------------
// Shopping assistant review (M13, ADR 0025)
// ---------------------------------------------------------------------------

export interface AdminAssistantConversation {
  readonly id: string;
  readonly owner: 'guest' | 'customer';
  readonly customer: { readonly id: string; readonly email: string } | null;
  readonly messageCount: number;
  readonly failedReplies: number;
  readonly tokens: number;
  readonly createdAt: string;
  readonly lastMessageAt: string;
}

export interface AdminAssistantConversationDetail extends Omit<
  AdminAssistantConversation,
  'tokens'
> {
  readonly messages: readonly {
    readonly id: string;
    readonly role: 'user' | 'assistant';
    readonly content: string;
    readonly provider: string | null;
    readonly model: string | null;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly toolNames: readonly string[];
    readonly latencyMs: number | null;
    readonly errorCode: string | null;
    readonly createdAt: string;
  }[];
}
