import { z } from 'zod';

/**
 * Calendar-day ranges for reports (M10, ADR 0022). Days are the store's days: Bangladesh,
 * UTC+06:00 all year (no daylight saving), so a day's bounds are a fixed offset from UTC. A
 * different store time zone would need a real zone database here.
 */
export const STORE_UTC_OFFSET = '+06:00';
export const STORE_OFFSET_MINUTES = 6 * 60;
const OFFSET_MINUTES = STORE_OFFSET_MINUTES;

/** A report may cover at most this many days, which bounds what one request can make the DB read. */
export const MAX_RANGE_DAYS = 366;

const day = z.iso.date();

export const dateRangeQuery = z
  .object({ from: day.optional(), to: day.optional() })
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    path: ['to'],
    message: 'Must not be before `from`',
  });

export interface DayRange {
  /** Inclusive store-local dates, `YYYY-MM-DD`. */
  readonly from: string;
  readonly to: string;
  /** UTC instants: [start, end). */
  readonly start: Date;
  readonly end: Date;
  readonly days: number;
}

/** Today's date in the store's time zone. */
export function storeToday(now: Date = new Date()): string {
  return new Date(now.getTime() + OFFSET_MINUTES * 60_000).toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/**
 * Defaults to the last `defaultDays` days ending today. A range longer than `MAX_RANGE_DAYS` is a
 * 400 from the caller (see `assertBounded`), not silently shortened.
 */
export function resolveRange(
  query: { readonly from?: string | undefined; readonly to?: string | undefined },
  options: { readonly defaultDays?: number; readonly now?: Date } = {},
): DayRange {
  const to = query.to ?? storeToday(options.now);
  const from = query.from ?? addDays(to, -((options.defaultDays ?? 30) - 1));
  const start = new Date(`${from}T00:00:00${STORE_UTC_OFFSET}`);
  const end = new Date(`${addDays(to, 1)}T00:00:00${STORE_UTC_OFFSET}`);
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000);

  return { from, to, start, end, days };
}

export function listDays(range: DayRange): string[] {
  return Array.from({ length: range.days }, (_, index) => addDays(range.from, index));
}
