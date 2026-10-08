/**
 * Reports what sits in orders.state / orders.status today, and with --apply maps
 * legacy values onto the new enum. Read-only without --apply.
 *
 *   node scripts/order-states.js
 *   node scripts/order-states.js --apply
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

// Anything the old shop wrote that means the same as one of the new values.
const MAP = {
  '': 'new',
  new: 'new',
  nova: 'new',
  nová: 'new',
  packed: 'packed',
  pripraveno: 'packed',
  send: 'shipped',
  sent: 'shipped',
  odeslano: 'shipped',
  odesláno: 'shipped',
  shipped: 'shipped',
  done: 'delivered',
  delivered: 'delivered',
  doruceno: 'delivered',
  storno: 'cancelled',
  cancel: 'cancelled',
  cancelled: 'cancelled',
  zruseno: 'cancelled',
};

const ALLOWED = ['new', 'packed', 'shipped', 'delivered', 'cancelled'];

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

  const states = await client.query(
    "SELECT COALESCE(state, '(null)') AS value, count(*)::int AS count FROM orders GROUP BY 1 ORDER BY 2 DESC",
  );
  const statuses = await client.query(
    "SELECT COALESCE(status, '(null)') AS value, count(*)::int AS count FROM orders GROUP BY 1 ORDER BY 2 DESC",
  );

  console.log('\nstate:');
  for (const row of states.rows) {
    const target = MAP[String(row.value).toLowerCase().trim()];
    const note = ALLOWED.includes(row.value)
      ? 'ok'
      : target
        ? `-> ${target}`
        : '-> new (unrecognised)';
    console.log(`  ${String(row.value).padEnd(16)} ${String(row.count).padStart(6)}   ${note}`);
  }

  console.log('\nstatus (left as it is, the gateway writes it):');
  for (const row of statuses.rows) {
    console.log(`  ${String(row.value).padEnd(16)} ${String(row.count).padStart(6)}`);
  }

  if (!apply) {
    console.log('\nRead-only. Run with --apply to rewrite the state column.\n');
    await client.end();
    return;
  }

  let changed = 0;
  for (const row of states.rows) {
    if (ALLOWED.includes(row.value)) continue;
    const target = MAP[String(row.value).toLowerCase().trim()] || 'new';
    const result =
      row.value === '(null)'
        ? await client.query('UPDATE orders SET state = $1 WHERE state IS NULL', [target])
        : await client.query('UPDATE orders SET state = $1 WHERE state = $2', [target, row.value]);
    changed += result.rowCount;
    console.log(`  ${row.value} -> ${target}: ${result.rowCount} rows`);
  }
  console.log(`\nUpdated ${changed} orders.\n`);
  await client.end();
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
