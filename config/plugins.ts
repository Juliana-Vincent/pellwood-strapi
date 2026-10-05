import type { Core } from '@strapi/strapi';

// Strapi's upload plugin defaults to a 1 GB sizeLimit and the body parser to a
// 200 MB per-file cap, so an actor with upload rights could post 200 MB files
// repeatedly - each one running the sharp resize pipeline at concurrency 1. The
// repo's own import-1-images.mjs already records parallel uploads OOMing the
// container and surfacing as a 502 from the edge. Product photography does not
// need more than this.
const UPLOAD_SIZE_LIMIT = 10 * 1024 * 1024; // 10 MB

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Plugin => {
  const uploadConfig: Record<string, unknown> = {
    sizeLimit: UPLOAD_SIZE_LIMIT,
  };

  // The S3 provider is only configured when Supabase credentials are present;
  // otherwise Strapi falls back to the local provider. The size limit applies
  // either way, which is why it is set before this branch rather than inside it.
  if (env('SUPABASE_S3_ENDPOINT')) {
    uploadConfig.provider = 'aws-s3';
    uploadConfig.providerOptions = {
      baseUrl: env('SUPABASE_PUBLIC_URL'),
      s3Options: {
        credentials: {
          accessKeyId: env('SUPABASE_S3_KEY'),
          secretAccessKey: env('SUPABASE_S3_SECRET'),
        },
        region: env('SUPABASE_S3_REGION'),
        endpoint: env('SUPABASE_S3_ENDPOINT'),
        forcePathStyle: true,
        params: { Bucket: env('SUPABASE_BUCKET', 'strapi-uploads') },
      },
    };
    uploadConfig.actionOptions = { upload: {}, uploadStream: {}, delete: {} };
  }

  return {
    upload: { config: uploadConfig },
  };
};

export default config;
