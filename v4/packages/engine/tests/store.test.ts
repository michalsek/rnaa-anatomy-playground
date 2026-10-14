import { describe, expect, it } from 'vitest';
import { mat4, vec3 } from 'wgpu-matrix';
import { createSceneStore } from '../src/scene/store.ts';

const geo = { kind: 'box', size: [1, 1, 1] } as const;
const style = { material: 'steel' } as const;
const modelOf = (f32: Float32Array, k: number) => f32.subarray(k * 20, k * 20 + 16);

describe('SceneStore', () => {
  it('nested spin: vane world = rotor world · vane local', () => {
    const store = createSceneStore();
    store.group('m', { transform: { position: [10, 0, 0] } });
    store.group('m.rotor', { parent: 'm', moves: true, transform: { position: [0, 5, 0] } });
    store.part('m.rotor.vane', { parent: 'm.rotor', geo, style, transform: { position: [3, 0, 0] } });
    store.build();
    store.group$('m.rotor').spin('z', Math.PI / 2);
    const { f32 } = store.flatten();
    const p = vec3.transformMat4([0, 0, 0], modelOf(f32, 0));
    // (3, 0, 0) rotated 90° about z is (0, 3, 0); plus (0, 5, 0) and (10, 0, 0).
    expect([...p].map((x) => Math.round(x * 1e5) / 1e5)).toEqual([10, 8, 0]);
    const expected = mat4.multiply(
      mat4.multiply(mat4.translation([10, 5, 0]), mat4.rotationZ(Math.PI / 2)),
      mat4.translation([3, 0, 0]),
    );
    modelOf(f32, 0).forEach((v, i) => expect(v).toBeCloseTo(expected[i]!, 5));
  });

  it('resolves registration out of order', () => {
    const store = createSceneStore();
    store.part('a.b.c', { parent: 'a.b', geo, style });
    store.group('a.b', { parent: 'a' });
    store.group('a');
    expect(store.build().stats.parts).toBe(1);
  });

  it('throws on unknown ids, parents and duplicates', () => {
    const store = createSceneStore();
    store.group('a', { moves: true });
    expect(() => store.node('a.nope')).toThrow(/unknown id "a.nope"; known under "a": a/);
    store.part('x', { parent: 'missing', geo, style });
    expect(() => store.build()).toThrow(/unknown parent "missing"/);
    expect(() => store.group('a')).toThrow(/duplicate id "a"/);
  });

  it('a stale token remove is a no-op', () => {
    const store = createSceneStore();
    const first = store.part('p', { geo, style });
    store.remove('p', first);
    const second = store.part('p', { geo, style });
    store.remove('p', first); // stale (e.g. a late StrictMode cleanup)
    expect(store.ids()).toEqual(['p']);
    store.remove('p', second);
    expect(store.ids()).toEqual([]);
  });

  it('pool count beyond capacity throws', () => {
    const store = createSceneStore();
    store.pool('pool', { geo, styles: [style], capacity: 4 });
    store.build();
    const pool = store.pool$('pool');
    pool.count = 4;
    expect(() => {
      pool.count = 5;
    }).toThrow(/exceeds capacity/);
  });
});
