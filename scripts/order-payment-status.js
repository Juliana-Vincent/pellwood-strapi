/**
 * Copies orders.status into orders.payment_status.
 *
 * Strapi 5 reserves the word "status" for a document's draft/published state, so
 * the admin showed the Comgate value as "published" and wrote that back over the
 * real one on every save. The field now lives in paymentStatus; this moves the
 * data across and reports the rows the admin had already overwritten.
 *
 *   node scripts/order-payment-status.js
 *   node scripts/order-payment-status.js --apply
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

  const columns = await client.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'orders' AND column_name IN ('status','payment_status')",
  );
  const names = columns.rows.map((row) => row.column_name);
  if (!names.includes('payment_status')) {
    console.error('\nThe payment_status column does not exist yet. Build Strapi and restart it first:');
    console.error('  npm run build && pm2 restart pellwood-strapi\n');
    process.exit(1);
  }
  if (!names.includes('status')) {
    console.log('\nNo old status column - nothing to copy.\n');
    await client.end();
    return;
  }

  const breakdown = await client.query(
    "SELECT COALESCE(status, '(null)') AS value, count(*)::int AS count FROM orders GROUP BY 1 ORDER BY 2 DESC",
  );
  console.log('\nold status column:');
  for (const row of breakdown.rows) {
    const note = row.value === 'published' ? '   <- overwritten by the admin, real value lost' : '';
    console.log(`  ${String(row.value).padEnd(14)} ${String(row.count).padStart(6)}${note}`);
  }

  const { rows: pending } = await client.query(
    "SELECT count(*)::int AS count FROM orders WHERE payment_status IS NULL AND status IS NOT NULL AND status <> 'published'",
  );
  console.log(`\n${pending[0].count} orders to copy.`);

  if (!apply) {
    console.log('Read-only. Run with --apply to copy them.\n');
    await client.end();
    return;
  }

  const result = await client.query(
    "UPDATE orders SET payment_status = status WHERE payment_status IS NULL AND status IS NOT NULL AND status <> 'published'",
  );
  console.log(`Copied ${result.rowCount} orders.\n`);
  await client.end();
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
