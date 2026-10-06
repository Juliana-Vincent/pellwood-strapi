import type { Core } from '@strapi/strapi';

/**
 * Keeps unpublished content private.
 *
 * Strapi 5's content API builds its query as `{ status: 'published', ...params }`,
 * so a `status` in the request overrides the default - and nothing strips it.
 * Anyone could read draft products, unpublished price changes, draft articles and
 * the draft Setting (delivery prices, discounts) with `?status=draft`, no login
 * needed.
 *
 * Unauthenticated requests asking for anything other than published content are
 * refused. Refused, not rewritten: changing Koa's parsed query in place risks
 * mangling the nested populate[...] and filters[...] keys every storefront
 * request depends on. The storefront never sends `status`, and requests carrying
 * an API token (the order and customer writes) are left alone.
 */
const ASKS_FOR_STATUS = /^(status|publicationState)(\[|$)/;

export default (_config: unknown, _ctx: { strapi: Core.Strapi }) => {
  return async (ctx: any, next: () => Promise<void>) => {
    if (ctx.path.startsWith('/api/') && !ctx.request.header.authorization) {
      const params = new URLSearchParams(ctx.querystring || '');
      for (const [key, value] of params) {
        if (ASKS_FOR_STATUS.test(key) && value !== 'published' && value !== 'live') {
          ctx.status = 403;
          ctx.body = {
            data: null,
            error: {
              status: 403,
              name: 'ForbiddenError',
              message: 'Only published content is available without authentication',
            },
          };
          return;
        }
      }
    }
    await next();
  };
};
