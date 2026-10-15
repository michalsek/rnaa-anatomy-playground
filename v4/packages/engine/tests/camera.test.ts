import { describe, expect, it } from 'vitest';
import { vec3 } from 'wgpu-matrix';
import { ORBIT, orbitBy, panBy, zoomAbout } from '../src/camera/orbit.ts';
import {
  type Bounds,
  type CameraState,
  DEG,
  basisOf,
  KIT_ELEVATION,
  KIT_YAW,
  cameraMatrices,
  fitToBounds,
  frameRect,
  kitProject,
} from '../src/camera/camera.ts';

const toPixels = (m: Float32Array, p: [number, number, number], w: number, h: number) => {
  const c = vec3.transformMat4(p, m);
  return [((c[0]! + 1) / 2) * w, ((1 - c[1]!) / 2) * h, c[2]!] as const;
};

describe('camera', () => {
  const bounds: Bounds = { min: [-20, -20, 0], max: [20, 20, 17] };

  it('projects like the kit formula: X = x·sinA − y·cosA, Y = (x·cosA + y·sinA)·sinE − z·cosE', () => {
    for (const dpr of [1, 2, 3]) {
      const viewport = { width: 800 * dpr, height: 600 * dpr, dpr };
      const state = fitToBounds(bounds, viewport);
      const { viewProjection } = cameraMatrices(state, viewport);
      const s = state.zoom * dpr;
      const origin = toPixels(viewProjection, [0, 0, 0], viewport.width, viewport.height);
      for (const p of [
        [10, 0, 0],
        [0, 10, 0],
        [0, 0, 10],
        [7, -3, 12],
      ] as [number, number, number][]) {
        const [px, py] = toPixels(viewProjection, p, viewport.width, viewport.height);
        const [kx, ky] = kitProject(p, KIT_YAW, KIT_ELEVATION);
        expect(px - origin[0]).toBeCloseTo(kx * s, 3);
        expect(py - origin[1]).toBeCloseTo(ky * s, 3);
      }
      // Pixel snap: the world origin sits on a whole device pixel.
      expect(Math.abs(origin[0] - Math.round(origin[0]))).toBeLessThan(1e-3);
      expect(Math.abs(origin[1] - Math.round(origin[1]))).toBeLessThan(1e-3);
    }
  });

  it('fits the bounds inside the viewport and orders depth nearest-first', () => {
    const viewport = { width: 390 * 3, height: 844 * 3, dpr: 3 };
    const state = fitToBounds(bounds, viewport, { pad: 24 });
    const { viewProjection } = cameraMatrices(state, viewport);
    const pad = 24 * 3;
    for (const x of [bounds.min[0], bounds.max[0]])
      for (const y of [bounds.min[1], bounds.max[1]])
        for (const z of [bounds.min[2], bounds.max[2]]) {
          const [px, py, depth] = toPixels(viewProjection, [x, y, z], viewport.width, viewport.height);
          expect(px).toBeGreaterThanOrEqual(pad - 1);
          expect(px).toBeLessThanOrEqual(viewport.width - pad + 1);
          expect(py).toBeGreaterThanOrEqual(pad - 1);
          expect(py).toBeLessThanOrEqual(viewport.height - pad + 1);
          expect(depth).toBeGreaterThan(0);
          expect(depth).toBeLessThan(1);
        }
    // A point toward the viewer (+x+y at yaw 45°, +z) is nearer: smaller depth.
    const [, , far] = toPixels(viewProjection, [-10, -10, 0], viewport.width, viewport.height);
    const [, , near] = toPixels(viewProjection, [10, 10, 5], viewport.width, viewport.height);
    expect(near).toBeLessThan(far);
  });
});

describe('camera frame (pads, 16:9)', () => {
  const box: Bounds = { min: [-180, -380, 0], max: [180, 380, 280] };
  it('fits into the largest centred 16:9 rectangle inside the padded viewport, touching one pair of its edges', () => {
    for (const [W, H, dpr, pad] of [
      [874, 402, 3, { t: 12, r: 74, b: 33, l: 74 }],
      [1600, 900, 1, { t: 60, r: 40, b: 50, l: 40 }],
      [390, 844, 3, { t: 100, r: 12, b: 40, l: 12 }],
    ] as const) {
      const viewport = { width: W * dpr, height: H * dpr, dpr };
      const aspect = 16 / 9;
      const rect = frameRect(viewport, { pad, aspect });
      expect(rect.w / rect.h).toBeCloseTo(aspect, 6);
      // Centred in the padded viewport, inside it.
      expect(rect.x + rect.w / 2).toBeCloseTo(pad.l + (W - pad.l - pad.r) / 2, 6);
      expect(rect.y + rect.h / 2).toBeCloseTo(pad.t + (H - pad.t - pad.b) / 2, 6);
      expect(rect.x).toBeGreaterThanOrEqual(pad.l - 1e-9);
      expect(rect.y).toBeGreaterThanOrEqual(pad.t - 1e-9);
      const state = fitToBounds(box, viewport, { pad, aspect });
      const { viewProjection } = cameraMatrices(state, viewport);
      let l = Infinity;
      let r = -Infinity;
      let t = Infinity;
      let b = -Infinity;
      for (const x of [box.min[0], box.max[0]])
        for (const y of [box.min[1], box.max[1]])
          for (const z of [box.min[2], box.max[2]]) {
            const [px, py] = toPixels(viewProjection, [x, y, z], viewport.width, viewport.height);
            l = Math.min(l, px / dpr);
            r = Math.max(r, px / dpr);
            t = Math.min(t, py / dpr);
            b = Math.max(b, py / dpr);
          }
      // Inside the rectangle (the pixel snap moves it ≤ 1 device px).
      const e = 1 / dpr + 1e-6;
      expect(l).toBeGreaterThanOrEqual(rect.x - e);
      expect(r).toBeLessThanOrEqual(rect.x + rect.w + e);
      expect(t).toBeGreaterThanOrEqual(rect.y - e);
      expect(b).toBeLessThanOrEqual(rect.y + rect.h + e);
      // Touching one pair of its edges, centred along the other.
      const touchesX = Math.abs(l - rect.x) < e && Math.abs(r - rect.x - rect.w) < e;
      const touchesY = Math.abs(t - rect.y) < e && Math.abs(b - rect.y - rect.h) < e;
      expect(touchesX || touchesY).toBe(true);
      expect((l + r) / 2).toBeCloseTo(rect.x + rect.w / 2, 0);
      expect((t + b) / 2).toBeCloseTo(rect.y + rect.h / 2, 0);
    }
  });
});

describe('free camera (orbit, pan, zoom; M11)', () => {
  const start = (): CameraState => ({ target: [10, -20, 30], yaw: 45 * DEG, elevation: 30 * DEG, zoom: 2 });
  /** A world point's CSS px offset from the viewport's centre (y down) for a camera. */
  const screen = (s: CameraState, p: [number, number, number]) => {
    const b = basisOf(s.yaw, s.elevation);
    const d = [0, 1, 2].map((i) => p[i]! - s.target[i]!);
    return [s.zoom * (d[0]! * b.right[0] + d[1]! * b.right[1] + d[2]! * b.right[2]), -s.zoom * (d[0]! * b.up[0] + d[1]! * b.up[1] + d[2]! * b.up[2])];
  };

  it('orbits about the target with the elevation clamped to 10–80°', () => {
    const s = orbitBy(start(), 40, -1000, start());
    expect(s.target).toEqual([10, -20, 30]);
    expect(s.elevation).toBeCloseTo(ORBIT.minElevation, 9);
    expect(orbitBy(start(), 0, 1000, start()).elevation).toBeCloseTo(ORBIT.maxElevation, 9);
    expect(s.yaw).toBeCloseTo(45 * DEG - 40 * ORBIT.perPx, 9);
  });

  it('pans the world with the finger and zooms about a point that stays put, within 0.5–12× the reference', () => {
    const p: [number, number, number] = [60, 15, 5];
    const a = screen(start(), p);
    const moved = panBy(start(), 17, -9, start());
    const b = screen(moved, p);
    expect(b[0]! - a[0]!).toBeCloseTo(17, 6);
    expect(b[1]! - a[1]!).toBeCloseTo(-9, 6);
    const z = zoomAbout(start(), 3, a[0]!, a[1]!, 1, start());
    expect(z.zoom).toBeCloseTo(6, 9);
    const c = screen(z, p);
    expect(c[0]).toBeCloseTo(a[0]!, 6);
    expect(c[1]).toBeCloseTo(a[1]!, 6);
    expect(zoomAbout(start(), 100, 0, 0, 1, start()).zoom).toBe(ORBIT.maxZoom);
    expect(zoomAbout(start(), 0.01, 0, 0, 1, start()).zoom).toBe(ORBIT.minZoom);
  });
});
