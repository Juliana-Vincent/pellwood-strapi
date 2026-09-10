#!/usr/bin/env node
/**
 * Stage 1 of the Sanity -> Strapi migration: media only.
 *
 * Reads the Sanity NDJSON export, finds every sanity.imageAsset, downloads it
 * from the Sanity CDN and uploads it to Strapi's /api/upload. Writes a map of
 *   sanity asset _id  ->  strapi media id
 * to image-map.json, which stage 2 uses to attach images to entries.
 *
 * Run this BEFORE importing content: entries can't reference media that
 * doesn't exist yet.
 *
 * Usage:
 *   STRAPI_URL=http://localhost:1337 \
 *   STRAPI_TOKEN=<full-access API token> \
 *   node import-1-images.mjs ./sanity-production-20260909.ndjson
 *
 * Create the token in Strapi admin: Settings -> API Tokens -> Create new
 * -> Token type "Full access". Upload is not part of the Public role.
 *
 * Safe to re-run: it skips assets already present in image-map.json, so if the
 * script dies halfway (flaky network, 339 MB of downloads) just run it again.
 */

import fs from 'node:fs';
import path from 'node:path';

const STRAPI_URL = (process.env.STRAPI_URL || 'http://localhost:1337').replace(/\/$/, '');

/**
 * Token resolution, in order of preference:
 *   1. a .strapi-token file next to this script (easiest - no shell escaping,
 *      and a full-access token is long enough that pasting it on a command
 *      line invites "File name too long" / quoting mistakes)
 *   2. the STRAPI_TOKEN env var
 * The trim() matters: copying from the Strapi admin usually brings a trailing
 * newline, which would otherwise end up inside the Authorization header.
 */
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
const NDJSON = process.argv[2];
const MAP_FILE = path.resolve('./image-map.json');

// Each upload makes Strapi's sharp pipeline generate several resized formats of
// the original, which is memory-hungry: on a 512 MB host (Render free tier)
// parallel uploads OOM the container, which surfaces as a 502 from the edge.
// Default to one at a time; raise it for a local machine or a paid instance.
const CONCURRENCY = Number(process.env.CONCURRENCY || 1);
const RETRIES = Number(process.env.RETRIES || 5);
// A crashed container needs tens of seconds to come back, so back off in
// seconds rather than milliseconds.
const RETRY_BASE_MS = Number(process.env.RETRY_BASE_MS || 5000);
// Optional pause between uploads, to let a small instance reclaim memory.
const THROTTLE_MS = Number(process.env.THROTTLE_MS || 0);
// Optional cap on the pixel width requested from Sanity's CDN.
// Sanity resized on delivery, so the multi-megapixel originals in the export
// were never actually served to visitors - the old client asked for at most
// ~1000px via urlFor().width(). Strapi has no on-the-fly resizing, and running
// sharp over a 7000px original to build four formats is what OOMs the process
// (a dropped connection mid-upload surfaces as a bare "fetch failed").
// Set e.g. MAX_IMAGE_WIDTH=2500 to import a sane size instead.
const MAX_IMAGE_WIDTH = Number(process.env.MAX_IMAGE_WIDTH || 0);

if (!NDJSON || !fs.existsSync(NDJSON)) {
  console.error('Usage: node import-1-images.mjs <path-to-ndjson>');
  process.exit(1);
}
if (!STRAPI_TOKEN) {
  console.error('No Strapi token found. Either:');
  console.error('  - save it to a file named .strapi-token in this directory, or');
  console.error('  - set the STRAPI_TOKEN environment variable');
  console.error('Create one in Strapi admin: Settings -> API Tokens -> Full access.');
  process.exit(1);
}

/** Read the export and pull out just the image assets. */
function readAssets(file) {
  const assets = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let doc;
    try {
      doc = JSON.parse(line);
    } catch {
      continue; // a malformed line shouldn't abort the whole run
    }
    if (doc._type === 'sanity.imageAsset' && doc.url) {
      assets.push({
        id: doc._id,
        url: doc.url,
        // originalFilename is often something like "4.JPG" - not unique across
        // the dataset, so prefix with the asset hash to avoid collisions in
        // Strapi's upload folder.
        filename: `${doc.assetId}-${doc.originalFilename || 'image'}`.replace(/[^\w.\-]/g, '_'),
        mime: doc.mimeType || 'application/octet-stream',
        size: doc.size || 0,
      });
    }
  }
  return assets;
}

function loadMap() {
  if (!fs.existsSync(MAP_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(MAP_FILE, 'utf8'));
  } catch {
    console.warn('image-map.json is unreadable, starting a fresh map.');
    return {};
  }
}

function saveMap(map) {
  fs.writeFileSync(MAP_FILE, JSON.stringify(map, null, 2));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Download one asset from the Sanity CDN. */
async function download(asset) {
  // Sanity's image API resizes on request, so capping here means we never pull
  // (or hand to sharp) more pixels than the site actually displayed.
  const url = MAX_IMAGE_WIDTH
    ? `${asset.url}?w=${MAX_IMAGE_WIDTH}&fit=max&auto=format`
    : asset.url;

  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    // Node's fetch collapses network errors into a bare "fetch failed"; the
    // real reason (ECONNRESET, ETIMEDOUT, DNS) is on .cause, and without it
    // a CDN rate-limit is indistinguishable from a dead connection.
    const cause = err?.cause?.code || err?.cause?.message || 'unknown';
    throw new Error(`CDN download failed (${cause})`);
  }
  if (!res.ok) throw new Error(`CDN ${res.status} ${res.statusText}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Upload one buffer to Strapi, returning the created media record. */
async function upload(asset, buffer) {
  const form = new FormData();
  form.append('files', new Blob([buffer], { type: asset.mime }), asset.filename);

  let res;
  try {
    res = await fetch(`${STRAPI_URL}/api/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${STRAPI_TOKEN}` },
      body: form, // no Content-Type header - fetch sets the multipart boundary
    });
  } catch (err) {
    // Distinguish this from a CDN failure: if Strapi's sharp pipeline OOMs on a
    // large image the socket just dies, and both phases would otherwise report
    // the same opaque "fetch failed".
    const cause = err?.cause?.code || err?.cause?.message || 'unknown';
    throw new Error(`Strapi upload connection failed (${cause}) - check whether Strapi restarted`);
  }

  const text = await res.text();
  if (!res.ok) throw new Error(`Strapi ${res.status}: ${text.slice(0, 300)}`);

  const json = JSON.parse(text);
  const media = Array.isArray(json) ? json[0] : json;
  if (!media?.id) throw new Error(`No media id in response: ${text.slice(0, 300)}`);
  return media;
}

async function processAsset(asset, map, counters) {
  if (map[asset.id]) {
    counters.skipped++;
    return;
  }

  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const buffer = await download(asset);
      const media = await upload(asset, buffer);
      map[asset.id] = { id: media.id, url: media.url, name: media.name };
      counters.done++;
      console.log(`  ok   ${counters.done + counters.skipped + counters.failed}/${counters.total}  ${asset.filename}`);
      return;
    } catch (err) {
      if (attempt === RETRIES) {
        counters.failed++;
        counters.failures.push({ id: asset.id, url: asset.url, error: String(err.message || err) });
        console.error(`  FAIL ${asset.filename}: ${err.message || err}`);
        return;
      }
      // Exponential-ish backoff in seconds: a container that got OOM-killed
      // needs time to restart before it can accept the next upload, and hammering
      // it every half-second just keeps it down.
      await sleep(RETRY_BASE_MS * attempt);
    }
  }
}

async function main() {
  const assets = readAssets(NDJSON);
  const map = loadMap();

  const counters = {
    total: assets.length,
    done: 0,
    skipped: 0,
    failed: 0,
    failures: [],
  };

  const totalMb = (assets.reduce((sum, a) => sum + a.size, 0) / 1e6).toFixed(1);
  console.log(`Found ${assets.length} image assets (~${totalMb} MB).`);
  console.log(`Already mapped: ${Object.keys(map).length}. Uploading the rest to ${STRAPI_URL}\n`);

  // Simple worker pool: CONCURRENCY workers pulling from a shared cursor.
  let cursor = 0;
  const worker = async () => {
    while (cursor < assets.length) {
      const asset = assets[cursor++];
      await processAsset(asset, map, counters);
      if (THROTTLE_MS) await sleep(THROTTLE_MS);
      // Persist as we go so a crash doesn't lose completed work.
      if (counters.done % 10 === 0) saveMap(map);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  saveMap(map);

  console.log(`\nUploaded: ${counters.done}  Skipped (already done): ${counters.skipped}  Failed: ${counters.failed}`);
  console.log(`Map written to ${MAP_FILE}`);

  if (counters.failures.length) {
    fs.writeFileSync('./image-failures.json', JSON.stringify(counters.failures, null, 2));
    console.log('Failures listed in image-failures.json - re-run this script to retry only those.');
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
