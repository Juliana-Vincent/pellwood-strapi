#!/usr/bin/env node
/**
 * Lists the Sanity image assets that are NOT yet in image-map.json.
 *
 * Use it between runs of import-1-images.mjs to see what's left, and to get
 * the raw CDN URLs so you can open one in a browser: if it loads there but
 * fails in the script, you're being rate-limited; if it 404s, the asset is
 * genuinely gone and stage 2 should skip it.
 *
 * Usage: node check-missing-images.mjs ./sanity-production-20260909.ndjson
 */

import fs from 'node:fs';

const NDJSON = process.argv[2];
if (!NDJSON || !fs.existsSync(NDJSON)) {
  console.error('Usage: node check-missing-images.mjs <path-to-ndjson>');
  process.exit(1);
}

const map = fs.existsSync('./image-map.json')
  ? JSON.parse(fs.readFileSync('./image-map.json', 'utf8'))
  : {};

const assets = [];
for (const line of fs.readFileSync(NDJSON, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  let doc;
  try {
    doc = JSON.parse(line);
  } catch {
    continue;
  }
  if (doc._type === 'sanity.imageAsset' && doc.url) {
    assets.push({ id: doc._id, url: doc.url, size: doc.size || 0 });
  }
}

const missing = assets.filter((a) => !map[a.id]);

console.log(`Mapped:  ${Object.keys(map).length}`);
console.log(`Total:   ${assets.length}`);
console.log(`Missing: ${missing.length}\n`);

if (missing.length) {
  // Sort biggest first - large files are the ones most likely to time out,
  // so if the tail of failures is all multi-megabyte images that's a size
  // problem rather than a rate-limit problem.
  missing.sort((a, b) => b.size - a.size);
  for (const a of missing) {
    console.log(`${(a.size / 1e6).toFixed(2).padStart(6)} MB  ${a.url}`);
  }
  fs.writeFileSync('./missing-images.json', JSON.stringify(missing, null, 2));
  console.log('\nWritten to missing-images.json');
}
