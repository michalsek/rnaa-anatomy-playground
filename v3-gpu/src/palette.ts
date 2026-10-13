// Palette = the CSS cascade, evaluated by the browser. Every paint is a probe descriptor (class chain); we rebuild
// the chain as a hidden SVG subtree in the same stage the original <svg> lived in, read getComputedStyle, and pack
// the result into a storage buffer. Re-run on theme change; nothing else in the renderer depends on colour.
import type { ChainNode, GpuScene, PaintDesc } from './scene.ts';

export type BlendMode = 'normal' | 'multiply' | 'screen';

export interface ResolvedPaint {
  /** Straight (non-premultiplied) sRGB-encoded colour, 0..1, alpha includes opacity chain. */
  rgba: [number, number, number, number];
  visible: boolean;
  /** stroke-width in CSS px (for stroke probes). */
  width: number;
  /** stroke-linecap (stroke probes). */
  cap: 'round' | 'butt' | 'square';
  blend: BlendMode;
  /** CSS filter blur radius (std deviation, user units) and translate from the computed transform. */
  blur: number;
  translate: [number, number];
  /** Gradient stops (linear paints only). */
  stops?: { offset: number; rgba: [number, number, number, number] }[];
}

const SVG_NS = 'http://www.w3.org/2000/svg';

let scratch: CanvasRenderingContext2D | null = null;
export function parseColor(text: string): [number, number, number, number] | null {
  if (!text || text === 'none' || text.startsWith('url(')) return null;
  const m = text.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/);
  if (m) {
    const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : Number(m[4]);
    return [Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255, a];
  }
  // color(srgb …), named colours etc.: let a 2D context normalise it.
  scratch ??= document.createElement('canvas').getContext('2d');
  if (!scratch) return null;
  scratch.fillStyle = '#000';
  scratch.fillStyle = text;
  const normal = String(scratch.fillStyle);
  if (normal.startsWith('#')) {
    const n = parseInt(normal.slice(1), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
  }
  return normal === text ? null : parseColor(normal);
}

function build(host: Element, chain: ChainNode[]): Element[] {
  const nodes: Element[] = [];
  let parent: Element = host;
  for (const node of chain) {
    const el = document.createElementNS(SVG_NS, node.tag);
    for (const [k, v] of Object.entries(node.attrs)) el.setAttribute(k, v);
    parent.appendChild(el);
    nodes.push(el);
    parent = el;
  }
  return nodes;
}

const num = (text: string, fallback: number) => {
  const v = parseFloat(text);
  return Number.isFinite(v) ? v : fallback;
};

/**
 * Resolve every paint. `stage` is the element that contained the original <svg> (so `.iso-plate` overrides such as
 * --anatomy-paper: var(--anatomy-card) apply exactly as they did to the SVG).
 */
export function resolvePalette(scene: GpuScene, stage: Element): ResolvedPaint[] {
  return resolvePaints(scene.paints, scene, stage);
}

/** Resolve `paints` (any subset, e.g. live paints discovered at runtime) in the scene's probe context. */
export function resolvePaints(paints: PaintDesc[], scene: Pick<GpuScene, 'svgClass' | 'chainPrefix'>, stage: Element): ResolvedPaint[] {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', scene.svgClass);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('style', 'position:absolute;left:0;top:0;width:0;height:0;overflow:hidden;pointer-events:none');
  stage.appendChild(svg);
  const prefixHost = build(svg, scene.chainPrefix).at(-1) ?? svg;
  try {
    const leafOf = (chain: ChainNode[]) => {
      const nodes = build(prefixHost, chain);
      return nodes;
    };
    return paints.map((desc: PaintDesc): ResolvedPaint => {
      const nodes = leafOf(desc.chain);
      const leaf = nodes[nodes.length - 1];
      const cs = getComputedStyle(leaf);
      let opacity = 1;
      for (const n of nodes) opacity *= num(getComputedStyle(n).opacity, 1);
      const blendText = cs.mixBlendMode;
      const blend: BlendMode = blendText === 'multiply' ? 'multiply' : blendText === 'screen' ? 'screen' : 'normal';
      const blur = num(cs.filter.match(/blur\(([\d.]+)px\)/)?.[1] ?? '', 0);
      const t = cs.transform.match(/matrix\(([^)]+)\)/)?.[1].split(',').map(Number);
      const translate: [number, number] = t ? [t[4], t[5]] : [0, 0];
      let result: ResolvedPaint;
      if (desc.kind === 'linear') {
        const stops = desc.stops.map((s) => {
          const stopNodes = build(prefixHost, s.chain);
          const scs = getComputedStyle(stopNodes[stopNodes.length - 1]);
          const c = parseColor(scs.stopColor) ?? [0, 0, 0, 1];
          c[3] *= num(scs.stopOpacity, 1) * (s.alpha ?? 1);
          return { offset: s.offset, rgba: c };
        });
        const fo = num(cs.fillOpacity, 1);
        result = { rgba: [1, 1, 1, opacity * fo * (desc.alpha ?? 1)], visible: true, width: 0, cap: 'butt', blend, blur, translate, stops };
      } else {
        const color = parseColor(desc.prop === 'fill' ? cs.fill : cs.stroke);
        const width = desc.prop === 'stroke' ? num(cs.strokeWidth, 1) : 0;
        const propOpacity = num(desc.prop === 'fill' ? cs.fillOpacity : cs.strokeOpacity, 1);
        const rgba: [number, number, number, number] = color ? [color[0], color[1], color[2], color[3] * opacity * propOpacity * (desc.alpha ?? 1)] : [0, 0, 0, 0];
        result = { rgba, visible: !!color && rgba[3] > 0 && (desc.prop === 'fill' || width > 0), width, cap: cs.strokeLinecap as ResolvedPaint['cap'], blend, blur, translate };
      }
      return result;
    });
  } finally {
    svg.remove();
  }
}

/** Card colour behind the figure (the canvas is cleared to it). */
export function resolveBackground(stage: Element): [number, number, number, number] {
  let el: Element | null = stage;
  while (el) {
    const c = parseColor(getComputedStyle(el).backgroundColor);
    if (c && c[3] > 0) return c;
    el = el.parentElement;
  }
  return [1, 1, 1, 1];
}
