import { Router } from 'express';

import { paged, respond, route } from '../../http/route.js';
import { pageMeta } from '../../http/schemas.js';
import { productFacetsQuery, productListQuery, productSlugParams } from './catalog.schemas.js';
import { listPublicCategories } from './categories.service.js';
import { getProductFacets, getPublicProduct, listProducts } from './products.service.js';

/**
 * The public catalog (API_SPEC.md §4). No guard: anonymous callers are the main audience.
 * What keeps unpublished data private is the publication rule inside every query
 * (`publication.ts`), not a session check, so there is no path through these routes that
 * reads a draft.
 *
 * `/products/facets` is registered before `/products/:slug`. Product slugs always end in a
 * source id or are admin-chosen, but the route order makes "facets" unambiguous regardless.
 */
export const productsRouter = Router();
export const categoriesRouter = Router();

productsRouter.get(
  '/',
  route({
    query: productListQuery,
    handler: async ({ query }) => {
      const { items, total } = await listProducts(query);
      return paged(items, pageMeta(query, total));
    },
  }),
);

productsRouter.get(
  '/facets',
  route({
    query: productFacetsQuery,
    handler: ({ query }) => getProductFacets(query),
  }),
);

productsRouter.get(
  '/:slug',
  route({
    params: productSlugParams,
    handler: ({ params }) => getPublicProduct(params.slug),
  }),
);

categoriesRouter.get(
  '/',
  route({
    handler: async () => respond(await listPublicCategories()),
  }),
);
