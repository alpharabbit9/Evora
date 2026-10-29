import type { Metadata } from 'next';

import { CollectionPage } from '@/components/catalog/collection-page';

const DESCRIPTION = 'Black denim, sharp outerwear, boots and leather goods, cut for women.';

export const metadata: Metadata = { title: 'Women', description: DESCRIPTION };

export default function WomenCollectionPage() {
  return (
    <CollectionPage
      eyebrow="Collection"
      title="Women"
      description={DESCRIPTION}
      preset={{ gender: 'women' }}
    />
  );
}
