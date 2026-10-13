// Palette = the CSS cascade, evaluated by the browser: every probe recipe is rebuilt as hidden SVG elements in the
// figure's stage and read back with getComputedStyle (export/palette-probe.mjs, the same code the M1 gate validates),
// all probes of a batch in one style recalculation.
import { parseColor, resolvePalette, type ProbeResult } from '../../export/palette-probe.mjs';
import type { BlendMode, LineCap, PaintResolver, ProbeDesc, ProbedPaint, Rgba } from '../core/paint.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';
const PROBE_HOST_STYLE = 'position:absolute;left:0;top:0;width:0;height:0;overflow:hidden;pointer-events:none';

const blendOf = (text: string): BlendMode => (text === 'multiply' || text === 'screen' ? text : 'normal');
const capOf = (text: string): LineCap => (text === 'butt' || text === 'square' ? text : 'round');
/** CSS `filter: blur(Npx)` → N (0 without a blur). */
const blurOf = (filter: string) => Number(/blur\(([\d.]+)px\)/.exec(filter)?.[1] ?? 0);
/** Translation of a computed `transform` matrix (CSS px). */
function translateOf(transform: string): [number, number] {
  const matrix = /matrix\(([^)]+)\)/.exec(transform)?.[1].split(',').map(Number);
  return matrix ? [matrix[4], matrix[5]] : [0, 0];
}

const probedOf = (result: ProbeResult): ProbedPaint => ({
  color: result.color,
  alpha: result.alpha,
  width: Number.isFinite(result.width) ? result.width : 0,
  cap: capOf(result.cap),
  blend: blendOf(result.blend),
  blur: blurOf(result.filter),
  translate: translateOf(result.transform),
});

export class DomPaintResolver implements PaintResolver {
  /**
   * @param stage the element that contained the figure (`.iso-plate` overrides such as `--anatomy-paper` apply there)
   * @param svgClass class of the probe host <svg> (what the figure's CSS targets)
   */
  constructor(private readonly stage: Element, private readonly svgClass: string) {}

  resolve(probes: ProbeDesc[]): ProbedPaint[] {
    if (!probes.length) return [];
    const host = document.createElementNS(SVG_NS, 'svg');
    host.setAttribute('class', this.svgClass);
    host.setAttribute('aria-hidden', 'true');
    host.setAttribute('style', PROBE_HOST_STYLE);
    this.stage.appendChild(host);
    try {
      return resolvePalette(probes, host).map(probedOf);
    } finally {
      host.remove();
    }
  }

  /** Card colour behind the figure: the first non-transparent background up the tree (white when none). */
  background(): Rgba {
    for (let el: Element | null = this.stage; el; el = el.parentElement) {
      const color = parseColor(getComputedStyle(el).backgroundColor);
      if (color && color[3] > 0) return color;
    }
    return [1, 1, 1, 1];
  }
}
