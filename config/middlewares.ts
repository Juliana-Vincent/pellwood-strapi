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
  'strapi::body',
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
