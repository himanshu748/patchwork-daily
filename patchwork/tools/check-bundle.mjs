// Bundle budget check, run at the end of `npm run build` (Req 27.3, D10, D36).
// Sums the gzip level 9 size of every .js file in dist/client, and of the JavaScript the launch screen
// (splash.html) loads: its entry script plus every chunk it imports statically. Lazy chunks count toward
// the total only.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const DIST = resolve(import.meta.dirname, '../dist/client');
const TOTAL_LIMIT = 133_120;
const LAUNCH_LIMIT = 15_360;

const gzipBytes = (name) => gzipSync(readFileSync(join(DIST, name)), { level: 9 }).length;
const local = (ref) => ref.replace(/^\.?\//, '');

function launchFiles() {
  const html = readFileSync(join(DIST, 'splash.html'), 'utf8');
  const queue = [...html.matchAll(/<script[^>]*\bsrc="([^"]+\.js)"/g), ...html.matchAll(/<link[^>]*rel="modulepreload"[^>]*href="([^"]+\.js)"/g)].map(
    (m) => local(m[1]),
  );
  const seen = new Set();
  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file) || !existsSync(join(DIST, file))) continue;
    seen.add(file);
    const code = readFileSync(join(DIST, file), 'utf8');
    // Static imports and re-exports only; import("./x.js") is lazy and has a parenthesis before the quote.
    for (const m of code.matchAll(/(?:\bfrom|\bimport)\s*["'](\.\/[\w.-]+\.js)["']/g)) queue.push(local(m[1]));
  }
  return [...seen].sort();
}

if (!existsSync(DIST)) {
  console.error(`check-bundle: ${DIST} does not exist; run vite build first.`);
  process.exit(1);
}

const all = readdirSync(DIST).filter((f) => f.endsWith('.js')).sort();
const sizes = new Map(all.map((f) => [f, gzipBytes(f)]));
const total = [...sizes.values()].reduce((a, b) => a + b, 0);
const launch = launchFiles();
const launchTotal = launch.reduce((a, f) => a + (sizes.get(f) ?? gzipBytes(f)), 0);

for (const [f, s] of sizes) console.log(`  ${f.padEnd(28)} ${String(s).padStart(7)} B gz${launch.includes(f) ? '  (launch screen)' : ''}`);
console.log(`check-bundle: client JS total ${total} of ${TOTAL_LIMIT} bytes gzipped`);
console.log(`check-bundle: launch screen JS ${launchTotal} of ${LAUNCH_LIMIT} bytes gzipped (${launch.join(', ')})`);

let failed = false;
if (launch.length === 0) {
  console.error('check-bundle: no launch-screen script found in splash.html');
  failed = true;
}
if (total > TOTAL_LIMIT) {
  console.error(`check-bundle: client JS is ${total - TOTAL_LIMIT} bytes over the 130 KB budget`);
  failed = true;
}
if (launchTotal > LAUNCH_LIMIT) {
  console.error(`check-bundle: launch screen JS is ${launchTotal - LAUNCH_LIMIT} bytes over the 15 KB budget`);
  failed = true;
}
process.exit(failed ? 1 : 0);
