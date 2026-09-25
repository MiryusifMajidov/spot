/**
 * Assemble the public website into `web/public/`, which is what Firebase Hosting
 * serves.
 *
 *   node store/legal/build.mjs   # regenerate the legal pages from the app's own text
 *   node web/build-site.mjs      # collect them next to the landing page
 *   npx firebase-tools deploy --only hosting --project spot-d7566
 *
 * Nothing is written by hand into `web/public/`: it is a build output, listed in
 * .gitignore. The two sources are `web/landing/index.html` (the marketing page)
 * and `store/legal/*.html` (generated from `src/lib/legal.ts` and the Russian and
 * English dictionaries, so the pages a reviewer opens and the screen a user taps
 * cannot drift apart).
 *
 * The legal pages land under `/legal/`, which is what the footer links and both
 * store forms point at:
 *
 *   https://spot-d7566.web.app/legal/privacy.html
 *   https://spot-d7566.web.app/legal/terms.html
 *   https://spot-d7566.web.app/legal/rules.html
 *   https://spot-d7566.web.app/legal/delete-account.html
 */
import { mkdir, copyFile, readdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT = join(HERE, 'public');

await rm(OUT, { recursive: true, force: true });
await mkdir(join(OUT, 'legal'), { recursive: true });

await copyFile(join(HERE, 'landing', 'index.html'), join(OUT, 'index.html'));
console.log('index.html');

const legalDir = join(ROOT, 'store', 'legal');
const pages = (await readdir(legalDir)).filter((f) => f.endsWith('.html'));
if (!pages.length) throw new Error('no legal pages — run `node store/legal/build.mjs` first');
for (const f of pages) {
  await copyFile(join(legalDir, f), join(OUT, 'legal', f));
  console.log('legal/' + f);
}

/* A published policy that still carries the placeholder would be worse than no
   page at all, and it is the kind of thing nobody notices until a reviewer
   does. Checked here, on the exact bytes about to be uploaded. */
const { readFile } = await import('node:fs/promises');
for (const f of pages) {
  const html = await readFile(join(OUT, 'legal', f), 'utf8');
  if (html.includes('DOLDURULMALI')) throw new Error(`${f} still contains a [DOLDURULMALI] placeholder`);
}

console.log(`\n${pages.length + 1} file(s) in web/public — ready for: npx firebase-tools deploy --only hosting`);
