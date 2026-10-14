"""Trace the iOS simulator's status bar into polygons for the rendered phone screen (M12).

    python3 -I tools/film/trace-status-bar.py <sim-screenshot.png> <out.ts> --ty 9.2312 --zoom 1.299937

The screenshot is the simulator at film mode's splash camera C0 (`__v4.film.arm`), its status bar
pinned with `xcrun simctl status_bar <udid> override --time 9:41 --dataNetwork wifi --wifiMode active
--wifiBars 3 --cellularMode active --cellularBars 4 --batteryState discharging --batteryLevel 100`
and taken with `simctl io <udid> screenshot --mask=ignored` (1206 x 2622, DPR 3, 402 x 874 pt).

Each glyph (the time's digits and colon, the cellular bars, the wifi arcs, the battery and its
cap) is a connected component of the light pixels over the dark screen. Its outline is the 50%
iso-line of the anti-aliased coverage (marching squares, sub-pixel), simplified (Douglas-Peucker,
0.2 px) and mapped into the screen art's plane: top-down at C0, x_art = ((px+.5)/3 - 201)/zoom and
y_art = ty + ((py+.5)/3 - 437)/zoom (world units; the closed glass is centred at the origin). A glyph
with holes (0, 9, 4) is cut through each hole into hole-free pieces that overlap by 2 px, since
Extrude plans have no holes. Writes a TS module with the polygons (counter-clockwise).
"""
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

args = sys.argv[1:]
src, out = args[0], args[1]
opt = lambda name, d: float(args[args.index(name) + 1]) if name in args else d
TY = opt('--ty', 9.2312)
ZOOM = opt('--zoom', 1.299937)
DPR, W_PT, H_PT = 3.0, 402.0, 874.0
Y0, Y1 = 50, 150  # the status bar's rows (sim px)

L = np.asarray(Image.open(src).convert('L'), dtype=float)
band = L[Y0:Y1]
bg = float(np.median(band))
cov = np.clip((band - bg) / (255.0 - bg), 0, 1)
ink = cov > 0.5
labels, n = ndimage.label(ink)


def march(f):
    """Closed 0.5 iso-lines of f (zero-padded), as lists of (x, y) in f's pixel-centre coords."""
    f = np.pad(f, 1)
    h, w = f.shape
    segs = {}

    def interp(a, b, pa, pb):
        t = (0.5 - a) / (b - a)
        return (pa[0] + t * (pb[0] - pa[0]), pa[1] + t * (pb[1] - pa[1]))

    out_edges = []
    for y in range(h - 1):
        for x in range(w - 1):
            tl, tr, br, bl = f[y, x], f[y, x + 1], f[y + 1, x + 1], f[y + 1, x]
            c = (tl > 0.5) * 8 + (tr > 0.5) * 4 + (br > 0.5) * 2 + (bl > 0.5)
            if c in (0, 15):
                continue
            # edge points keyed by the grid edge they sit on
            e = {
                't': (('h', y, x), lambda: interp(tl, tr, (x, y), (x + 1, y))),
                'r': (('v', y, x + 1), lambda: interp(tr, br, (x + 1, y), (x + 1, y + 1))),
                'b': (('h', y + 1, x), lambda: interp(bl, br, (x, y + 1), (x + 1, y + 1))),
                'l': (('v', y, x), lambda: interp(tl, bl, (x, y), (x, y + 1))),
            }
            # segments oriented with ink on the left (screen coords: y down)
            table = {
                1: [('l', 'b')], 2: [('b', 'r')], 3: [('l', 'r')], 4: [('r', 't')], 5: [('l', 't'), ('r', 'b')],
                6: [('b', 't')], 7: [('l', 't')], 8: [('t', 'l')], 9: [('t', 'b')], 10: [('t', 'r'), ('b', 'l')],
                11: [('t', 'r')], 12: [('r', 'l')], 13: [('r', 'b')], 14: [('b', 'l')],
            }
            for a, b in table[c]:
                ka, fa = e[a]
                kb, fb = e[b]
                out_edges.append((ka, kb))
                segs[ka] = fa()
                segs[kb] = fb()
    nxt = {}
    for a, b in out_edges:
        nxt[a] = b
    loops = []
    seen = set()
    for start in nxt:
        if start in seen:
            continue
        loop = []
        k = start
        while k not in seen:
            seen.add(k)
            px, py = segs[k]
            loop.append((px - 1, py - 1))
            k = nxt.get(k)
            if k is None:
                raise RuntimeError('an open contour (the marching-squares table is inconsistent)')
        if k != start:
            raise RuntimeError('a contour did not close on its start')
        if len(loop) >= 3:
            loops.append(loop)
    return loops


def area(p):
    return 0.5 * sum(p[i][0] * p[(i + 1) % len(p)][1] - p[(i + 1) % len(p)][0] * p[i][1] for i in range(len(p)))


def dp(points, eps):
    """Douglas-Peucker on a closed ring (split at the two farthest points)."""
    pts = np.array(points)
    if len(pts) < 8:
        return points

    def rec(a):
        if len(a) < 3:
            return list(map(tuple, a))
        s, e = a[0], a[-1]
        d = e - s
        n = np.hypot(*d) or 1.0
        dist = np.abs(d[0] * (a[:, 1] - s[1]) - d[1] * (a[:, 0] - s[0])) / n
        i = int(np.argmax(dist))
        if dist[i] <= eps:
            return [tuple(s), tuple(e)]
        return rec(a[: i + 1])[:-1] + rec(a[i:])

    i0 = 0
    i1 = int(np.argmax(np.hypot(pts[:, 0] - pts[0, 0], pts[:, 1] - pts[0, 1])))
    ring = np.concatenate([pts, pts[:1]])
    first = rec(ring[i0 : i1 + 1])
    second = rec(ring[i1:])
    return (first[:-1] + second[:-1])


pieces = []
for k in range(1, n + 1):
    comp = labels == k
    ys, xs = np.nonzero(comp)
    if comp.sum() < 12:
        continue
    near = ndimage.binary_dilation(comp, iterations=2)
    field = np.where(near, cov, 0.0)
    filled = ndimage.binary_fill_holes(comp)
    holes, nh = ndimage.label(filled & ~comp)
    cuts = sorted(float(np.nonzero(holes == h)[1].mean()) for h in range(1, nh + 1))
    edges = [xs.min() - 3] + cuts + [xs.max() + 3]
    for a, b in zip(edges[:-1], edges[1:]):
        cols = np.arange(field.shape[1])
        lo = a if a == edges[0] else a - 1
        hi = b if b == edges[-1] else b + 1
        part = np.where((cols >= lo) & (cols <= hi), field, 0.0)
        loops = march(part)
        # Outer outlines all turn one way; a hole would turn the other (it was not cut).
        if len({area(lp) > 0 for lp in loops}) != 1:
            raise RuntimeError(f'glyph at x {xs.min()}: a hole was not cut')
        pieces.extend(loops)

polys = []
for loop in pieces:
    simple = dp(loop, 0.2)
    # sim px (band coords) → the art's plane (world units)
    # (pixel indices are centres: the pixel's area starts half a pixel before them)
    art = [(((x + 0.5) / DPR - W_PT / 2) / ZOOM, TY + ((y + 0.5 + Y0) / DPR - H_PT / 2) / ZOOM) for x, y in simple]
    a = area(art)
    if abs(a) < 0.5:
        continue
    if a < 0:
        art = art[::-1]
    polys.append(art)

polys.sort(key=lambda p: min(x for x, _ in p))
lines = [
    '/**',
    ' * The iOS status bar on the rendered screen (M12, generated by tools/film/trace-status-bar.py from the',
    " * simulator's pinned status bar at film mode's splash camera C0; do not edit): the time, the cellular",
    ' * bars, the wifi arcs and the battery as hole-free polygons in the screen art\'s plane (world units, the',
    ' * closed glass centred at the origin, counter-clockwise). Plain module.',
    ' */',
    'export const STATUS_BAR_GLYPHS: readonly (readonly (readonly [number, number])[])[] = [',
]
for p in polys:
    lines.append('  [' + ', '.join(f'[{x:.2f}, {y:.2f}]' for x, y in p) + '],')
lines.append('];')
open(out, 'w').write('\n'.join(lines) + '\n')
print(f'{len(polys)} polygons, {sum(len(p) for p in polys)} points, bg {bg:.1f}, components {n}')
