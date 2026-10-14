import { describe, expect, it } from 'vitest';
import { vec3 } from 'wgpu-matrix';
import { DEG, type CameraState, cameraMatrices, frameRect } from '../src/camera/camera.ts';
import { createCameraEase } from '../src/camera/ease.ts';
import { FILM, type Glass, cameraLerp, filmBand, filmFrame, filmGeometry, filmLineScale, projectCss, screenCamera, simCamera, smootherstep } from '../src/camera/film.ts';

/** The closed phone's glass (M12 plan §0.2). */
const GLASS: Glass = { w: 358.4, d: 358.4 * (874 / 402), r: 61 * (358.4 / 402), z: 41 };
const toPixels = (m: Float32Array, p: [number, number, number], w: number, h: number) => {
  const c = vec3.transformMat4(p, m);
  return [((c[0]! + 1) / 2) * w, ((1 - c[1]!) / 2) * h] as const;
};
/** The glass corners through the renderer's matrices (device px), in the order −x−y, +x−y, −x+y, +x+y. */
const corners = (s: CameraState, vp: { width: number; height: number; dpr: number }) =>
  ([[-1, -1], [1, -1], [-1, 1], [1, 1]] as const).map(([sx, sy]) =>
    toPixels(cameraMatrices(s, vp).viewProjection, [(sx * GLASS.w) / 2, (sy * GLASS.d) / 2, GLASS.z], vp.width, vp.height),
  );

describe('film (M12)', () => {
  it('screenCamera: the glass fills G on web (1920 × 1080 @2) and the simulator\'s screen exactly (402 × 874 @3), island up', () => {
    const web = { width: 3840, height: 2160, dpr: 2 };
    const c1 = screenCamera(GLASS, { fill: 'height', size: 1000 });
    const [a, b, c, d] = corners(c1, web);
    // G: 1000 high from y 40, the screen's aspect, centred.
    const gw = (1000 * 402) / 874;
    expect(a[0]).toBeCloseTo((1920 - gw), 1);
    expect(a[1]).toBeCloseTo(80, 2);
    expect(d[0] - a[0]).toBeCloseTo(gw * 2, 1);
    expect(d[1] - a[1]).toBeCloseTo(2000, 2);
    // −y (the island's side) is at the top; +x is right: no roll, no mirror.
    expect(b[0]).toBeGreaterThan(a[0]);
    expect(c[1]).toBeGreaterThan(a[1]);
    // The simulator's splash: the glass's corners on the screen's corners.
    const sim = { width: 1206, height: 2622, dpr: 3 };
    const c0 = simCamera(GLASS, { width: 402, height: 874 });
    const [sa, sb, sc, sd] = corners(c0, sim);
    for (const [got, want] of [[sa[0], 0], [sa[1], 0], [sb[0], 1206], [sc[1], 2622], [sd[0], 1206], [sd[1], 2622]] as const) expect(Math.abs(got - want)).toBeLessThan(0.01);
    // In the output the simulator's screen is G, and G's corner radius is the glass's.
    const geo = filmGeometry(GLASS, sim);
    for (const k of ['x', 'y', 'w', 'h'] as const) expect(geo.screen[k]).toBeCloseTo(geo.G[k], 6);
    expect(geo.glassR / geo.G.w).toBeCloseTo(61 / 402, 6);
  });

  it('filmFrame: the same rectangle relative to the band on web and simulator; the band is centred on the output; S fills it', () => {
    const sim = { width: 1206, height: 2622, dpr: 3 };
    const geo = filmGeometry(GLASS, sim);
    const rel = (vp: { width: number; height: number; dpr: number }, dy: number) => {
      const css = { width: vp.width / vp.dpr, height: vp.height / vp.dpr };
      const band = filmBand(css, { dy });
      const r = frameRect(vp, filmFrame(css, { dy }));
      return [(r.x - band.x) / band.w, (r.y - band.y) / band.h, r.w / band.w, r.h / band.h];
    };
    const w = rel({ width: 3840, height: 2160, dpr: 2 }, 0);
    const s = rel(sim, geo.dy);
    for (let i = 0; i < 4; i++) expect(s[i]).toBeCloseTo(w[i]!, 9);
    expect(w[0]).toBeCloseTo(FILM.margin, 9);
    expect(w[2]).toBeCloseTo(1 - 2 * FILM.margin, 9);
    // Web pads: 48 left/right, 27 top/bottom.
    const pad = filmFrame({ width: 1920, height: 1080 }).pad as { t: number; l: number };
    expect(pad.l).toBeCloseTo(48, 9);
    expect(pad.t).toBeCloseTo(27, 9);
    // The simulator's band (its full width, centred on the glass) maps to the output's centre.
    expect(geo.bandOut.x + geo.bandOut.w / 2).toBeCloseTo(960, 6);
    expect(geo.bandOut.y + geo.bandOut.h / 2).toBeCloseTo(540, 6);
    expect(geo.bandOut.w / geo.bandOut.h).toBeCloseTo(16 / 9, 9);
    expect(geo.S * geo.bandOut.w).toBeCloseTo(1920, 6);
    expect(geo.G.x).toBeCloseTo((1920 - (1000 * 402) / 874) / 2, 6);
    // Lines in proportion to the band: web 1, simulator 402/1920.
    expect(filmLineScale({ width: 1920, height: 1080 })).toBe(1);
    expect(filmLineScale({ width: 402, height: 874 })).toBeCloseTo(402 / 1920, 12);
  });

  it('cameraLerp: exact ends, the shortest yaw across ±180°, monotone log zoom; smootherstep', () => {
    const a: CameraState = { target: [1, 2, 3], yaw: 170 * DEG, elevation: 30 * DEG, zoom: 0.5 };
    const b: CameraState = { target: [-4, 6, 41], yaw: -170 * DEG, elevation: 90 * DEG, zoom: 8 };
    const out: CameraState = { target: [0, 0, 0], yaw: 0, elevation: 0, zoom: 1 };
    cameraLerp(a, b, 0, out);
    expect(out).toEqual({ ...a, target: [...a.target] });
    cameraLerp(a, b, 1, out);
    expect(out.target).toEqual(b.target);
    expect(out.yaw).toBe(b.yaw);
    expect(out.elevation).toBeCloseTo(b.elevation, 12);
    expect(out.zoom).toBeCloseTo(b.zoom, 12);
    cameraLerp(a, b, 0.5, out);
    expect(Math.abs(out.yaw - 180 * DEG)).toBeLessThan(1e-9);
    expect(out.zoom).toBeCloseTo(2, 12);
    let last = 0;
    for (let i = 1; i <= 100; i++) {
      cameraLerp(a, b, i / 100, out);
      expect(out.zoom).toBeGreaterThan(last);
      last = out.zoom;
    }
    expect(smootherstep(0)).toBe(0);
    expect(smootherstep(1)).toBe(1);
    expect(smootherstep(0.5)).toBeCloseTo(0.5, 12);
    expect(smootherstep(-1)).toBe(0);
  });

  it('no frame jumps: the scripted moves and the eases change the camera by a bounded, one-signed step per 1/60 s', () => {
    // Per-frame steps of a camera sequence, and whether any channel's velocity reverses.
    const check = (seq: CameraState[], max: { yaw: number; elevation: number; logZoom: number; target: number }) => {
      let prev: number[] | null = null;
      for (let i = 1; i < seq.length; i++) {
        const a = seq[i - 1]!;
        const b = seq[i]!;
        const d = [b.yaw - a.yaw, b.elevation - a.elevation, Math.log(b.zoom / a.zoom), Math.hypot(b.target[0] - a.target[0], b.target[1] - a.target[1], b.target[2] - a.target[2])];
        expect(Math.abs(d[0]!)).toBeLessThanOrEqual(max.yaw);
        expect(Math.abs(d[1]!)).toBeLessThanOrEqual(max.elevation);
        expect(Math.abs(d[2]!)).toBeLessThanOrEqual(max.logZoom);
        expect(d[3]!).toBeLessThanOrEqual(max.target);
        if (prev) for (let k = 0; k < 3; k++) if (Math.abs(prev[k]!) > 1e-9 && Math.abs(d[k]!) > 1e-9) expect(Math.sign(prev[k]!)).toBe(Math.sign(d[k]!));
        prev = d;
      }
    };
    // Part 1's path F → C1 (2.5 s) and Part 2's pull-out and tilt, as the film plays them.
    const F: CameraState = { target: [0, 0, 137], yaw: 45 * DEG, elevation: 30 * DEG, zoom: 1.585 };
    const C1 = screenCamera(GLASS, { fill: 'height', size: 1000 });
    const path = (a: CameraState, b: CameraState, n: number) =>
      Array.from({ length: n + 1 }, (_, i) => cameraLerp(a, b, smootherstep(i / n), { target: [0, 0, 0], yaw: 0, elevation: 0, zoom: 1 }));
    check(path(F, C1, 150), { yaw: 0.6 * DEG, elevation: 0.8 * DEG, logZoom: 0.03, target: 2 });
    const C0 = simCamera(GLASS, { width: 402, height: 874 });
    const C0b = { ...C0, target: [...C0.target] as [number, number, number], zoom: C0.zoom * 0.6 };
    check(path(C0, C0b, 84), { yaw: 1e-9, elevation: 1e-9, logZoom: 0.02, target: 1e-9 });
    check(path(C0b, { ...F, zoom: 0.332 }, 120), { yaw: 0.8 * DEG, elevation: 1.1 * DEG, logZoom: 0.02, target: 2.5 });
    // The renderer's ease (the tour's view changes), stepped at 1/60 s, across ±180° of yaw.
    const ease = createCameraEase();
    const from: CameraState = { target: [0, 0, 0], yaw: 170 * DEG, elevation: 30 * DEG, zoom: 1 };
    ease.to(from, 1, { target: [40, -30, 10], yaw: -170 * DEG, elevation: 45 * DEG, zoom: 6 }, 1);
    const seq: CameraState[] = [{ ...from, target: [...from.target] }];
    for (let i = 0; i < 600 && !ease.done(); i++) {
      const c: CameraState = { target: [0, 0, 0], yaw: 0, elevation: 0, zoom: 1 };
      ease.step(1 / 60, c);
      seq.push(c);
    }
    check(seq, { yaw: 2 * DEG, elevation: 2 * DEG, logZoom: 0.15, target: 4 });
    expect(seq.at(-1)!.yaw).toBeCloseTo(190 * DEG, 9);
  });
});
