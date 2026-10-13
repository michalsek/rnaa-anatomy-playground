// DOM host of the live slots: the v2 runtime writes `slot.innerHTML = markup` every frame; here those writes are
// intercepted on hidden skeleton `<g data-slot>` elements, so no SVG DOM is ever built for slot content.
import type { SlotSource } from './adapter.ts';

/**
 * Intercepts `innerHTML` on each named slot element. An unchanged string is ignored; a changed one marks the slot
 * dirty and, for the first change of a burst, calls `onChange` (the host defers its flush to a microtask, which runs
 * right after the runtime's rAF callback has written every slot).
 */
export class DomSlotSource implements SlotSource {
  readonly names: string[];
  readonly markup: string[];
  readonly dirty: Uint8Array;
  onChange: () => void = () => {};
  private forwarded: (Element | null)[] | null = null;
  private pending = false;

  /**
   * @param validate Called inside the setter before a changed string is accepted; throwing from it makes the
   *   runtime's own write throw (dev builds use it to fail loudly at the offending write).
   */
  constructor(elements: Map<string, Element>, private readonly validate: ((markup: string) => void) | null) {
    this.names = [...elements.keys()];
    this.markup = this.names.map(() => '');
    this.dirty = new Uint8Array(this.names.length);
    this.names.forEach((name, index) => this.intercept(elements.get(name)!, index));
  }

  /** Preview / fallback: every write also goes to the real slot of this figure SVG (the v2 DOM path). */
  forwardTo(svg: Element) {
    this.forwarded = this.names.map((name) => svg.querySelector(`[data-slot="${CSS.escape(name)}"]`));
    this.forwarded.forEach((el, index) => {
      if (el) el.innerHTML = this.markup[index];
    });
  }

  stopForwarding() {
    this.forwarded = null;
  }

  takeDirty(): number[] {
    this.pending = false;
    const changed: number[] = [];
    for (let i = 0; i < this.dirty.length; i++) if (this.dirty[i]) changed.push(i);
    this.dirty.fill(0);
    return changed;
  }

  markAllDirty() {
    this.dirty.fill(1);
    this.schedule();
  }

  private intercept(element: Element, index: number) {
    Object.defineProperty(element, 'innerHTML', {
      configurable: true,
      get: () => this.markup[index],
      set: (value: unknown) => {
        const markup = String(value);
        const forward = this.forwarded?.[index];
        if (forward) forward.innerHTML = markup;
        if (markup === this.markup[index]) return;
        this.validate?.(markup);
        this.markup[index] = markup;
        this.dirty[index] = 1;
        this.schedule();
      },
    });
  }

  private schedule() {
    if (this.pending) return;
    this.pending = true;
    this.onChange();
  }
}
