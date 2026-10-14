import { describe, expect, it } from 'vitest';
import { mat4 } from 'wgpu-matrix';
import { box } from '../src/geo/box.ts';
import { contactSegments } from '../src/geo/contact.ts';
import { extrude } from '../src/geo/extrude.ts';
import { tube } from '../src/geo/tube.ts';

const at = (x: number, y: number, z: number) => mat4.translation([x, y, z]);

describe('contacts', () => {
  it('post × ring: endpoints on both surfaces, chained into closed loops', () => {
    const post = extrude({ plan: { circle: 0.5, steps: 32 }, height: 6 });
    const n = 24;
    const loop = Array.from({ length: n }, (_, k) => {
      const a = (2 * Math.PI * k) / n;
      return [0.5 * Math.cos(a), 0.5 * Math.sin(a), 3] as const;
    });
    const ring = tube({ path: loop, radius: 0.3, sides: 16, bend: 0, closed: true });
    const segs = contactSegments({ mesh: post, model: at(0, 0, 0) }, { mesh: ring, model: at(0, 0, 0) });
    expect(segs.length / 6).toBeGreaterThan(16);
    const degree = new Map<string, number>();
    for (let i = 0; i < segs.length; i += 3) {
      const [x, y, z] = [segs[i]!, segs[i + 1]!, segs[i + 2]!];
      // On the post's side (faceted cylinder r 0.5) ...
      expect(Math.hypot(x, y)).toBeGreaterThan(0.49);
      expect(Math.hypot(x, y)).toBeLessThan(0.501);
      // ... and on the ring's surface (r 0.3 about its centreline circle).
      const r = Math.hypot(Math.hypot(x, y) - 0.5, z - 3);
      expect(Math.abs(r - 0.3)).toBeLessThan(0.02);
      const key = [x, y, z].map((v) => Math.round(v * 1e4)).join(',');
      degree.set(key, (degree.get(key) ?? 0) + 1);
    }
    for (const d of degree.values()) expect(d).toBe(2);
  });

  it('flush box on box: no segments', () => {
    const base = box({ size: [2, 2, 1], center: [0, 0, 0.5] });
    const top = box({ size: [1, 1, 1], center: [0, 0, 1.5] });
    expect(contactSegments({ mesh: base, model: at(0, 0, 0) }, { mesh: top, model: at(0, 0, 0) })).toHaveLength(0);
  });
});
