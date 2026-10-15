/**
 * Which machines stand on their stands or legs in the factory scene: `FACTORY_LAYOUT.stands`
 * (the recorded decisions, notes/M10.md), overridable at run time for the by-eye comparison
 * (`__v4.sim.stands({ beltA: false })`; `stands(null)` restores the layout's). An external store,
 * so a toggle re-renders the scene only. Plain module.
 */
import { FACTORY_LAYOUT, STAND_IDS, type StandId } from '@anatomy/engine';

type Stands = Record<StandId, boolean>;

let current: Stands = { ...FACTORY_LAYOUT.stands };
const listeners = new Set<() => void>();

export const standsStore = {
  get: (): Stands => current,
  subscribe(cb: () => void) {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
  /** Override some machines (unknown ids throw); null = the layout's decisions. */
  set(next: Partial<Record<StandId, boolean>> | null) {
    if (next) {
      for (const k of Object.keys(next)) if (!(STAND_IDS as readonly string[]).includes(k)) throw new Error(`stands: unknown machine "${k}"; known: ${STAND_IDS.join(', ')}`);
    }
    current = next ? { ...current, ...next } : { ...FACTORY_LAYOUT.stands };
    for (const cb of listeners) cb();
    return current;
  },
};
