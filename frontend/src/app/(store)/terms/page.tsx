import type { Metadata } from 'next';

import { DraftNotice, InfoPage, InfoSection } from '@/components/storefront/info/info-page';

const DESCRIPTION = 'How ordering works in this store, and what is still to be decided.';

export const metadata: Metadata = { title: 'Terms', description: DESCRIPTION };

/**
 * A factual summary of how ordering behaves today (ADRs 0014, 0018, 0019, 0020). It is NOT
 * legal terms of sale: tax, refund and cancellation eligibility and the legal entity are
 * open (PRD §9). Replace it with reviewed terms before launch.
 */
export default function TermsPage() {
  return (
    <InfoPage
      page="terms"
      contents={[
        { id: 'status', title: 'This store is a demo' },
        { id: 'ordering', title: 'Ordering' },
        { id: 'cancellations-returns', title: 'Cancellations and returns' },
        { id: 'undecided', title: 'Still to be decided' },
      ]}
      eyebrow="Legal"
      title="Terms"
      description={DESCRIPTION}
      draft="This page is a draft summary of how the store works today, not legal terms of sale. It has not been legally reviewed."
    >
      <InfoSection id="status" title="This store is a demo">
        <p>
          The catalog is a development dataset: product photos and names come from the Kaggle
          “Fashion Product Images” dataset, and prices and stock are generated for development.
          Nothing here is for sale, and online payments use a test connection.
        </p>
      </InfoSection>

      <InfoSection id="ordering" title="Ordering">
        <p>
          You need an account to place an order. Prices are in Bangladeshi taka (BDT), and we
          deliver within Bangladesh only. The total for an order, including delivery, is worked out
          by the store from its own prices when you place the order, and shown to you first.
        </p>
        <p>
          You can pay on delivery, or online through SSLCOMMERZ. An online order is held for a
          limited time while you pay, and is closed if payment does not complete.
        </p>
      </InfoSection>

      <InfoSection id="cancellations-returns" title="Cancellations and returns">
        <p>
          You can cancel an order until it starts being prepared. Returns and refunds after delivery
          are not covered by a decided policy yet.
        </p>
      </InfoSection>

      <InfoSection id="undecided" title="Still to be decided">
        <p>
          Tax, shipping zones and fees, cancellation and refund eligibility (including for cash on
          delivery) and the legal details of the seller are not decided yet. Until they are, nothing
          on this page is a binding commitment.
        </p>
        <DraftNotice>Reviewed terms are required before launch (PRD §8, §9).</DraftNotice>
      </InfoSection>
    </InfoPage>
  );
}
