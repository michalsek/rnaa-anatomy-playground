import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { scene, page, k } from "../../shared/kit.mjs";
import { build, LIVE } from "./packets.mjs";
const HERE = dirname(fileURLToPath(import.meta.url));
const ctx = scene({ W: 620, H: 300, fit: [...k.boxCorners({ x: -72, y: -18, w: 144, d: 36, r: 0 }, 0, 18)] });
build(ctx, [0, 0, 0]);
page(ctx, { out: join(HERE, "packets.html"), title: "Packets", fig: "Part", hint: "", readout: "fluff · control · graph · data · audio · garbage", live: [LIVE], boot: `FACTORY.define("packets", MACHINES.packets);`, caption: "Items that travel the factory: loose JS instructions (fluff) and the parcels they are packed into, colour coded by what they carry." });
