// M12 Part 1: the deterministic, frame-stepped web capture (notes/M12-plan.md §3).
//
//   node tools/film/capture-web.mjs <out-dir> [--frames N] [--tag p1] [--no-video]
//
// Needs the capture Chrome on CDP port 9333 showing the app (factory scene), started with
//   open -na "Google Chrome" --args --user-data-dir=$SCRATCH/chrome-film --remote-debugging-port=9333 \
//     --disable-background-timer-throttling --disable-renderer-backgrounding \
//     --disable-backgrounding-occluded-windows --force-color-profile=srgb http://localhost:8090
// (sRGB: without it the screenshots come in the display's profile, P3 on a Mac).
// The page is emulated at 1920 × 1080 CSS px, DPR 2; film mode on; Part 1 from its first frame;
// then per frame: `__v4.film.step()` (1/60 s, resolves when the GPU is done), a PNG screenshot
// (3840 × 2160) piped to ffmpeg (Lanczos to 1080p, FFV1 RGB: <tag>.mkv), and a line of state with
// the PNG's md5 (<tag>-state.jsonl). The first and the last three 4K PNGs are kept
// (<tag>_first.png, <tag>_last.png, <tag>_last-1.png, <tag>_last-2.png).
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createWriteStream, writeFileSync } from 'node:fs';
import { connect } from './cdp.mjs';

const args = process.argv.slice(2);
const out = args[0];
if (!out) throw new Error('usage: capture-web.mjs <out-dir> [--frames N] [--tag p1] [--no-video]');
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const maxFrames = Number(opt('--frames', 1e9));
const tag = opt('--tag', 'p1');
const video = !args.includes('--no-video');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const cdp = await connect();
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 2, mobile: false });
await sleep(1500);
// Hide everything but the app: Expo's dev indicator (a fixed div after #root) flashes a badge
// whenever Metro rebuilds (a file saved in the workspace), and it would land in the frames.
await cdp.evaluate(`(() => { const s = document.createElement('style'); s.textContent = 'body > :not(#root) { display: none !important; }'; document.head.appendChild(s); })()`);
const enabled = await cdp.evaluate(`__v4.film.enable({ platform: 'web' })`);
console.log('enabled', JSON.stringify({ size: enabled.size, refFit: enabled.refFit, F: enabled.F, geo: enabled.geo }));
// Let the app's effects (frame, theme) land before the first frame.
await sleep(1500);
await cdp.evaluate(`__v4.film.part1()`);

let ff = null;
let ffDone = null;
if (video) {
  ff = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', '60', '-c:v', 'png', '-i', '-', '-vf', 'scale=1920:1080:flags=lanczos', '-c:v', 'ffv1', '-level', '3', '-pix_fmt', 'gbrp', `${out}/${tag}.mkv`], { stdio: ['pipe', 'inherit', 'inherit'] });
  ffDone = new Promise((ok, fail) => ff.on('close', (code) => (code === 0 ? ok() : fail(new Error(`ffmpeg ${code}`)))));
}
const write = (buf) => new Promise((ok) => (ff.stdin.write(buf) ? ok() : ff.stdin.once('drain', ok)));
const log = createWriteStream(`${out}/${tag}-state.jsonl`);
const ring = [];
const t0 = Date.now();
let n = 0;
let last = null;
for (; n < maxFrames; n++) {
  await cdp.evaluate(`__v4.film.step()`);
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true });
  const png = Buffer.from(data, 'base64');
  if (n === 0) writeFileSync(`${out}/${tag}_first.png`, png);
  ring.push(png);
  if (ring.length > 3) ring.shift();
  if (ff) await write(png);
  const st = await cdp.evaluate(`(() => { const s = __v4.film.state(); return { shot: s.shot, t: s.t, frame: s.frame, logo: s.logo, simT: s.simT, camera: s.camera, reveal: s.reveal.t, tour: s.tour.view, ledger: s.ledger, done: s.done }; })()`);
  st.md5 = createHash('md5').update(png).digest('hex');
  log.write(`${JSON.stringify(st)}\n`);
  last = st;
  if (n % 120 === 0) console.log(`frame ${n} t ${st.t} ${st.shot} ${st.tour ?? ''} ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  if (st.done) {
    n++;
    break;
  }
}
ring.forEach((png, i) => writeFileSync(`${out}/${tag}_last${i === ring.length - 1 ? '' : `-${ring.length - 1 - i}`}.png`, png));
log.end();
if (ff) {
  ff.stdin.end();
  await ffDone;
}
const marks = await cdp.evaluate(`__v4.film.state().marks`);
console.log('frames', n, 'last', JSON.stringify(last), 'marks', JSON.stringify(marks), `${((Date.now() - t0) / 1000).toFixed(0)} s`);
writeFileSync(`${out}/${tag}-summary.json`, JSON.stringify({ frames: n, last, marks, enabled }, null, 1));
cdp.close();
