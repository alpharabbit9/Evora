/**
 * Ids of the product page's information tabs. Each is also the `id` of its tab button and the
 * URL fragment that opens it, so `/products/x#size-and-fit` and a plain `<a href>` to it work
 * without JavaScript. Kept out of the `'use client'` tabs module so the Server Component page
 * can import the strings themselves rather than client references.
 */
export const DETAILS_TAB = 'details';
export const SIZE_AND_FIT_TAB = 'size-and-fit';
export const SHIPPING_TAB = 'shipping-and-returns';

/**
 * Opens a tab from elsewhere on the page (the purchase panel's "Size guide"). The tabs listen
 * for `hashchange`; `replaceState` does not fire one, so it is dispatched here, which also
 * makes a repeat click work when the fragment is already in the URL.
 */
export function showProductTab(id: string): void {
  window.history.replaceState(window.history.state, '', `#${id}`);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}
