/**
 * Where the overlays go over a window-sized stage (M10): the canvas always fills the window, so
 * its size changes only with the window (iOS keeps a canvas resized after start-up framed for the
 * old size: notes/M6.md). The card, its texts, the chips and the sheet are overlays; the camera
 * keeps the figure clear of them through the frame's pads, never by resizing the stage.
 *
 * - **card** (default): a framed card inset from the safe area; outside it the page colour is
 *   painted over the canvas. Landscape: the chips sit in the card's top-right corner, fig and
 *   title share the top-left. Portrait: the chips sit above the card, as before.
 * - **bare** (full-bleed): no card, no texts, no sheet; small margins inside the safe area.
 * - **rec**: fits go into the largest centred 16:9 rectangle (the recording crop).
 *
 * Plain module (no components).
 */
import type { FrameSpec, Pad } from '@anatomy/engine';

export interface Edges {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface OverlayModes {
  /** Full-bleed: no card frame or texts. */
  bare: boolean;
  /** The chip bar is shown. */
  chrome: boolean;
  /** 16:9 frame for recordings. */
  rec: boolean;
}

export interface OverlayLayout {
  landscape: boolean;
  narrow: boolean;
  /** The card's edges from the window (null in bare mode). */
  card: Edges | null;
  /**
   * The card's header and footer bands (heights inside its frame): painted in the card's colour,
   * so whatever reaches past the fit (the floating display) ends cleanly under the texts and chips.
   */
  bands: { top: number; bottom: number };
  /** The chip bar's top and right from the window. */
  chips: { top: number; right: number };
  /** The camera's frame: pads from the canvas (= window) edges, the aspect. */
  frame: FrameSpec;
}

/** The chip row's height (44 pt hit areas) and its gap above the card in portrait. */
export const CHIP_ROW = 44;
/** Room the card's texts take: the top row, the bottom row (one line; two in portrait). */
export const CARD_TEXT = { top: 34, bottom: 34, bottomTwo: 58, side: 20 };
/** Bare mode's margin inside the safe area (no text to keep clear of). */
const BARE_MARGIN = 12;
export const RECORD_ASPECT = 16 / 9;

export function overlayLayout(win: { width: number; height: number }, insets: Edges, m: OverlayModes): OverlayLayout {
  const landscape = win.width > win.height;
  const narrow = win.width < 600;
  const side = narrow ? 8 : 12;
  const chipsAbove = !landscape && m.chrome && !m.bare;
  const aspect = m.rec ? RECORD_ASPECT : null;
  if (m.bare) {
    const pad: Pad = {
      t: insets.top + BARE_MARGIN + (m.chrome ? CHIP_ROW : 0),
      r: insets.right + BARE_MARGIN,
      b: insets.bottom + BARE_MARGIN,
      l: insets.left + BARE_MARGIN,
    };
    return { landscape, narrow, card: null, bands: { top: 0, bottom: 0 }, chips: { top: insets.top + 4, right: insets.right + side - 4 }, frame: { pad, aspect } };
  }
  const card: Edges = {
    top: insets.top + (chipsAbove ? CHIP_ROW + 8 : side),
    right: insets.right + side,
    bottom: insets.bottom + side,
    left: insets.left + side,
  };
  // Landscape: the chips (44 pt, 2 below the frame) sit in the header band.
  const bands = { top: landscape && m.chrome ? CHIP_ROW + 4 : CARD_TEXT.top, bottom: landscape ? CARD_TEXT.bottom : CARD_TEXT.bottomTwo };
  const pad: Pad = {
    t: card.top + bands.top + 4,
    r: card.right + CARD_TEXT.side,
    b: card.bottom + bands.bottom + 4,
    l: card.left + CARD_TEXT.side,
  };
  const chips = landscape ? { top: card.top + 2, right: card.right + 4 } : { top: insets.top + 4, right: insets.right + side - 4 };
  return { landscape, narrow, card, bands, chips, frame: { pad, aspect } };
}
