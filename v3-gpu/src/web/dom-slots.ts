// DOM host of the live slots: the v2 runtime writes `slot.innerHTML = markup` every tick into the figure's own
// `<g data-slot>` groups; those writes are intercepted (an own `innerHTML` accessor on each slot element), so no SVG
// DOM is built for slot content while the GPU draws the figure. While the figure itself is on screen (preview during
// boot) writes also go through to the DOM; `release` hands the slots back to the browser for good (fallback).
import type { SlotSource } from '../live/slot-source.ts';

const NATIVE_INNER_HTML = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML')!;

export class DomSlotSource implements SlotSource {
  readonly names: string[];
  /** Writes also reach the slot elements' own DOM (the figure is visible). */
  writeThrough = true;
  /** A slot changed (called once per changed write; -1 for all of them). */
  onChange: (slot: number) => void = () => {};
  /**
   * Runs inside the setter before a changed string is accepted; throwing from it makes the runtime's own write throw
   * (dev builds validate there so the offending write fails loudly).
   */
  validate: ((markup: string) => void) | null = null;
  private readonly elements: Element[];
  private readonly markup: string[];
  private readonly dirty: Uint8Array;
  private dirtyCount = 0;
  private released = false;
  /**
   * Per slot: null, or the slot is drawn by a native machine and this brings its markup up to date with what the
   * machine draws (v2's strings, on demand). Native slots keep their writes for readers; they are never parsed or
   * scheduled.
   */
  private readonly refreshOf: ((() => void) | null)[];

  constructor(elements: Map<string, Element>) {
    this.names = [...elements.keys()];
    this.elements = [...elements.values()];
    this.markup = this.elements.map((element) => String(NATIVE_INNER_HTML.get!.call(element)));
    this.dirty = new Uint8Array(this.names.length);
    this.refreshOf = this.names.map(() => null);
    this.elements.forEach((element, slot) => this.intercept(element, slot));
  }

  get hasDirty() {
    return this.dirtyCount > 0;
  }

  markupOf(slot: number) {
    return this.markup[slot];
  }

  takeDirty(out: number[]): number[] {
    out.length = 0;
    for (let slot = 0; slot < this.dirty.length; slot++) if (this.dirty[slot]) out.push(slot);
    this.dirty.fill(0);
    this.dirtyCount = 0;
    return out;
  }

  markAllDirty() {
    if (this.released) return;
    this.dirty.fill(1);
    this.dirtyCount = this.dirty.length;
    this.onChange(-1);
  }

  /**
   * Hands `slots` to a native machine: writes to them no longer mark them dirty or request frames; reading their
   * `innerHTML` (and `release`) first calls `refresh`, which writes the current markup through the setter. Each
   * machine has its own refresh, so several native machines share one source.
   */
  ownNatively(slots: readonly number[], refresh: () => void) {
    for (const slot of slots) this.refreshOf[slot] = refresh;
  }

  /** Gives `slots` back to the markup path: their current strings (refreshed first) are parsed and drawn again. */
  disownNatively(slots: readonly number[]) {
    this.refreshNatives(slots);
    for (const slot of slots) {
      this.refreshOf[slot] = null;
      if (this.released) continue;
      if (!this.dirty[slot]) {
        this.dirty[slot] = 1;
        this.dirtyCount++;
      }
      this.onChange(slot);
    }
  }

  /** Removes the interceptors; every slot element gets the last markup written to it (the vector fallback). */
  release() {
    if (this.released) return;
    this.refreshNatives(this.refreshOf.map((_, slot) => slot));
    this.released = true;
    this.elements.forEach((element, slot) => {
      delete (element as { innerHTML?: string }).innerHTML;
      NATIVE_INNER_HTML.set!.call(element, this.markup[slot]);
    });
  }

  /** Brings the markup of the native slots among `slots` up to date, calling each machine's refresh once. */
  private refreshNatives(slots: readonly number[]) {
    const refreshes = new Set<() => void>();
    for (const slot of slots) {
      const refresh = this.refreshOf[slot];
      if (refresh) refreshes.add(refresh);
    }
    for (const refresh of refreshes) refresh();
  }

  private intercept(element: Element, slot: number) {
    Object.defineProperty(element, 'innerHTML', {
      configurable: true,
      get: () => {
        this.refreshOf[slot]?.();
        return this.markup[slot];
      },
      set: (value: unknown) => {
        const markup = String(value);
        if (this.writeThrough) NATIVE_INNER_HTML.set!.call(element, markup);
        if (this.refreshOf[slot]) {
          // only refreshes write native slots (the hook skips v2's own writes): dev builds still validate them
          if (markup !== this.markup[slot]) this.validate?.(markup);
          this.markup[slot] = markup;
          return;
        }
        if (markup === this.markup[slot]) return;
        this.validate?.(markup);
        this.markup[slot] = markup;
        if (!this.dirty[slot]) {
          this.dirty[slot] = 1;
          this.dirtyCount++;
        }
        this.onChange(slot);
      },
    });
  }
}
