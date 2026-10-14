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

  it('unchanged handle writes do not dirty the table; pose takes pitch and roll', () => {
    const store = createSceneStore();
    store.group('g', { moves: true });
    store.pool('g.pool', { parent: 'g', geo, styles: [style, style], capacity: 2 });
    store.build();
    const group = store.group$('g');
    const pool = store.pool$('g.pool');
    pool.count = 1;
    group.spin('z', 0.5);
    pool.pose(0, [1, 2, 3], 0.1, Math.PI / 2, 0);
    pool.style(0, 1);
    expect(store.flatten().dirty).toBe(true);
    group.spin('z', 0.5);
    pool.pose(0, [1, 2, 3], 0.1, Math.PI / 2, 0);
    pool.style(0, 1);
    pool.count = 1;
    expect(store.flatten().dirty).toBe(false);
    group.spin('z', 0);
    pool.pose(0, [0, 0, 0], 0, Math.PI / 2, 0);
    const { f32 } = store.flatten();
    // Pitch 90° about y turns the instance's +x down to −z.
    const x = vec3.transformMat4([1, 0, 0], modelOf(f32, 0));
    expect([...x].map((v) => Math.round(v * 1e5) / 1e5 + 0)).toEqual([0, 0, -1]);
  });

  it('scalar pose equals the array pose; translate is a cheap set; capacity is read live', () => {
    const store = createSceneStore();
    store.group('g', { moves: true });
    const token = store.pool('g.pool', { parent: 'g', geo, styles: [style], capacity: 2 });
    store.build();
    const pool = store.pool$('g.pool');
    pool.count = 2;
    pool.pose(0, [1, 2, 3], 0.4);
    pool.pose(1, 1, 2, 3, 0.4);
    const group = store.group$('g');
    group.translate(0, 0, 8.3);
    const { f32 } = store.flatten();
    expect([...modelOf(f32, 1)]).toEqual([...modelOf(f32, 0)]);
    expect(modelOf(f32, 0)[14]).toBeCloseTo(3 + 8.3, 5);
    group.translate(0, 0, 8.3);
    pool.pose(1, 1, 2, 3, 0.4);
    expect(store.flatten().dirty).toBe(false);
    group.set({ position: [0, 0, 8.3] });
    expect(store.flatten().dirty).toBe(true);
    // Re-registering the pool with another capacity: an old handle sees the new one.
    store.remove('g.pool', token);
    store.pool('g.pool', { parent: 'g', geo, styles: [style], capacity: 5 });
    expect(pool.capacity).toBe(5);
  });
});
