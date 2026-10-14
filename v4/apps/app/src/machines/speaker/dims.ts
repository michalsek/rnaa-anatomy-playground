/**
 * Speaker dimensions, from v2 `parts/screen/speaker.mjs` (build L11–224), in the speaker's local
 * frame (origin = the centre of the stand's base plate on the floor; the driver's axis is z). The
 * throat, ledge and mouth come from the sim's `speakerGeometry`; the rest scales from the baffle
 * height. Plain module (no components).
 */
import { SPK, type SpeakerGeometry } from '@anatomy/engine';

export { SPK };

export function driver(g: SpeakerGeometry) {
  const ZB = g.height;
  const dish = { r0: 8.8, r1: 17.4, z0: ZB - SPK.basket - 1.4, z1: ZB - SPK.basket };
  const surround = { r: 27.4, tube: 2.4, z: ZB + 1.4 + 2.4 };
  const cone = { r0: 8.6, z0: ZB - 3.4, r1: surround.r - surround.tube + 0.1, z1: surround.z };
  const spiderZ = ZB - 9;
  return {
    ZB,
    dish,
    /** Top of the motor's top plate (= the dish's underside). */
    M0: dish.z0,
    spider: { z0: spiderZ - 0.8, z1: spiderZ, r0: 8.6, r1: 16 + ((spiderZ - dish.z1) / SPK.basket) * 11.6 - 0.5 },
    former: { r: 9.4, z0: spiderZ, z1: ZB - 4.1 },
    arm: { r0: 16, z0: dish.z1, r1: 27.6, z1: ZB },
    ring: { r0: 27, r1: 32.5, z0: ZB, z1: ZB + 1.4, slotR: 30.6 },
    surround,
    cone,
    /** Terminal block under the dish (+y side). */
    terminal: { x0: -5, x1: 5, y0: 17.2, y1: 22, z0: dish.z1 - 4, z1: dish.z1 },
    /** The meter window on the throat's top, and its LEDs. */
    meter: (() => {
      const x0 = SPK.ringOut + 1.5;
      const x1 = g.throat.x1 - 1.2;
      const pitch = (x1 - x0 - 1.6) / SPK.leds;
      return {
        x0,
        x1,
        y: 4.4,
        z0: g.throat.z1,
        z1: g.throat.z1 + 0.6,
        leds: Array.from({ length: SPK.leds }, (_, i) => ({ x0: x0 + 0.8 + i * pitch + 0.25, x1: x0 + 0.8 + (i + 1) * pitch - 0.25 })),
      };
    })(),
  };
}

export type Driver = ReturnType<typeof driver>;
