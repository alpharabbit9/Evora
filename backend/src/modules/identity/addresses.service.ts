import { notFound } from '../../http/errors.js';
import { prisma } from '../../lib/prisma.js';
import { withTransaction } from '../../lib/transaction.js';
import type { CreateAddressInput, UpdateAddressInput } from './identity.schemas.js';

/**
 * Saved addresses, owned by one user (API_SPEC.md §3, commerce invariant 7).
 *
 * Every query is scoped by `userId` as well as by the address id. That is the point: a
 * read or write for a row that belongs to someone else matches nothing, so there is no
 * second ownership check to forget, and no way to tell from the outside whether the id
 * exists at all (the answer is 404 either way).
 *
 * `isDefault` is backed by the partial unique index `addresses_one_default_per_user_key`.
 * Clearing the previous default and setting the new one therefore happen in one short
 * transaction — two concurrent "make this my default" calls cannot both win, because the
 * index would reject the second.
 */
export interface AddressView {
  readonly id: string;
  readonly label: string | null;
  readonly recipientName: string;
  readonly phone: string | null;
  readonly line1: string;
  readonly line2: string | null;
  readonly city: string;
  readonly state: string | null;
  readonly postalCode: string;
  readonly countryCode: string;
  readonly isDefault: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

const ADDRESS_SELECT = {
  id: true,
  label: true,
  recipientName: true,
  phone: true,
  line1: true,
  line2: true,
  city: true,
  state: true,
  postalCode: true,
  countryCode: true,
  isDefault: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** Shared wording: an address the caller does not own is indistinguishable from one that does not exist. */
function addressNotFound(): never {
  throw notFound('That address does not exist.');
}

export async function listAddresses(userId: string): Promise<AddressView[]> {
  return prisma.address.findMany({
    where: { userId },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    select: ADDRESS_SELECT,
  });
}

export async function createAddress(
  userId: string,
  input: CreateAddressInput,
): Promise<AddressView> {
  const { isDefault, ...fields } = input;

  return withTransaction(
    async (tx) => {
      if (isDefault) {
        await tx.address.updateMany({
          where: { userId, isDefault: true },
          data: { isDefault: false },
        });
      }

      return tx.address.create({
        data: { userId, isDefault, ...fields },
        select: ADDRESS_SELECT,
      });
    },
    { label: 'identity.createAddress' },
  );
}

export async function updateAddress(
  userId: string,
  addressId: string,
  input: UpdateAddressInput,
): Promise<AddressView> {
  return withTransaction(
    async (tx) => {
      // Scoped by owner: a foreign id simply is not here.
      const existing = await tx.address.findFirst({
        where: { id: addressId, userId },
        select: { id: true },
      });

      if (!existing) {
        addressNotFound();
      }

      if (input.isDefault === true) {
        await tx.address.updateMany({
          where: { userId, isDefault: true, id: { not: addressId } },
          data: { isDefault: false },
        });
      }

      // Every writable column is named. A partial update cannot be expressed as a spread
      // of the request body here, and that is a feature: a column becomes writable only
      // when it is added to this list on purpose.
      return tx.address.update({
        where: { id: addressId },
        data: {
          ...(input.label === undefined ? {} : { label: input.label }),
          ...(input.recipientName === undefined ? {} : { recipientName: input.recipientName }),
          ...(input.phone === undefined ? {} : { phone: input.phone }),
          ...(input.line1 === undefined ? {} : { line1: input.line1 }),
          ...(input.line2 === undefined ? {} : { line2: input.line2 }),
          ...(input.city === undefined ? {} : { city: input.city }),
          ...(input.state === undefined ? {} : { state: input.state }),
          ...(input.postalCode === undefined ? {} : { postalCode: input.postalCode }),
          ...(input.countryCode === undefined ? {} : { countryCode: input.countryCode }),
          ...(input.isDefault === undefined ? {} : { isDefault: input.isDefault }),
        },
        select: ADDRESS_SELECT,
      });
    },
    { label: 'identity.updateAddress' },
  );
}

export async function deleteAddress(userId: string, addressId: string): Promise<void> {
  // `deleteMany` with both keys: no row is loaded, so no ownership check can be skipped.
  const { count } = await prisma.address.deleteMany({ where: { id: addressId, userId } });

  if (count === 0) {
    addressNotFound();
  }
}
