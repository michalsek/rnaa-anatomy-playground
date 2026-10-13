import { describe, expect, it } from 'vitest';
import tgpu from 'typegpu';
import { fillFragment, fillVertex } from '../src/render/shaders.ts';

describe('M1 fill shader', () => {
  it('resolves the full vertex and fragment functions to WGSL', () => {
    const wgsl = tgpu.resolve([fillVertex, fillFragment]);
    expect(wgsl).toMatch(/@vertex/);
    expect(wgsl).toMatch(/@fragment/);
    expect(wgsl).toMatch(/fwidth\(/);
    expect(wgsl).toMatch(/dpdx\(/);
  });
});
