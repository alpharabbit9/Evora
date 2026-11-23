import type { ProductQuery } from '@/lib/catalog/api';

/**
 * The first nine front-runners, in `/shop`'s own order, so the two never disagree: one lead
 * tile and eight cards. At `lg` the lead is two columns by two rows of a four-column grid, so
 * 1 + 8 fills three rows exactly (1 + 4 fills two). At `md` (plan.md 8.3) the same lead sits
 * two by two in a three-column grid: two cards beside it and two rows of three below, so 1 + 8
 * fills four rows (1 + 4 would not, and keeps two columns there).
 *
 * A module of its own, not an export of the grid: the grid is a Client Component, and a value
 * imported from one into a Server Component arrives as a client reference, not the object. The
 * server prefetch (`dark-edit.tsx`) and the grid's `useQuery` must build the same query key.
 */
export const DARK_EDIT_QUERY: ProductQuery = { sort: 'featured', page: 1, pageSize: 9 };
