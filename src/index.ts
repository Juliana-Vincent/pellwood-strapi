/**
 * Length and diameter describe the stick, not its wording, so they are the same
 * number in Czech and in English and the editor fills them in once.
 *
 * The schema marks them as not localized, which makes Strapi write them to every
 * locale of the product - but it writes whatever the payload holds, so a save that
 * does not mention them (editing only the English text, say) propagates null and
 * wipes the number everywhere. This keeps them: the values are read before the
 * write and put back unless the editor actually changed or cleared them.
 */
const SHARED_PRODUCT_FIELDS = ['length', 'diameter'] as const;
const SYNCED_ACTIONS = ['update', 'publish', 'unpublish', 'discardDraft'];

type Row = Record<string, unknown>;

const firstValue = (rows: Row[], field: string) => {
  const row = rows.find((candidate) => candidate[field] !== null && candidate[field] !== undefined);
  return row ? row[field] : undefined;
};

export default {
  register({ strapi }: { strapi: any }) {
    strapi.documents.use(async (context: any, next: any) => {
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
