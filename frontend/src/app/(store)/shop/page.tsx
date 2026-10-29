import type { Metadata } from 'next';

import { CollectionPage } from '@/components/catalog/collection-page';

const DESCRIPTION = 'Outerwear, tailoring, denim, footwear and accessories in a darker register.';

export const metadata: Metadata = { title: 'Shop all', description: DESCRIPTION };

/**
 * The whole catalog. Category, gender and every other filter are query parameters
 * (`/shop?category=boots&gender=men`), read by `CatalogBrowser`.
 */
export default function ShopPage() {
  return (
    <CollectionPage
      eyebrow="The collection"
      title="Shop all"
      description={DESCRIPTION}
      preset={{}}
    />
  );
}
