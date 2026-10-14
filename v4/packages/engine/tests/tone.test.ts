import { describe, expect, it } from 'vitest';
import { d } from 'typegpu';
import { lightOf, KIT_ELEVATION, KIT_YAW } from '../src/camera/camera.ts';
import { TONE_TOP, planShade, toneOf, tubeStripes } from '../src/shading/tone.ts';

// The kit's reference implementation (`lathe.mjs`): unit3([-sinA, cosA, 1.2]) and bandOf.
const KIT_BANDS = [0, 0.2, 0.42, 0.62];
const kitLight = () => {
  const l = [-Math.sin(KIT_YAW), Math.cos(KIT_YAW), 1.2];
  const len = Math.hypot(...l);
  return l.map((x) => x / len);
};
const kitTone = (n: number[]) => {
  const len = Math.hypot(...n);
  const l = kitLight();
  const score = (n[0]! * l[0]! + n[1]! * l[1]! + n[2]! * l[2]!) / len;
  let tone = 0;
  while (tone < KIT_BANDS.length && score >= KIT_BANDS[tone]!) tone++;
  return tone;
};

const camLight = () => d.vec3f(...lightOf({ yaw: KIT_YAW, elevation: KIT_ELEVATION }));

describe("'use gpu' tone lookup on the CPU", () => {
  it('matches the kit band for normals all around a lathe and up its profile', () => {
    const light = camLight();
    for (let a = 0; a < 360; a += 7.5) {
      for (const nz of [-0.6, -0.2, 0, 0.3, 0.7]) {
        const r = Math.sqrt(1 - nz * nz);
        const n = [r * Math.cos((a * Math.PI) / 180), r * Math.sin((a * Math.PI) / 180), nz];
        expect(toneOf(d.vec3f(n[0]!, n[1]!, n[2]!), light)).toBe(kitTone(n));
      }
    }
  });

  it('gives a box the classic Anatomy faces: lit top, darkest right side', () => {
    const light = camLight();
    expect(toneOf(d.vec3f(0, 0, 1), light)).toBe(TONE_TOP);
    expect(toneOf(d.vec3f(1, 0, 0), light)).toBe(0); // screen-right face, away from the light
    expect(toneOf(d.vec3f(0, 1, 0), light)).toBe(3); // screen-left face, toward the light (s3)
  });
});

describe('plan and tube rules', () => {
  it("planShade matches the kit's extrude bucket for 16 plan normals", () => {
    const light = camLight();
    const [lx, ly] = [-Math.sin(KIT_YAW), Math.cos(KIT_YAW)];
    for (let k = 0; k < 16; k++) {
      const a = ((k * 22.5 + 5) * Math.PI) / 180;
      const [nx, ny] = [Math.cos(a), Math.sin(a)];
      const lit = (nx * lx + ny * ly + 1) / 2;
      const kit = Math.min(3, Math.max(0, Math.floor(lit * 4)));
      expect(planShade(d.vec3f(nx, ny, 0), light)).toBe(kit);
    }
    expect(planShade(d.vec3f(0, 0, 1), light)).toBe(TONE_TOP);
    expect(planShade(d.vec3f(0, 0, -1), light)).toBe(0);
  });

  it("tube stripes sit at the kit's offsets", () => {
    for (const tw of [1, 0.5, -0.8]) {
      const at = (s: number) => [...tubeStripes(s, tw, 1e-4)] as [number, number];
      expect(at(0.44 * tw)[0]).toBe(1);
      expect(at(0.44 * tw + 0.25)[0]).toBe(0);
      expect(at(0.44 * tw - 0.25)[0]).toBe(0);
      expect(at(-0.62 * tw)[1]).toBe(1);
      expect(at(-0.62 * tw + 0.21)[1]).toBe(0);
    }
  });
});
