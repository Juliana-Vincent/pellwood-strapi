#!/usr/bin/env node
/*
 * Read-only check for the images listed in missing-images.json.
 *
 *   node scripts/find-missing-images.js [path/to/missing-images.json]
 *
 * For each image it reports:
 *   - whether the Sanity CDN still serves it (HEAD request),
 *   - every place in the Strapi database whose text/JSON mentions its hash
 *     (rich text, JSON fields, file records...).
 *
 * It never writes anything. Database settings come from .env
 * (DATABASE_URL, or DATABASE_HOST/PORT/NAME/USERNAME/PASSWORD/SSL).
 */
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}

function dbConfig() {
  const e = process.env;
  const ssl = e.DATABASE_SSL === "true" ? { rejectUnauthorized: e.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false" } : false;
  if (e.DATABASE_URL) return { connectionString: e.DATABASE_URL, ssl };
  return {
    host: e.DATABASE_HOST || "127.0.0.1",
    port: Number(e.DATABASE_PORT || 5432),
    database: e.DATABASE_NAME,
    user: e.DATABASE_USERNAME,
    password: e.DATABASE_PASSWORD,
    ssl,
  };
}

// "image-<hash>-<w>x<h>-<ext>" -> "<hash>"
const hashOf = (img) => (String(img.id).match(/^image-([0-9a-f]{40})-/) || [])[1];

async function cdnStatus(url) {
  try {
    const res = await fetch(url, { method: "HEAD" });
    return res.status;
  } catch (err) {
    return "ERR " + (err.cause?.code || err.message);
  }
}

async function main() {
  const root = process.cwd();
  loadEnv(path.join(root, ".env"));
  const listFile = process.argv[2] || path.join(root, "missing-images.json");
  const images = JSON.parse(fs.readFileSync(listFile, "utf8"));
  const hashes = images.map(hashOf).filter(Boolean);
  if (hashes.length !== images.length) {
    console.warn(`Warning: ${images.length - hashes.length} entries have an unexpected id format and are skipped in the DB search.`);
  }

  const client = new Client(dbConfig());
  await client.connect();

  const { rows: cols } = await client.query(`
    SELECT c.table_name, c.column_name,
           EXISTS (SELECT 1 FROM information_schema.columns i
                   WHERE i.table_schema = c.table_schema AND i.table_name = c.table_name
                     AND i.column_name = 'id') AS has_id
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
    WHERE c.table_schema = 'public'
      AND c.data_type IN ('text', 'character varying', 'json', 'jsonb')
      AND c.table_name NOT LIKE 'strapi\\_%'
    ORDER BY c.table_name, c.column_name`);

  const pattern = hashes.join("|");
  const found = new Map(hashes.map((h) => [h, []]));

  for (const { table_name: t, column_name: c, has_id } of cols) {
    const q = `SELECT ${has_id ? "id" : "NULL"} AS id, substring(${quoteIdent(c)}::text from $1) AS hit
               FROM ${quoteIdent(t)} WHERE ${quoteIdent(c)}::text ~ $1`;
    const { rows } = await client.query(q, [pattern]);
    for (const r of rows) {
      found.get(r.hit)?.push(`${t}.${c}${r.id != null ? ` (id ${r.id})` : ""}`);
    }
  }
  await client.end();

  let used = 0;
  console.log(`Checked ${images.length} images against ${cols.length} text/JSON columns.\n`);
  for (const img of images) {
    const h = hashOf(img);
    const where = (h && found.get(h)) || [];
    if (where.length) used++;
    const mb = (img.size / 1024 / 1024).toFixed(1);
    console.log(`${img.id}  (${mb} MB)`);
    console.log(`  Sanity CDN: ${await cdnStatus(img.url)}`);
    console.log(`  Used in Strapi: ${where.length ? [...new Set(where)].join(", ") : "nowhere"}`);
  }
  console.log(`\n${used} of ${images.length} are referenced somewhere in Strapi.`);
}

function quoteIdent(s) {
  return '"' + String(s).replace(/"/g, '""') + '"';
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
