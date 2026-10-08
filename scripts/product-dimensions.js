/**
 * Moves the Délka / Průměr parameters into the new length and diameter fields.
 *
 * Both locales already store millimetres, so one shared number serves the Czech
 * and the English site and the editor types it once. Values are read from every
 * locale of a product; a product whose locales disagree is reported and skipped.
 *
 *   node scripts/product-dimensions.js            report only
 *   node scripts/product-dimensions.js --apply    fill length and diameter
 *   node scripts/product-dimensions.js --clean    then remove the old parameter rows
 */
const fs = require('fs');
const path = require('path');

// "Diameter " with a trailing space is in the live data, so titles are trimmed and
// compared without case.
const LENGTH_TITLES = ['délka', 'delka', 'length'];
const DIAMETER_TITLES = ['průměr', 'prumer', 'diameter'];

const kind = (title) => {
  const key = String(title || '').trim().toLowerCase();
  if (LENGTH_TITLES.includes(key)) return 'length';
  if (DIAMETER_TITLES.includes(key)) return 'diameter';
  return null;
};

/** "400 mm", "14,4 mm", "58mm" -> 400, 14.4, 58. A range like "17-23 mm" returns null. */
const toNumber = (value) => {
  const text = String(value || '').trim();
  if (/\d\s*[-–]\s*\d/.test(text)) return null;
  const parsed = parseFloat(text.replace(',', '.').replace(/[^\d.]/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

/** Groups the component rows by product and decides what each one should get. */
function plan(rows) {
  const docs = new Map();
  const oddities = [];

  for (const row of rows) {
    const which = kind(row.param);
    if (!which) {
      // Other millimetre parameters are legitimate (handle diameter, felt ball),
      // but a typo'd title hides a real dimension from the filter - so they are
      // listed for a human to glance at, never migrated automatically.
      if (/^\s*[\d.,]+\s*mm\s*$/i.test(String(row.value || ''))) {
        oddities.push(`${row.locale} "${row.title}": parameter "${row.param}" = ${row.value}`);
      }
      continue;
    }
    const entry = docs.get(row.document_id) || { title: row.title, length: new Set(), diameter: new Set() };
    const number = toNumber(row.value);
    if (number === null) {
      oddities.push(`${row.locale} "${row.title}": ${row.param} = "${row.value}" is not a single number`);
    } else {
      entry[which].add(number);
    }
    docs.set(row.document_id, entry);
  }

  const updates = [];
  const conflicts = [];
  for (const [documentId, entry] of docs) {
    const pick = (set) => (set.size === 0 ? undefined : set.size > 1 ? 'conflict' : [...set][0]);
    const length = pick(entry.length);
    const diameter = pick(entry.diameter);
    if (length === 'conflict' || diameter === 'conflict') {
      conflicts.push(
        `"${entry.title}": length ${[...entry.length].join('/') || '-'}, diameter ${[...entry.diameter].join('/') || '-'}`,
      );
      continue;
    }
    if (length === undefined && diameter === undefined) continue;
    updates.push({ documentId, title: entry.title, length, diameter });
  }

  return { updates, conflicts, oddities: [...new Set(oddities)], docCount: docs.size };
}

async function main() {
  const { Client } = require('pg');
  const envPath = path.join(__dirname, '..', '.env');
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  }

  const apply = process.argv.includes('--apply');
  const clean = process.argv.includes('--clean');
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
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'api_products' AND column_name IN ('length','diameter')",
  );
  if (columns.rows.length < 2) {
    console.error('\nThe length/diameter columns do not exist yet. Build Strapi and restart it first:');
    console.error('  npm run build && pm2 restart pellwood-strapi\n');
    process.exit(1);
  }

  const { rows } = await client.query(`
    SELECT p.document_id, p.locale, p.title, c.id AS cmp_id, c.title AS param, c.value
    FROM api_products p
    JOIN api_products_cmps pc ON pc.entity_id = p.id AND pc.field = 'parametrs'
    JOIN components_shared_parameters c ON c.id = pc.cmp_id
  `);

  const { updates, conflicts, oddities, docCount } = plan(rows);

  console.log(`\n${docCount} products carry a Délka/Průměr parameter.`);
  console.log(`${updates.length} can be filled in automatically.`);
  for (const update of updates.slice(0, 8)) {
    console.log(`  ${update.title}: length=${update.length ?? '-'} diameter=${update.diameter ?? '-'}`);
  }
  if (updates.length > 8) console.log(`  … and ${updates.length - 8} more`);

  if (conflicts.length) {
    console.log(`\n${conflicts.length} disagree between locales and are SKIPPED - fix these by hand:`);
    for (const line of conflicts) console.log(`  ${line}`);
  }
  if (oddities.length) {
    console.log(`\n${oddities.length} other millimetre parameters, left in place - check for a typo'd title:`);
    for (const line of oddities) console.log(`  ${line}`);
  }

  if (!apply && !clean) {
    console.log('\nRead-only. Run with --apply to fill the fields.\n');
    await client.end();
    return;
  }

  if (apply) {
    let changed = 0;
    for (const update of updates) {
      // Every row of the document at once: both locales, draft and published.
      const result = await client.query(
        'UPDATE api_products SET length = COALESCE($1::numeric, length), diameter = COALESCE($2::numeric, diameter) WHERE document_id = $3',
        [update.length ?? null, update.diameter ?? null, update.documentId],
      );
      changed += result.rowCount;
    }
    console.log(`\nFilled ${updates.length} products (${changed} rows incl. locales and drafts).`);
  }

  if (clean) {
    const ids = rows.filter((row) => kind(row.param) && toNumber(row.value) !== null).map((row) => row.cmp_id);
    if (!ids.length) {
      console.log('\nNothing left to clean.');
    } else {
      await client.query('DELETE FROM api_products_cmps WHERE cmp_id = ANY($1::int[]) AND field = $2', [ids, 'parametrs']);
      const removed = await client.query('DELETE FROM components_shared_parameters WHERE id = ANY($1::int[])', [ids]);
      console.log(`\nRemoved ${removed.rowCount} old parameter rows.`);
    }
  }

  console.log('');
  await client.end();
}

module.exports = { kind, toNumber, plan };

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
