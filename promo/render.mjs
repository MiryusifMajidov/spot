// Renders a promo page to MP4: seeks its GSAP timeline frame by frame in headless
// Chromium, saves JPEG frames, mixes the app's own UI sounds at the tap moments,
// encodes with ffmpeg.
//
//   node promo/render.mjs promo/v1-zal/index.html out.mp4 [--fps 60] [--workers 4]
//   node promo/render.mjs promo/v1-zal/index.html stills/ --stills 3,8.5,14   (PNG stills)
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Playwright is installed globally (NODE_PATH), which ESM imports do not search.
const { chromium } = createRequire(import.meta.url)('playwright');

const args = process.argv.slice(2);
const page = path.resolve(args[0]);
const out = path.resolve(args[1]);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const fps = Number(opt('fps', 60));
const workers = Number(opt('workers', Math.max(1, os.cpus().length)));
const stills = opt('stills', null);
const root = path.dirname(new URL(import.meta.url).pathname);

const browser = await chromium.launch({ args: ['--font-render-hinting=none', '--disable-lcd-text'] });
async function open() {
  const p = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  p.on('pageerror', (e) => console.error('pageerror:', e.message));
  p.on('console', (m) => { if (m.type() === 'error') console.error('console:', m.text()); });
  await p.goto(pathToFileURL(page).href);
  await p.waitForFunction(() => window.__ready === true, null, { timeout: 30000 });
  await p.evaluate(() => document.fonts.ready);
  await p.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 30000 });
  return p;
}

if (stills) {
  fs.mkdirSync(out, { recursive: true });
  const p = await open();
  for (const s of stills.split(',').map(Number)) {
    await p.evaluate((t) => window.__seek(t), s);
    await p.screenshot({ path: path.join(out, `t${String(s).replace('.', '_')}.png`) });
  }
  await browser.close();
  process.exit(0);
}

const probe = await open();
const duration = await probe.evaluate(() => window.__duration);
const sfx = await probe.evaluate(() => window.SFX);
await probe.close();
const total = Math.ceil(duration * fps);
console.log(`duration ${duration.toFixed(2)}s → ${total} frames @${fps}fps, ${workers} workers`);

const frames = fs.mkdtempSync(path.join(os.tmpdir(), 'spot-frames-'));
const t0 = Date.now();
let done = 0;
await Promise.all(Array.from({ length: workers }, async (_, w) => {
  const p = await open();
  const a = Math.floor((total * w) / workers), b = Math.floor((total * (w + 1)) / workers);
  for (let i = a; i < b; i++) {
    await p.evaluate((t) => window.__seek(t), i / fps);
    await p.screenshot({ path: path.join(frames, `${String(i).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 94 });
    if (++done % 200 === 0) console.log(`${done}/${total} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }
  await p.close();
}));
await browser.close();

// audio: the app's tap/success sounds placed on the timeline
const snd = { tap: 'assets/sounds/tap.wav', pop: 'assets/sounds/tap.wav', success: 'assets/sounds/success.wav' };
const vol = { tap: 0.35, pop: 0.18, success: 0.4 };
const repo = path.resolve(root, '..');
const music = opt('music', null);
const inputs = ['-framerate', String(fps), '-i', path.join(frames, '%05d.jpg')];
if (music) inputs.push('-i', path.resolve(music));
else inputs.push('-f', 'lavfi', '-t', String(duration), '-i', 'anullsrc=r=48000:cl=stereo');
const filters = [];
sfx.forEach((s, k) => {
  inputs.push('-i', path.join(repo, snd[s.s] || snd.tap));
  const ms = Math.max(0, Math.round(s.t * 1000));
  filters.push(`[${k + 2}:a]aresample=48000,aformat=channel_layouts=stereo,volume=${vol[s.s] ?? 0.5},adelay=${ms}|${ms}[a${k}]`);
});
filters.unshift(`[1:a]aresample=48000,aformat=channel_layouts=stereo,volume=${music ? 1 : 0}[bed]`);
const mixIn = ['[bed]', ...sfx.map((_, k) => `[a${k}]`)].join('');
filters.push(`${mixIn}amix=inputs=${sfx.length + 1}:normalize=0:duration=first[aout]`);
const ff = spawnSync('ffmpeg', [
  '-y', '-loglevel', 'error', ...inputs,
  '-filter_complex', filters.join(';'),
  '-map', '0:v', '-map', '[aout]',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-profile:v', 'high',
  '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', '-t', String(duration), out,
], { stdio: 'inherit' });
fs.rmSync(frames, { recursive: true, force: true });
if (ff.status !== 0) process.exit(ff.status || 1);
console.log(`wrote ${out} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
