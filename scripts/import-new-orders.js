#!/usr/bin/env node
/*
 * Imports orders from the old site's export that are not in Strapi yet.
 *
 *   node scripts/import-new-orders.js ~/pellwood-export/<date>/orders.json            (dry run)
 *   node scripts/import-new-orders.js ~/pellwood-export/<date>/orders.json --apply
 *
 * - "Already there" is decided by idOrder, so running it again never duplicates.
 * - Goes through the Strapi REST API (same as the site), so lifecycle hooks such
 *   as the search index run for every imported order.
 * - Needs STRAPI_WRITE_TOKEN. It is read from the environment, or from the
 *   client's .env (default ../pellwood-client/.env, override with --client-env=PATH).
 * - Strapi address: STRAPI_INTERNAL_URL, default http://127.0.0.1:4501.
 */
const fs = require("fs");
const path = require("path");

// Same mapping as scripts/order-states.js.
const STATE_MAP = {
  "": "new", new: "new", nova: "new", "nová": "new",
  packed: "packed", process: "packed", processing: "packed", vyrizuje: "packed",
  zpracovava: "packed", pripraveno: "packed",
  send: "shipped", sent: "shipped", odeslano: "shipped", "odesláno": "shipped", shipped: "shipped",
  done: "delivered", delivered: "delivered", doruceno: "delivered",
  storno: "cancelled", cancel: "cancelled", cancelled: "cancelled", zruseno: "cancelled",
};

function readEnvFile(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}

function readOrders(file) {
  const raw = fs.readFileSync(file, "utf8").trim();
  return raw.startsWith("[")
    ? JSON.parse(raw)
    : raw.split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l));
}

// MongoDB Extended JSON helpers
const oidOf = (v) => (v && typeof v === "object" && v.$oid) || (typeof v === "string" ? v : null);
const numOf = (v) => {
  if (v && typeof v === "object") v = v.$numberInt ?? v.$numberLong ?? v.$numberDouble ?? v.$numberDecimal;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
// The first 4 bytes of an ObjectId are its creation time in seconds.
const dateFromOid = (oid) => (oid && /^[0-9a-f]{24}$/i.test(oid) ? new Date(parseInt(oid.slice(0, 8), 16) * 1000) : null);
const str = (v) => (v === null || v === undefined ? "" : String(v));

function toStrapi(o) {
  const date = dateFromOid(oidOf(o._id));
  const rawState = str(o.state).toLowerCase().trim();
  return {
    idOrder: numOf(o.idOrder),
    orderDate: date ? date.toISOString() : null,
    email: str(o.email),
    phone: str(o.phone),
    name: str(o.name),
    surname: str(o.surname),
    country: str(o.country),
    city: str(o.city),
    address: str(o.address),
    code: str(o.code),
    anotherAddressCheck: Boolean(o.anotherAddressCheck),
    companyDataCheck: Boolean(o.companyDataCheck),
    anotherAdress: o.anotherAdress ?? {},
    companyData: o.companyData ?? {},
    currency: str(o.currency),
    note: str(o.note),
    basket: Array.isArray(o.basket) ? o.basket : [],
    sum: numOf(o.sum),
    paymentStatus: str(o.status),
    state: STATE_MAP[rawState] || "new",
    paymentMethod: str(o.paymentMethod),
    paymentPrice: str(o.paymentPrice),
    payOnline: Boolean(o.payOnline),
    deliveryMethod: str(o.deliveryMethod),
    deliveryPrice: str(o.deliveryPrice),
    // The old site already sent the confirmation and the conversion for these.
    notified: true,
    conversionSent: true,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const file = args.find((a) => !a.startsWith("--"));
  if (!file) {
    console.error("Usage: node scripts/import-new-orders.js <orders.json> [--apply] [--client-env=PATH]");
    process.exit(1);
  }
  const clientEnvArg = args.find((a) => a.startsWith("--client-env="));
  const clientEnv = readEnvFile(
    clientEnvArg ? clientEnvArg.split("=")[1] : path.join(process.cwd(), "..", "pellwood-client", ".env")
  );
  const token = process.env.STRAPI_WRITE_TOKEN || clientEnv.STRAPI_WRITE_TOKEN;
  const base = (process.env.STRAPI_INTERNAL_URL || clientEnv.STRAPI_INTERNAL_URL || "http://127.0.0.1:4501").replace(/\/$/, "");
  if (!token) {
    console.error("STRAPI_WRITE_TOKEN not found (environment or client .env).");
    process.exit(1);
  }

  async function api(p, init = {}) {
    const res = await fetch(base + p, {
      ...init,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(init.headers || {}) },
    });
    const text = await res.text();
    const body = text ? JSON.parse(text) : null;
    if (!res.ok) throw new Error(`${res.status} ${body?.error?.message || res.statusText}`);
    return body;
  }

  // Everything Strapi already has: idOrder -> orderDate
  const existing = new Map();
  for (let page = 1; ; page++) {
    const body = await api(
      `/api/orders?fields[0]=idOrder&fields[1]=orderDate&pagination[pageSize]=100&pagination[page]=${page}`
    );
    for (const o of body.data || []) existing.set(Number(o.idOrder), o.orderDate);
    if (page >= (body.meta?.pagination?.pageCount || 1)) break;
  }

  const orders = readOrders(file).map((o) => ({ raw: o, data: toStrapi(o) }));
  const invalid = orders.filter((o) => !o.data.idOrder);
  const seen = new Set();
  const todo = [];
  let dupInFile = 0;
  for (const o of orders) {
    if (!o.data.idOrder || existing.has(o.data.idOrder)) continue;
    if (seen.has(o.data.idOrder)) { dupInFile++; continue; }
    seen.add(o.data.idOrder);
    todo.push(o);
  }

  // Sanity check of the date rule against orders that were imported before.
  let maxDiffH = 0, compared = 0;
  for (const o of orders) {
    const had = existing.get(o.data.idOrder);
    if (!had || !o.data.orderDate) continue;
    compared++;
    maxDiffH = Math.max(maxDiffH, Math.abs(new Date(had) - new Date(o.data.orderDate)) / 36e5);
  }

  console.log(`Export: ${orders.length} orders. Strapi: ${existing.size}. To import: ${todo.length}.`);
  if (invalid.length) console.log(`Skipped ${invalid.length} without an idOrder.`);
  if (dupInFile) console.log(`Skipped ${dupInFile} repeated idOrder inside the export.`);
  console.log(`Date check on ${compared} already-imported orders: largest difference ${maxDiffH.toFixed(1)} h.`);

  const byState = {};
  for (const o of todo) byState[o.data.state] = (byState[o.data.state] || 0) + 1;
  if (todo.length) console.log(`New orders by state: ${JSON.stringify(byState)}`);
  for (const o of todo) {
    console.log(`  ${o.data.idOrder}  ${(o.data.orderDate || "no date").slice(0, 16)}  ${o.data.state.padEnd(9)} ${o.data.paymentStatus || "-"}  ${o.data.sum ?? "?"} ${o.data.currency}`);
  }

  if (!apply) {
    console.log("\nDry run - nothing written. Add --apply to import.");
    return;
  }

  let ok = 0;
  const failed = [];
  for (const o of todo) {
    try {
      await api("/api/orders", { method: "POST", body: JSON.stringify({ data: o.data }) });
      ok++;
    } catch (err) {
      failed.push(`${o.data.idOrder}: ${err.message}`);
    }
  }
  console.log(`\nImported ${ok} of ${todo.length}.`);
  if (failed.length) {
    console.log("Failed (fix and run again - imported ones are skipped):");
    for (const f of failed) console.log("  " + f);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
