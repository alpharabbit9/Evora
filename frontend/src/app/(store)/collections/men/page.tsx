import type { Metadata } from 'next';

import { CollectionPage } from '@/components/catalog/collection-page';

const DESCRIPTION = 'Dark jackets, tailoring, denim, boots and the accessories that finish them.';

export const metadata: Metadata = { title: 'Men', description: DESCRIPTION };

export default function MenCollectionPage() {
  return (
    <CollectionPage
      eyebrow="Collection"
      title="Men"
      description={DESCRIPTION}
      preset={{ gender: 'men' }}
    />
  );
}
