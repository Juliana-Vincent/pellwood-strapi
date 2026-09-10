#!/usr/bin/env node
/**
 * Audits Strapi documents by which locales they actually have, and can delete
 * the ones that exist in a single locale only.
 *
 * Why this exists: earlier import runs created orphaned documents - a PUT meant
 * to add an English locale instead minted a separate document holding only the
 * English content. Those show up alongside the correctly-paired ones and look
 * like duplicates.
 *
 * Run the audit FIRST (no flags) and read the output. Note that some products
 * legitimately have no English version (7 of them in the Sanity export), so a
 * cs-only document is usually correct and is never deleted by this script.
 *
 * Usage:
 *   node audit-locales.mjs                          # report only
 *   node audit-locales.mjs --delete-orphans=en      # delete en-only documents
 *
 * Token: .strapi-token file or STRAPI_TOKEN env var (Full access).
 */

import fs from 'node:fs';

const STRAPI_URL = (process.env.STRAPI_URL || 'http://localhost:1337').replace(/\/$/, '');
const LOCALES = ['cs', 'en'];
const TYPES = ['products', 'articles', 'archives', 'categories', 'menus'];

const DELETE_ORPHANS = (process.argv.find((a) => a.startsWith('--delete-orphans=')) || '')
  .replace('--delete-orphans=', '');

function resolveToken() {
  for (const file of ['./.strapi-token', './strapi-token.txt']) {
    if (fs.existsSync(file)) {
      const v = fs.readFileSync(file, 'utf8').trim();
      if (v) return v;
    }
  }
  return (process.env.STRAPI_TOKEN || '').trim();
}
const TOKEN = resolveToken();
if (!TOKEN) {
  console.error('No Strapi token found (.strapi-token file or STRAPI_TOKEN env var).');
  process.exit(1);
}

async function api(method, endpoint) {
  const res = await fetch(`${STRAPI_URL}/api/${endpoint}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${endpoint} -> ${res.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : {};
}

/** All documentIds (with slug/title for readability) that have a given locale. */
async function listByLocale(plural, locale) {
  const found = new Map();
  let page = 1;
  for (;;) {
    // status=draft returns every document, published or not - a published-only
    // filter would hide anything left as a draft.
    const query =
      `${plural}?locale=${locale}&status=draft` +
      `&pagination%5BpageSize%5D=100&pagination%5Bpage%5D=${page}`;
    let res;
    try {
      res = await api('GET', query);
    } catch (err) {
      // Don't swallow this: a 401/403/connection error would otherwise look
      // exactly like an empty collection, which is a dangerous thing to report
      // right before offering to delete things.
      console.error(`  ERROR reading ${plural} [${locale}]: ${err.message}`);
      break;
    }
    const rows = res?.data || [];
    for (const row of rows) {
      if (!row?.documentId) continue;
      // Strapi can answer with a fallback locale; only count exact matches.
      if (row.locale && row.locale !== locale) continue;
      found.set(row.documentId, row.slug || row.title || '(no slug)');
    }
    const pageCount = res?.meta?.pagination?.pageCount ?? 1;
    if (page >= pageCount || !rows.length) break;
    page++;
  }
  return found;
}

async function main() {
  console.log(`Target: ${STRAPI_URL}\n`);

  for (const plural of TYPES) {
    const byLocale = {};
    for (const locale of LOCALES) byLocale[locale] = await listByLocale(plural, locale);

    const all = new Set(LOCALES.flatMap((l) => [...byLocale[l].keys()]));
    if (!all.size) {
      console.log(`${plural}: empty\n`);
      continue;
    }

    const groups = { both: [], 'cs-only': [], 'en-only': [] };
    for (const documentId of all) {
      const has = LOCALES.filter((l) => byLocale[l].has(documentId));
      const label = byLocale[has[0]].get(documentId);
      if (has.length === LOCALES.length) groups.both.push([documentId, label]);
      else groups[`${has[0]}-only`].push([documentId, label]);
    }

    console.log(`${plural}: ${all.size} documents`);
    console.log(`  both locales : ${groups.both.length}`);
    console.log(`  cs only      : ${groups['cs-only'].length}`);
    console.log(`  en only      : ${groups['en-only'].length}`);

    for (const key of ['cs-only', 'en-only']) {
      if (!groups[key].length) continue;
      console.log(`  --- ${key} ---`);
      const shown = groups[key].slice(0, 10);
      for (const [documentId, label] of shown) console.log(`    ${documentId}  ${label}`);
      if (groups[key].length > shown.length) {
        console.log(`    ... and ${groups[key].length - shown.length} more`);
      }
    }

    const orphans = DELETE_ORPHANS ? groups[`${DELETE_ORPHANS}-only`] || [] : [];
    if (orphans.length) {
      console.log(`  deleting ${orphans.length} ${DELETE_ORPHANS}-only document(s)...`);
      let claimed = 0;
      for (const [documentId, label] of orphans) {
        try {
          // The locale parameter matters: without it Strapi acts on the default
          // locale (cs), which these documents do not have - it then reports
          // success while deleting nothing.
          await api('DELETE', `${plural}/${documentId}?locale=${DELETE_ORPHANS}`);
          claimed++;
        } catch (err) {
          console.error(`    FAIL ${documentId} ${label}: ${err.message}`);
        }
      }

      // Re-read rather than trusting the status codes: this whole mess started
      // with writes that reported one thing and did another.
      const after = await listByLocale(plural, DELETE_ORPHANS);
      const stillOrphaned = orphans.filter(([documentId]) => after.has(documentId));
      console.log(`  delete calls accepted: ${claimed}/${orphans.length}`);
      console.log(`  verified gone        : ${orphans.length - stillOrphaned.length}/${orphans.length}`);
      if (stillOrphaned.length) {
        console.log(`  STILL PRESENT: ${stillOrphaned.length} - the delete did not take effect`);
        for (const [documentId, label] of stillOrphaned.slice(0, 5)) {
          console.log(`    ${documentId}  ${label}`);
        }
      }
    }
    console.log('');
  }

  if (!DELETE_ORPHANS) {
    console.log('Report only. To remove en-only documents:');
    console.log('  node audit-locales.mjs --delete-orphans=en');
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
