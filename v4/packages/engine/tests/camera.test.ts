import { describe, expect, it } from 'vitest';
import { vec3 } from 'wgpu-matrix';
import {
  type Bounds,
  KIT_ELEVATION,
  KIT_YAW,
  cameraMatrices,
  fitToBounds,
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
