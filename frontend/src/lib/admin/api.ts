'use client';

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
} from '@tanstack/react-query';

import {
  apiDelete,
  apiDownload,
  apiGet,
  apiGetPage,
  apiPatch,
  apiPost,
  apiPut,
  type QueryValue,
} from '@/lib/api-client';
import type { SessionUser } from '@/lib/server-session';

import type { OrderStatus } from '@/lib/checkout/types';

import type {
  AdminAssistantConversation,
  AdminAssistantConversationDetail,
  AdjustmentReason,
  AdminCategory,
  AdminCoupon,
  AdminCustomer,
  AdminOverview,
  AuditEntry,
  CouponType,
  StoreSettings,
  UserRole,
  AdminImage,
  AdminJob,
  AdminJobSummary,
  AdminOrder,
  AdminOrderListItem,
  AdminProduct,
  AdminProductListItem,
  AdminRefund,
  AdminVariant,
  InventoryMovement,
  InventoryRow,
  JobType,
  StockAdjustmentResult,
  UserStatus,
} from './types';

/**
 * The dashboard's reads and writes over the admin API (API_SPEC.md §8). Every call carries the
 * session cookie through `apiFetch`, and the API refuses anyone below ADMIN whatever this code or
 * the page around it does: nothing here is a security check.
 *
 * Writes are never retried (`AppProviders`), and they invalidate the reads they change, so what is
 * on screen after a save is the server's answer rather than a copy made here.
 */
export const ADMIN_PAGE_SIZE = 20;

/** The API's page-size cap (`MAX_PAGE_SIZE`). */
const OPTIONS_PAGE_SIZE = 100;

export type ListFilters = Record<string, QueryValue>;

export const adminKeys = {
  all: ['admin'] as const,
  products: () => [...adminKeys.all, 'products'] as const,
  productList: (filters: ListFilters) => [...adminKeys.products(), 'list', filters] as const,
  product: (id: string) => [...adminKeys.products(), 'detail', id] as const,
  categories: () => [...adminKeys.all, 'categories'] as const,
  categoryList: (filters: ListFilters) => [...adminKeys.categories(), 'list', filters] as const,
  categoryOptions: () => [...adminKeys.categories(), 'options'] as const,
  inventory: () => [...adminKeys.all, 'inventory'] as const,
  inventoryList: (filters: ListFilters) => [...adminKeys.inventory(), 'list', filters] as const,
  movements: (filters: ListFilters) => [...adminKeys.inventory(), 'movements', filters] as const,
  customers: () => [...adminKeys.all, 'customers'] as const,
  customerList: (filters: ListFilters) => [...adminKeys.customers(), 'list', filters] as const,
  orders: () => [...adminKeys.all, 'orders'] as const,
  orderList: (filters: ListFilters) => [...adminKeys.orders(), 'list', filters] as const,
  order: (id: string) => [...adminKeys.orders(), 'detail', id] as const,
  overview: (range: ListFilters) => [...adminKeys.all, 'overview', range] as const,
  coupons: () => [...adminKeys.all, 'coupons'] as const,
  couponList: (filters: ListFilters) => [...adminKeys.coupons(), 'list', filters] as const,
  settings: () => [...adminKeys.all, 'settings'] as const,
  audit: (filters: ListFilters) => [...adminKeys.all, 'audit', filters] as const,
  viewer: () => [...adminKeys.all, 'viewer'] as const,
  jobs: () => [...adminKeys.all, 'jobs'] as const,
  jobList: (filters: ListFilters) => [...adminKeys.jobs(), 'list', filters] as const,
  jobSummary: () => [...adminKeys.jobs(), 'summary'] as const,
  assistant: () => [...adminKeys.all, 'assistant'] as const,
  assistantList: (filters: ListFilters) => [...adminKeys.assistant(), 'list', filters] as const,
  assistantConversation: (id: string) => [...adminKeys.assistant(), 'detail', id] as const,
};

function path(...segments: string[]): string {
  return `/admin/${segments.map(encodeURIComponent).join('/')}`;
}

/** Runs a write, then refreshes whatever it made stale, whether or not the write succeeded. */
function useAdminWrite<TArgs, TResult>(
  write: (args: TArgs) => Promise<TResult>,
  staleKeys: readonly QueryKey[],
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: write,
    // On failure too: a request that timed out may still have taken effect on the server.
    onSettled: () =>
      Promise.all(staleKeys.map((queryKey) => queryClient.invalidateQueries({ queryKey }))),
  });
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

export function useAdminProducts(filters: ListFilters) {
  return useQuery({
    queryKey: adminKeys.productList(filters),
    queryFn: ({ signal }) =>
      apiGetPage<AdminProductListItem>('/admin/products', { query: filters, signal }),
    placeholderData: keepPreviousData,
  });
}

export function useAdminProduct(productId: string) {
  return useQuery({
    queryKey: adminKeys.product(productId),
    queryFn: ({ signal }) => apiGet<AdminProduct>(path('products', productId), { signal }),
  });
}

export interface ProductWrite {
  name?: string;
  slug?: string;
  description?: string | null;
  brand?: string | null;
  categoryId?: string;
  gender?: AdminProduct['gender'];
  status?: AdminProduct['status'];
  featuredRank?: number | null;
}

export function useCreateProduct() {
  return useAdminWrite(
    (body: ProductWrite) => apiPost<AdminProduct>('/admin/products', { body }),
    [adminKeys.products()],
  );
}

export function useUpdateProduct(productId: string) {
  return useAdminWrite(
    (body: ProductWrite) => apiPatch<AdminProduct>(path('products', productId), { body }),
    [adminKeys.products(), adminKeys.inventory()],
  );
}

export function useArchiveProduct(productId: string) {
  return useAdminWrite(
    () => apiPost<AdminProduct>(path('products', productId, 'archive')),
    [adminKeys.products(), adminKeys.inventory()],
  );
}

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------

/**
 * Stock is deliberately not part of a variant write. The API accepts `stockQuantity` here, but
 * only `/admin/inventory/adjustments` records a movement, and the ledger has to explain every
 * balance (ADR 0004). A new variant starts at zero and stock goes in through an adjustment.
 */
export interface VariantWrite {
  sku?: string;
  options?: Record<string, string>;
  priceMinor?: number;
  compareAtPriceMinor?: number | null;
  lowStockThreshold?: number;
  weightGrams?: number | null;
  status?: AdminVariant['status'];
}

export function useSaveVariant(productId: string) {
  return useAdminWrite(
    ({ variantId, body }: { variantId?: string | undefined; body: VariantWrite }) =>
      variantId === undefined
        ? apiPost<AdminVariant>(path('products', productId, 'variants'), { body })
        : apiPatch<AdminVariant>(path('products', productId, 'variants', variantId), { body }),
    [adminKeys.products(), adminKeys.inventory()],
  );
}

// ---------------------------------------------------------------------------
// Images (metadata only: the API has no upload endpoint yet)
// ---------------------------------------------------------------------------

export interface ImageWrite {
  objectKey?: string;
  altText?: string;
  sortOrder?: number;
  kind?: AdminImage['kind'];
  variantId?: string | null;
}

export function useSaveImage(productId: string) {
  return useAdminWrite(
    ({ imageId, body }: { imageId?: string | undefined; body: ImageWrite }) =>
      imageId === undefined
        ? apiPost<AdminImage>(path('products', productId, 'images'), { body })
        : apiPatch<AdminImage>(path('products', productId, 'images', imageId), { body }),
    [adminKeys.products()],
  );
}

export function useDeleteImage(productId: string) {
  return useAdminWrite(
    (imageId: string) => apiDelete<undefined>(path('products', productId, 'images', imageId)),
    [adminKeys.products()],
  );
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export function useAdminCategories(filters: ListFilters) {
  return useQuery({
    queryKey: adminKeys.categoryList(filters),
    queryFn: ({ signal }) =>
      apiGetPage<AdminCategory>('/admin/categories', { query: filters, signal }),
    placeholderData: keepPreviousData,
  });
}

async function fetchAllCategories(signal: AbortSignal): Promise<AdminCategory[]> {
  const categories: AdminCategory[] = [];

  for (let page = 1; ; page += 1) {
    const { items, total } = await apiGetPage<AdminCategory>('/admin/categories', {
      query: { page, pageSize: OPTIONS_PAGE_SIZE },
      signal,
    });
    categories.push(...items);

    if (items.length === 0 || categories.length >= total) return categories;
  }
}

/** Every category, for the pickers and filters. A short list that rarely changes. */
export function useCategoryOptions() {
  return useQuery({
    queryKey: adminKeys.categoryOptions(),
    queryFn: ({ signal }) => fetchAllCategories(signal),
  });
}

export function categoryLabel(category: Pick<AdminCategory, 'name' | 'parent'>): string {
  return category.parent ? `${category.parent.name} / ${category.name}` : category.name;
}

export interface CategoryWrite {
  name?: string;
  slug?: string;
  description?: string | null;
  parentId?: string | null;
  isActive?: boolean;
  sortOrder?: number;
}

export function useSaveCategory() {
  return useAdminWrite(
    ({ categoryId, body }: { categoryId?: string | undefined; body: CategoryWrite }) =>
      categoryId === undefined
        ? apiPost<AdminCategory>('/admin/categories', { body })
        : apiPatch<AdminCategory>(path('categories', categoryId), { body }),
    // A renamed category shows on every product row that sits in it.
    [adminKeys.categories(), adminKeys.products()],
  );
}

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

export function useAdminInventory(filters: ListFilters) {
  return useQuery({
    queryKey: adminKeys.inventoryList(filters),
    queryFn: ({ signal }) =>
      apiGetPage<InventoryRow>('/admin/inventory', { query: filters, signal }),
    placeholderData: keepPreviousData,
  });
}

export function useInventoryMovements(filters: ListFilters) {
  return useQuery({
    queryKey: adminKeys.movements(filters),
    queryFn: ({ signal }) =>
      apiGetPage<InventoryMovement>('/admin/inventory/movements', { query: filters, signal }),
    placeholderData: keepPreviousData,
  });
}

export interface StockAdjustment {
  variantId: string;
  /** Signed. The API applies it atomically and refuses one that would go below zero. */
  delta: number;
  reason: AdjustmentReason;
  note?: string;
}

export function useAdjustStock() {
  return useAdminWrite(
    (body: StockAdjustment) =>
      apiPost<StockAdjustmentResult>('/admin/inventory/adjustments', { body }),
    [adminKeys.inventory(), adminKeys.products()],
  );
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

export function useAdminCustomers(filters: ListFilters) {
  return useQuery({
    queryKey: adminKeys.customerList(filters),
    queryFn: ({ signal }) =>
      apiGetPage<AdminCustomer>('/admin/customers', { query: filters, signal }),
    placeholderData: keepPreviousData,
  });
}

// ---------------------------------------------------------------------------
// Orders (M8, ADR 0020)
// ---------------------------------------------------------------------------

export function useAdminOrders(filters: ListFilters) {
  return useQuery({
    queryKey: adminKeys.orderList(filters),
    queryFn: ({ signal }) =>
      apiGetPage<AdminOrderListItem>('/admin/orders', { query: filters, signal }),
    placeholderData: keepPreviousData,
  });
}

/** Refunds settle in the background, so an order with one in progress keeps checking. */
const ORDER_POLL_MS = 10_000;

export function useAdminOrder(orderId: string) {
  return useQuery({
    queryKey: adminKeys.order(orderId),
    queryFn: ({ signal }) => apiGet<AdminOrder>(path('orders', orderId), { signal }),
    refetchInterval: (query) =>
      query.state.data?.refundsDetail.some((refund) => refund.status === 'PENDING')
        ? ORDER_POLL_MS
        : false,
  });
}

/** Everything an order change can move: the order, the lists, and stock when it is cancelled. */
function orderStaleKeys(orderId: string): readonly QueryKey[] {
  return [adminKeys.order(orderId), adminKeys.orders(), adminKeys.inventory()];
}

export interface TransitionWrite {
  /** The status on screen. The API refuses the change if the order has moved since. */
  from: OrderStatus;
  to: OrderStatus;
  note?: string;
  carrier?: string;
  trackingNumber?: string;
}

export function useTransitionOrder(orderId: string) {
  return useAdminWrite(
    (body: TransitionWrite) =>
      apiPost<AdminOrder>(path('orders', orderId, 'transitions'), { body }),
    orderStaleKeys(orderId),
  );
}

export function useRecordCodCollection(orderId: string) {
  return useAdminWrite(
    () => apiPost<AdminOrder>(path('orders', orderId, 'cod-collection')),
    orderStaleKeys(orderId),
  );
}

/**
 * The key belongs to one refund the admin means to make, not to one click: the dialog makes it
 * when it opens and keeps it until a refund comes back, so a retry after a lost response finds
 * the first refund instead of making a second (ADR 0020 decision 6).
 */
export function useRefundOrder(orderId: string) {
  return useAdminWrite(
    ({ key, body }: { key: string; body: { amountMinor: number; reason: string } }) =>
      apiPost<AdminRefund>(path('orders', orderId, 'refunds'), { body, idempotencyKey: key }),
    orderStaleKeys(orderId),
  );
}

export function useResolveHold(orderId: string) {
  return useAdminWrite(
    ({
      paymentId,
      decision,
      note,
    }: {
      paymentId: string;
      decision: 'accept' | 'reject';
      note: string;
    }) =>
      apiPost<AdminOrder>(path('payments', paymentId, 'hold-resolution'), {
        body: { decision, note },
      }),
    orderStaleKeys(orderId),
  );
}

/** The signed-in administrator: what to render, never what to allow (the API decides). */
export function useViewer() {
  return useQuery({
    queryKey: adminKeys.viewer(),
    queryFn: ({ signal }) => apiGet<SessionUser>('/me', { signal }),
    staleTime: 60_000,
  });
}

/** SUPERADMIN only; the API refuses anyone else (ADR 0009). */
export function useUpdateCustomerRole() {
  return useAdminWrite(
    ({ userId, role }: { userId: string; role: UserRole }) =>
      apiPatch<AdminCustomer>(path('customers', userId, 'role'), { body: { role } }),
    [adminKeys.customers()],
  );
}

export function useUpdateCustomerStatus() {
  return useAdminWrite(
    ({ userId, status }: { userId: string; status: UserStatus }) =>
      apiPatch<AdminCustomer>(path('customers', userId, 'status'), { body: { status } }),
    [adminKeys.customers()],
  );
}

// ---------------------------------------------------------------------------
// Background jobs (M9, ADR 0021)
// ---------------------------------------------------------------------------

/** The queue moves on its own, so the screen keeps up without a reload. */
const JOBS_POLL_MS = 15_000;

export function useAdminJobs(filters: ListFilters) {
  return useQuery({
    queryKey: adminKeys.jobList(filters),
    queryFn: ({ signal }) => apiGetPage<AdminJob>('/admin/jobs', { query: filters, signal }),
    placeholderData: keepPreviousData,
    refetchInterval: JOBS_POLL_MS,
  });
}

export function useAdminJobSummary() {
  return useQuery({
    queryKey: adminKeys.jobSummary(),
    queryFn: ({ signal }) => apiGet<AdminJobSummary>('/admin/jobs/summary', { signal }),
    refetchInterval: JOBS_POLL_MS,
  });
}

export function useRetryJob() {
  return useAdminWrite(
    (jobId: string) => apiPost<AdminJob>(path('jobs', jobId, 'retry')),
    [adminKeys.jobs()],
  );
}

export function useRetryDeadJobs() {
  return useAdminWrite(
    ({ type }: { type?: JobType }) =>
      apiPost<{ retried: number; remaining: number }>('/admin/jobs/retry', {
        body: type ? { status: 'DEAD', type } : { status: 'DEAD' },
      }),
    [adminKeys.jobs()],
  );
}

// ---------------------------------------------------------------------------
// Overview, coupons, settings, audit log, export (M10, ADR 0022)
// ---------------------------------------------------------------------------

export function useAdminOverview(range: { from?: string; to?: string }) {
  return useQuery({
    queryKey: adminKeys.overview(range),
    queryFn: ({ signal }) => apiGet<AdminOverview>('/admin/overview', { query: range, signal }),
    placeholderData: keepPreviousData,
  });
}

export function useAdminCoupons(filters: ListFilters) {
  return useQuery({
    queryKey: adminKeys.couponList(filters),
    queryFn: ({ signal }) => apiGetPage<AdminCoupon>('/admin/coupons', { query: filters, signal }),
    placeholderData: keepPreviousData,
  });
}

export interface CouponWrite {
  code?: string;
  type?: CouponType;
  percentBps?: number;
  valueMinor?: number;
  minimumSpendMinor?: number | null;
  maxDiscountMinor?: number | null;
  startsAt?: string | null;
  endsAt?: string | null;
  usageLimit?: number | null;
  perUserLimit?: number | null;
  isActive?: boolean;
  appliesToAllProducts?: boolean;
  productIds?: string[];
}

export function useCreateCoupon() {
  return useAdminWrite(
    (body: CouponWrite) => apiPost<AdminCoupon>('/admin/coupons', { body }),
    [adminKeys.coupons()],
  );
}

export function useUpdateCoupon() {
  return useAdminWrite(
    ({ couponId, body }: { couponId: string; body: CouponWrite }) =>
      apiPatch<AdminCoupon>(path('coupons', couponId), { body }),
    [adminKeys.coupons()],
  );
}

export function useStoreSettings() {
  return useQuery({
    queryKey: adminKeys.settings(),
    queryFn: ({ signal }) => apiGet<StoreSettings>('/admin/settings', { signal }),
  });
}

export type SettingsWrite = Omit<StoreSettings, 'updatedAt' | 'updatedBy'>;

export function useSaveSettings() {
  return useAdminWrite(
    (body: SettingsWrite) => apiPut<StoreSettings>('/admin/settings', { body }),
    [adminKeys.settings()],
  );
}

export function useAuditLog(filters: ListFilters) {
  return useQuery({
    queryKey: adminKeys.audit(filters),
    queryFn: ({ signal }) =>
      apiGetPage<AuditEntry>('/admin/audit-logs', { query: filters, signal }),
    placeholderData: keepPreviousData,
  });
}

/** Saves the CSV through the browser. The API audits every export. */
export async function downloadOrdersCsv(query: { from: string; to: string; status?: string }) {
  const { blob, filename } = await apiDownload('/admin/reports/orders.csv', query);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename ?? `orders-${query.from}-to-${query.to}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Shopping assistant review (M13, ADR 0025)
// ---------------------------------------------------------------------------

export function useAdminAssistantConversations(filters: ListFilters) {
  return useQuery({
    queryKey: adminKeys.assistantList(filters),
    queryFn: ({ signal }) =>
      apiGetPage<AdminAssistantConversation>('/admin/assistant/conversations', {
        query: filters,
        signal,
      }),
    placeholderData: keepPreviousData,
  });
}

/**
 * Every read of a conversation is audited on the server, so it is read once per visit: no
 * refetch on focus or reconnect, which would add audit rows nobody asked for.
 */
export function useAdminAssistantConversation(conversationId: string) {
  return useQuery({
    queryKey: adminKeys.assistantConversation(conversationId),
    queryFn: ({ signal }) =>
      apiGet<AdminAssistantConversationDetail>(path('assistant', 'conversations', conversationId), {
        signal,
      }),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });
}
