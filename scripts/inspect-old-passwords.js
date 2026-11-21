#!/usr/bin/env node
/*
 * Read-only: describes the SHAPE of the old password values without printing them.
 *
 *   node scripts/inspect-old-passwords.js ~/pellwood-export/<date>/users.json
 *
 * Prints the user document's field names (no values), and for each password only
 * its length, character set and a guessed format.
 */
const fs = require("fs");

const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/inspect-old-passwords.js <users.json>");
  process.exit(1);
}
const raw = fs.readFileSync(file, "utf8").trim();
const users = raw.startsWith("[")
  ? JSON.parse(raw)
  : raw.split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l));

function guess(p) {
  if (p == null || p === "") return "empty";
  if (typeof p !== "string") return `not a string (${typeof p}${p.$binary ? ", binary" : ""})`;
  if (p.startsWith("U2FsdGVkX1")) return "CryptoJS AES (encrypted, needs the old secret key)";
  if (/^\$argon2/.test(p)) return "argon2";
  if (/^\$2[aby]\$/.test(p)) return "bcrypt";
  if (/^pbkdf2/i.test(p) || p.includes(":")) return "salted hash with separator (pbkdf2/scrypt style)";
  if (/^[0-9a-f]{32}$/i.test(p)) return "hex, 32 chars (MD5?)";
  if (/^[0-9a-f]{40}$/i.test(p)) return "hex, 40 chars (SHA-1?)";
  if (/^[0-9a-f]{64}$/i.test(p)) return "hex, 64 chars (SHA-256?)";
  if (/^[0-9a-f]{128}$/i.test(p)) return "hex, 128 chars (SHA-512 / pbkdf2?)";
  if (/^[A-Za-z0-9+/]+=*$/.test(p)) return "base64-looking";
  return "unknown - possibly plain text";
}

const fieldSets = new Map();
for (const u of users) {
  const keys = Object.keys(u).sort().join(", ");
  fieldSets.set(keys, (fieldSets.get(keys) || 0) + 1);
}
console.log("User document fields (names only):");
for (const [keys, n] of fieldSets) console.log(`  ${n} x  ${keys}`);

console.log("\nPassword shapes:");
users.forEach((u, i) => {
  const p = u.password;
  const len = typeof p === "string" ? p.length : "-";
  console.log(`  user ${i + 1}: length ${len}, ${guess(p)}`);
});
