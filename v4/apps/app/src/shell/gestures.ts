/**
 * The stage's camera gestures (M11; M10 plan §5), host-agnostic: drag orbits (elevation 10–80°),
 * two fingers or a shift-drag pan (two fingers also pinch-zoom about their centre), the wheel
 * zooms about the cursor (0.5–12× the fit), a double tap eases back to the view's preset. Any of
 * them calls `onInput` first (the tour stops). Points are CSS px in the stage (y down). Plain
 * module: `Stage.tsx` feeds it from a PanResponder (and, on web, the wheel and the shift key).
 */
import { type CameraState, orbitBy, panBy, zoomAbout } from '@anatomy/engine';

export interface GestureTarget {
  camera(): CameraState;
  setCamera(state: CameraState): void;
  refZoom(): number;
  resetView(): void;
}

export interface Point {
  x: number;
  y: number;
}

/** A drag must move this far (CSS px) before it moves the camera; a tap stays below it. */
const SLOP = 4;
/** Two taps within this long (ms) and this close (px) are a double tap. */
const DOUBLE = { ms: 320, px: 24 };

export function createGestures(o: { target: () => GestureTarget | null; size: () => { width: number; height: number }; onInput: () => void }) {
  let cam: CameraState | null = null;
  let last: Point[] = [];
  let moved = false;
  let shift = false;
  let lastTap = { t: -1e9, x: 0, y: 0 };
  const centre = (ps: Point[]) => ({ x: ps.reduce((a, p) => a + p.x, 0) / ps.length, y: ps.reduce((a, p) => a + p.y, 0) / ps.length });
  const spread = (ps: Point[]) => (ps.length < 2 ? 0 : Math.hypot(ps[0]!.x - ps[1]!.x, ps[0]!.y - ps[1]!.y));
  const begin = (ps: Point[]) => {
    last = ps;
    cam = o.target()?.camera() ?? null;
  };
  return {
    /** Shift held (web): a drag pans. */
    setShift(on: boolean) {
      shift = on;
    },
    start(ps: Point[]) {
      moved = false;
      begin(ps);
    },
    move(ps: Point[], total: Point) {
      const t = o.target();
      if (!t || !cam || ps.length === 0) return;
      // A finger added or lifted: restart from here (no jump).
      if (ps.length !== last.length) {
        begin(ps);
        return;
      }
      if (!moved && Math.hypot(total.x, total.y) < SLOP && ps.length < 2) return;
      if (!moved) o.onInput();
      moved = true;
      const c0 = centre(last);
      const c1 = centre(ps);
      const dx = c1.x - c0.x;
      const dy = c1.y - c0.y;
      if (ps.length >= 2) {
        panBy(cam, dx, dy);
        const s0 = spread(last);
        const s1 = spread(ps);
        if (s0 > 1 && s1 > 1) {
          const { width, height } = o.size();
          zoomAbout(cam, s1 / s0, c1.x - width / 2, c1.y - height / 2, t.refZoom());
        }
      } else if (shift) panBy(cam, dx, dy);
      else orbitBy(cam, dx, dy);
      t.setCamera(cam);
      last = ps;
    },
    end(p: Point | null, now: number) {
      const wasTap = !moved && p !== null;
      cam = null;
      last = [];
      if (!wasTap) return;
      if (now - lastTap.t < DOUBLE.ms && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < DOUBLE.px) {
        lastTap.t = -1e9;
        o.onInput();
        o.target()?.resetView();
        return;
      }
      lastTap = { t: now, x: p.x, y: p.y };
    },
    /** Wheel (web): `deltaY` > 0 zooms out, about the cursor. */
    wheel(deltaY: number, at: Point) {
      const t = o.target();
      if (!t) return;
      o.onInput();
      const c = t.camera();
      const { width, height } = o.size();
      zoomAbout(c, Math.exp(-deltaY * 0.0015), at.x - width / 2, at.y - height / 2, t.refZoom());
      t.setCamera(c);
    },
  };
}
