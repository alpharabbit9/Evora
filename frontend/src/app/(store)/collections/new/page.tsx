import type { Metadata } from 'next';

import { CollectionPage } from '@/components/catalog/collection-page';

const DESCRIPTION = 'The latest additions to the collection, newest first.';

export const metadata: Metadata = { title: 'New arrivals', description: DESCRIPTION };

export default function NewArrivalsPage() {
  return (
    <CollectionPage
      eyebrow="Just in"
      title="New arrivals"
      description={DESCRIPTION}
      preset={{ sort: 'newest' }}
    />
  );
}
