import type { Core } from '@strapi/strapi';

const config: Core.Config.Middlewares = [
  'strapi::logger',
  'strapi::errors',
  {
    name: 'strapi::security',
    config: {
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'connect-src': ["'self'", 'https:'],
          'img-src': ["'self'", 'data:', 'blob:', 'pawdlzmdumjinndgowct.supabase.co'],
          'media-src': ["'self'", 'data:', 'blob:', 'pawdlzmdumjinndgowct.supabase.co'],
          upgradeInsecureRequests: null,
        },
      },
    },
  },
  {
    name: 'strapi::cors',
    config: {
      // Strapi's default is origin '*' WITH credentials: true, and its matcher
      // reflects the caller's own origin back when the list contains '*'. That is
      // the reflected-origin pattern a literal wildcard normally prevents: any page
      // a signed-in admin visits could make credentialed calls here and read the
      // responses. Pin it to the storefronts instead.
      origin: (process.env.CORS_ORIGINS || 'https://pellwood.com,https://pellwood.hardart.cz')
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
      credentials: true,
    },
  },
  'strapi::poweredBy',
  'strapi::query',
  {
    name: 'strapi::body',
    config: {
      // Rejects an oversized upload while it is still being received, rather than
      // buffering up to formidable's 200 MB default first.
      formidable: {
        maxFileSize: 10 * 1024 * 1024,
      },
    },
  },
  'strapi::session',
  'strapi::favicon',
    {
    name: 'strapi::public',
    config: {
      maxAge: 31536000000,
    },
  },
];

export default config;
