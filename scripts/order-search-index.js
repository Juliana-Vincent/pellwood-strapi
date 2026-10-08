/**
 * Fills searchText on orders that were placed before the column existed.
 *
 * Postgres treats á and a as different letters, so "novak" never found
 * "Nováková". Each order now carries an accent-free copy of its name, e-mail,
 * phone, city and number, and the Objednávky page searches that. New orders are
 * indexed as they are saved; this is for the ones already in the database.
 *
 *   node scripts/order-search-index.js            report only
 *   node scripts/order-search-index.js --apply    write the index
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

const stripAccents = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

const searchTextOf = (row) =>
  [row.id_order, row.name, row.surname, row.email, row.phone, row.city]
    .map(stripAccents)
    .filter(Boolean)
    .join(' ')
    .slice(0, 255);

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
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'search_text'",
  );
  if (!columns.rows.length) {
    console.error('\nThe search_text column does not exist yet. Build Strapi and restart it first:');
    console.error('  npm run build && pm2 restart pellwood-strapi\n');
    process.exit(1);
  }

  const { rows } = await client.query(
    'SELECT id, id_order, name, surname, email, phone, city, search_text FROM orders',
  );
  const pending = rows.filter((row) => searchTextOf(row) !== (row.search_text || ''));

  console.log(`\n${rows.length} orders, ${pending.length} to index.`);
  for (const row of pending.slice(0, 5)) {
    console.log(`  #${row.id_order} -> "${searchTextOf(row)}"`);
  }
  if (pending.length > 5) console.log(`  … and ${pending.length - 5} more`);

  if (!apply) {
    console.log('\nRead-only. Run with --apply to write them.\n');
    await client.end();
    return;
  }

  for (const row of pending) {
    await client.query('UPDATE orders SET search_text = $1 WHERE id = $2', [searchTextOf(row), row.id]);
  }
  console.log(`\nIndexed ${pending.length} orders.\n`);
  await client.end();
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
