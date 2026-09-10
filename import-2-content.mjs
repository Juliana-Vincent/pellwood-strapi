#!/usr/bin/env node
/**
 * Stage 2 of the Sanity -> Strapi migration: content.
 *
 * Requires stage 1 to have run first: image-map.json must exist, because
 * entries reference media by the Strapi id assigned during upload.
 *
 * Usage:
 *   STRAPI_URL=http://localhost:1337 \
 *   node import-2-content.mjs ./sanity-production-20260909.ndjson
 *
 * Token: same as stage 1 - a .strapi-token file in this directory, or the
 * STRAPI_TOKEN env var. Needs Full access (create + createLocalization).
 *
 * Add --dry-run to convert everything and print the report WITHOUT writing to
 * Strapi. Do that first: it surfaces missing images, unresolved relations and
 * required-field gaps before anything is created.
 *
 * Import order matters, because relations point at documents that must already
 * exist:
 *   1. categories, archives   (no outgoing relations)
 *   2. products               (-> category)
 *   3. articles               (-> archive)
 *   4. products, second pass  (-> linkedProducts, now that all products exist)
 *   5. homepage, menu, setting
 *
 * Re-running: safe-ish, but NOT idempotent - it creates new documents each
 * time. If a run goes wrong, delete the entries in Strapi (or restore the DB)
 * before re-running, otherwise you get duplicates.
 */

import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const STRAPI_URL = (process.env.STRAPI_URL || 'http://localhost:1337').replace(/\/$/, '');
const NDJSON = process.argv.find((a) => a.endsWith('.ndjson'));
const DRY_RUN = process.argv.includes('--dry-run');
// Delete existing content of the imported types before importing. Required for
// any re-run: the script creates new documents, and the unique `slug` field
// will reject anything already present.
const PURGE = process.argv.includes('--purge');
// Log the full request body and response for every failure. Use with --types
// and --limit to iterate on one small collection instead of all 115 products.
const DEBUG = process.argv.includes('--debug');
// e.g. --types=archives,categories   (Strapi plural names)
const ONLY_TYPES = (process.argv.find((a) => a.startsWith('--types=')) || '')
  .replace('--types=', '')
  .split(',')
  .filter(Boolean);
// e.g. --limit=3  - import at most N documents per collection
const LIMIT = Number((process.argv.find((a) => a.startsWith('--limit=')) || '').replace('--limit=', '') || 0);

// Sanity stored Czech under the key "cz"; the Strapi locale code is "cs".
// Confirm these match Settings -> Internationalization in your Strapi.
const LOCALES = [
  { sanity: 'cz', strapi: 'cs' },
  { sanity: 'en', strapi: 'en' },
];

const THROTTLE_MS = Number(process.env.THROTTLE_MS || 120);

function resolveToken() {
  for (const file of ['./.strapi-token', './strapi-token.txt']) {
    if (fs.existsSync(file)) {
      const value = fs.readFileSync(file, 'utf8').trim();
      if (value) return value;
    }
  }
  return (process.env.STRAPI_TOKEN || '').trim();
}
const STRAPI_TOKEN = resolveToken();

if (!NDJSON || !fs.existsSync(NDJSON)) {
  console.error('Usage: node import-2-content.mjs <path-to-ndjson> [--dry-run]');
  process.exit(1);
}
if (!DRY_RUN && !STRAPI_TOKEN) {
  console.error('No Strapi token found (.strapi-token file or STRAPI_TOKEN env var).');
  process.exit(1);
}
if (!fs.existsSync('./image-map.json')) {
  console.error('image-map.json not found - run import-1-images.mjs first.');
  process.exit(1);
}

const imageMap = JSON.parse(fs.readFileSync('./image-map.json', 'utf8'));

// sanity _id -> strapi documentId, filled in as we go and used for relations
const idMap = {};
// things that need a human decision afterwards
const report = { warnings: [], errors: [], created: {} };

const warn = (msg) => {
  report.warnings.push(msg);
  console.warn(`  warn: ${msg}`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Portable Text -> Strapi blocks
// ---------------------------------------------------------------------------

/**
 * Converts one Portable Text block's spans into Strapi block children.
 *
 * Sanity marks are either decorators ("strong", "em") or a markDefs key that
 * points at an annotation - in this dataset the only annotation type is "link"
 * (224 of them). Strapi represents links as an inline node wrapping the text
 * rather than as a property on it, hence the branch at the end.
 */
function spansToChildren(block) {
  const markDefs = new Map((block.markDefs || []).map((m) => [m._key, m]));
  const children = [];

  for (const span of block.children || []) {
    if (span?._type !== 'span') continue;

    const node = { type: 'text', text: span.text ?? '' };
    let href = null;

    for (const mark of span.marks || []) {
      switch (mark) {
        case 'strong':
          node.bold = true;
          break;
        case 'em':
          node.italic = true;
          break;
        case 'underline':
          node.underline = true;
          break;
        case 'strike-through':
          node.strikethrough = true;
          break;
        case 'code':
          node.code = true;
          break;
        default: {
          const def = markDefs.get(mark);
          if (!def) break; // dangling mark key with no matching markDef
          if (def._type === 'link') {
            // 14 of these exist in the export with no href at all - empty
            // links left in the Sanity editor. Keep the text, drop the link:
            // a link node with an undefined url would fail validation.
            if (def.href) href = def.href;
            else warn('link annotation has no href in Sanity - text kept, link dropped');
          } else {
            warn(`unhandled annotation type "${def._type}" - text kept, formatting dropped`);
          }
          break;
        }
      }
    }

    children.push(href ? { type: 'link', url: href, children: [node] } : node);
  }

  // Strapi rejects a block with no children; an empty text node is the
  // equivalent of Sanity's empty paragraph (this dataset has plenty).
  if (!children.length) children.push({ type: 'text', text: '' });
  return children;
}

/**
 * Converts a Portable Text array into Strapi's blocks format.
 * Returns undefined for empty input so the caller can omit the field entirely
 * rather than writing an empty array.
 */
function toBlocks(portableText) {
  if (!Array.isArray(portableText) || !portableText.length) return undefined;

  const out = [];
  let list = null;
  const flushList = () => {
    if (list) {
      out.push(list);
      list = null;
    }
  };

  for (const block of portableText) {
    if (block?._type !== 'block') {
      // Images embedded directly in rich text would land here. This dataset
      // has none (all 1244 blocks are text), so flag it rather than silently
      // dropping content if that ever changes.
      flushList();
      warn(`non-text block of type "${block?._type}" in rich text was skipped`);
      continue;
    }

    const children = spansToChildren(block);

    // Sanity marks list items on individual blocks; Strapi nests list-items
    // inside a single list node, so consecutive items have to be grouped.
    if (block.listItem) {
      const format = block.listItem === 'number' ? 'ordered' : 'unordered';
      if (!list || list.format !== format) {
        flushList();
        list = { type: 'list', format, children: [] };
      }
      list.children.push({ type: 'list-item', children });
      continue;
    }

    flushList();

    const style = block.style || 'normal';
    if (/^h[1-6]$/.test(style)) {
      out.push({ type: 'heading', level: Number(style[1]), children });
    } else if (style === 'blockquote') {
      out.push({ type: 'quote', children });
    } else {
      out.push({ type: 'paragraph', children });
    }
  }

  flushList();
  return out.length ? out : undefined;
}

// ---------------------------------------------------------------------------
// Field helpers
// ---------------------------------------------------------------------------

/** Sanity image object -> Strapi media id, via the stage 1 map. */
function mediaId(image, context) {
  const ref = image?.asset?._ref;
  if (!ref) return undefined;
  const mapped = imageMap[ref];
  if (!mapped) {
    warn(`${context}: image ${ref} is not in image-map.json - field left empty`);
    return undefined;
  }
  return mapped.id;
}

/**
 * Sanity stored these "pick 3 products" relations as an object with fixed keys
 * (product_1, product_2, product_3) rather than an array. Some products also
 * reference themselves, which Strapi would happily store as a self-relation.
 */
function refIds(relationObject, selfSanityId) {
  if (!relationObject) return [];
  const values = Array.isArray(relationObject) ? relationObject : Object.values(relationObject);
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const ref = value?._ref;
    if (!ref || ref === selfSanityId || seen.has(ref)) continue;
    seen.add(ref);
    out.push(ref);
  }
  return out;
}

/** Maps Sanity _ids to Strapi documentIds, warning about anything unresolved. */
function toDocumentIds(sanityIds, context) {
  const out = [];
  for (const id of sanityIds) {
    const documentId = idMap[id];
    if (!documentId) {
      warn(`${context}: referenced document ${id} was never created - relation skipped`);
      continue;
    }
    out.push(documentId);
  }
  return out;
}

const slugOf = (obj) => obj?.slug?.current || undefined;

/** Sanity prices are sometimes numbers, sometimes strings with a comma. */
function toDecimal(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const num = Number(String(value).replace(',', '.'));
  return Number.isFinite(num) ? num : undefined;
}

function variants(list) {
  if (!Array.isArray(list) || !list.length) return undefined;
  // inStock and weight exist on the Strapi component but never existed in
  // Sanity and are not read anywhere in the client, so they are left unset
  // rather than invented.
  return list.map((v) => ({ title: v.title ?? '', price: String(v.price ?? '') }));
}

function parameters(list) {
  if (!Array.isArray(list) || !list.length) return undefined;
  return list.map((p) => ({ title: p.title ?? '', value: p.value ?? '' }));
}

/** Drops undefined values so Strapi keeps its own defaults for absent fields. */
const compact = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

// ---------------------------------------------------------------------------
// Strapi REST
// ---------------------------------------------------------------------------

async function api(method, endpoint, body) {
  const url = `${STRAPI_URL}/api/${endpoint}`;
  const payload = body ? JSON.stringify({ data: body }) : undefined;

  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${STRAPI_TOKEN}`,
    },
    body: payload,
  });

  const text = await res.text();

  if (DEBUG && !res.ok) {
    console.error(`\n  --- DEBUG ${method} ${url} -> ${res.status}`);
    console.error(`  request : ${payload || '(no body)'}`);
    console.error(`  response: ${text.slice(0, 800)}\n`);
  }

  if (!res.ok) {
    throw new Error(`${method} ${endpoint} -> ${res.status}: ${text.slice(0, 400)}`);
  }
  return text ? JSON.parse(text) : {};
}

/**
 * Reads back one locale of a document.
 *
 * Needed because a failing write is not proof that nothing was written: this
 * import has produced 400 responses for writes whose rows ended up in the
 * database anyway. Trusting the status code alone made every re-run collide
 * with data the previous "failed" run had created.
 */
async function readLocale(plural, documentId, locale) {
  try {
    const res = await api('GET', `${plural}/${documentId}?locale=${locale}&status=draft`);
    const doc = res?.data;
    if (!doc) return null;
    // Strapi answers with the fallback locale when the requested one is absent,
    // so compare rather than assuming a 200 means the locale exists.
    return doc.locale === locale ? doc : null;
  } catch {
    return null;
  }
}

/**
 * Creates a collection-type document in the Czech locale, then attaches the
 * English locale to the SAME document.
 *
 * Two Strapi 5 details this relies on:
 *  - A POST without a `status` param creates the document already published,
 *    so nothing is left as an invisible draft.
 *  - A locale is added by PUT-ing to the existing documentId with ?locale=xx.
 *    Doing this via the Document Service instead can mint a *new* documentId
 *    (strapi issue #24445), which would break the locale pairing.
 */
async function createLocalized(plural, byLocale, label) {
  const primary = byLocale.find((entry) => entry.data);
  if (!primary) return null;

  const created = await api('POST', `${plural}?locale=${primary.locale}`, primary.data);
  const documentId = created?.data?.documentId;
  if (!documentId) throw new Error(`${label}: no documentId returned`);

  for (const entry of byLocale) {
    if (entry === primary || !entry.data) continue;

    let wrote = false;
    try {
      await api('PUT', `${plural}/${documentId}?locale=${entry.locale}`, entry.data);
      wrote = true;
    } catch (err) {
      // Don't trust the status code: check whether the locale attached anyway.
      const attached = await readLocale(plural, documentId, entry.locale);
      if (attached) {
        warn(`${label}: ${entry.locale} write returned an error but the locale did attach - treating as written`);
        wrote = true;
      } else {
        // A real failure. Surface it, but keep the primary locale we created
        // rather than aborting the whole document.
        report.errors.push(`${label} [${entry.locale}]: ${err.message}`);
        console.error(`  FAIL ${label} [${entry.locale}]: ${err.message}`);
      }
    }

    // Even a 200 deserves a check: an orphaned document (new documentId
    // instead of a localization) reads back as "locale missing" here, which is
    // exactly the failure that left the admin's English tab empty.
    if (wrote) {
      const attached = await readLocale(plural, documentId, entry.locale);
      if (!attached) {
        report.errors.push(
          `${label} [${entry.locale}]: write reported success but the locale is NOT attached to ${documentId} - likely created as a separate document`
        );
        console.error(`  ORPHAN ${label} [${entry.locale}] - not linked to ${documentId}`);
      }
    }
  }

  return documentId;
}

async function updateDocument(plural, documentId, locale, data) {
  return api('PUT', `${plural}/${documentId}?locale=${locale}`, data);
}

/** Single types have no documentId in the path. */
async function upsertSingle(singular, locale, data) {
  return api('PUT', `${singular}?locale=${locale}`, data);
}

/**
 * Fails fast if Strapi isn't answering yet.
 *
 * Starting the import while `strapi develop` is still booting produces a burst
 * of opaque "fetch failed" errors on the first N entries, which looks like a
 * script bug rather than a race.
 */
async function preflight() {
  try {
    const res = await fetch(`${STRAPI_URL}/api/products?pagination%5BpageSize%5D=1`, {
      headers: { Authorization: `Bearer ${STRAPI_TOKEN}` },
    });
    if (res.status === 401 || res.status === 403) {
      throw new Error(`Strapi rejected the token (${res.status}). Check .strapi-token has Full access.`);
    }
    if (!res.ok) throw new Error(`Strapi answered ${res.status} on a test query.`);
  } catch (err) {
    if (err.message.startsWith('Strapi')) throw err;
    throw new Error(
      `Cannot reach Strapi at ${STRAPI_URL} (${err.cause?.code || err.message}).\n` +
        'If you just ran `npm run develop`, wait for "Strapi started successfully" before importing.'
    );
  }
}

/**
 * Deletes every document of the given types, across all locales and both
 * draft and published versions.
 *
 * Needed because this script is not idempotent: re-running over existing data
 * collides on the unique `slug` field. Deleting from the Content Manager is an
 * easy way to get this half-right - removing entries while the locale selector
 * is set to one locale can leave the other locale's versions behind, and those
 * orphans still hold the slugs.
 *
 * Media is untouched: uploads live in the Media Library, so image-map.json
 * stays valid and stage 1 does not need re-running.
 */
async function purge(plurals) {
  console.log('Purging existing content...');

  for (const plural of plurals) {
    const documentIds = new Set();

    // A document only appears in a query for a locale it actually has, and
    // draft-only documents are invisible to the default (published) view, so
    // sweep every combination.
    for (const { strapi: locale } of LOCALES) {
      for (const status of ['draft', 'published']) {
        let page = 1;
        for (;;) {
          const query = `${plural}?locale=${locale}&status=${status}` +
            `&pagination%5BpageSize%5D=100&pagination%5Bpage%5D=${page}`;
          let res;
          try {
            res = await api('GET', query);
          } catch (err) {
            // A type with nothing in it, or no such locale, is not an error.
            break;
          }
          const rows = res?.data || [];
          for (const row of rows) if (row?.documentId) documentIds.add(row.documentId);
          const pageCount = res?.meta?.pagination?.pageCount ?? 1;
          if (page >= pageCount || !rows.length) break;
          page++;
        }
      }
    }

    if (!documentIds.size) {
      console.log(`  ${plural}: nothing to delete`);
      continue;
    }

    let deleted = 0;
    for (const documentId of documentIds) {
      try {
        // Deleting by documentId removes every locale of that document.
        await api('DELETE', `${plural}/${documentId}`);
        deleted++;
      } catch (err) {
        report.errors.push(`purge ${plural}/${documentId}: ${err.message}`);
      }
    }
    console.log(`  ${plural}: deleted ${deleted}/${documentIds.size}`);
  }
  console.log('');
}

// ---------------------------------------------------------------------------
// Per-type builders: one Sanity locale object -> one Strapi data payload
// ---------------------------------------------------------------------------

const build = {
  category: (o) =>
    compact({
      title: o.title,
      sort: o.sort,
      description: toBlocks(o.description),
    }),

  archive: (o) =>
    compact({
      title: o.title,
      slug: slugOf(o),
      sort: o.sort,
      description: toBlocks(o.description),
      SEOtitle: o.titleHead,
      SEOdescription: o.descriptionHead,
    }),

  // linkedProducts deliberately omitted here - filled in by a second pass once
  // every product exists.
  product: (o, doc, locale) =>
    compact({
      title: o.title,
      slug: slugOf(o),
      image: mediaId(o.image, `product "${o.title}" [${locale}]`),
      orientedImage: o.orientedImage,
      // Only set where Sanity had one: products with variants priced per
      // variant never had a top-level price, and inventing one (e.g. the
      // cheapest variant) would change what the page displays.
      price: toDecimal(o.price),
      text: toBlocks(o.text),
      // `description` (blocks) exists on the Strapi product but has no Sanity
      // counterpart - descriptionHead is the meta description, not body copy.
      SEOdescription: o.descriptionHead,
      SEOtitle: o.titleHead,
      sort: o.sort,
      variants: variants(o.variants),
      parametrs: parameters(o.parametrs),
      category: o.category?._ref ? idMap[o.category._ref] : undefined,
    }),

  article: (o, doc, locale) =>
    compact({
      title: o.title,
      slug: slugOf(o),
      image: mediaId(o.image, `article "${o.title}" [${locale}]`),
      SEOtitle: o.titleHead,
      SEOdescription: o.descriptionHead,
      sort: o.sort,
      // article.category targets the archive content-type, not category.
      category: o.category?._ref ? idMap[o.category._ref] : undefined,
      chapters: (o.chapters || []).map((ch) => ({
        title: ch.title ?? '',
        text: toBlocks(ch.text),
        image: mediaId(ch.image, `article "${o.title}" chapter [${locale}]`),
      })),
    }),

  homepage: (o, doc, locale) =>
    compact({
      title: o.title,
      image: mediaId(o.image, `homepage [${locale}]`),
      content: toBlocks(o.content),
      SEOtitle: o.titleHead,
      SEOdescription: o.descriptionHead,
      button: o.button ? { title: o.button.title ?? '', url: o.button.url ?? '' } : undefined,
      banner: o.banner
        ? compact({
            title: o.banner.title,
            url: o.banner.url,
            image: mediaId(o.banner.image, `homepage banner [${locale}]`),
          })
        : undefined,
    }),

  menu: (o) =>
    compact({
      title: o.title,
      location: o.location,
      items: (o.items || []).map((i) => ({ title: i.title ?? '', menuUrl: i.menuUrl ?? '' })),
    }),

  setting: (o) =>
    compact({
      // Sanity's settings had titleCategory/descriptionCategory/metaCatalog;
      // the Strapi setting type only has title/description/footer, so the two
      // category fields are mapped across and metaCatalog has nowhere to go.
      title: o.titleCategory,
      description: o.descriptionCategory,
      footer: (o.footer || []).map((f) => compact({ title: f.title ?? '', content: toBlocks(f.content) })),
    }),
};

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

function readDocs(file) {
  const docs = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      docs.push(JSON.parse(line));
    } catch {
      warn('skipped a malformed NDJSON line');
    }
  }
  return docs;
}

/** Builds the per-locale payloads for one Sanity document. */
function localePayloads(doc, type) {
  return LOCALES.map(({ sanity, strapi }) => {
    const source = doc[sanity];
    return {
      locale: strapi,
      data: source && typeof source === 'object' ? build[type](source, doc, strapi) : null,
    };
  });
}

async function importCollection(docs, sanityType, strapiType, plural) {
  if (ONLY_TYPES.length && !ONLY_TYPES.includes(plural)) return 0;

  let selected = docs.filter((d) => d._type === sanityType);
  if (LIMIT) selected = selected.slice(0, LIMIT);
  console.log(`\n${sanityType} -> ${plural} (${selected.length})`);
  let count = 0;

  for (const doc of selected) {
    const label = `${sanityType} ${doc.cz?.title || doc.en?.title || doc._id}`;
    const payloads = localePayloads(doc, strapiType);

    const missing = LOCALES.filter(({ sanity }) => !doc[sanity]).map(({ strapi }) => strapi);
    if (missing.length) warn(`${label}: no source content for locale(s) ${missing.join(', ')}`);

    if (DRY_RUN) {
      // Pretend it worked so later relation lookups resolve and get validated.
      idMap[doc._id] = `dry-${doc._id}`;
      count++;
      continue;
    }

    try {
      const documentId = await createLocalized(plural, payloads, label);
      if (documentId) {
        idMap[doc._id] = documentId;
        count++;
        console.log(`  ok  ${label}`);
      }
    } catch (err) {
      report.errors.push(`${label}: ${err.message}`);
      console.error(`  FAIL ${label}: ${err.message}`);
    }
    await sleep(THROTTLE_MS);
  }

  report.created[plural] = count;
  return count;
}

/** Second pass: product -> product relations, once every product exists. */
async function linkProducts(docs) {
  const products = docs.filter((d) => d._type === 'product');
  console.log(`\nlinking products (${products.length})`);
  let linked = 0;

  for (const doc of products) {
    const documentId = idMap[doc._id];
    if (!documentId) continue;

    for (const { sanity, strapi } of LOCALES) {
      const source = doc[sanity];
      if (!source?.linkedProducts) continue;

      const label = `product "${source.title}" [${strapi}] linkedProducts`;
      const ids = toDocumentIds(refIds(source.linkedProducts, doc._id), label);
      if (!ids.length) continue;

      if (DRY_RUN) {
        linked++;
        continue;
      }
      try {
        await updateDocument('products', documentId, strapi, { linkedProducts: ids });
        linked++;
      } catch (err) {
        report.errors.push(`${label}: ${err.message}`);
        console.error(`  FAIL ${label}: ${err.message}`);
      }
      await sleep(THROTTLE_MS);
    }
  }

  report.created.productLinks = linked;
}

async function importSingles(docs) {
  // homepage: recommendedProducts is the same object-shaped relation as
  // linkedProducts, and can be set inline because products already exist.
  const homepage = docs.find((d) => d._type === 'homepage');
  if (homepage) {
    console.log('\nhomepage');
    for (const { sanity, strapi } of LOCALES) {
      const source = homepage[sanity];
      if (!source) continue;
      const data = build.homepage(source, homepage, strapi);
      const ids = toDocumentIds(refIds(source.recommendedProducts), `homepage [${strapi}] recommendedProducts`);
      if (ids.length) data.recommendedProducts = ids;

      if (DRY_RUN) continue;
      try {
        await upsertSingle('homepage', strapi, data);
        console.log(`  ok  homepage [${strapi}]`);
      } catch (err) {
        report.errors.push(`homepage [${strapi}]: ${err.message}`);
        console.error(`  FAIL homepage [${strapi}]: ${err.message}`);
      }
    }
  }

  const setting = docs.find((d) => d._type === 'settings');
  if (setting) {
    console.log('\nsetting');
    if (setting.cz?.metaCatalog || setting.en?.metaCatalog) {
      warn('settings.metaCatalog has no field in the Strapi setting type - not imported');
    }
    for (const { sanity, strapi } of LOCALES) {
      const source = setting[sanity];
      if (!source) continue;
      if (DRY_RUN) continue;
      try {
        await upsertSingle('setting', strapi, build.setting(source, setting, strapi));
        console.log(`  ok  setting [${strapi}]`);
      } catch (err) {
        report.errors.push(`setting [${strapi}]: ${err.message}`);
        console.error(`  FAIL setting [${strapi}]: ${err.message}`);
      }
    }
  }
}

async function main() {
  const docs = readDocs(NDJSON);
  console.log(`Read ${docs.length} Sanity documents.`);
  console.log(`Images mapped: ${Object.keys(imageMap).length}`);
  console.log(DRY_RUN ? 'DRY RUN - nothing will be written to Strapi.\n' : `Target: ${STRAPI_URL}\n`);

  if (!DRY_RUN) {
    await preflight();
    if (PURGE) await purge(['products', 'articles', 'archives', 'categories', 'menus']);
  }

  // Order is dependency-driven: see the header comment.
  await importCollection(docs, 'category', 'category', 'categories');
  await importCollection(docs, 'archive', 'archive', 'archives');
  await importCollection(docs, 'product', 'product', 'products');
  await importCollection(docs, 'article', 'article', 'articles');
  await linkProducts(docs);
  await importCollection(docs, 'menu', 'menu', 'menus');
  await importSingles(docs);

  fs.writeFileSync('./id-map.json', JSON.stringify(idMap, null, 2));
  fs.writeFileSync('./import-report.json', JSON.stringify(report, null, 2));

  console.log('\n--- summary ---');
  for (const [key, value] of Object.entries(report.created)) console.log(`  ${key}: ${value}`);
  console.log(`  warnings: ${report.warnings.length}`);
  console.log(`  errors:   ${report.errors.length}`);
  console.log('\nid-map.json and import-report.json written.');
  if (report.errors.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
