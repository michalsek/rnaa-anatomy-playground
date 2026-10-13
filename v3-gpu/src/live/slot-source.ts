// Where live slot markup comes from. The DOM host intercepts the v2 runtime's `slot.innerHTML = markup` writes; a
// native host could push strings (or, later, structured records) directly. The source only records which slots
// changed; when to flush is the frame loop's decision.
export interface SlotSource {
  readonly names: readonly string[];
  markupOf(slot: number): string;
  /** Whether any slot changed since the last `takeDirty`. */
  readonly hasDirty: boolean;
  /** Writes the indices of the changed slots into `out` (cleared first) and clears the dirty set; returns `out`. */
  takeDirty(out: number[]): number[];
  /** Marks every slot changed (a new renderer, a palette change). */
  markAllDirty(): void;
}
