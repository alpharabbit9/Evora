'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useMemo, useState } from 'react';
import { type FieldPath, useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';

import { CART_COLUMNS, CartSkeleton } from '@/components/cart/cart-skeleton';
import { ProductImage } from '@/components/catalog/product-image';
import { ErrorState } from '@/components/common/error-state';
import { TextField } from '@/components/common/text-field';
import { useAsyncAction } from '@/hooks/use-async-action';
import { ApiErrorCode, errorMessage, isApiError } from '@/lib/api-error';
import type { Cart } from '@/lib/catalog/types';
import type {
  CheckoutQuote,
  CouponQuote,
  DeliveryOptionId,
  PaymentMethodId,
  SavedAddress,
} from '@/lib/checkout/types';
import {
  clearAttemptKey,
  useCheckoutQuote,
  usePlaceOrder,
  useSavedAddresses,
  useStartPayment,
} from '@/lib/checkout/use-checkout';
import { formatMoney } from '@/lib/money';
import { signInPath } from '@/lib/safe-redirect';
import { cn } from '@/lib/utils';

/** The only country the API delivers to for now (ADR 0018). It refuses any other. */
const COUNTRY_CODE = 'BD';
const COUNTRY_NAME = 'Bangladesh';

const QUOTE_DEBOUNCE_MS = 400;

const NEW_ADDRESS = 'new';

const SECTION_LABEL = 'text-[10px] font-semibold tracking-[0.24em] text-muted-foreground uppercase';

/** UX only: the API validates all of this again, and its verdict lands on the same fields. */
const addressSchema = z.object({
  recipientName: z.string().trim().min(1, 'Enter the recipient’s name').max(120),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9][0-9\s()-]{6,30}$/, 'Enter a valid phone number'),
  line1: z.string().trim().min(1, 'Enter your address').max(200),
  line2: z.string().trim().max(200),
  city: z.string().trim().min(1, 'Enter your city').max(120),
  state: z.string().trim().max(120),
  postalCode: z.string().trim().min(1, 'Enter your postal code').max(32),
});

type AddressValues = z.infer<typeof addressSchema>;

const EMPTY_ADDRESS: AddressValues = {
  recipientName: '',
  phone: '',
  line1: '',
  line2: '',
  city: '',
  state: '',
  postalCode: '',
};

function toFormValues(address: SavedAddress): AddressValues {
  return {
    recipientName: address.recipientName,
    phone: address.phone ?? '',
    line1: address.line1,
    line2: address.line2 ?? '',
    city: address.city,
    state: address.state ?? '',
    postalCode: address.postalCode,
  };
}

/** The value settles after `delayMs` without a change, so typing a city is one quote, not six. */
function useDebounced<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSettled(value);
    }, delayMs);

    return () => {
      clearTimeout(timer);
    };
  }, [value, delayMs]);

  return settled;
}

/**
 * The address, delivery and payment form, beside a summary the server priced.
 *
 * The browser adds nothing up. It sends variants, quantities and an address, and displays what
 * comes back. The total on screen goes back with the order as `expectedTotalMinor`: if the server
 * would now charge something else (a price changed, a sale ended) it refuses rather than charge
 * more than the customer agreed to, and the refreshed quote is what they see next.
 */
export function CheckoutForm({ cart, onPlaced }: { cart: Cart; onPlaced: () => void }) {
  const savedAddresses = useSavedAddresses();

  if (savedAddresses.isPending) {
    return <CartSkeleton />;
  }

  // A failed read only costs the shortcut: the customer can still type an address.
  return (
    <AddressAndPayment
      cart={cart}
      onPlaced={onPlaced}
      addresses={(savedAddresses.data ?? []).filter(
        (address) => address.countryCode === COUNTRY_CODE,
      )}
    />
  );
}

/**
 * Mounted once the saved addresses are known, so the form can start from the first of them and
 * never has to overwrite what the customer has begun typing.
 */
function AddressAndPayment({
  cart,
  onPlaced,
  addresses,
}: {
  cart: Cart;
  onPlaced: () => void;
  addresses: readonly SavedAddress[];
}) {
  const router = useRouter();
  const first = addresses[0];

  const [addressChoice, setAddressChoice] = useState(first ? first.id : NEW_ADDRESS);
  const [deliveryOption, setDeliveryOption] = useState<DeliveryOptionId>('standard');
  const [chosenPayment, setChosenPayment] = useState<PaymentMethodId>('COD');
  const [saveAddress, setSaveAddress] = useState(false);
  const [couponCode, setCouponCode] = useState<string | undefined>(undefined);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    setFocus,
    control,
    formState: { errors },
  } = useForm<AddressValues>({
    resolver: zodResolver(addressSchema),
    defaultValues: first ? toFormValues(first) : EMPTY_ADDRESS,
  });

  const city = useWatch({ control, name: 'city' }).trim();
  const settledCity = useDebounced(city, QUOTE_DEBOUNCE_MS);

  const items = useMemo(
    () => cart.items.map((line) => ({ variantId: line.variant.id, quantity: line.quantity })),
    [cart.items],
  );

  const quote = useCheckoutQuote({
    items,
    destination: settledCity ? { city: settledCity, countryCode: COUNTRY_CODE } : null,
    deliveryOption,
    couponCode,
  });

  // An option the store has switched off is not offered; the server priced standard instead.
  const offeredDelivery = quote.data?.deliveryOptions.map((option) => option.id) ?? [];
  const effectiveDelivery: DeliveryOptionId =
    offeredDelivery.length === 0 || offeredDelivery.includes(deliveryOption)
      ? deliveryOption
      : 'standard';
  const appliedCoupon =
    quote.data?.coupon?.status === 'applied' ? quote.data.coupon.code : undefined;

  // The server says what is on offer for this total. A choice that stops being offered (an address
  // change moved the total past the provider's limit) falls back rather than being refused later.
  const offeredPayments = quote.data?.paymentMethods ?? ['COD'];
  const paymentMethod: PaymentMethodId = offeredPayments.includes(chosenPayment)
    ? chosenPayment
    : 'COD';

  const startPayment = useStartPayment();
  const placeOrder = usePlaceOrder();
  const place = useAsyncAction(placeOrder.mutateAsync, {
    toastOnError: false,
    onError: (error) => {
      if (!isApiError(error)) return;

      if (error.code === ApiErrorCode.UNAUTHENTICATED) {
        router.replace(signInPath('/checkout'));
        return;
      }

      // The key already bought something else: the earlier attempt reached the server after
      // all. Further tries need a new key, and the customer needs to look before making one.
      if (error.code === ApiErrorCode.IDEMPOTENCY_CONFLICT) {
        clearAttemptKey();
      }

      let focused = false;
      for (const detail of error.details) {
        const field = detail.field.replace(/^shipping\./, '');
        if (field !== detail.field && field in EMPTY_ADDRESS) {
          setError(field as FieldPath<AddressValues>, { type: 'server', message: detail.issue });
          if (!focused) setFocus(field as FieldPath<AddressValues>);
          focused = true;
        }
      }
    },
  });
  const failure = place.error;

  // The on-screen total can be agreed to only when it is for the address and option in the form.
  const quoteIsCurrent = !quote.isFetching && !quote.isPlaceholderData && city === settledCity;
  const canPlace = quoteIsCurrent && quote.data?.totalMinor != null && !quote.data.hasIssues;

  const onSubmit = handleSubmit(async (values) => {
    const total = quote.data?.totalMinor;
    if (!canPlace || total === null || total === undefined) return;

    const order = await place.run({
      items,
      shipping: {
        recipientName: values.recipientName,
        phone: values.phone,
        line1: values.line1,
        line2: values.line2 || null,
        city: values.city,
        state: values.state || null,
        postalCode: values.postalCode,
        countryCode: COUNTRY_CODE,
      },
      deliveryOption: effectiveDelivery,
      paymentMethod,
      saveAddress: addressChoice === NEW_ADDRESS && saveAddress,
      ...(appliedCoupon ? { couponCode: appliedCoupon } : {}),
      expectedTotalMinor: total,
    });

    if (!order) return;

    onPlaced();

    if (order.paymentMethod === 'ONLINE') {
      try {
        const { redirectUrl } = await startPayment.mutateAsync(order.id);
        window.location.assign(redirectUrl);
        return;
      } catch {
        // The order exists and is waiting. Its page explains that and offers to try again.
      }
    }

    router.replace(`/orders/${order.id}?placed=1`);
  });

  const chooseAddress = (choice: string) => {
    setAddressChoice(choice);
    const address = addresses.find((candidate) => candidate.id === choice);
    reset(address ? toFormValues(address) : EMPTY_ADDRESS);
  };

  const isConflict = isApiError(failure) && failure.code === ApiErrorCode.IDEMPOTENCY_CONFLICT;

  return (
    <form onSubmit={onSubmit} noValidate className={CART_COLUMNS}>
      <div className="flex flex-col gap-12">
        <section aria-labelledby="checkout-address" className="flex flex-col gap-5">
          <h2 id="checkout-address" className={SECTION_LABEL}>
            Delivery address
          </h2>

          {addresses.length > 0 ? (
            <fieldset className="flex flex-col gap-2">
              <legend className="sr-only">Choose a saved address</legend>
              {addresses.map((address) => (
                <ChoiceCard
                  key={address.id}
                  name="address-choice"
                  checked={addressChoice === address.id}
                  onChange={() => {
                    chooseAddress(address.id);
                  }}
                >
                  <span className="block font-medium">
                    {address.label ?? address.recipientName}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {[address.line1, address.city, address.postalCode].join(', ')}
                  </span>
                </ChoiceCard>
              ))}
              <ChoiceCard
                name="address-choice"
                checked={addressChoice === NEW_ADDRESS}
                onChange={() => {
                  chooseAddress(NEW_ADDRESS);
                }}
              >
                <span className="block font-medium">A new address</span>
              </ChoiceCard>
            </fieldset>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="Full name"
              autoComplete="name"
              registration={register('recipientName')}
              error={errors.recipientName?.message}
            />
            <TextField
              label="Phone"
              type="tel"
              autoComplete="tel"
              registration={register('phone')}
              error={errors.phone?.message}
              hint="The courier will call this number."
            />
            <TextField
              className="sm:col-span-2"
              label="Address"
              autoComplete="address-line1"
              registration={register('line1')}
              error={errors.line1?.message}
            />
            <TextField
              className="sm:col-span-2"
              label="Apartment, floor, landmark (optional)"
              autoComplete="address-line2"
              registration={register('line2')}
              error={errors.line2?.message}
            />
            <TextField
              label="City"
              autoComplete="address-level2"
              registration={register('city')}
              error={errors.city?.message}
              hint="Delivery fees depend on your city."
            />
            <TextField
              label="Division (optional)"
              autoComplete="address-level1"
              registration={register('state')}
              error={errors.state?.message}
            />
            <TextField
              label="Postal code"
              autoComplete="postal-code"
              registration={register('postalCode')}
              error={errors.postalCode?.message}
            />
            <div className="flex flex-col gap-1.5 text-sm">
              <span className="text-xs text-muted-foreground">Country</span>
              <span className="flex h-11 items-center">{COUNTRY_NAME}</span>
            </div>
          </div>

          {addressChoice === NEW_ADDRESS ? (
            <label className="flex items-center gap-2.5 text-sm">
              <input
                type="checkbox"
                checked={saveAddress}
                onChange={(event) => {
                  setSaveAddress(event.target.checked);
                }}
                className="size-4 accent-foreground"
              />
              Save this address to my account
            </label>
          ) : null}
        </section>

        <fieldset className="flex flex-col gap-3">
          <legend className={SECTION_LABEL}>Delivery option</legend>
          <div className="mt-2 flex flex-col gap-2">
            {(quote.data?.deliveryOptions ?? []).map((option) => (
              <ChoiceCard
                key={option.id}
                name="delivery-option"
                checked={effectiveDelivery === option.id}
                onChange={() => {
                  setDeliveryOption(option.id);
                }}
              >
                <span className="flex items-baseline justify-between gap-4">
                  <span>
                    <span className="block font-medium">{option.label}</span>
                    <span className="block text-xs text-muted-foreground">{option.estimate}</span>
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {option.feeMinor === null
                      ? 'Enter your city'
                      : option.feeMinor === 0
                        ? 'Free'
                        : formatMoney(option.feeMinor, cart.currency)}
                  </span>
                </span>
              </ChoiceCard>
            ))}
          </div>
        </fieldset>

        <section aria-labelledby="checkout-payment" className="flex flex-col gap-3">
          <h2 id="checkout-payment" className={SECTION_LABEL}>
            Payment
          </h2>
          {offeredPayments.includes('ONLINE') ? (
            <fieldset className="flex flex-col gap-2">
              <legend className="sr-only">Choose how to pay</legend>
              <ChoiceCard
                name="payment-method"
                checked={paymentMethod === 'COD'}
                onChange={() => {
                  setChosenPayment('COD');
                }}
              >
                <span className="block font-medium">Cash on delivery</span>
                <span className="block text-xs text-muted-foreground">
                  Pay in cash when your order arrives. There is nothing to pay today.
                </span>
              </ChoiceCard>
              <ChoiceCard
                name="payment-method"
                checked={paymentMethod === 'ONLINE'}
                onChange={() => {
                  setChosenPayment('ONLINE');
                }}
              >
                <span className="block font-medium">Pay online</span>
                <span className="block text-xs text-muted-foreground">
                  bKash, card or other mobile banking through SSLCOMMERZ. You choose on their secure
                  page, and we never see your payment details.
                </span>
              </ChoiceCard>
            </fieldset>
          ) : (
            <div className="border border-foreground p-4 text-sm">
              <p className="font-medium">Cash on delivery</p>
              <p className="text-xs text-muted-foreground">
                Pay in cash when your order arrives. There is nothing to pay today.
              </p>
            </div>
          )}
        </section>
      </div>

      <aside
        aria-labelledby="checkout-summary"
        className="self-start border border-border p-6 lg:sticky lg:top-28"
      >
        <h2 id="checkout-summary" className={SECTION_LABEL}>
          Order summary
        </h2>

        {quote.isError && !quote.data ? (
          <ErrorState
            className="py-6"
            error={quote.error}
            title="We couldn't price your order"
            onRetry={() => {
              void quote.refetch();
            }}
          />
        ) : (
          <Summary
            quote={quote.data}
            currency={cart.currency}
            updating={quote.isFetching || city !== settledCity}
          />
        )}

        <PromoCode
          applied={couponCode}
          quoteCoupon={quote.data?.coupon ?? null}
          checking={quote.isFetching}
          onApply={setCouponCode}
        />

        {/* Always mounted, so a screen reader hears each new outcome. */}
        <div role="alert" className="text-xs leading-5 text-destructive empty:hidden">
          {failure ? (
            <p className="mt-4">
              {errorMessage(failure)}{' '}
              {isConflict ? (
                <>
                  An earlier attempt may already have gone through, so check{' '}
                  <Link href="/account" className="underline">
                    your orders
                  </Link>{' '}
                  before trying again.
                </>
              ) : null}
            </p>
          ) : null}
        </div>

        <button
          type="submit"
          disabled={place.isPending || (Boolean(city) && !canPlace)}
          className="mt-5 flex h-12 w-full items-center justify-center rounded-md bg-foreground px-6 text-sm font-semibold text-background transition-opacity hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-40"
        >
          {place.isPending
            ? 'Placing your order…'
            : paymentMethod === 'ONLINE'
              ? 'Place order and pay'
              : 'Place order'}
        </button>
        <p className="mt-3 text-xs leading-5 text-muted-foreground">
          Prices and stock are confirmed when you place your order.
        </p>
      </aside>
    </form>
  );
}

function Summary({
  quote,
  currency,
  updating,
}: {
  quote: CheckoutQuote | undefined;
  currency: string;
  updating: boolean;
}) {
  if (!quote) {
    return (
      <p role="status" className="mt-5 text-sm text-muted-foreground">
        Pricing your order…
      </p>
    );
  }

  return (
    <div className={cn('transition-opacity', updating && 'opacity-60')} aria-busy={updating}>
      <ul className="mt-5 flex flex-col gap-4">
        {quote.items.map((line) => (
          <li key={line.variantId} className="flex gap-3 text-sm">
            <div className="relative aspect-[3/4] w-14 shrink-0 overflow-hidden bg-muted">
              <ProductImage image={line.product.image} sizes="56px" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="leading-snug">{line.product.name}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {[line.color, line.size ? `Size ${line.size}` : null, `Qty ${line.quantity}`]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              {line.status !== 'available' ? (
                <p className="mt-0.5 text-xs text-destructive">
                  No longer available at this quantity.
                </p>
              ) : null}
            </div>
            <p className="shrink-0 tabular-nums">{formatMoney(line.lineTotalMinor, currency)}</p>
          </li>
        ))}
      </ul>

      <dl className="mt-5 flex flex-col gap-2.5 border-t border-border pt-5 text-sm tabular-nums">
        <div className="flex items-baseline justify-between gap-4">
          <dt>Subtotal</dt>
          <dd>{formatMoney(quote.subtotalMinor, currency)}</dd>
        </div>
        {quote.discountMinor > 0 ? (
          <div className="flex items-baseline justify-between gap-4">
            <dt>Discount{quote.coupon ? ` (${quote.coupon.code})` : ''}</dt>
            <dd>−{formatMoney(quote.discountMinor, currency)}</dd>
          </div>
        ) : null}
        <div className="flex items-baseline justify-between gap-4">
          <dt>Delivery</dt>
          <dd className={quote.shippingMinor === null ? 'text-muted-foreground' : undefined}>
            {quote.shippingMinor === null
              ? 'Enter your city'
              : quote.shippingMinor === 0
                ? 'Free'
                : formatMoney(quote.shippingMinor, currency)}
          </dd>
        </div>
        {quote.taxMinor > 0 ? (
          <div className="flex items-baseline justify-between gap-4">
            <dt>Tax</dt>
            <dd>{formatMoney(quote.taxMinor, currency)}</dd>
          </div>
        ) : null}
        <div className="flex items-baseline justify-between gap-4 border-t border-border pt-3 text-base font-medium">
          <dt>Total</dt>
          <dd>{quote.totalMinor === null ? '—' : formatMoney(quote.totalMinor, currency)}</dd>
        </div>
      </dl>

      {quote.freeShippingThresholdMinor !== null && quote.shippingMinor !== 0 ? (
        <p className="mt-3 text-xs leading-5 text-muted-foreground">
          Free delivery on orders of {formatMoney(quote.freeShippingThresholdMinor, currency)} or
          more.
        </p>
      ) : null}

      {quote.hasIssues ? (
        <p className="mt-4 text-xs leading-5 text-destructive">
          Something in your order just changed.{' '}
          <Link href="/cart" className="underline">
            Review your bag
          </Link>{' '}
          to continue.
        </p>
      ) : null}
    </div>
  );
}

/**
 * One promo code per order. The server decides whether it applies (ADR 0022); a code it refuses is
 * shown with its reason and left off the order, so it can never be the reason an order fails.
 */
function PromoCode({
  applied,
  quoteCoupon,
  checking,
  onApply,
}: {
  applied: string | undefined;
  quoteCoupon: CouponQuote | null;
  checking: boolean;
  onApply: (code: string | undefined) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState('');
  const outcome = applied && quoteCoupon?.code === applied.toUpperCase() ? quoteCoupon : null;

  if (applied) {
    return (
      <div className="mt-5 border-t border-border pt-4 text-sm">
        <div className="flex items-center justify-between gap-3">
          <p>
            <span className="text-xs text-muted-foreground">Promo code</span>{' '}
            <span className="font-medium">{applied.toUpperCase()}</span>
          </p>
          <button
            type="button"
            className="text-xs underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
            onClick={() => {
              onApply(undefined);
              setDraft('');
            }}
          >
            Remove
          </button>
        </div>
        <p
          role="status"
          className={cn(
            'mt-1 text-xs leading-5',
            outcome?.status === 'refused' ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          {!outcome || checking
            ? 'Checking…'
            : outcome.status === 'applied'
              ? 'Applied.'
              : outcome.message}
        </p>
      </div>
    );
  }

  return (
    <div className="mt-5 border-t border-border pt-4">
      <label htmlFor={id} className="text-xs text-muted-foreground">
        Promo code
      </label>
      <div className="mt-1.5 flex gap-2">
        <input
          id={id}
          value={draft}
          maxLength={32}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
          onKeyDown={(event) => {
            // Inside the checkout form: Enter applies the code rather than placing the order.
            if (event.key === 'Enter') {
              event.preventDefault();
              if (draft.trim()) onApply(draft.trim());
            }
          }}
          className="h-10 min-w-0 flex-1 border border-border bg-transparent px-3 text-sm uppercase focus-visible:outline-2 focus-visible:outline-ring"
        />
        <button
          type="button"
          disabled={!draft.trim()}
          onClick={() => {
            onApply(draft.trim());
          }}
          className="h-10 shrink-0 border border-foreground px-4 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-40"
        >
          Apply
        </button>
      </div>
    </div>
  );
}

function ChoiceCard({
  name,
  checked,
  onChange,
  children,
}: {
  name: string;
  checked: boolean;
  onChange: () => void;
  children: React.ReactNode;
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-center gap-3 border p-4 text-sm transition-colors has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring',
        checked ? 'border-foreground' : 'border-border hover:border-foreground/50',
      )}
    >
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onChange}
        className="size-4 shrink-0 accent-foreground"
      />
      <span className="min-w-0 flex-1">{children}</span>
    </label>
  );
}
