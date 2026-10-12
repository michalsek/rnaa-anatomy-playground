// Minimal TypeGPU 0.12.7 render program: WGSL-string shaders (no build plugin needed),
// earcut-triangulated mesh in a typed vertex buffer + per-instance buffer, a read-only
// storage buffer indexed by instance_index in the vertex shader, a per-frame uniform,
// 4x MSAA colour + depth, indexed instanced draw.
import tgpu from 'typegpu';
import * as d from 'typegpu/data';
import earcut from 'earcut';

const status = ((window as any).__result = { ok: false, frames: 0 } as Record<string, unknown>);

// ---- schemas -------------------------------------------------------------------------
const Instance = d.struct({ offset: d.vec2f, scale: d.f32, depth: d.f32 });
const Frame = d.struct({ time: d.f32, aspect: d.f32 });

// ---- vertex layouts: one per-vertex, one per-instance --------------------------------
const meshLayout = tgpu.vertexLayout(d.arrayOf(d.vec2f), 'vertex');
const instanceLayout = tgpu.vertexLayout(d.arrayOf(Instance), 'instance');

// ---- bind group layout: uniform + read-only storage ----------------------------------
const layout = tgpu.bindGroupLayout({
  frame: { uniform: Frame },
  colors: { storage: d.arrayOf(d.vec4f), access: 'readonly' }, // runtime-sized array
});

// ---- shaders (WGSL bodies; TypeGPU generates the In/Out structs and @group/@binding) -
const vertex = tgpu.vertexFn({
  in: { pos: d.vec2f, offset: d.vec2f, scale: d.f32, depth: d.f32, iid: d.builtin.instanceIndex },
  out: { position: d.builtin.position, color: d.vec4f },
})/* wgsl */ `{
  let a = layout.$.frame.time * (0.5 + f32(in.iid) * 0.3);
  let r = mat2x2f(cos(a), sin(a), -sin(a), cos(a));
  var p = r * in.pos * in.scale + in.offset;
  p.x = p.x / layout.$.frame.aspect;
  return Out(vec4f(p, in.depth, 1.0), layout.$.colors[in.iid]);
}`.$uses({ layout }); // NOT { frame: layout.$.frame } — the `$` getters throw outside codegen

const fragment = tgpu.fragmentFn({
  in: { color: d.vec4f },
  out: d.vec4f,
})/* wgsl */ `{ return in.color; }`;

async function main() {
  const root = await tgpu.init(); // requests adapter + device
  const canvas = document.querySelector('canvas')!;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(canvas.clientWidth * dpr);
  canvas.height = Math.round(canvas.clientHeight * dpr);
  const context = root.configureContext({ canvas, alphaMode: 'premultiplied' });
  const format = navigator.gpu.getPreferredCanvasFormat();

  // earcut: a 5-point star → flat coords + triangle indices
  const flat: number[] = [];
  for (let k = 0; k < 10; k++) {
    const rad = k % 2 ? 0.4 : 1.0;
    const ang = Math.PI / 2 + (k * Math.PI) / 5;
    flat.push(Math.cos(ang) * rad, Math.sin(ang) * rad);
  }
  const tris = earcut(flat);
  const verts = Array.from({ length: flat.length / 2 }, (_, k) => d.vec2f(flat[2 * k], flat[2 * k + 1]));

  const meshBuffer = root.createBuffer(d.arrayOf(d.vec2f, verts.length), verts).$usage('vertex');
  const indexBuffer = root.createBuffer(d.arrayOf(d.u32, tris.length), tris).$usage('index');
  const instances = [
    { offset: d.vec2f(-0.55, 0.0), scale: 0.35, depth: 0.5 },
    { offset: d.vec2f(0.0, 0.0), scale: 0.45, depth: 0.3 },
    { offset: d.vec2f(0.55, 0.0), scale: 0.35, depth: 0.5 },
  ];
  const instanceBuffer = root.createBuffer(d.arrayOf(Instance, instances.length), instances).$usage('vertex');
  const colorBuffer = root
    .createBuffer(d.arrayOf(d.vec4f, 3), [d.vec4f(1, 0.3, 0.3, 1), d.vec4f(1, 0.85, 0.1, 1), d.vec4f(0.3, 0.9, 0.5, 1)])
    .$usage('storage');
  const frameBuffer = root.createBuffer(Frame, { time: 0, aspect: canvas.width / canvas.height }).$usage('uniform');

  const bindGroup = root.createBindGroup(layout, { frame: frameBuffer, colors: colorBuffer });

  const SAMPLES = 4;
  const msaa = root.createTexture({ size: [canvas.width, canvas.height], format, sampleCount: SAMPLES }).$usage('render');
  const depthTex = root
    .createTexture({ size: [canvas.width, canvas.height], format: 'depth24plus', sampleCount: SAMPLES })
    .$usage('render');

  const pipeline = root.createRenderPipeline({
    vertex,
    fragment,
    attribs: {
      pos: meshLayout.attrib,
      offset: instanceLayout.attrib.offset,
      scale: instanceLayout.attrib.scale,
      depth: instanceLayout.attrib.depth,
    },
    targets: { format },
    primitive: { topology: 'triangle-list' },
    multisample: { count: SAMPLES },
    depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
  });

  const t0 = performance.now();
  const frame = () => {
    frameBuffer.patch({ time: (performance.now() - t0) / 1000 }); // per-frame partial write
    pipeline
      .with(meshLayout, meshBuffer)
      .with(instanceLayout, instanceBuffer)
      .with(bindGroup)
      .withColorAttachment({
        view: msaa,
        resolveTarget: context,
        clearValue: [0.1, 0.2, 0.6, 1],
        loadOp: 'clear',
        storeOp: 'discard',
      })
      .withDepthStencilAttachment({ view: depthTex, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'discard' })
      .withIndexBuffer(indexBuffer)
      .drawIndexed(tris.length, instances.length);
    status.frames = (status.frames as number) + 1;
    requestAnimationFrame(frame);
  };
  frame();
  Object.assign(status, { ok: true, triangles: tris.length / 3, format, wgsl: tgpu.resolve([pipeline as any]).slice(0, 4000) });
}

main().catch((e) => {
  status.error = String(e?.stack ?? e);
  console.error(e);
});
