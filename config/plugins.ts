import type { Core } from '@strapi/strapi';

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Plugin => ({
  upload: {
    config: {
      provider: 'aws-s3',
      providerOptions: {
        baseUrl: env('SUPABASE_PUBLIC_URL'),
        s3Options: {
          credentials: {
            accessKeyId: env('SUPABASE_S3_KEY'),
            secretAccessKey: env('SUPABASE_S3_SECRET'),
          },
          region: env('SUPABASE_S3_REGION'),
          endpoint: env('SUPABASE_S3_ENDPOINT'),
          // Supabase serves buckets under a path, not a subdomain per bucket.
          forcePathStyle: true,
          params: {
            Bucket: env('SUPABASE_BUCKET', 'strapi-uploads'),
          },
        },
      },
      actionOptions: { upload: {}, uploadStream: {}, delete: {} },
    },
  },
});

export default config;