#!/usr/bin/env node
/*
 * Read-only: compares every product's variants and prices in a Sanity export
 * with what Strapi publishes today, and lists the differences.
 *
 *   node scripts/compare-sanity-products.js <sanity-export.ndjson> [--strapi=https://pellwood-strapi.hardart.cz]
 *
 * Uses Strapi's public REST API (the same one the website reads), so it needs
 * no token and no database access, and only sees published products - which is
 * exactly what customers see. Writes nothing anywhere.
 *
 * Products are matched per language by slug, falling back to the title.
 * Variants are matched by name (case and accents ignored); Sanity's "Habr"
 * and the English "Hornbeam" are separate per language, so each language is
 * compared on its own.
 */
const fs = require("fs");

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const strapiArg = args.find((a) => a.startsWith("--strapi="));
const STRAPI = (strapiArg ? strapiArg.split("=")[1] : "https://pellwood-strapi.hardart.cz").replace(/\/$/, "");

if (!file) {
  console.error("Usage: node scripts/compare-sanity-products.js <sanity-export.ndjson> [--strapi=URL]");
  process.exit(1);
}

const LANGS = [
  { sanity: "cz", strapi: "cs", currency: "Kč" },
  { sanity: "en", strapi: "en", currency: "€" },
];

const norm = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/** "21,60" / "528" / 528 / "" -> number or null */
function price(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

const slugOf = (s) => (s && typeof s === "object" ? s.current : s) || "";

async function fetchStrapiProducts(locale) {
  const out = [];
  for (let page = 1; ; page++) {
    const url =
      `${STRAPI}/api/products?locale=${locale}&populate[variants]=true` +
      `&fields[0]=title&fields[1]=slug&fields[2]=price` +
      `&pagination[pageSize]=100&pagination[page]=${page}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} from ${url}`);
    const body = await res.json();
    out.push(...(body.data || []));
    if (page >= (body.meta?.pagination?.pageCount || 1)) break;
  }
  return out;
}

function compareVariants(sv, tv, cur) {
  const issues = [];
  const strapiByName = new Map((tv || []).map((v) => [norm(v.title), v]));
  const seen = new Set();
  for (const v of sv || []) {
    const key = norm(v.title);
    const want = price(v.price);
    const got = strapiByName.get(key);
    seen.add(key);
    if (!got) {
      issues.push(`variant "${v.title}" missing in Strapi (Sanity: ${want ?? "no price"} ${cur})`);
    } else if (price(got.price) === null && want !== null) {
      issues.push(`variant "${v.title}" has no price in Strapi (Sanity: ${want} ${cur})`);
    } else if (want !== null && price(got.price) !== want) {
      issues.push(`variant "${v.title}" price ${price(got.price)} ${cur} in Strapi, ${want} ${cur} in Sanity`);
    }
  }
  for (const v of tv || []) {
    if (!seen.has(norm(v.title))) {
      issues.push(`variant "${v.title}" only in Strapi (${price(v.price) ?? "no price"} ${cur})`);
    }
  }
  return issues;
}

async function main() {
  const docs = fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l))
    .filter((d) => d._type === "product" && !String(d._id).startsWith("drafts."));

  let problems = 0;

  for (const lang of LANGS) {
    const strapi = await fetchStrapiProducts(lang.strapi);
    const bySlug = new Map(strapi.map((p) => [p.slug, p]));
    const byTitle = new Map(strapi.map((p) => [norm(p.title), p]));
    const matched = new Set();

    console.log(`\n=== ${lang.strapi.toUpperCase()}: Sanity ${docs.length} products, Strapi ${strapi.length} published ===`);

    for (const d of docs) {
      const s = d[lang.sanity];
      if (!s?.title) continue;
      const t = bySlug.get(slugOf(s.slug)) || byTitle.get(norm(s.title));
      if (!t) {
        problems++;
        console.log(`- ${s.title}: not published in Strapi (slug "${slugOf(s.slug)}")`);
        continue;
      }
      matched.add(t.documentId);

      const issues = [];
      const hasSanityVariants = (s.variants || []).length > 0;
      if (hasSanityVariants) {
        issues.push(...compareVariants(s.variants, t.variants, lang.currency));
      } else {
        const want = price(s.price);
        const got = price(t.price);
        if (want !== null && got !== want) {
          issues.push(`price ${got ?? "missing"} ${lang.currency} in Strapi, ${want} ${lang.currency} in Sanity`);
        }
        if ((t.variants || []).length) {
          issues.push(`Strapi has ${t.variants.length} variant(s), Sanity had none`);
        }
      }
      if (issues.length) {
        problems += issues.length;
        console.log(`- ${t.title}  (/produkt/${t.slug})`);
        for (const i of issues) console.log(`    ${i}`);
      }
    }

    const extra = strapi.filter((p) => !matched.has(p.documentId));
    if (extra.length) {
      console.log(`  Only in Strapi (new since Sanity, probably fine): ${extra.map((p) => p.title).join(", ")}`);
    }
  }

  console.log(problems ? `\n${problems} difference(s) found.` : "\nNo differences - Strapi matches Sanity.");
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
