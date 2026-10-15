# M11: review changes (user feedback, 2026-10-14)

*Orchestrator brief built from the user's M10 review. Work in step order, with checkpoints. No time estimates.*

## User decisions
1. **Full screen by default.** `bare` mode is the default, and the card is opt-in through its chip.
2. **Orbit/pan/zoom.** Restore it from M10's cut list. See M10-plan §5:
   - drag = orbit, with elevation clamped to 10–80°;
   - two fingers or shift-drag = pan;
   - pinch or wheel = zoom, 0.5–12× fit;
   - double tap = back to the current preset.

   Any user input stops the tour. Lines keep scaling with zoom, and the light stays fixed to the camera.
3. **Shorter reveal.** Move most machines at once instead of one after another. Some chaos during the reveal is fine. Rules that still hold:
   - rigid motion only (no scale);
   - nothing bleeds out of the closed case (the clip volume stays);
   - it ends exactly at the assembled layout;
   - conceal is the reverse.

   The planner's no-clash rule between moving machines is relaxed. Avoid obvious long pass-throughs by eye.
4. **Re-layout, at the orchestrator/agent's discretion, shown with before/after shots:**
   - Move the **dispenser bead drop** forward, toward the bottom/front edge of the phone screen. The input chain (dispenser, belt A, packer, belt B as needed) follows. The goal is to show more of the speaker section.
   - **Rotate the disposal section by 180°** (belt C + crusher), if there's space.
   - Constraints: keep it only if it reads better. Ports still line up; record any deviations from v2 in the ports test. Stands are re-decided by the M10 rule (remove one only if it covers other parts). The reveal's packed layout is updated to match.
5. **Screen meter.** Hide the "progress dots" (the 4-cell meter) on the phone screen. Keep the code behind a flag (e.g. `PHONE.meter = false`).
6. **Speaker 2–3× larger**, chosen by eye so it reads well and doesn't clash. Use a rigid uniform scale of the speaker machine, or scale its geometry dims; the ports and the elevator spout hand-off must still line up.
7. **Faster tour.** Shorten the holds and raise the speeds. Target roughly 45–55 s instead of about 76 s, still event-gated.

## Still open (not in this milestone)
- Rates: dispenser rate, HOLD 6 vs 10, belt speeds.
- Centrifuge spin animation revisit. The controller swap is ready.

## Next: M12, the loop video (see M12-plan.md once written)
