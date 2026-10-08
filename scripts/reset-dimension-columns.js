/**
 * Drops the length and diameter columns so Strapi can recreate them as text.
 *
 * They were added as decimal, which forces the admin to use the separator of
 * whatever language the panel is in - a Czech editor types "14,4" and the field
 * refuses it. They are text now, and the site parses the number out of whatever
 * is typed. Postgres will not turn a numeric column into text on its own, so the
 * empty columns are dropped and Strapi builds them again on the next start.
 *
 * Refuses to run if anything has been written to them already.
 *
 *   node scripts/reset-dimension-columns.js            check
 *   node scripts/reset-dimension-columns.js --apply    drop them
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const envPath = path.join(__dirname, '..', '.env');
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (match && !process.env[match[1]]) {
    process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
}

(async () => {
  const apply = process.argv.includes('--apply');
  const client = new Client(
    process.env.DATABASE_URL
      ? { connectionString: process.env.DATABASE_URL }
      : {
          host: process.env.DATABASE_HOST || 'localhost',
          port: Number(process.env.DATABASE_PORT || 5432),
          database: process.env.DATABASE_NAME,
          user: process.env.DATABASE_USERNAME,
          password: process.env.DATABASE_PASSWORD,
        },
  );
  await client.connect();

  const { rows: columns } = await client.query(
    "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'api_products' AND column_name IN ('length','diameter')",
  );
  if (!columns.length) {
    console.log('\nNeither column exists - nothing to do. Start Strapi and it will create them as text.\n');
    await client.end();
    return;
  }
  for (const column of columns) {
    console.log(`  ${column.column_name}: ${column.data_type}`);
  }
  if (columns.every((column) => column.data_type.includes('char') || column.data_type === 'text')) {
    console.log('\nAlready text - nothing to do.\n');
    await client.end();
    return;
  }

  const { rows: filled } = await client.query(
    'SELECT count(*)::int AS count FROM api_products WHERE length IS NOT NULL OR diameter IS NOT NULL',
  );
  if (filled[0].count > 0) {
    console.error(
      `\n${filled[0].count} products already have a value. Dropping the columns would lose it - tell me and I will write a converting migration instead.\n`,
    );
    process.exit(1);
  }

  if (!apply) {
    console.log('\nBoth columns are empty and can be dropped. Run with --apply.\n');
    await client.end();
    return;
  }

  await client.query('ALTER TABLE api_products DROP COLUMN IF EXISTS length, DROP COLUMN IF EXISTS diameter');
  console.log('\nDropped. Start Strapi (npm run build && pm2 restart pellwood-strapi) and it recreates them as text.\n');
  await client.end();
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
