/**
 * The campaign photograph behind each listing page's banner, and the collections the banner
 * links between. A banner change is a data edit here; the files live in
 * `public/images/collections/`, resized to 2400px.
 *
 * All photos are from Unsplash, under the Unsplash License (free use, no attribution
 * required; credited anyway, on the banner and below). They are decorative mood images, not
 * product shots: nothing in them is claimed to be for sale.
 *
 * - leather-jackets-on-rack.jpg — Samuel Yongbo Kwon, unsplash.com/photos/6R5srMX5iUk
 * - man-in-leather-jacket-facing-away.jpg — Sergio Santo Pietro, unsplash.com/photos/8E53VLty99Y
 * - woman-in-leather-jacket-at-night.jpg — Valentina Kondrasyuk, unsplash.com/photos/vWCV_CvqMxY
 * - dark-clothing-on-store-rack.jpg — Elliot zoz, unsplash.com/photos/NoxwkSkOdCY
 * - leather-bag-zip-detail.jpg — Zahra, unsplash.com/photos/Ja33lkJc4JQ
 */

export type CollectionKey = 'shop' | 'men' | 'women' | 'new';

export interface BannerPhoto {
  readonly src: string;
  /** CSS `object-position`, so the subject stays clear of the copy on the left. */
  readonly position: string;
  readonly credit: { readonly name: string; readonly url: string };
}

export const COLLECTION_BANNERS: Record<CollectionKey, BannerPhoto> = {
  shop: {
    src: '/images/collections/leather-jackets-on-rack.jpg',
    position: '50% 40%',
    credit: { name: 'Samuel Yongbo Kwon', url: 'https://unsplash.com/photos/6R5srMX5iUk' },
  },
  men: {
    src: '/images/collections/man-in-leather-jacket-facing-away.jpg',
    position: '50% 30%',
    credit: { name: 'Sergio Santo Pietro', url: 'https://unsplash.com/photos/8E53VLty99Y' },
  },
  women: {
    src: '/images/collections/woman-in-leather-jacket-at-night.jpg',
    position: '50% 28%',
    credit: { name: 'Valentina Kondrasyuk', url: 'https://unsplash.com/photos/vWCV_CvqMxY' },
  },
  new: {
    src: '/images/collections/dark-clothing-on-store-rack.jpg',
    position: '50% 45%',
    credit: { name: 'Elliot zoz', url: 'https://unsplash.com/photos/NoxwkSkOdCY' },
  },
};

/** The editorial tile set into the first page of an unfiltered listing. */
export const EDITORIAL_TILE = {
  src: '/images/collections/leather-bag-zip-detail.jpg',
  position: '50% 50%',
  credit: { name: 'Zahra', url: 'https://unsplash.com/photos/Ja33lkJc4JQ' },
} as const satisfies BannerPhoto;

/** The banner's collection switcher, in nav order. */
export const COLLECTION_LINKS: readonly { key: CollectionKey; label: string; href: string }[] = [
  { key: 'shop', label: 'Shop all', href: '/shop' },
  { key: 'men', label: 'Men', href: '/collections/men' },
  { key: 'women', label: 'Women', href: '/collections/women' },
  { key: 'new', label: 'New arrivals', href: '/collections/new' },
];
