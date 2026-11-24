/**
 * Fills in the EAN codes from the client's table (scripts/data/ean-table.json, made from EAN_table.xls - the 12-digit codes there with their check digit added,
 
 * Hornbeam, HI = Hickory, optionally with Nylon tips. "Premium" is ignored - single-pair products call the wood "Premium Habr", the X-line 4-pair ones just "Habr", and the table does not distinguish. The English variants are matched the same way, so their order and typos ("Hornbream") do not matter.
 *
 * Writes straight to the rows - both locales, draft and published - so nothing is published by accident and no draft the client is working on changes.
 *
 */
const fs = require('fs');
const path = require('path');

const normalize = (value) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/** "Premium Habr nylon" -> { wood: 'HO', nylon: true }. */
const woodOf = (title) => {
  const text = normalize(title);
  const wood = /habr|hor\w*b/.test(text) ? 'HO' : /hick/.test(text) ? 'HI' : null;
  return { wood, nylon: /nylon/.test(text) };
};

/**
 * Decides which component row or product gets which code.
 * products: [{ id, document_id, locale, title }]
 * variants: [{ product_id, cmp_id, title, ean }]
 */
function plan(table, products, variants) {
  const byTitle = new Map();
  for (const product of products) {
    if (product.locale !== 'cs') continue;
    const key = normalize(product.title);
    const docs = byTitle.get(key) || new Set();
    docs.add(product.document_id);
    byTitle.set(key, docs);
  }
  const rowsOf = new Map();
  for (const product of products) {
    const list = rowsOf.get(product.document_id) || [];
    list.push(product);
    rowsOf.set(product.document_id, list);
  }
  const variantsOf = new Map();
  for (const variant of variants) {
    const list = variantsOf.get(variant.product_id) || [];
    list.push(variant);
    variantsOf.set(variant.product_id, list);
  }

  const toVariants = new Map(); // cmp_id -> { ean, entry, current }
  const toProducts = new Map(); // document_id -> { ean, entry, current }
  const skipped = [];
  const assign = (map, key, value) => {
    const existing = map.get(key);
    if (existing && existing.ean !== value.ean) {
      skipped.push(`${value.entry.table}: same target as ${existing.entry.table} - both skipped`);
      map.set(key, { ...existing, conflict: true });
      return;
    }
    map.set(key, value);
  };

  for (const entry of table) {
    const docs = byTitle.get(normalize(entry.product));
    if (!docs) {
      skipped.push(`${entry.table} (${entry.ean}): no product "${entry.product}"`);
      continue;
    }
    if (docs.size > 1) {
      skipped.push(`${entry.table} (${entry.ean}): ${docs.size} products are called "${entry.product}"`);
      continue;
    }
    const [documentId] = docs;
    const rows = rowsOf.get(documentId) || [];
    const anyVariants = rows.some((row) => (variantsOf.get(row.id) || []).length);

    if (!anyVariants) {
      if (entry.wood) {
        skipped.push(`${entry.table} (${entry.ean}): "${entry.product}" has no variants`);
        continue;
      }
      assign(toProducts, documentId, { ean: entry.ean, entry, current: rows[0]?.ean || null });
      continue;
    }

    // Every locale and draft/published row must point at exactly one variant.
    const picked = [];
    const problems = [];
    for (const row of rows) {
      const list = variantsOf.get(row.id) || [];
      const hits = entry.wood
        ? list.filter((v) => {
            const w = woodOf(v.title);
            return w.wood === entry.wood && w.nylon === !!entry.nylon;
          })
        : list.length === 1
          ? list
          : [];
      if (hits.length === 1) picked.push(hits[0]);
      else if (list.length) problems.push(`${row.locale}: ${list.map((v) => v.title).join(' / ')}`);
    }
    if (!picked.length || problems.length) {
      const wanted = entry.wood ? `${entry.wood === 'HO' ? 'Habr' : 'Hickory'}${entry.nylon ? ' Nylon' : ''}` : 'a single variant';
      skipped.push(`${entry.table} (${entry.ean}): "${entry.product}" has no ${wanted} variant (${problems.join('; ')})`);
      continue;
    }
    for (const variant of picked) {
      assign(toVariants, variant.cmp_id, { ean: entry.ean, entry, current: variant.ean || null });
    }
  }

  // What the site sells that the table has no code for.
  const missing = [];
  for (const product of products) {
    if (product.locale !== 'cs' || !product.published_at) continue;
    const list = variantsOf.get(product.id) || [];
    if (!list.length) {
      if (!toProducts.has(product.document_id)) missing.push(product.title);
      continue;
    }
    const without = list.filter((v) => !toVariants.has(v.cmp_id)).map((v) => v.title);
    if (without.length === list.length) missing.push(`${product.title} (all variants)`);
    else if (without.length) missing.push(`${product.title}: ${without.join(', ')}`);
  }

  const clean = (map) => [...map.entries()].filter(([, value]) => !value.conflict);
  return {
    variantUpdates: clean(toVariants),
    productUpdates: clean(toProducts),
    skipped: [...new Set(skipped)],
    missing: [...new Set(missing)].sort(),
  };
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
  const table = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'ean-table.json'), 'utf8'));
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

  const columns = await client.query(`
    SELECT table_name FROM information_schema.columns
    WHERE column_name = 'ean' AND table_name IN ('api_products', 'components_shared_variants')
  `);
  if (columns.rows.length < 2) {
    console.error('\nThe ean columns do not exist yet. Build Strapi and restart it first:');
    console.error('  npm run build && pm2 restart pellwood-strapi\n');
    process.exit(1);
  }

  const products = (
    await client.query('SELECT id, document_id, locale, title, ean, published_at FROM api_products')
  ).rows;
  const variants = (
    await client.query(`
      SELECT pc.entity_id AS product_id, c.id AS cmp_id, c.title, c.ean
      FROM api_products_cmps pc
      JOIN components_shared_variants c ON c.id = pc.cmp_id
      WHERE pc.field = 'variants' AND pc.component_type = 'shared.variant'
    `)
  ).rows;

  const { variantUpdates, productUpdates, skipped, missing } = plan(table, products, variants);
  const changes = [...variantUpdates, ...productUpdates].filter(([, v]) => v.current && v.current !== v.ean);

  const used = new Set([...variantUpdates, ...productUpdates].map(([, v]) => v.entry.ean));
  console.log(`\n${table.length} codes in the table, ${used.size} match the shop.`);
  console.log(`${variantUpdates.length} variant rows and ${productUpdates.length} products to fill (rows include both locales, draft and published).`);
  if (changes.length) {
    console.log(`\n${changes.length} rows already have a DIFFERENT code - it will be replaced:`);
    for (const [, v] of changes) console.log(`  ${v.entry.table}: ${v.current} -> ${v.ean}`);
  }
  if (skipped.length) {
    console.log(`\n${skipped.length} codes not used:`);
    for (const line of skipped) console.log(`  ${line}`);
  }
  if (missing.length) {
    console.log(`\n${missing.length} products on the site have no code in the table:`);
    for (const line of missing) console.log(`  ${line}`);
  }

  if (!apply) {
    console.log('\nRead-only. Run with --apply to write the codes.\n');
    await client.end();
    return;
  }

  await client.query('BEGIN');
  try {
    for (const [cmpId, value] of variantUpdates) {
      await client.query('UPDATE components_shared_variants SET ean = $1 WHERE id = $2', [value.ean, cmpId]);
    }
    for (const [documentId, value] of productUpdates) {
      await client.query('UPDATE api_products SET ean = $1 WHERE document_id = $2', [value.ean, documentId]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
  console.log(`\nWritten. The site picks the codes up on its next build (feeds) and page refresh.\n`);
  await client.end();
}

module.exports = { normalize, woodOf, plan };

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
