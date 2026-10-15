/**
 * A readout as an external store: the frame loop publishes every frame, React sees at most one
 * change per `minMs` (a phase change always goes through at once). The text is formatted from one
 * status, so its words and numbers are from the same instant. Plain module (no components).
 */

export interface ReadoutSource {
  subscribe(cb: () => void): () => void;
  /** The readout line. */
  getSnapshot(): string;
  /** The phase word alone (the accessible live region). */
  getPhase(): string;
}

export interface Readout<S> extends ReadoutSource {
  /** Called every frame with `now` in ms; notifies when the text changed and `minMs` passed. */
  publish(s: S, now: number): void;
  /** Notify now (after a seek, or while paused). */
  flush(s: S): void;
  /** Format with another function from now on (a view's card); call `flush` to show it at once. */
  setFormat(format: (s: S) => string, phaseOf?: (s: S) => string): void;
}

export function createReadout<S>(
  minMs: number,
  initialFormat: (s: S) => string,
  initialPhase: (s: S) => string,
  initial: S,
): Readout<S> {
  let format = initialFormat;
  let phaseOf = initialPhase;
  const listeners = new Set<() => void>();
  let text = format(initial);
  let phase = phaseOf(initial);
  let last = -Infinity;
  const set = (s: S, now: number) => {
    const nextPhase = phaseOf(s);
    const nextText = format(s);
    if (nextText === text && nextPhase === phase) {
      last = now; // unchanged: check again only after minMs, so idle frames don't re-format
      return;
    }
    text = nextText;
    phase = nextPhase;
    last = now;
    for (const cb of listeners) cb();
  };
  return {
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    getSnapshot: () => text,
    getPhase: () => phase,
    publish(s, now) {
      if (phaseOf(s) !== phase || now - last >= minMs) set(s, now);
    },
    flush(s) {
      set(s, last);
    },
    setFormat(f, p) {
      format = f;
      if (p) phaseOf = p;
    },
  };
}
