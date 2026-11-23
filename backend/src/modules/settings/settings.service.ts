import type { StoreSettings } from '@prisma/client';
import { z } from 'zod';

import { env } from '../../config/env.js';
import { conflict } from '../../http/errors.js';
import { prisma } from '../../lib/prisma.js';
import { isUniqueViolation } from '../../lib/prisma-errors.js';
import { type TransactionClient, withTransaction } from '../../lib/transaction.js';
import type { AdminActionContext } from '../admin/customers.service.js';
import { AuditAction, recordAudit } from '../audit/audit.service.js';
import { DEFAULT_PRICING, MAX_MONEY_MINOR, type PricingSettings } from '../pricing/pricing.js';

/**
 * Shipping, tax and store identity (M10, ADR 0022). One row; until an administrator saves it,
 * `DEFAULT_SETTINGS` applies (ADR 0018's provisional fees, no tax, the env store name).
 *
 * Checkout reads these inside its transaction, so the order is priced with what was in force when
 * it committed. A change while a customer is on the checkout page shows up as a changed total, and
 * the `expectedTotalMinor` guard refuses the order until they have seen it.
 *
 * Every save is conditional on `version`: the administrator sends the version they loaded, and a
 * save over someone else's newer one is refused (409) instead of silently undoing it.
 */
export interface StoreSettingsView {
  readonly storeName: string;
  readonly supportEmail: string | null;
  readonly standardFeeDhakaMinor: number;
  readonly standardFeeNationalMinor: number;
  readonly expressEnabled: boolean;
  readonly expressFeeDhakaMinor: number;
  readonly expressFeeNationalMinor: number;
  readonly freeShippingThresholdMinor: number | null;
  readonly taxRateBps: number;
  /** 0 while the defaults apply (nothing saved yet). */
  readonly version: number;
  readonly updatedAt: Date | null;
  readonly updatedBy: { readonly id: string; readonly name: string } | null;
}

type Editable = Omit<StoreSettingsView, 'version' | 'updatedAt' | 'updatedBy'>;

export function defaultSettings(): StoreSettingsView {
  return {
    storeName: env.STORE_NAME,
    supportEmail: null,
    standardFeeDhakaMinor: DEFAULT_PRICING.feesMinor.standard.dhaka,
    standardFeeNationalMinor: DEFAULT_PRICING.feesMinor.standard.national,
    expressEnabled: DEFAULT_PRICING.expressEnabled,
    expressFeeDhakaMinor: DEFAULT_PRICING.feesMinor.express.dhaka,
    expressFeeNationalMinor: DEFAULT_PRICING.feesMinor.express.national,
    freeShippingThresholdMinor: DEFAULT_PRICING.freeShippingThresholdMinor,
    taxRateBps: DEFAULT_PRICING.taxRateBps,
    version: 0,
    updatedAt: null,
    updatedBy: null,
  };
}

type Row = StoreSettings & { updatedBy: { id: string; name: string } | null };

function toView(row: Row): StoreSettingsView {
  return {
    storeName: row.storeName,
    supportEmail: row.supportEmail,
    standardFeeDhakaMinor: row.standardFeeDhakaMinor,
    standardFeeNationalMinor: row.standardFeeNationalMinor,
    expressEnabled: row.expressEnabled,
    expressFeeDhakaMinor: row.expressFeeDhakaMinor,
    expressFeeNationalMinor: row.expressFeeNationalMinor,
    freeShippingThresholdMinor: row.freeShippingThresholdMinor,
    taxRateBps: row.taxRateBps,
    version: row.version,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
  };
}

const INCLUDE = { updatedBy: { select: { id: true, name: true } } } as const;

/** The settings in force. Pass the transaction to read them under the caller's snapshot. */
export async function getStoreSettings(
  db: TransactionClient | typeof prisma = prisma,
): Promise<StoreSettingsView> {
  const row = await db.storeSettings.findUnique({ where: { id: 'default' }, include: INCLUDE });
  return row ? toView(row) : defaultSettings();
}

export function pricingOf(settings: StoreSettingsView): PricingSettings {
  return {
    feesMinor: {
      standard: {
        dhaka: settings.standardFeeDhakaMinor,
        national: settings.standardFeeNationalMinor,
      },
      express: { dhaka: settings.expressFeeDhakaMinor, national: settings.expressFeeNationalMinor },
    },
    expressEnabled: settings.expressEnabled,
    freeShippingThresholdMinor: settings.freeShippingThresholdMinor,
    taxRateBps: settings.taxRateBps,
  };
}

/** Delivery fees up to ৳100,000; a higher one is far more likely a typo in poisha than a fee. */
const fee = z.number().int().min(0).max(10_000_000);

export const storeSettingsBody = z.strictObject({
  /** The version the administrator loaded; 0 when nothing had been saved yet. */
  version: z.number().int().min(0),
  storeName: z.string().trim().min(1).max(80),
  supportEmail: z.email().max(254).nullable(),
  standardFeeDhakaMinor: fee,
  standardFeeNationalMinor: fee,
  expressEnabled: z.boolean(),
  expressFeeDhakaMinor: fee,
  expressFeeNationalMinor: fee,
  freeShippingThresholdMinor: z.number().int().min(1).max(MAX_MONEY_MINOR).nullable(),
  /** Exclusive tax, 0–50 %, in basis points. */
  taxRateBps: z.number().int().min(0).max(5_000),
});

export type StoreSettingsInput = z.output<typeof storeSettingsBody>;

function editable(view: StoreSettingsView): Editable {
  const { version: _version, updatedAt: _updatedAt, updatedBy: _updatedBy, ...rest } = view;
  return rest;
}

const STALE = 'Someone else saved the settings after you opened them. Reload to see their changes.';

/** `PUT /admin/settings`. Audited with what changed, before and after. */
export async function updateStoreSettings(
  input: StoreSettingsInput,
  context: AdminActionContext,
): Promise<StoreSettingsView> {
  const { version, ...values } = input;

  try {
    return await withTransaction(
      async (tx) => {
        const before = await getStoreSettings(tx);

        if (before.version !== version) throw conflict(STALE);

        const data = { ...values, updatedByUserId: context.actor.id };

        if (version === 0) {
          // A concurrent first save loses on the primary key, handled below.
          await tx.storeSettings.create({ data: { id: 'default', ...data, version: 1 } });
        } else {
          const { count } = await tx.storeSettings.updateMany({
            where: { id: 'default', version },
            data: { ...data, version: { increment: 1 } },
          });
          if (count === 0) throw conflict(STALE);
        }

        const after = await getStoreSettings(tx);
        const previous = editable(before);
        const next = editable(after);
        const changed = (Object.keys(next) as (keyof Editable)[]).filter(
          (key) => previous[key] !== next[key],
        );

        await recordAudit(tx, {
          action: AuditAction.SETTINGS_UPDATED,
          entityType: 'StoreSettings',
          entityId: 'default',
          actor: context.actor,
          before: Object.fromEntries(changed.map((key) => [key, previous[key]])),
          after: Object.fromEntries(changed.map((key) => [key, next[key]])),
          ...(context.ipAddress === undefined ? {} : { ipAddress: context.ipAddress }),
          ...(context.requestId === undefined ? {} : { requestId: context.requestId }),
        });

        return after;
      },
      { label: 'settings.update' },
    );
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict(STALE);
    throw error;
  }
}
