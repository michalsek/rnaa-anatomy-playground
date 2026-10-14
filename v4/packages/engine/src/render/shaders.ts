/**
 * The fill shader with in-face lines, and the marks shader (free dots and segments).
 *
 * Fill vertex stage (vertex pulling, `draw(triCount × 3, instances, firstTri × 3, firstInstance)`):
 * each invocation loads its whole triangle and its instance (`instance_index + tri.slot`),
 * projects the three corners to device pixels for the screen altitudes, decides the mode of
 * each edge for this frame (outline where the neighbour faces away, crease where flagged), and
 * picks the tone rule (plan only while the model's z stays vertical, tube only on curved faces).
 *
 * Fill fragment stage: tones (bands, plan or tube rule) with analytic AA, then UV tick lines,
 * creases, and outlines (flagged edges plus a smooth-contour term on curved surfaces), each
 * mixed in by coverage.
 */
import tgpu, { d, std } from 'typegpu';
import { SLOT, SLOT_COUNT } from '../palette/tokens.ts';
import { FLAG, NO_NEIGHBOUR } from '../geo/topology.ts';
import { TUBE_LIGHT, bandWeights, planLit, planWeights, tubeStripes } from '../shading/tone.ts';
import {
  EDGE_CREASE,
  EDGE_OUTLINE,
  edgeCoverage,
  edgeMode,
  flagBit,
  tickCoverage,
  wire,
} from '../shading/lines.ts';
import { INSTANCE, MARK, TONE_RULE, sceneLayout as L } from './schemas.ts';

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

/**
 * The line through a and b as (n.x, n.y, c) with |n| = 1 and n·p + c > 0 on `inside`'s side:
 * a pixel's distance into the face from that edge, in pixels.
 */
const edgeLine = (a: d.v2f, b: d.v2f, inside: d.v2f) => {
  'use gpu';
  const e = std.sub(b, a);
  const len = std.length(e);
  let n = d.vec2f(-e.y, e.x);
  n = std.div(n, std.max(len, 1e-6));
  let c = -std.dot(n, a);
  if (std.dot(n, inside) + c < 0) {
    n = std.neg(n);
    c = -c;
  }
  // A collapsed edge is never near anything.
  return std.select(d.vec3f(n, c), d.vec3f(0, 0, 1e6), len < 1e-6);
};

/** z of (b − a) × (c − b): the turn at corner b. */
const turn = (a: d.v2f, b: d.v2f, c: d.v2f) => {
  'use gpu';
  const u = std.sub(b, a);
  const v = std.sub(c, b);
  return u.x * v.y - u.y * v.x;
};

/** Whether the screen quad a-b-c-d turns the same way at all four corners. */
const isConvexQuad = (a: d.v2f, b: d.v2f, c: d.v2f, e: d.v2f) => {
  'use gpu';
  const t0 = turn(e, a, b);
  const t1 = turn(a, b, c);
  const t2 = turn(b, c, e);
  const t3 = turn(c, e, a);
  const allPos = t0 > 0 && t1 > 0 && t2 > 0 && t3 > 0;
  const allNeg = t0 < 0 && t1 < 0 && t2 < 0 && t3 < 0;
  return allPos || allNeg;
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

/** A clip position outside the depth range: the primitive is dropped. */
const HIDDEN = d.vec4f(0, 0, 2, 1);

export const fillVertex = tgpu.vertexFn({
  in: { vid: d.builtin.vertexIndex, iid: d.builtin.instanceIndex },
  out: {
    clip: d.builtin.position,
    normal: d.vec3f,
    uv: d.vec2f,
    bary: d.interpolate('linear', d.vec3f),
    heights: d.interpolate('flat', d.vec3f),
    modes: d.interpolate('flat', d.vec3u),
    style: d.interpolate('flat', d.u32),
    rule: d.interpolate('flat', d.u32),
    flags: d.interpolate('flat', d.u32),
    extraA: d.interpolate('flat', d.vec3f),
    extraB: d.interpolate('flat', d.vec3f),
    extraModes: d.interpolate('flat', d.vec2u),
    tangent: d.vec3f,
    facingGrad: d.interpolate('flat', d.f32),
  },
})((input) => {
  'use gpu';
  const t = d.u32(input.vid / 3);
  const c = input.vid % 3;
  const tri = L.$.tris[t];
  const inst = L.$.instances[input.iid + tri.slot];
  const style = L.$.styles[inst.style];
  const frame = L.$.frame;

  const v0 = L.$.vertices[tri.idx.x];
  const v1 = L.$.vertices[tri.idx.y];
  const v2 = L.$.vertices[tri.idx.z];
  const c0 = std.mul(frame.viewProjection, std.mul(inst.model, d.vec4f(v0.position, 1)));
  const c1 = std.mul(frame.viewProjection, std.mul(inst.model, d.vec4f(v1.position, 1)));
  const c2 = std.mul(frame.viewProjection, std.mul(inst.model, d.vec4f(v2.position, 1)));
  const p0 = toPixels(c0, frame.viewport);
  const p1 = toPixels(c1, frame.viewport);
  const p2 = toPixels(c2, frame.viewport);

  const own = facingOf(inst.model, tri.faceNormal, frame.toward);
  const modes = d.vec3u(
    edgeMode(own, neighbourFacing(tri.adj.x, inst.model, frame.toward), tri.flags, 0),
    edgeMode(own, neighbourFacing(tri.adj.y, inst.model, frame.toward), tri.flags, 1),
    edgeMode(own, neighbourFacing(tri.adj.z, inst.model, frame.toward), tri.flags, 2),
  );

  // The quad partner's two outer edges (its third edge is the shared diagonal): their lines
  // also run through this triangle near the shared corners, so it draws them too.
  const hasPartner = tri.partner !== NO_NEIGHBOUR;
  const pt = L.$.tris[std.select(tri.partner, d.u32(0), !hasPartner)];
  const q0 = toPixels(
    std.mul(frame.viewProjection, std.mul(inst.model, d.vec4f(L.$.vertices[pt.idx.x].position, 1))),
    frame.viewport,
  );
  const q1 = toPixels(
    std.mul(frame.viewProjection, std.mul(inst.model, d.vec4f(L.$.vertices[pt.idx.y].position, 1))),
    frame.viewport,
  );
  const q2 = toPixels(
    std.mul(frame.viewProjection, std.mul(inst.model, d.vec4f(L.$.vertices[pt.idx.z].position, 1))),
    frame.viewport,
  );
  const ptFacing = facingOf(inst.model, pt.faceNormal, frame.toward);
  const e0 = edgeLine(q1, q2, q0);
  const e1 = edgeLine(q2, q0, q1);
  const e2 = edgeLine(q0, q1, q2);
  const n0 = edgeMode(ptFacing, neighbourFacing(pt.adj.x, inst.model, frame.toward), pt.flags, 0);
  const n1 = edgeMode(ptFacing, neighbourFacing(pt.adj.y, inst.model, frame.toward), pt.flags, 1);
  const n2 = edgeMode(ptFacing, neighbourFacing(pt.adj.z, inst.model, frame.toward), pt.flags, 2);
  // j = the partner's edge shared with this triangle, i = ours.
  const j1 = pt.adj.y === t;
  const j2 = pt.adj.z === t;
  const extraA = std.select(std.select(e1, e2, j1), e0, j2);
  const extraB = std.select(std.select(e2, e0, j1), e1, j2);
  // The trick assumes the projected quad is convex; on a folded or bow-tie quad (seen edge-on,
  // or strongly non-planar) the partner's edge lines would cut into this face, so drop them.
  // Quad order: our far corner, shared end, partner's far corner, other shared end.
  const i1 = tri.adj.y === tri.partner;
  const i2 = tri.adj.z === tri.partner;
  const ownFar = std.select(std.select(p0, p1, i1), p2, i2);
  const shareA = std.select(std.select(p1, p2, i1), p0, i2);
  const shareB = std.select(std.select(p2, p0, i1), p1, i2);
  const ptFar = std.select(std.select(q0, q1, j1), q2, j2);
  const convex = isConvexQuad(ownFar, shareA, ptFar, shareB);
  const extraModes = std.select(
    d.vec2u(0, 0),
    std.select(std.select(d.vec2u(n1, n2), d.vec2u(n2, n0), j1), d.vec2u(n0, n1), j2),
    hasPartner && convex,
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

  // Tone rule: plan only while the model's z axis stays vertical; tube only on curved faces.
  const zAxis = std.normalize(std.mul(inst.model, d.vec4f(0, 0, 1, 0)).xyz);
  const smooth = flagBit(tri.flags, FLAG.smoothBit) === 1;
  let rule = d.u32(TONE_RULE.bands);
  if (style.toneRule === TONE_RULE.plan && std.abs(zAxis.z) > 0.999) {
    rule = d.u32(TONE_RULE.plan);
  }
  if (style.toneRule === TONE_RULE.tube && smooth) {
    rule = d.u32(TONE_RULE.tube);
  }
  const visible = (inst.flags & INSTANCE.visible) !== 0;
  const tangent = std.select(std.select(v0.tangent, v1.tangent, is1), v2.tangent, is2);
  // Screen gradient of the facing (n · toward) over this triangle, for the smooth-contour
  // distance. Computed here rather than with dpdx/dpdy: near a fan apex (a lathe pole) the
  // triangles are thinner than a pixel and the derivatives extrapolate wildly.
  const f0 = std.dot(std.normalize(std.mul(inst.model, d.vec4f(v0.normal, 0)).xyz), frame.toward);
  const f1 = std.dot(std.normalize(std.mul(inst.model, d.vec4f(v1.normal, 0)).xyz), frame.toward);
  const f2 = std.dot(std.normalize(std.mul(inst.model, d.vec4f(v2.normal, 0)).xyz), frame.toward);
  const g1 = std.sub(p1, p0);
  const g2 = std.sub(p2, p0);
  const det = g1.x * g2.y - g1.y * g2.x;
  const facingGrad = std.length(
    std.div(
      std.add(std.mul(d.vec2f(g2.y, -g2.x), f1 - f0), std.mul(d.vec2f(-g1.y, g1.x), f2 - f0)),
      std.select(det, d.f32(1e-6), std.abs(det) < 1e-6),
    ),
  );

  return {
    clip: std.select(HIDDEN, clip, visible),
    normal: std.mul(inst.model, d.vec4f(normal, 0)).xyz,
    uv,
    bary,
    heights: d.vec3f(altitude(p0, p1, p2), altitude(p1, p2, p0), altitude(p2, p0, p1)),
    modes,
    style: inst.style,
    rule,
    flags: tri.flags,
    extraA,
    extraB,
    extraModes,
    tangent: std.mul(inst.model, d.vec4f(tangent, 0)).xyz,
    facingGrad,
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
    pixel: d.builtin.position,
    front: d.builtin.frontFacing,
    normal: d.vec3f,
    uv: d.vec2f,
    bary: d.interpolate('linear', d.vec3f),
    heights: d.interpolate('flat', d.vec3f),
    modes: d.interpolate('flat', d.vec3u),
    style: d.interpolate('flat', d.u32),
    rule: d.interpolate('flat', d.u32),
    flags: d.interpolate('flat', d.u32),
    extraA: d.interpolate('flat', d.vec3f),
    extraB: d.interpolate('flat', d.vec3f),
    extraModes: d.interpolate('flat', d.vec2u),
    tangent: d.vec3f,
    facingGrad: d.interpolate('flat', d.f32),
  },
  out: d.vec4f,
})((input) => {
  'use gpu';
  const frame = L.$.frame;
  const st = L.$.styles[input.style];
  const m = st.material;

  // Every derivative first, in uniform control flow.
  const n = std.normalize(input.normal);
  const score = std.dot(n, frame.light);
  const fw = std.fwidth(score);
  const lit = planLit(n, frame.light);
  const fwLit = std.fwidth(lit);
  // Tube rule: the tube's axis on screen (from the interpolated centreline tangent), the
  // direction across it, s = the normal's screen component along that, and tw = how much it
  // faces the kit's screen light. axisLen: 1 side-on, 0 end-on.
  const t3 = input.tangent;
  const axisScreen = d.vec2f(std.dot(t3, frame.right), -std.dot(t3, frame.up));
  const axisLen = std.length(axisScreen) / std.max(std.length(t3), 1e-9);
  const axis2 = std.div(axisScreen, std.max(std.length(axisScreen), 1e-9));
  const across = d.vec2f(-axis2.y, axis2.x);
  const sAcross = std.dot(d.vec2f(std.dot(n, frame.right), -std.dot(n, frame.up)), across);
  const fwS = std.fwidth(sAcross);
  const tw = std.dot(across, d.vec2f(TUBE_LIGHT[0], TUBE_LIGHT[1]));
  const facing = std.dot(n, frame.toward);
  const set = (input.flags >>> FLAG.lineSetShift) & FLAG.lineSetMask;
  const lineSet = L.$.lineSets[std.select(set, d.u32(1), set === 0) - 1];
  const x = input.uv.x * lineSet.count - lineSet.phase;
  const xGrad = std.length(d.vec2f(std.dpdx(x), std.dpdy(x)));

  let color = tone(m, SLOT.s0);
  if (input.rule === TONE_RULE.plan) {
    if (n.z > 0.5) {
      color = tone(m, SLOT.top);
    } else if (n.z >= -0.5) {
      const pw = planWeights(lit, fwLit);
      color = std.mix(color, tone(m, SLOT.s1), pw.x);
      color = std.mix(color, tone(m, SLOT.s2), pw.y);
      color = std.mix(color, tone(m, SLOT.s3), pw.z);
    }
  } else {
    // Bands.
    const w = bandWeights(score, fw);
    color = std.mix(color, tone(m, SLOT.s1), w.x);
    color = std.mix(color, tone(m, SLOT.s2), w.y);
    color = std.mix(color, tone(m, SLOT.s3), w.z);
    color = std.mix(color, tone(m, SLOT.top), w.w);
    if (input.rule === TONE_RULE.tube) {
      // Seen nearly end-on the stripes have no direction; hand over to the bands there.
      const stripes = tubeStripes(sAcross, tw, fwS);
      let tubeColor = tone(m, SLOT.s2);
      tubeColor = std.mix(tubeColor, tone(m, SLOT.top), stripes.x);
      tubeColor = std.mix(tubeColor, tone(m, SLOT.s0), stripes.y);
      color = std.mix(color, tubeColor, std.smoothstep(0.25, 0.45, axisLen));
    }
  }
  const debug = frame.debug;
  if (debug === 1) {
    color = d.vec4f(frame.paper);
  }

  // The inside of an open mesh (only drawn unculled): a flat void whose only lines are the
  // outlines of its open rim (no creases, ticks or contours).
  const inside = !input.front;
  if (inside) {
    color = std.select(tone(m, SLOT.s0), d.vec4f(frame.paper), debug === 1);
  }

  if (debug !== 2) {
    // UV tick lines.
    if (set > 0 && !inside) {
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
    const line = wire(st.width * frame.pxPerCss);
    const half = line.x / 2;
    const d0 = input.bary.x * input.heights.x;
    const d1 = input.bary.y * input.heights.y;
    const d2 = input.bary.z * input.heights.z;
    const dA = std.dot(input.extraA.xy, input.pixel.xy) + input.extraA.z;
    const dB = std.dot(input.extraB.xy, input.pixel.xy) + input.extraB.z;
    const crease = std.max(
      std.max(
        edgeTerm(input.modes.x, EDGE_CREASE, d0, half, line.y),
        std.max(
          edgeTerm(input.modes.y, EDGE_CREASE, d1, half, line.y),
          edgeTerm(input.modes.z, EDGE_CREASE, d2, half, line.y),
        ),
      ),
      std.max(
        edgeTerm(input.extraModes.x, EDGE_CREASE, dA, half, line.y),
        edgeTerm(input.extraModes.y, EDGE_CREASE, dB, half, line.y),
      ),
    );
    const outline = std.max(
      std.max(
        edgeTerm(input.modes.x, EDGE_OUTLINE, d0, line.x, line.y),
        std.max(
          edgeTerm(input.modes.y, EDGE_OUTLINE, d1, line.x, line.y),
          edgeTerm(input.modes.z, EDGE_OUTLINE, d2, line.x, line.y),
        ),
      ),
      std.max(
        edgeTerm(input.extraModes.x, EDGE_OUTLINE, dA, line.x, line.y),
        edgeTerm(input.extraModes.y, EDGE_OUTLINE, dB, line.x, line.y),
      ),
    );
    // Smooth contour: on curved faces the limb is where n · toward reaches 0, which can fall
    // inside a facet (or on a sliver), so measure it per pixel from the interpolated normal
    // and the triangle's facing gradient (from the vertex stage).
    // Near a limb the facing grows like √distance (the surface turns away quadratically), so
    // the first-order estimate f / |∇f| is twice the true distance: halve it. Where the facing
    // instead crosses zero linearly (a saddle, e.g. the inner side of a tube bend), the
    // estimate is already right, so the halved one draws those contours up to twice as wide:
    // the faint streaks noted in M1.
    let contour = d.f32(0);
    if (flagBit(input.flags, FLAG.smoothBit) === 1 && !inside) {
      contour = edgeCoverage((0.5 * facing) / std.max(input.facingGrad, 1e-6), line.x, line.y);
    }

    color = std.mix(
      color,
      std.select(tone(m, st.creaseSlot), BLUE, debug === 1),
      crease,
    );
    if (debug === 1) {
      color = std.mix(color, MAGENTA, contour);
      color = std.mix(color, RED, outline);
    } else {
      color = std.mix(color, tone(m, st.outlineSlot), std.max(outline, contour));
    }
  }
  return d.vec4f(color.xyz, 1);
});

// ---- marks: free dots and segments ------------------------------------------------------------

/** World units a mark is pulled toward the viewer, so it wins the depth test on its surface. */
const MARK_BIAS = 0.05;
/** World units: the most a contact line is pulled off its surface toward the viewer. */
const CONTACT_LIFT_CAP = 0.15;
const CYAN = d.vec4f(0.05, 0.75, 0.85, 1);

/** Quad corner k of 6 (two triangles): x = 0 at the start, 1 at the end; y = side (±1). */
const cornerOf = (k: number) => {
  'use gpu';
  const x = std.select(d.f32(0), d.f32(1), k === 1 || k === 4 || k === 5);
  const y = std.select(d.f32(-1), d.f32(1), k === 2 || k === 3 || k === 5);
  return d.vec2f(x, y);
};

/** Dot opacity by tone (`iso.css`): hi .85, mid .45, lo .22, faint .12, else .32. */
const dotOpacity = (slot: number) => {
  'use gpu';
  let o = d.f32(0.32);
  if (slot === SLOT.hi) {
    o = 0.85;
  } else if (slot === SLOT.mid) {
    o = 0.45;
  } else if (slot === SLOT.lo) {
    o = 0.22;
  } else if (slot === SLOT.faint) {
    o = 0.12;
  }
  return o;
};

export const marksVertex = tgpu.vertexFn({
  in: { vid: d.builtin.vertexIndex, iid: d.builtin.instanceIndex },
  out: {
    clip: d.builtin.position,
    pa: d.interpolate('flat', d.vec2f),
    pb: d.interpolate('flat', d.vec2f),
    /** Device px: a dot's radius, or a segment's drawn width. */
    size: d.interpolate('flat', d.f32),
    alpha: d.interpolate('flat', d.f32),
    color: d.interpolate('flat', d.vec4f),
    kind: d.interpolate('flat', d.u32),
  },
})((input) => {
  'use gpu';
  const mark = L.$.marks[input.iid];
  const inst = L.$.instances[mark.instance];
  const frame = L.$.frame;
  const bias = std.mul(frame.toward, MARK_BIAS);
  const wa = std.add(std.mul(inst.model, d.vec4f(mark.a, 1)).xyz, bias);
  const wb = std.add(std.mul(inst.model, d.vec4f(mark.b, 1)).xyz, bias);
  const ca = std.mul(frame.viewProjection, d.vec4f(wa, 1));
  const cb = std.mul(frame.viewProjection, d.vec4f(wb, 1));
  const pa = toPixels(ca, frame.viewport);
  const pb = toPixels(cb, frame.viewport);

  const isDot = mark.kind === MARK.dot;
  const isContact = mark.kind === MARK.contact;
  const wpx = mark.size * frame.pxPerCss;
  const line = wire(wpx);
  const size = std.select(line.x, wpx, isDot);
  const extent = std.select(line.x * 0.5, wpx, isDot) + 1;

  const span = std.sub(pb, pa);
  const len = std.length(span);
  const dir = std.select(d.vec2f(1, 0), std.div(span, std.max(len, 1e-6)), len > 1e-4);
  const perp = d.vec2f(-dir.y, dir.x);
  const k = cornerOf(input.vid);
  const atEnd = k.x > 0.5;
  // The corner's offset from its end point, in device px (y down) and in world units.
  const off = std.add(std.mul(dir, std.select(-extent, extent, atEnd)), std.mul(perp, k.y * extent));
  const dx = off.x / frame.pxPerUnit;
  const dy = -off.y / frame.pxPerUnit;

  // Facing: marks with a normal hide on back sides and fade toward the limbs.
  const hasNormal = std.dot(mark.normal, mark.normal) > 0;
  const wn = std.mul(inst.model, d.vec4f(mark.normal, 0)).xyz;
  const nw = std.div(wn, std.max(std.length(wn), 1e-9));
  const facing = std.dot(nw, frame.toward);

  // The corner sits on the mark's tangent plane, so the quad keeps the depth of the surface
  // it is drawn on (a flat quad would sink into a sloped face). Without a usable normal the
  // quad is pulled toward the viewer by its own size, capped so a mark on a thin part cannot
  // jump in front of it. A contact line lies in an inside corner: the smaller part rises from
  // the surface and would hide the inner half of the line, so it gets half its width more.
  let lift = std.min(std.sqrt(std.max(dx * dx + dy * dy, 0)), CONTACT_LIFT_CAP * 2);
  if (hasNormal && std.abs(facing) > 0.1) {
    lift = -(std.dot(nw, frame.right) * dx + std.dot(nw, frame.up) * dy) / facing;
  }
  if (isContact) {
    lift = lift + std.min((0.5 * line.x) / frame.pxPerUnit, CONTACT_LIFT_CAP);
  }
  const endWorld = std.select(wa, wb, atEnd);
  const corner = std.add(
    std.add(endWorld, std.add(std.mul(frame.right, dx), std.mul(frame.up, dy))),
    std.mul(frame.toward, lift),
  );
  let alpha = std.select(line.y, dotOpacity(mark.slot), isDot);
  if (hasNormal && !isContact) {
    alpha = alpha * std.select(std.smoothstep(mark.fade.x, mark.fade.y, facing), 0, facing <= 0);
  }
  const visible = (inst.flags & INSTANCE.visible) !== 0 && frame.debug !== 2 && alpha > 0;

  const slot = std.select(mark.slot, d.u32(SLOT.dot), isDot);
  let color = tone(mark.material, slot);
  if (frame.debug === 1) {
    color = d.vec4f(CYAN);
  }
  const clip = std.mul(frame.viewProjection, d.vec4f(corner, 1));
  return {
    clip: std.select(HIDDEN, clip, visible),
    pa,
    pb,
    size,
    alpha,
    color,
    kind: mark.kind,
  };
});

export const marksFragment = tgpu.fragmentFn({
  in: {
    pixel: d.builtin.position,
    pa: d.interpolate('flat', d.vec2f),
    pb: d.interpolate('flat', d.vec2f),
    size: d.interpolate('flat', d.f32),
    alpha: d.interpolate('flat', d.f32),
    color: d.interpolate('flat', d.vec4f),
    kind: d.interpolate('flat', d.u32),
  },
  out: d.vec4f,
})((input) => {
  'use gpu';
  const p = input.pixel.xy;
  let cover = d.f32(0);
  if (input.kind === MARK.dot) {
    cover = std.clamp(input.size + 0.5 - std.length(std.sub(p, input.pa)), 0, 1);
  } else {
    // Round caps (distance to the segment), so chained segments along a curve (contact lines)
    // join without wedges.
    const span = std.sub(input.pb, input.pa);
    const len = std.length(span);
    const dir = std.div(span, std.max(len, 1e-6));
    const q = std.sub(p, input.pa);
    const along = std.clamp(std.dot(q, dir), 0, len);
    const dist = std.length(std.sub(q, std.mul(dir, along)));
    cover = tickCoverage(dist, input.size, d.f32(1));
  }
  return d.vec4f(input.color.xyz, cover * input.alpha);
});
