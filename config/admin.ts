import type { Core } from '@strapi/strapi';

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Admin => ({
  auth: {
    secret: env('ADMIN_JWT_SECRET'),
  },
  apiToken: {
    salt: env('API_TOKEN_SALT'),
  },
  transfer: {
    token: {
      salt: env('TRANSFER_TOKEN_SALT'),
    },
  },
  secrets: {
    encryptionKey: env('ENCRYPTION_KEY'),
  },
  // The "Preview" panel next to the editor: it opens the real page for whatever is
  // being edited. Strapi only knows the documentId, so each content type looks up
  // its slug and builds the address the site actually uses.
  preview: {
    enabled: env.bool('PREVIEW_ENABLED', true),
    config: {
      allowedOrigins: [env('CLIENT_URL', 'http://localhost:4502')],
      async handler(uid: string, { documentId, locale }: { documentId: string; locale?: string }) {
        const base = env('CLIENT_URL', 'http://localhost:4502').replace(/\/$/, '');
        // The Czech site lives at the root, the English one under /en.
        const prefix = locale === 'en' ? '/en' : '';

        if (uid === 'api::homepage.homepage') return `${base}${prefix}/`;

        const paths: Record<string, string> = {
          'api::product.product': 'produkt',
          'api::category.category': 'produkty',
          'api::archive.archive': 'kategorie',
        };

        if (uid === 'api::article.article') {
          const article: any = await strapi.documents('api::article.article').findOne({
            documentId,
            locale,
            populate: { category: true },
          });
          const rubrika = article?.category?.slug;
          if (!article?.slug || !rubrika) return null;
          return `${base}${prefix}/clanek/${rubrika}/${article.slug}`;
        }

        const path = paths[uid];
        if (!path) return null;

        const entry: any = await strapi.documents(uid as any).findOne({ documentId, locale });
        if (!entry?.slug) return null;
        return `${base}${prefix}/${path}/${entry.slug}`;
      },
    },
  },

  flags: {
    nps: env.bool('FLAG_NPS', true),
    promoteEE: env.bool('FLAG_PROMOTE_EE', true),
    docLinks: env.bool('FLAG_DOC_LINKS', true),
  },
});

export default config;
