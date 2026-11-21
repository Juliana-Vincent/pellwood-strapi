#!/usr/bin/env node
/*
 * Copies old-site password hashes into Strapi customers that have none.
 *
 *   node scripts/import-customer-passwords.js ~/pellwood-export/<date>/users.json          (dry run)
 *   node scripts/import-customer-passwords.js ~/pellwood-export/<date>/users.json --apply
 *
 * - Matches by email, case-insensitive.
 * - Only fills customers whose password is empty; never overwrites an existing one.
 * - Copies bcrypt hashes ($2a/$2b/$2y) as they are. The old site stored plain-text
 *   passwords; pass --plain to bcrypt-hash those on the way in.
 * - Never prints a hash. Safe to run more than once.
 *
 * users.json may be a JSON array or one document per line (mongoexport default).
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

function readUsers(file) {
  const raw = fs.readFileSync(file, "utf8").trim();
  if (raw.startsWith("[")) return JSON.parse(raw);
  return raw.split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l));
}

const norm = (e) => String(e || "").trim().toLowerCase();
const short = (email) => {
  const [u, d] = String(email || "").split("@");
  return d ? `${u.slice(0, 3)}…@${d}` : "(no email)";
};
const isBcrypt = (h) => typeof h === "string" && /^\$2[aby]\$\d\d\$.{53}$/.test(h);

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const plain = args.includes("--plain");
  const file = args.find((a) => !a.startsWith("--"));
  if (!file) {
    console.error("Usage: node scripts/import-customer-passwords.js <users.json> [--plain] [--apply]");
    process.exit(1);
  }
  let bcrypt = null;
  if (plain) {
    try {
      bcrypt = require("bcryptjs");
    } catch {
      console.error("--plain needs bcryptjs. Run: npm i --no-save bcryptjs");
      process.exit(1);
    }
  }

  loadEnv(path.join(process.cwd(), ".env"));
  const users = readUsers(file);

  // email -> hash, flagging addresses that appear twice with different hashes
  const old = new Map();
  const rawOf = new Map();
  const conflicts = new Set();
  let notBcrypt = 0;
  for (const u of users) {
    const email = norm(u.email);
    if (!email) continue;
    let hash = u.password;
    if (!isBcrypt(hash)) {
      // The old site stored passwords in plain text. With --plain they are hashed
      // here, so the customer keeps their password and no plain text reaches Strapi.
      if (plain && typeof hash === "string" && hash.length > 0) {
        hash = await bcrypt.hash(hash, 10);
      } else {
        notBcrypt++;
        console.log(`skip  ${short(email)}: old password is ${u.password ? "not bcrypt (use --plain)" : "empty"}`);
        continue;
      }
    }
    if (old.has(email) && rawOf.get(email) !== u.password) conflicts.add(email);
    old.set(email, hash);
    rawOf.set(email, u.password);
  }

  const client = new Client(dbConfig());
  await client.connect();
  const { rows: customers } = await client.query(`SELECT id, email, password FROM customers`);

  let filled = 0, alreadySet = 0;
  const matched = new Set();
  if (apply) await client.query("BEGIN");
  try {
    for (const c of customers) {
      const email = norm(c.email);
      if (!old.has(email)) continue;
      matched.add(email);
      if (conflicts.has(email)) {
        console.log(`skip  ${short(email)}: two different old hashes, decide by hand`);
        continue;
      }
      if (c.password) {
        alreadySet++;
        continue;
      }
      if (apply) {
        await client.query(
          `UPDATE customers SET password = $1, updated_at = now()
            WHERE id = $2 AND (password IS NULL OR password = '')`,
          [old.get(email), c.id]
        );
      }
      filled++;
      console.log(`${apply ? "set " : "would set"}  ${short(email)} (customer ${c.id})`);
    }
    if (apply) await client.query("COMMIT");
  } catch (err) {
    if (apply) await client.query("ROLLBACK");
    throw err;
  } finally {
    await client.end();
  }

  const noCustomer = [...old.keys()].filter((e) => !matched.has(e));
  for (const e of noCustomer) console.log(`none  ${short(e)}: no Strapi customer with this email`);

  console.log(
    `\n${users.length} old users, ${notBcrypt} without a bcrypt hash, ` +
    `${filled} ${apply ? "filled" : "to fill"}, ${alreadySet} already have a password, ` +
    `${noCustomer.length} with no Strapi customer.` +
    (apply ? "" : "\nDry run - nothing written. Add --apply to write.")
  );
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
