import type { Metadata } from 'next';

import { DraftNotice, InfoPage, InfoSection } from '@/components/storefront/info/info-page';

const DESCRIPTION = 'What this store records about you, and what is still to be decided.';

export const metadata: Metadata = { title: 'Privacy', description: DESCRIPTION };

/**
 * A factual summary of what the application does with personal data today, taken from the
 * schema and ADRs 0014, 0018 and 0019. It is NOT a privacy policy: retention and deletion,
 * hosting, email provider and legal review are open (PRD §9, database-design.md §8), so it
 * promises nothing about them. Replace it with the reviewed policy before launch.
 */
export default function PrivacyPage() {
  return (
    <InfoPage
      page="privacy"
      contents={[
        { id: 'what-we-record', title: 'What we record' },
        { id: 'payments', title: 'Payments' },
        { id: 'undecided', title: 'Still to be decided' },
      ]}
      eyebrow="Legal"
      title="Privacy"
      description={DESCRIPTION}
      draft="This page is a draft summary, not a legal privacy policy. It has not been legally reviewed, and how long data is kept and how it can be deleted are not decided yet."
    >
      <InfoSection id="what-we-record" title="What we record">
        <p>
          <strong className="font-medium text-foreground">Your account:</strong> your name, your
          email address and your password, and the sign-in sessions that keep you signed in.
        </p>
        <p>
          <strong className="font-medium text-foreground">Your orders:</strong> the items bought and
          their prices at the time, the delivery address and phone number you enter at checkout, the
          delivery option, and the status of the order and its payment. The email address on an
          order is your account&apos;s.
        </p>
        <p>
          <strong className="font-medium text-foreground">Your bag and wishlist:</strong> the pieces
          you add to them, while you are signed in.
        </p>
      </InfoSection>

      <InfoSection id="payments" title="Payments">
        <p>
          Online payments are taken on the payment provider&apos;s own page (SSLCOMMERZ, which
          includes bKash, cards and other mobile banking). Your payment details go straight to the
          provider: we never see or store them. We keep the outcome of the payment and the
          provider&apos;s reference for it. Cash on delivery involves no online payment.
        </p>
        <p>The online payment connection is currently a test (sandbox) one.</p>
      </InfoSection>

      <InfoSection id="undecided" title="Still to be decided">
        <p>
          How long order, payment and account records are kept, how accounts can be deleted, who can
          see this data, where it is hosted and how email is sent are not decided yet. Until they
          are, this page makes no promise about them.
        </p>
        <DraftNotice>A reviewed privacy policy is required before launch (PRD §8, §9).</DraftNotice>
      </InfoSection>
    </InfoPage>
  );
}
