import { describe, expect, it } from 'vitest';
import tgpu from 'typegpu';
import { fillFragment, fillVertex, marksFragment, marksVertex, spriteFragment, spriteVertex } from '../src/render/shaders.ts';

describe('shaders', () => {
  it('resolve the fill and marks stages to WGSL', () => {
    const fill = tgpu.resolve([fillVertex, fillFragment]);
    expect(fill).toMatch(/@vertex/);
    expect(fill).toMatch(/@fragment/);
    expect(fill).toMatch(/fwidth\(/);
    const marks = tgpu.resolve([marksVertex, marksFragment]);
    expect(marks).toMatch(/@vertex/);
    expect(marks).toMatch(/@fragment/);
  });

  it('resolve the sprite stages to WGSL', () => {
    const sprites = tgpu.resolve([spriteVertex, spriteFragment]);
    expect(sprites).toMatch(/@vertex/);
    expect(sprites).toMatch(/@fragment/);
  });
});
