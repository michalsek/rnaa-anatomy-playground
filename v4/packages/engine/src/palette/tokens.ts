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
 * `faint` and `lit` are line tones (`iso.css`: outline = mid, crease = faint, ribs = lo);
 * `dot` fills bolt dots (`--anatomy-dot`), whose opacity comes from their tone.
 */
export const SLOTS = [
  'paper', 'face', 'top', 's0', 's1', 's2', 's3', 'hi', 'mid', 'lo', 'faint', 'lit', 'dot',
] as const;
export type Slot = (typeof SLOTS)[number];
export const SLOT_COUNT = SLOTS.length;
export const SLOT = Object.fromEntries(SLOTS.map((name, index) => [name, index])) as {
  [K in Slot]: number;
};

export type MaterialTokens = Record<Slot, string>;

/** Appended only: existing indices stay put (styles store the index). */
export const MATERIALS = ['steel', 'graphite', 'react', 'lit', 'pkControl', 'pkGraph', 'pkData'] as const;
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
  dot: '#c8cbd1',
};

/** `a` over `b` at `t` (0 = b, 1 = a): a line of colour `a` drawn at opacity `t` on `b`. */
export function mixHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  const ch = (x: number, y: number) => Math.round((x * t + y * (1 - t)) * 255).toString(16).padStart(2, '0');
  return `#${ch(ar, br)}${ch(ag, bg)}${ch(ab, bb)}`;
}

/**
 * The kit's `data-lit` solid (`iso.css`: face fill, lit-top / lit-shade, edges in `--anatomy-lit`):
 * a lens that glows white on dark and reads as a black ring on light.
 */
const lit: Record<Theme, MaterialTokens> = {
  light: {
    paper: '#ffffff', face: '#ffffff', top: '#ffffff',
    s0: '#eeeeeb', s1: '#eeeeeb', s2: '#eeeeeb', s3: '#eeeeeb',
    hi: '#000000', mid: '#000000', lo: '#000000', faint: '#000000', lit: '#000000', dot: '#3a3a3e',
  },
  dark: {
    paper: '#1b1b1b', face: '#1b1b1b', top: '#262626',
    s0: '#1d1d1d', s1: '#1d1d1d', s2: '#1d1d1d', s3: '#1d1d1d',
    hi: '#ffffff', mid: '#ffffff', lo: '#ffffff', faint: '#ffffff', lit: '#ffffff', dot: '#e6e6e6',
  },
};

/**
 * Packets (`factory.css`, `.pk[data-kind]`), the same in both themes: edges `#2a2c31`, other
 * lines the same ink at .55 opacity (pre-mixed over the face here).
 */
const PK_INK = '#2a2c31';
const packet = (top: string, face: string, s: [string, string, string, string]): MaterialTokens => {
  const soft = mixHex(PK_INK, face, 0.55);
  return {
    paper: face, face, top, s0: s[0], s1: s[1], s2: s[2], s3: s[3],
    hi: PK_INK, mid: PK_INK, lo: soft, faint: soft, lit: PK_INK, dot: PK_INK,
  };
};
const pkControl = packet('#5aa9e6', '#4b98d6', ['#2f6fa6', '#3a7fb8', '#4689c4', '#5294cf']);
const pkGraph = packet('#f0be5e', '#e4ad48', ['#b07a1f', '#c08a2b', '#cc9636', '#d8a241']);
const pkData = packet('#ffffff', '#f3f4f6', ['#c9ccd2', '#d4d7dc', '#dfe1e5', '#e9eaed']);

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
      dot: '#3a3a3e',
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
      dot: '#0f4256',
    },
    lit: lit.light,
    pkControl,
    pkGraph,
    pkData,
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
      dot: '#e6e6e6',
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
      dot: '#bfeefc',
    },
    lit: lit.dark,
    pkControl,
    pkGraph,
    pkData,
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

/**
 * Effect colours (rgba), appended to the palette after `[material][slot]`: `fx(i)` is entry
 * `MATERIALS × SLOTS + i`. From the v2 centrifuge (`.cf-*`) and the kit's halo
 * (`--anatomy-halo`, `--anatomy-halo-opacity`).
 */
export const FX_NAMES = ['halo', 'glow', 'glowSoft', 'void0', 'void1', 'void2', 'strobe'] as const;
export type FxName = (typeof FX_NAMES)[number];
export const FX = Object.fromEntries(FX_NAMES.map((name, index) => [name, index])) as {
  [K in FxName]: number;
};
type Rgba = readonly [hex: string, alpha: number];
export const FX_TOKENS: Record<Theme, Record<FxName, Rgba>> = {
  light: {
    halo: ['#8a8a80', 0.32],
    glow: ['#38c27a', 1],
    glowSoft: ['#9fe8bd', 1],
    void0: ['#c9ccd1', 1],
    void1: ['#7d8188', 1],
    void2: ['#4a4d53', 1],
    strobe: ['#7d8188', 1],
  },
  dark: {
    halo: ['#050505', 0.9],
    glow: ['#7dffb4', 1],
    glowSoft: ['#2f8a5a', 1],
    void0: ['#3a3d43', 1],
    void1: ['#1a1c20', 1],
    void2: ['#0b0c0e', 1],
    strobe: ['#8b8f97', 1],
  },
};

/** Palette entries: every material's slots, then the FX colours. */
export const PALETTE_SIZE = MATERIALS.length * SLOT_COUNT + FX_NAMES.length;

/** Flat RGBA table: `[material][slot]` then `fx`, laid out as `arrayOf(vec4f, PALETTE_SIZE)`. */
export function paletteTable(theme: Theme): Float32Array {
  const table = new Float32Array(PALETTE_SIZE * 4);
  MATERIALS.forEach((material, m) => {
    SLOTS.forEach((slot, s) => {
      const [r, g, b] = hexToRgb(TOKENS[theme][material][slot]);
      table.set([r, g, b, 1], (m * SLOT_COUNT + s) * 4);
    });
  });
  FX_NAMES.forEach((name, i) => {
    const [hex, alpha] = FX_TOKENS[theme][name];
    table.set([...hexToRgb(hex), alpha], (MATERIALS.length * SLOT_COUNT + i) * 4);
  });
  return table;
}

/** The overlay card (`iso.css .iso-plate`, v2 `shot.png`). */
export const CARD: Record<Theme, { page: string; card: string; text: string; strong: string; muted: string; frame: string }> = {
  light: { page: '#f2f2ef', card: '#fbfbfa', text: '#57575a', strong: '#18181a', muted: '#8c8c90', frame: '#8a8a8f' },
  dark: { page: '#0b0b0b', card: '#131313', text: '#a3a3a3', strong: '#e6e6e6', muted: '#6e6e6e', frame: '#6a6a6a' },
};

/** The kit's mono stack per host. */
export const MONO = { web: 'ui-monospace,"SF Mono",Menlo,Consolas,monospace', ios: 'Menlo' } as const;

/** Line tones (palette slots that ink lines and dots). */
export type LineTone = 'hi' | 'mid' | 'lo' | 'faint' | 'lit';

/** Dot opacity per tone (`iso.css`, `.iso-dots[data-tone]`). */
export const DOT_OPACITY = { hi: 0.85, mid: 0.45, lo: 0.22, faint: 0.12 } as const;
