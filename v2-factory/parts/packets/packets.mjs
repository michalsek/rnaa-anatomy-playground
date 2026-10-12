// Packets and fluff on a display plinth: the item library every machine carries.
export function build(ctx, [ox, oy, oz] = [0, 0, 0]) {
  const { k, P } = ctx;
  const plan = { x: ox - 70, y: oy - 16, w: 140, d: 32, r: 3 };
  ctx.slab("packets.plinth", plan, oz, 6, { tone: "mid" }, { steps: 4, bevel: 0.6, inner: ctx.Ln(k.sideSeam(plan, oz + 3, P, 4), { tone: "faint" }), extra: ctx.screws([[plan.x + 5, plan.y + 5], [plan.x + plan.w - 5, plan.y + 5], [plan.x + 5, plan.y + plan.d - 5], [plan.x + plan.w - 5, plan.y + plan.d - 5]], oz + 6) });
  ctx.slot("packets:items", { after: "packets.plinth" });
  ctx.data.packets = { origin: [ox, oy, oz + 6], kinds: ["fluff", "control", "graph", "data", "audio", "garbage"] };
}
export const LIVE = `
MACHINES.packets = (api) => {
  const g = api.slot("items");
  const { origin, kinds } = api.data;
  return {
    tick(dt, t) {
      g.innerHTML = kinds.map((kind, i) => {
        const p = [origin[0] - 55 + i * 22, origin[1], origin[2] + (api.calm() ? 0 : Math.max(0, Math.sin(t * 2 + i)) * 3)];
        return kind === "fluff" ? api.fluffSvg(p, 3) : api.packetSvg(kind, p);
      }).join("");
    },
  };
};`;
