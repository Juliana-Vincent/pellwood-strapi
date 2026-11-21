#!/usr/bin/env node
/*
 * Read-only follow-up to find-missing-images.js.
 *
 *   node scripts/inspect-missing-files.js
 *
 * For the media-library entries of the 17 missing images it prints:
 *   - the stored url and whether that file exists under public/uploads,
 *   - which entries use it (files_related_mph: type, id, field),
 *   - how one old order's basket refers to the image.
 * Writes nothing.
 */
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const FILE_IDS = [57, 59, 65, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 188, 266];

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

async function main() {
  const root = process.cwd();
  loadEnv(path.join(root, ".env"));
  const client = new Client(dbConfig());
  await client.connect();

  const { rows: files } = await client.query(
    `SELECT id, name, url, provider, size, width, height FROM files WHERE id = ANY($1) ORDER BY id`,
    [FILE_IDS]
  );

  const { rows: rel } = await client.query(
    `SELECT file_id, related_type, related_id, field FROM files_related_mph WHERE file_id = ANY($1)
     ORDER BY file_id, related_type, related_id`,
    [FILE_IDS]
  ).catch((err) => {
    console.warn("Could not read files_related_mph:", err.message);
    return { rows: [] };
  });

  for (const f of files) {
    const local = f.url && f.url.startsWith("/") ? path.join(root, "public", f.url) : null;
    const onDisk = local ? (fs.existsSync(local) ? "yes" : "MISSING") : "n/a (external url)";
    const uses = rel.filter((r) => r.file_id === f.id);
    console.log(`file ${f.id}  ${f.width}x${f.height}  ${f.size} kB  provider=${f.provider}`);
    console.log(`  url: ${f.url}`);
    console.log(`  on disk: ${onDisk}`);
    console.log(`  used by: ${uses.length ? uses.map((u) => `${u.related_type}#${u.related_id}.${u.field}`).join(", ") : "nothing"}`);
  }

  const { rows: sample } = await client.query(
    `SELECT id, substring(basket::text from '.{0,80}49801ae659fc9b6ff80b55b1f8b17b4dd0c43f37.{0,40}') AS snippet
     FROM orders WHERE id = 19`
  );
  if (sample[0]) console.log(`\norder 19 basket snippet:\n  ${sample[0].snippet}`);

  await client.end();
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
