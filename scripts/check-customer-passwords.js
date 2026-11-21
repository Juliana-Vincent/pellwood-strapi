#!/usr/bin/env node
/*
 * Read-only: shows, per customer row, whether a password hash is stored.
 *
 *   node scripts/check-customer-passwords.js
 *
 * Never prints a hash - only its type ($2a/$2b = bcrypt), plus whether the row
 * is a draft or published, and when it last changed. Emails are shortened.
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

const short = (email) => {
  const [u, d] = String(email || "").split("@");
  return d ? `${u.slice(0, 3)}…@${d}` : "(no email)";
};

function hashKind(h) {
  if (!h) return "EMPTY";
  const m = String(h).match(/^\$(2[abxy])\$/);
  return m ? `bcrypt $${m[1]}` : `other (${String(h).length} chars)`;
}

async function main() {
  const root = process.cwd();
  loadEnv(path.join(root, ".env"));

  const schemaFile = path.join(root, "src/api/customer/content-types/customer/schema.json");
  if (fs.existsSync(schemaFile)) {
    const schema = JSON.parse(fs.readFileSync(schemaFile, "utf8"));
    console.log(`draftAndPublish: ${schema.options?.draftAndPublish}`);
    console.log(`password field: ${JSON.stringify(schema.attributes?.password)}\n`);
  }

  const client = new Client(dbConfig());
  await client.connect();
  const { rows } = await client.query(
    `SELECT id, document_id, email, password, published_at, updated_at
       FROM customers ORDER BY email, published_at NULLS FIRST`
  );
  await client.end();

  for (const r of rows) {
    console.log(
      `${String(r.id).padStart(4)}  ${short(r.email).padEnd(28)}  ` +
      `${(r.published_at ? "published" : "draft").padEnd(9)}  ` +
      `${hashKind(r.password).padEnd(20)}  updated ${new Date(r.updated_at).toISOString().slice(0, 16)}`
    );
  }
  const docs = new Set(rows.map((r) => r.document_id)).size;
  console.log(`\n${rows.length} rows, ${docs} customers, ${rows.filter((r) => !r.password).length} rows without a password.`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
