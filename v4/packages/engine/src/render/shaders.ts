/**
 * The M1 fill shader with in-face lines.
 *
 * Vertex stage (vertex pulling, `draw(triCount × 3)`): each invocation loads its whole triangle,
 * projects the three corners to device pixels for the screen altitudes, and decides the mode of
 * each edge for this frame (outline where the neighbour faces away, crease where flagged).
 *
 * Fragment stage: four-tone bands with analytic AA, then UV tick lines, creases, and outlines
 * (flagged edges plus a smooth-contour term on curved surfaces), each mixed in by coverage.
 */
import tgpu, { d, std } from 'typegpu';
import { SLOT, SLOT_COUNT } from '../palette/tokens.ts';
import { NO_NEIGHBOUR } from '../geo/topology.ts';
import { bandWeights } from '../shading/tone.ts';
import {
  EDGE_CREASE,
  EDGE_OUTLINE,
  edgeCoverage,
  edgeMode,
  flagBit,
  tickCoverage,
  wire,
} from '../shading/lines.ts';
import { sceneLayout as L } from './schemas.ts';

const toPixels = (clip: d.v4f, viewport: d.v2f) => {
  'use gpu';
  const ndc = std.div(clip.xy, clip.w);
  return d.vec2f((ndc.x * 0.5 + 0.5) * viewport.x, (0.5 - ndc.y * 0.5) * viewport.y);
};

/** Distance from corner p to the line through a and b, in the same (pixel) units. */
const altitude = (p: d.v2f, a: d.v2f, b: d.v2f) => {
  'use gpu';
  const e = std.sub(b, a);
  const q = std.sub(p, a);
  return std.abs(e.x * q.y - e.y * q.x) / std.max(std.length(e), 1e-6);
};

const facingOf = (model: d.m4x4f, normal: d.v3f, toward: d.v3f) => {
  'use gpu';
  return std.dot(std.mul(model, d.vec4f(normal, 0)).xyz, toward);
};

/** Facing of the triangle across an edge; no neighbour counts as facing away. */
const neighbourFacing = (adj: number, model: d.m4x4f, toward: d.v3f) => {
  'use gpu';
  const safe = std.select(d.u32(adj), d.u32(0), d.u32(adj) === NO_NEIGHBOUR);
  const facing = facingOf(model, L.$.tris[safe].faceNormal, toward);
  return std.select(facing, d.f32(-1), d.u32(adj) === NO_NEIGHBOUR);
};

export const fillVertex = tgpu.vertexFn({
  in: { vid: d.builtin.vertexIndex },
  out: {
    clip: d.builtin.position,
    normal: d.vec3f,
    uv: d.vec2f,
    bary: d.interpolate('linear', d.vec3f),
    heights: d.interpolate('flat', d.vec3f),
    modes: d.interpolate('flat', d.vec3u),
    part: d.interpolate('flat', d.u32),
    flags: d.interpolate('flat', d.u32),
  },
})((input) => {
  'use gpu';
  const t = d.u32(input.vid / 3);
  const c = input.vid % 3;
  const tri = L.$.tris[t];
  const part = L.$.parts[tri.part];
  const frame = L.$.frame;

  const v0 = L.$.vertices[tri.idx.x];
  const v1 = L.$.vertices[tri.idx.y];
  const v2 = L.$.vertices[tri.idx.z];
  const c0 = std.mul(frame.viewProjection, std.mul(part.model, d.vec4f(v0.position, 1)));
  const c1 = std.mul(frame.viewProjection, std.mul(part.model, d.vec4f(v1.position, 1)));
  const c2 = std.mul(frame.viewProjection, std.mul(part.model, d.vec4f(v2.position, 1)));
  const p0 = toPixels(c0, frame.viewport);
  const p1 = toPixels(c1, frame.viewport);
  const p2 = toPixels(c2, frame.viewport);

  const own = facingOf(part.model, tri.faceNormal, frame.toward);
  const modes = d.vec3u(
    edgeMode(own, neighbourFacing(tri.adj.x, part.model, frame.toward), tri.flags, 0),
    edgeMode(own, neighbourFacing(tri.adj.y, part.model, frame.toward), tri.flags, 1),
    edgeMode(own, neighbourFacing(tri.adj.z, part.model, frame.toward), tri.flags, 2),
  );

  const is1 = c === 1;
  const is2 = c === 2;
  const clip = std.select(std.select(c0, c1, is1), c2, is2);
  const normal = std.select(std.select(v0.normal, v1.normal, is1), v2.normal, is2);
  const uv = std.select(
    std.select(d.vec2f(v0.u, v0.v), d.vec2f(v1.u, v1.v), is1),
    d.vec2f(v2.u, v2.v),
    is2,
  );
  const bary = std.select(
    std.select(d.vec3f(1, 0, 0), d.vec3f(0, 1, 0), is1),
    d.vec3f(0, 0, 1),
    is2,
  );

  return {
    clip,
    normal: std.mul(part.model, d.vec4f(normal, 0)).xyz,
    uv,
    bary,
    heights: d.vec3f(altitude(p0, p1, p2), altitude(p1, p2, p0), altitude(p2, p0, p1)),
    modes,
    part: tri.part,
    flags: tri.flags,
  };
});

const tone = (material: number, slot: number) => {
  'use gpu';
  return d.vec4f(L.$.palette[d.u32(material) * SLOT_COUNT + d.u32(slot)]);
};

/** Coverage of edge `i`'s line if its mode is `want`, else 0. */
const edgeTerm = (mode: number, want: number, dist: number, extent: number, alpha: number) => {
  'use gpu';
  return std.select(d.f32(0), edgeCoverage(dist, extent, alpha), d.u32(mode) === d.u32(want));
};

const RED = d.vec4f(0.9, 0.1, 0.1, 1);
const MAGENTA = d.vec4f(0.85, 0.1, 0.85, 1);
const BLUE = d.vec4f(0.15, 0.35, 0.95, 1);
const GREEN = d.vec4f(0.1, 0.7, 0.2, 1);

export const fillFragment = tgpu.fragmentFn({
  in: {
    normal: d.vec3f,
    uv: d.vec2f,
    bary: d.interpolate('linear', d.vec3f),
    heights: d.interpolate('flat', d.vec3f),
    modes: d.interpolate('flat', d.vec3u),
    part: d.interpolate('flat', d.u32),
    flags: d.interpolate('flat', d.u32),
  },
  out: d.vec4f,
})((input) => {
  'use gpu';
  const frame = L.$.frame;
  const part = L.$.parts[input.part];
  const m = part.material;

  // Every derivative first, in uniform control flow.
  const n = std.normalize(input.normal);
  const score = std.dot(n, frame.light);
  const fw = std.fwidth(score);
  const facing = std.dot(n, frame.toward);
  const facingGrad = std.length(d.vec2f(std.dpdx(facing), std.dpdy(facing)));
  const set = (input.flags >>> 8) & 0xff;
  const lineSet = L.$.lineSets[std.select(set, d.u32(1), set === 0) - 1];
  const x = input.uv.x * lineSet.count - lineSet.phase;
  const xGrad = std.length(d.vec2f(std.dpdx(x), std.dpdy(x)));

  // Bands.
  const w = bandWeights(score, fw);
  let color = tone(m, SLOT.s0);
  color = std.mix(color, tone(m, SLOT.s1), w.x);
  color = std.mix(color, tone(m, SLOT.s2), w.y);
  color = std.mix(color, tone(m, SLOT.s3), w.z);
  color = std.mix(color, tone(m, SLOT.top), w.w);
  const debug = frame.debug;
  if (debug === 1) {
    color = tone(m, SLOT.paper);
  }

  if (debug !== 2) {
    // UV tick lines.
    if (set > 0) {
      const nearest = std.round(x);
      const dist = std.abs(x - nearest) / std.max(xGrad, 1e-6);
      const count = d.i32(lineSet.count);
      const index = ((d.i32(nearest) % count) + count) % count;
      if (index >= lineSet.first && index <= lineSet.last) {
        const every = d.i32(std.max(lineSet.majorEvery, 1));
        const major = lineSet.majorEvery > 0 && (index - lineSet.first) % every === 0;
        const line = wire(std.select(lineSet.width, lineSet.majorWidth, major) * frame.pxPerCss);
        let alpha = line.y;
        if (lineSet.fade.y > lineSet.fade.x) {
          alpha = alpha * std.smoothstep(lineSet.fade.x, lineSet.fade.y, facing);
        }
        const ink = std.select(
          tone(m, std.select(lineSet.minorSlot, lineSet.majorSlot, major)),
          GREEN,
          debug === 1,
        );
        color = std.mix(color, ink, tickCoverage(dist, line.x, alpha));
      }
    }

    // Edge lines: creases straddle their edge (half per face), outlines lie inside the face.
    const line = wire(part.width * frame.pxPerCss);
    const half = line.x / 2;
    const d0 = input.bary.x * input.heights.x;
    const d1 = input.bary.y * input.heights.y;
    const d2 = input.bary.z * input.heights.z;
    const crease = std.max(
      edgeTerm(input.modes.x, EDGE_CREASE, d0, half, line.y),
      std.max(
        edgeTerm(input.modes.y, EDGE_CREASE, d1, half, line.y),
        edgeTerm(input.modes.z, EDGE_CREASE, d2, half, line.y),
      ),
    );
    const outline = std.max(
      edgeTerm(input.modes.x, EDGE_OUTLINE, d0, line.x, line.y),
      std.max(
        edgeTerm(input.modes.y, EDGE_OUTLINE, d1, line.x, line.y),
        edgeTerm(input.modes.z, EDGE_OUTLINE, d2, line.x, line.y),
      ),
    );
    // Smooth contour: on curved faces the limb is where n · toward reaches 0, which can fall
    // inside a facet (or on a sliver), so measure it per pixel from the interpolated normal.
    let contour = d.f32(0);
    if (flagBit(input.flags, 6) === 1) {
      contour = edgeCoverage(facing / std.max(facingGrad, 1e-6), line.x, line.y);
    }

    color = std.mix(
      color,
      std.select(tone(m, part.creaseSlot), BLUE, debug === 1),
      crease,
    );
    if (debug === 1) {
      color = std.mix(color, MAGENTA, contour);
      color = std.mix(color, RED, outline);
    } else {
      color = std.mix(color, tone(m, part.outlineSlot), std.max(outline, contour));
    }
  }
  return d.vec4f(color.xyz, 1);
});
