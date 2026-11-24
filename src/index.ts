/**
 * Length, diameter and the EAN of a product without variants describe the stick,
 * not its wording, so they are the same in Czech and in English and the editor
 * fills them in once.
 *
 * The schema marks them as not localized, which makes Strapi write them to every
 * locale of the product - but it writes whatever the payload holds, so a save that
 * does not mention them (editing only the English text, say) propagates null and
 * wipes the number everywhere. This keeps them: the values are read before the
 * write and put back unless the editor actually changed or cleared them.
 */
const SHARED_PRODUCT_FIELDS = ['length', 'diameter', 'ean'] as const;
const SYNCED_ACTIONS = ['update', 'publish', 'unpublish', 'discardDraft'];

type Row = Record<string, unknown>;

const firstValue = (rows: Row[], field: string) => {
  const row = rows.find((candidate) => candidate[field] !== null && candidate[field] !== undefined);
  return row ? row[field] : undefined;
};

/**
 * Searching orders by name has to ignore Czech accents: a shop owner types
 * "novak" and expects Nováková. Postgres compares á and a as different letters
 * and the unaccent extension needs rights this database user does not have, so
 * each order carries an accent-free copy of the fields worth searching and the
 * admin searches that instead.
 */
const stripAccents = (value: unknown) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

const ORDER_SEARCH_FIELDS = ['idOrder', 'name', 'surname', 'email', 'phone', 'city'];

export const orderSearchText = (order: Record<string, unknown>) =>
  ORDER_SEARCH_FIELDS.map((field) => stripAccents(order?.[field]))
    .filter(Boolean)
    .join(' ')
    .slice(0, 255);

/**
 * Moving an order to "Vyřizuje se" e-mails the customer. The shop (Next.js) owns
 * the e-mail templates and the mail account, so Strapi only tells it which order
 * changed; the shop re-reads the order itself and sends at most one such e-mail
 * per order (processingNotified). ORDER_EMAIL_SECRET must be the same value in
 * both apps' .env. Never awaited: a mail problem must not cost the admin the save.
 */
const notifyProcessing = (strapi: any, documentId: string) => {
  const secret = process.env.ORDER_EMAIL_SECRET;
  if (!secret) {
    strapi.log.warn('ORDER_EMAIL_SECRET is not set - no "Vyřizuje se" e-mail was sent.');
    return;
  }
  const base = (process.env.CLIENT_INTERNAL_URL || 'http://127.0.0.1:4502').replace(/\/$/, '');
  const request = (globalThis as any).fetch(`${base}/api/order/status-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-secret': secret },
    body: JSON.stringify({ documentId }),
    signal: (AbortSignal as any).timeout(20000),
  });
  request
    .then(async (res: any) => {
      if (!res.ok) strapi.log.error(`"Vyřizuje se" e-mail failed: ${res.status} ${await res.text()}`);
    })
    .catch((err: Error) => strapi.log.error(`"Vyřizuje se" e-mail failed: ${err.message}`));
};

export default {
  register({ strapi }: { strapi: any }) {
    strapi.documents.use(async (context: any, next: any) => {
      if (context.uid === 'api::order.order' && ['create', 'update'].includes(context.action)) {
        const incomingState = context.params?.data?.state;
        let previousState: string | null | undefined;
        if (context.action === 'update' && incomingState === 'processing' && context.params?.documentId) {
          try {
            const before = await strapi.db
              .query('api::order.order')
              .findOne({ where: { documentId: context.params.documentId }, select: ['state'] });
            previousState = before?.state;
          } catch (err) {
            strapi.log.error(`Could not read the order state: ${(err as Error).message}`);
          }
        }

        const result = await next();

        // The full edit form sends the state with every save, so only an actual
        // change counts.
        if (context.action === 'update' && incomingState === 'processing' && previousState !== 'processing') {
          const documentId = result?.documentId || context.params?.documentId;
          if (documentId) notifyProcessing(strapi, documentId);
        }

        try {
          const documentId = result?.documentId || context.params?.documentId;
          if (documentId) {
            const query = strapi.db.query('api::order.order');
            const [order] = await query.findMany({
              where: { documentId },
              select: ['id', ...ORDER_SEARCH_FIELDS],
            });
            if (order) {
              await query.updateMany({ where: { documentId }, data: { searchText: orderSearchText(order) } });
            }
          }
        } catch (err) {
          strapi.log.error(`Could not index the order for search: ${(err as Error).message}`);
        }
        return result;
      }

      if (context.uid !== 'api::product.product' || !SYNCED_ACTIONS.includes(context.action)) {
        return next();
      }

      const documentId = context.params?.documentId;
      const query = strapi.db.query('api::product.product');
      let before: Row[] = [];

      try {
        if (documentId) {
          before = await query.findMany({
            where: { documentId },
            select: ['id', ...SHARED_PRODUCT_FIELDS],
          });
        }
      } catch (err) {
        strapi.log.error(`Could not read shared product fields: ${(err as Error).message}`);
      }

      const result = await next();

      try {
        const id = documentId || result?.documentId;
        if (!id) return result;

        const incoming = context.params?.data || {};
        const data: Record<string, unknown> = {};

        for (const field of SHARED_PRODUCT_FIELDS) {
          if (Object.prototype.hasOwnProperty.call(incoming, field)) {
            // Sent with the save: either a new number, or deliberately emptied.
            const value = incoming[field];
            data[field] = value === '' || value === undefined ? null : value;
          } else {
            // Not part of this save - put back what the product already had.
            const previous = firstValue(before, field);
            if (previous !== undefined) data[field] = previous;
          }
        }

        if (Object.keys(data).length) {
          // The query engine writes the rows directly - both locales, draft and
          // published - without going through the document service again, so this
          // cannot trigger itself.
          await query.updateMany({ where: { documentId: id }, data });
        }
      } catch (err) {
        // Never cost the editor their save.
        strapi.log.error(`Could not sync shared product fields: ${(err as Error).message}`);
      }

      return result;
    });
  },

  bootstrap() {},
};
