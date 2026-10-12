// Local helpers for parts/screen: prisms extruded along any axis (a phone standing upright, a clamp jaw seen
// from the front), seams on their sides, face-plane matrices and a recess cut into a vertical face.
// Adapted from the arcade-cabinet and desk-computer examples of the Anatomy skill.

const signed = (poly) => poly.reduce((a, [x, y], i) => {
  const [x2, y2] = poly[(i + 1) % poly.length];
  return a + x * y2 - x2 * y;
}, 0);
const screenOriented = (pts) => (signed(pts) < 0 ? [...pts].reverse() : pts);
function runsOf(flags, want) {
  const count = flags.length;
  const runs = [];
  const start = flags.findIndex((flag, index) => flag !== flags[(index + count - 1) % count]);
  if (start < 0) return flags[0] === want ? [Array.from({ length: count + 1 }, (_, index) => index % count)] : [];
  let run = null;
  for (let step = 0; step < count; step++) {
    const index = (start + step) % count;
    if (flags[index] === want) {
      if (!run) run = [index];
      run.push((index + 1) % count);
    } else if (run) {
      runs.push(run);
      run = null;
    }
  }
  if (run) runs.push(run);
  return runs;
}

// A frame whose s runs along `a` and whose polygon lives in (u, v).
export const ALONG_Y = { o: [0, 0, 0], a: [0, 1, 0], u: [1, 0, 0], v: [0, 0, 1] };
export const ALONG_X = { o: [0, 0, 0], a: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1] };

export function planes(ctx) {
  const { k, G, P, V, at, S } = ctx;
  const W3 = (F, s, [x, y]) => [F.o[0] + F.a[0] * s + F.u[0] * x + F.v[0] * y, F.o[1] + F.a[1] * s + F.u[1] * x + F.v[1] * y, F.o[2] + F.a[2] * s + F.u[2] * x + F.v[2] * y];
  const orient = (poly) => (signed(poly) > 0 ? poly : [...poly].reverse());
  const normalsOf = (F, ring) => ring.map(([x0, y0], i) => {
    const [x1, y1] = ring[(i + 1) % ring.length];
    return G.unit3(G.add3(G.mul3(F.u, y1 - y0), G.mul3(F.v, -(x1 - x0))));
  });

  // the solid paths of a prism of any (also concave) polygon in (u, v), from s0 to s1 along F.a
  function prismPaths(F, poly, s0, s1) {
    const ring = orient(poly);
    const n = ring.length;
    const capNear = G.dot3(F.a, V) > 0;
    const [nearS, farS] = capNear ? [s1, s0] : [s0, s1];
    const near = ring.map((p) => at(W3(F, nearS, p)));
    const far = ring.map((p) => at(W3(F, farS, p)));
    const normals = normalsOf(F, ring);
    const facing = normals.map((m) => G.dot3(m, V) > 1e-9);
    const outline = [];
    const crease = [];
    for (const run of runsOf(facing, false)) outline.push(k.pathOf(run.map((i) => near[i])));
    for (const run of runsOf(facing, true)) {
      crease.push(k.pathOf(run.map((i) => near[i])));
      outline.push(k.pathOf(run.map((i) => far[i])));
    }
    for (let i = 0; i < n; i++) if (facing[(i + n - 1) % n] !== facing[i]) outline.push(k.pathOf([near[i], far[i]]));
    const parts = [k.pathOf(screenOriented(near), true), k.pathOf(screenOriented(far), true)];
    const buckets = [[], [], [], [], []];
    for (let i = 0; i < n; i++) {
      if (!facing[i]) continue;
      const quad = screenOriented([near[i], near[(i + 1) % n], far[(i + 1) % n], far[i]]);
      parts.push(k.pathOf(quad, true));
      buckets[G.toneOf(normals[i], P)].push(k.pathOf(quad, true));
    }
    const capTone = G.toneOf(capNear ? F.a : G.mul3(F.a, -1), P);
    buckets[capTone].push(k.pathOf(screenOriented(near), true));
    return { fill: parts.join(""), outline: outline.join(""), crease: crease.join(""), top: buckets[4].join(""), shades: buckets.slice(0, 4).map((b) => b.join("")) };
  }
  // a seam round the visible sides of a prism at s: ends exactly on the silhouette edges
  function seamOf(F, poly, s) {
    const ring = orient(poly);
    const facing = normalsOf(F, ring).map((m) => G.dot3(m, V) > 1e-9);
    return runsOf(facing, true).map((run) => k.pathOf(run.map((i) => at(W3(F, s, ring[i]))))).join("");
  }
  // a line across one side face of a prism (polygon edge index i), from cap to cap, at fraction t along the edge
  function acrossOf(F, poly, s0, s1, i, t = 0.5) {
    const ring = orient(poly);
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % ring.length];
    const p = [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t];
    return k.pathOf([at(W3(F, s0, p)), at(W3(F, s1, p))]);
  }
  // put a prism: frame F (o carries the origin), polygon in (u, v), s0..s1
  function prism(name, F, poly, s0, s1, style = {}, { extra = "", inner = "", bias = 0, ref, attrs } = {}) {
    const shape = ctx.record(ctx.A.prism(F, poly, s0, s1, { name }));
    const cx = poly.reduce((a, p) => a + p[0], 0) / poly.length;
    const cy = poly.reduce((a, p) => a + p[1], 0) / poly.length;
    ctx.put(name, ref ?? W3(F, (s0 + s1) / 2, [cx, cy]), S(prismPaths(F, poly, s0, s1), { tone: "mid", ...style, inner }) + extra, [shape], { bias, attrs });
    return shape;
  }
  // a transform that maps local (u, v) onto the plane through o spanned by ex, ey (world directions)
  function planeMatrix(o, ex, ey) {
    const p0 = at(o);
    const px = at(G.add3(o, ex));
    const py = at(G.add3(o, ey));
    const v = (x) => x.toFixed(4);
    return `matrix(${v(px[0] - p0[0])} ${v(px[1] - p0[1])} ${v(py[0] - p0[0])} ${v(py[1] - p0[1])} ${p0[0].toFixed(2)} ${p0[1].toFixed(2)})`;
  }
  // a rounded rectangle path in plane coordinates
  const roundRect = (u0, v0, u1, v1, r, steps = 6) => k.pathOf(k.roundedPlan({ x: u0, y: v0, w: u1 - u0, d: v1 - v0, r }, steps), true);
  // points of a polygon on the vertical face y = Y (poly in (x, z)), projected
  const onFaceY = (Y, poly) => poly.map(([x, z]) => at([x, Y, z]));
  const onFaceX = (X, poly) => poly.map(([y, z]) => at([X, y, z]));

  // a recess in a vertical face going `depth` back into the part: face "y" (the +y face at y = at, local (x, z)) or
  // face "x" (the +x face at x = at, local (y, z)). Walls shaded by facing, back-plane art, and a clip of the opening.
  function recess(face, { u0, u1, z0, z1, r, depth }, at3, { back = "", backStyle = "", inside = "", id } = {}) {
    if (!id) throw new Error("recess needs an id (scoped by the instance id)");
    const W = face === "y" ? (u, z, d = 0) => [u, at3 - d, z] : (u, z, d = 0) => [at3 - d, u, z];
    const N3 = face === "y" ? (nu, nz) => [nu, 0, nz] : (nu, nz) => [0, nu, nz];
    const ring = k.roundedPlan({ x: u0, y: z0, w: u1 - u0, d: z1 - z0, r }, 6);
    const cu = (u0 + u1) / 2;
    const cz = (z0 + z1) / 2;
    const tops = [];
    const sides = [[], [], [], []];
    ring.forEach(([au, az], index) => {
      const [bu, bz] = ring[(index + 1) % ring.length];
      const length = Math.hypot(bu - au, bz - az) || 1;
      let [nu, nz] = [(bz - az) / length, -(bu - au) / length];
      if (nu * (cu - (au + bu) / 2) + nz * (cz - (az + bz) / 2) < 0) [nu, nz] = [-nu, -nz];
      // an inner wall's normal points into the opening; it shows when it faces the viewer
      if (G.dot3(N3(nu, nz), V) <= 1e-6) return;
      const quad = k.pathOf([at(W(au, az)), at(W(bu, bz)), at(W(bu, bz, depth)), at(W(au, az, depth))], true);
      if (nz > 0.7) tops.push(quad);
      else sides[G.toneOf(N3(nu, nz), P)]?.push(quad);
    });
    const ex = face === "y" ? [1, 0, 0] : [0, 1, 0];
    const m0 = planeMatrix(W(0, 0), ex, [0, 0, -1]);
    const m1 = planeMatrix(W(0, 0, depth), ex, [0, 0, -1]);
    const shape = k.pathOf(ring.map(([u, z]) => [u, -z]), true);
    const clipD = k.pathOf(ring.map(([u, z]) => at(W(u, z))), true);
    return {
      id,
      clipD,
      svg: [
        `<clipPath id="${id}"><path d="${clipD}"/></clipPath>`,
        `<g clip-path="url(#${id})">`,
        `<g transform="${m1}"><path class="iso-fill" d="${shape}" style="${backStyle}"/>${back}<path class="iso-line" data-tone="faint" d="${shape}"/></g>`,
        tops.length ? `<path class="iso-top" d="${tops.join("")}"/>` : "",
        ...sides.map((d, shade) => (d.length ? `<path class="iso-shade" data-shade="${shade}" d="${d.join("")}"/>` : "")),
        inside,
        `</g>`,
        `<g transform="${m0}"><path class="iso-line" data-tone="lo" d="${shape}"/></g>`,
      ].join(""),
    };
  }
  return { prismPaths, seamOf, acrossOf, prism, planeMatrix, roundRect, onFaceY, onFaceX, recess, W3 };
}
