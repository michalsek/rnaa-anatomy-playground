/**
 * Palette tokens: the single source of colour for every host (GPU table now, CSS vars later).
 *
 * Values are copied from the v2 factory kit:
 * - `steel`: the Anatomy kit defaults (`~/.claude/skills/anatomy/kit/iso.css`, `.iso` = dark,
 *   `.iso[data-theme="light"]` = light);
 * - `graphite`, `react`: `v2-factory/shared/factory.css` (`.it.fx-graphite` has no dark
 *   override, so it is the same in both themes).
 *
 * Colours are sRGB hex and go to a non-sRGB canvas format unchanged, so the GPU writes the
 * exact hex values the SVG uses.
 */

export type Theme = 'light' | 'dark';

/**
 * Per-material tone slots, in GPU table order. `paper`..`s3` fill faces; `hi`, `mid`, `lo`,
 * `faint` and `lit` are line tones (`iso.css`: outline = mid, crease = faint, ribs = lo).
 */
export const SLOTS = [
  'paper', 'face', 'top', 's0', 's1', 's2', 's3', 'hi', 'mid', 'lo', 'faint', 'lit',
] as const;
export type Slot = (typeof SLOTS)[number];
export const SLOT_COUNT = SLOTS.length;
export const SLOT = Object.fromEntries(SLOTS.map((name, index) => [name, index])) as {
  [K in Slot]: number;
};

export type MaterialTokens = Record<Slot, string>;

export const MATERIALS = ['steel', 'graphite', 'react'] as const;
export type Material = (typeof MATERIALS)[number];
export const MATERIAL = Object.fromEntries(MATERIALS.map((name, index) => [name, index])) as {
  [K in Material]: number;
};

const graphite: MaterialTokens = {
  paper: '#2a2c31',
  face: '#34363c',
  top: '#3b3e44',
  s0: '#1e2024',
  s1: '#24262a',
  s2: '#2a2c31',
  s3: '#303338',
  hi: '#e6e8ec',
  mid: '#8b8f97',
  lo: '#5c6068',
  faint: '#43464d',
  lit: '#ffffff',
};

export const TOKENS: Record<Theme, Record<Material, MaterialTokens>> = {
  light: {
    steel: {
      paper: '#fbfbfa',
      face: '#ffffff',
      top: '#ffffff',
      s0: '#dcdcd9',
      s1: '#e5e5e2',
      s2: '#ededea',
      s3: '#f4f4f1',
      hi: '#26262a',
      mid: '#8a8a8f',
      lo: '#b4b4b8',
      faint: '#d4d4d6',
      lit: '#000000',
    },
    graphite,
    react: {
      paper: '#a6e5f8',
      face: '#a6e5f8',
      top: '#bfeefc',
      s0: '#5fb7d6',
      s1: '#72c4e1',
      s2: '#85d0ea',
      s3: '#97daf2',
      hi: '#0f4256',
      mid: '#2a6f86',
      lo: '#4f97b1',
      faint: '#7cc3dc',
      lit: '#000000',
    },
  },
  dark: {
    steel: {
      paper: '#131313',
      face: '#1b1b1b',
      top: '#1c1c1c',
      s0: '#0f0f0f',
      s1: '#121212',
      s2: '#151515',
      s3: '#181818',
      hi: '#d4d4d4',
      mid: '#6a6a6a',
      lo: '#3e3e3e',
      faint: '#2a2a2a',
      lit: '#ffffff',
    },
    graphite,
    react: {
      paper: '#1f4d5e',
      face: '#1f4d5e',
      top: '#24576a',
      s0: '#123441',
      s1: '#173c4a',
      s2: '#1b4554',
      s3: '#1f4d5e',
      hi: '#bfeefc',
      mid: '#61dafb',
      lo: '#3c8aa6',
      faint: '#2a6377',
      lit: '#ffffff',
    },
  },
};

/** The page/card ground the figure sits on (`--anatomy-card` = `--anatomy-paper`). */
export const PAPER: Record<Theme, string> = {
  light: TOKENS.light.steel.paper,
  dark: TOKENS.dark.steel.paper,
};

export function hexToRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [((value >> 16) & 0xff) / 255, ((value >> 8) & 0xff) / 255, (value & 0xff) / 255];
}

/** Flat RGBA table, `[material][slot]`, laid out as `arrayOf(vec4f, MATERIALS × SLOTS)`. */
export function paletteTable(theme: Theme): Float32Array {
  const table = new Float32Array(MATERIALS.length * SLOT_COUNT * 4);
  MATERIALS.forEach((material, m) => {
    SLOTS.forEach((slot, s) => {
      const [r, g, b] = hexToRgb(TOKENS[theme][material][slot]);
      table.set([r, g, b, 1], (m * SLOT_COUNT + s) * 4);
    });
  });
  return table;
}
