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
}

export function createReadout<S>(
  minMs: number,
  format: (s: S) => string,
  phaseOf: (s: S) => string,
  initial: S,
): Readout<S> {
  const listeners = new Set<() => void>();
  let text = format(initial);
  let phase = phaseOf(initial);
  let last = -Infinity;
  const set = (s: S, now: number) => {
    const nextPhase = phaseOf(s);
    const nextText = format(s);
    if (nextText === text && nextPhase === phase) return;
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
  };
}
