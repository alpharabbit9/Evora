import type { Metadata } from 'next';

import { DraftNotice, InfoPage, InfoSection } from '@/components/storefront/info/info-page';

const DESCRIPTION = 'Delivery options, fees, cancellations and returns.';

export const metadata: Metadata = { title: 'Shipping & returns', description: DESCRIPTION };

/**
 * Provisional development values from ADR 0018 (decision 6) and
 * `backend/src/modules/pricing/pricing.ts`. They are not store policy: PRD §9 has not decided
 * shipping zones or fees. Keep this table in step with the backend, and replace it when the
 * decision is made.
 */
const DELIVERY_OPTIONS = [
  { name: 'Standard', estimate: 'Usually 3–5 working days', dhaka: '৳80', elsewhere: '৳150' },
  { name: 'Express', estimate: 'Usually 1–2 working days', dhaka: '৳150', elsewhere: '৳250' },
] as const;

export default function ShippingPage() {
  return (
    <InfoPage
      page="shipping"
      contents={[
        { id: 'delivery', title: 'Delivery' },
        { id: 'cancellations', title: 'Cancelling an order' },
        { id: 'returns', title: 'Returns' },
      ]}
      eyebrow="Help"
      title="Shipping & returns"
      description={DESCRIPTION}
      draft="The fees and rules on this page are provisional development values, not final store policy. Shipping zones and fees, and cancellation and refund eligibility, are still to be decided."
    >
      <InfoSection id="delivery" title="Delivery">
        <p>
          We deliver within Bangladesh only. The fee for your order is shown at checkout, before you
          pay, and is worked out from your delivery address: orders to an address in Dhaka are
          charged the Dhaka rate, and all others the rate for elsewhere in Bangladesh.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[30rem] border-collapse text-left text-sm">
            <caption className="sr-only">
              Provisional delivery options, estimates and fees in Bangladeshi taka
            </caption>
            <thead>
              <tr className="border-b border-border text-[10px] font-semibold tracking-[0.18em] text-foreground uppercase">
                <th scope="col" className="py-3 pr-4 font-semibold">
                  Option
                </th>
                <th scope="col" className="py-3 pr-4 font-semibold">
                  Estimate
                </th>
                <th scope="col" className="py-3 pr-4 font-semibold">
                  Dhaka
                </th>
                <th scope="col" className="py-3 font-semibold">
                  Elsewhere
                </th>
              </tr>
            </thead>
            <tbody>
              {DELIVERY_OPTIONS.map((option) => (
                <tr key={option.name} className="border-b border-border">
                  <th scope="row" className="py-3 pr-4 font-medium text-foreground">
                    {option.name}
                  </th>
                  <td className="py-3 pr-4">{option.estimate}</td>
                  <td className="py-3 pr-4">{option.dhaka}</td>
                  <td className="py-3">{option.elsewhere}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>Estimates are not guarantees. No tax is added to an order for now.</p>
      </InfoSection>

      <InfoSection id="cancellations" title="Cancelling an order">
        <p>
          You can cancel an order yourself from its page until it starts being prepared. After that
          it can no longer be cancelled online. If you had already paid, the payment is refunded to
          the way you paid.
        </p>
        <DraftNotice>
          This cancellation rule is provisional (ADR 0020) and may change before launch.
        </DraftNotice>
      </InfoSection>

      <InfoSection id="returns" title="Returns">
        <p>
          The home page mentions returns within 30 days of delivery. That window is not backed by a
          decided returns policy yet, and there is no self-service returns request. Eligibility for
          returns and exchanges, including for orders paid in cash on delivery, will be published
          here once it is decided.
        </p>
        <DraftNotice>Returns policy not decided.</DraftNotice>
      </InfoSection>
    </InfoPage>
  );
}
