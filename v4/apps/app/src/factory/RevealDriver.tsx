/**
 * The reveal's frame hook (notes/M10-plan.md §3): one hook writes, from the plan at the reveal
 * clock, the lid's offset (the display), every machine's and the dispenser's root pose
 * (T(d)·R on top of its origin: the sim's origin never changes), the clip volume (the case's
 * inside up to the lid's underside) and the machines' halos (hidden while they are off their
 * spot). Once still it writes once and stops (the static slots then upload nothing). In DEV it
 * checks the plan's machine boxes against the scene's rest bounds.
 */
import { FACTORY_LAYOUT, type GroupHandle, MACHINE_BOX, REVEAL_IDS, type RevealPose, type SpriteHandle, clipAt, lidPose, machineOrigins, revealLanded, revealPose } from '@anatomy/engine';
import { useEffect, useState } from 'react';
import { useFrame, useNode, useNodes } from '../blocks/blocks.tsx';
import { useScene } from '../blocks/context.ts';
import { revealCtl } from './revealCtl.ts';

declare const __DEV__: boolean;

/** The scene ids of the moving roots (the dispenser hangs under the phone). */
const ROOT_IDS = REVEAL_IDS.map((id) => (id === 'dispenser' ? 'phone.dispenser' : id));
const R2D = 180 / Math.PI;

export function RevealDriver() {
  const roots = useNodes<GroupHandle>(ROOT_IDS);
  const lid = useNode<GroupHandle>('phone.display');
  const { store } = useScene();
  const [w] = useState(() => ({
    pose: { d: [0, 0, 0], rot: [0, 0, 0] } as RevealPose,
    t: { position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number] },
    lid: [0, 0, 0] as [number, number, number],
    lidT: { position: [0, 0, 0] as [number, number, number] },
    clip: { lo: [0, 0, 0] as [number, number, number], hi: [0, 0, 0] as [number, number, number], r: 0, band: 0 },
    halos: [] as SpriteHandle[][],
    /** The store and its version the halo list was read at (a rebuild re-registers them; a
     *  remount brings a new store, which reaches the same version count). */
    halosOf: null as object | null,
    halosAt: -1,
  }));
  // Open the phone when the scene mounts (a remount or an edit replays it).
  useEffect(() => {
    revealCtl.restart();
    return () => {
      store.clipVolume = null;
    };
  }, [store]);
  useEffect(() => {
    if (!__DEV__) return undefined;
    // After the first build: the authored boxes against the parts' rest bounds.
    const id = setTimeout(() => {
      const o = { ...machineOrigins(FACTORY_LAYOUT), dispenser: [0, 0, 0] };
      REVEAL_IDS.forEach((m, i) => {
        const b = store.groupBounds(ROOT_IDS[i]!);
        if (!b) return;
        const box = MACHINE_BOX[m];
        let worst = 0;
        for (let k = 0; k < 3; k++) {
          worst = Math.max(worst, Math.abs(b.min[k]! - o[m][k]! - box[0][k]!), Math.abs(b.max[k]! - o[m][k]! - box[1][k]!));
        }
        if (worst > 2) console.warn(`[reveal] MACHINE_BOX.${m} is ${worst.toFixed(1)} off the scene's rest bounds`);
      });
    }, 1500);
    return () => clearTimeout(id);
  }, [store]);
  useFrame((info) => {
    if (!revealCtl.active) return;
    const plan = revealCtl.plan;
    const t = revealCtl.advance(info.dt);
    const hs = roots();
    if (w.halosOf !== store || w.halosAt !== store.version) {
      w.halos = ROOT_IDS.map((id) => store.haloIds(id).map((h) => store.sprite$(h)));
      w.halosOf = store;
      w.halosAt = store.version;
    }
    for (let i = 0; i < REVEAL_IDS.length; i++) {
      revealPose(plan, REVEAL_IDS[i]!, t, w.pose);
      w.t.position[0] = w.pose.d[0];
      w.t.position[1] = w.pose.d[1];
      w.t.position[2] = w.pose.d[2];
      w.t.rotation[0] = w.pose.rot[0] * R2D;
      w.t.rotation[1] = w.pose.rot[1] * R2D;
      w.t.rotation[2] = w.pose.rot[2] * R2D;
      hs[i]!.set(w.t);
      const on = revealLanded(plan, REVEAL_IDS[i]!, t) ? 1 : 0;
      for (const h of w.halos[i]!) h.level = on;
    }
    lidPose(plan, t, w.lid);
    w.lidT.position[0] = w.lid[0];
    w.lidT.position[1] = w.lid[1];
    w.lidT.position[2] = w.lid[2];
    lid().set(w.lidT);
    store.clipVolume = clipAt(plan, t, FACTORY_LAYOUT, w.clip);
    if (!revealCtl.playing) revealCtl.written();
  });
  return null;
}
