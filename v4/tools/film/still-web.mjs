// node tools/film/still-web.mjs <out-dir>: checkpoint B stills on web (the capture Chrome): film
// mode at 1920 × 1080 @2, F (the open factory) and C1 (the closed glass, top-down), 4K PNGs.
import { writeFileSync } from 'node:fs';
import { connect } from './cdp.mjs';

const out = process.argv[2] ?? '.';
const cdp = await connect();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name) => {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true });
  writeFileSync(`${out}/${name}.png`, Buffer.from(data, 'base64'));
};
try {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 2, mobile: false });
  await sleep(1500);
  console.log(JSON.stringify(await cdp.evaluate(`__v4.film.enable({ platform: 'web' })`)));
  await sleep(1000);
  await cdp.evaluate(`__v4.film.part1()`);
  for (let i = 0; i < 3; i++) await cdp.evaluate(`__v4.film.step()`);
  await shot('B-web-F');
  const C = await cdp.evaluate(`(() => { const st = __v4.film.state(); return st; })()`);
  console.log(JSON.stringify(C));
  // C1: the glass top-down, filling 1000 of 1080 px.
  await cdp.evaluate(`(() => { __v4.reveal.seek(0); const g = __v4.film.state().glass; __v4cam.set({ target: [0, 0, g.z], yaw: Math.PI / 2, elevation: Math.PI / 2, zoom: 1000 / g.d }); })()`);
  for (let i = 0; i < 3; i++) await cdp.evaluate(`__v4.film.step()`);
  await shot('B-web-C1');
} finally {
  cdp.close();
}
