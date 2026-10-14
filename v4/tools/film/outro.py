"""M12 outro: from the loop's last frame, zoom out onto a screenshot of the Claude app whose simulator
panel shows the factory app, the loop's footage playing inside the panel's screen.

    python3 -I tools/film/outro.py <dir> <screenshot.png> [--zoom 3.5] [--hold 4.0]

Needs <dir>/p1.mkv (Part 1; the footage continues with its frames after the loop point, 30 on) and
writes <dir>/outro.mkv (FFV1 RGB, 1920 × 1080, 60 fps) plus a few PNGs (outro_*.png). Then
`loop.sh` makes final-light-60.mp4 = the loop + the outro.

- The simulator's screen in the screenshot is found from its pixels: the paper's edges against the
  black bezel along clean rows and columns (sub-pixel crossings), checked against 402 : 874.
- Inside it the screenshot keeps its real status bar and the app's chip row; below the chip row
  (110 pt: the chips' 44 pt row from 66 pt) the screen is filled with the app's paper, edge to edge,
  the bottom corners following the screen's own corner profile (measured per row), and the footage
  goes into the film's 16:9 band: the screen's full width, centred on the screen (`filmFrame` on the
  simulator, dy 0).
- The zoom is exponential with smootherstep about the point that stays still between the start (the
  band fills the output: the footage 1:1, so the first frame is the loop's next frame) and the end
  (the whole window, fit to the width: 0.75; the 1 % left over top and bottom is the window's own
  dark background, so its corners and edges stay whole). Then the hold.
- Every frame is resampled from the full-resolution screenshot and the 1080p footage with the
  compositor's separable Lanczos-3 matrices (composite.py), at the exact sub-pixel map.
"""
import subprocess
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, __file__.rsplit('/', 1)[0])
from composite_lib import resample, smootherstep  # noqa: E402

args = sys.argv[1:]
D, SHOT = args[0], args[1]
opt = lambda name, d: float(args[args.index(name) + 1]) if name in args else d
ZOOM_S = opt('--zoom', 3.5)
HOLD_S = opt('--hold', 4.0)
FPS = 60
OUT_W, OUT_H = 1920, 1080
XF = 30  # the loop starts at Part 1's frame 30: the outro's footage begins there
WINDOW_BG = np.array([21, 21, 21], np.float32)
PAPER = np.array([251, 251, 250], np.float32)  # the app's light paper (#fbfbfa)

img = np.asarray(Image.open(SHOT).convert('RGB'), np.float32).copy()
L = img.mean(axis=2)
H, W = L.shape

# ---- the simulator's screen ---------------------------------------------------------------------
cx0, cy0 = W * 0.856, H * 0.506  # a point on the panel's paper (the panel is at the window's right)


def cross(p, i, step, thr=126.0):
    """The sub-pixel 50 % crossing walking from i (on the paper) by step (in pixel-edge coordinates)."""
    while p[i] > thr:
        i += step
    a, b = p[i - step], p[i]
    return (i - step) + step * (a - thr) / (a - b) + 0.5


def screen_rect():
    # Clean rows below the factory render, clean columns between the clock and the island.
    rows = [int(H * f) for f in (0.71, 0.745, 0.78, 0.815)]
    lefts = [cross(L[r], int(cx0), -1) for r in rows]
    rights = [cross(L[r], int(cx0), 1) for r in rows]
    x0, x1 = float(np.median(lefts)), float(np.median(rights))
    cols = [int(x0 + (x1 - x0) * f) for f in (0.29, 0.31, 0.70, 0.72)]
    tops = [cross(L[:, c], int(H * 0.2), -1) for c in cols]
    bots = [cross(L[:, c], int(H * 0.88), 1) for c in cols]
    y0, y1 = float(np.median(tops)), float(np.median(bots))
    return x0, y0, x1 - x0, y1 - y0


sx, sy, sw, sh = screen_rect()
aspect = sw / sh
print(f'simulator screen: ({sx:.2f}, {sy:.2f}) {sw:.2f} × {sh:.2f}, aspect {aspect:.5f} (402:874 = {402 / 874:.5f})')
if abs(aspect / (402 / 874) - 1) > 0.005:
    raise SystemExit('the screen rect is not 402:874 within 0.5 %')
pt = sw / 402  # screenshot px per point

# ---- the screen below the chip row: paper, edge to edge -----------------------------------------
chip_bottom = sy + 110.1 * pt
corner = 140  # rows above the bottom where the corner curves (measured per row there)
for y in range(int(np.floor(chip_bottom)), int(np.ceil(sy + sh)) + 1):
    if y >= H:
        break
    near_bottom = y > sy + sh - corner
    le = cross(L[y], int(cx0), -1) if near_bottom and L[y, int(cx0)] > 126 else sx
    re = cross(L[y], int(cx0), 1) if near_bottom and L[y, int(cx0)] > 126 else sx + sw
    if near_bottom and L[y, int(cx0)] <= 126:
        continue  # below the screen
    xs = np.arange(int(np.floor(le)), int(np.ceil(re)) + 1)
    cov = np.minimum(np.clip(xs + 1 - le, 0, 1), np.clip(re - xs, 0, 1))
    cov = cov * np.clip(sy + sh - y, 0, 1) * np.clip(y + 1 - chip_bottom, 0, 1)
    row = img[y, xs]
    img[y, xs] = row * (1 - cov[:, None]) + PAPER * cov[:, None]
# The window's rounded corners show the desktop: the window's background there.
for (ys, xs_) in ((slice(0, 16), slice(0, 16)), (slice(0, 16), slice(W - 16, W)), (slice(H - 16, H), slice(0, 16)), (slice(H - 16, H), slice(W - 16, W))):
    blk = img[ys, xs_]
    tint = (blk[..., 2] - blk[..., 0]) > 4
    blk[tint] = WINDOW_BG

# ---- the band and the zoom ------------------------------------------------------------------------
band_w = sw
band_h = sw * 9 / 16
band_x = sx
band_y = sy + 437 * (sh / 874) - band_h / 2
k0 = OUT_W / band_w  # the band fills the output
k1 = OUT_W / W  # the window fills the width
b = np.array([band_x + band_w / 2, band_y + band_h / 2])
m = np.array([W / 2, H / 2])
c = np.array([OUT_W / 2, OUT_H / 2])
# The fixed point f: k0·(f − b) = k1·(f − m), and where it sits in the output, F = c + k0·(f − b).
f = (k0 * b - k1 * m) / (k0 - k1)
F = c + k0 * (f - b)
print(f'band ({band_x:.2f}, {band_y:.2f}) {band_w:.2f} × {band_h:.2f}; zoom {k0:.4f} → {k1:.4f}; fixed point {f.round(2)} at {F.round(2)}')
Image.fromarray(np.clip(np.rint(img), 0, 255).astype(np.uint8)).save(f'{D}/outro_screen.png')

n_zoom = int(round(ZOOM_S * FPS))
n_hold = int(round(HOLD_S * FPS))
n = n_zoom + n_hold
foot = subprocess.Popen(['ffmpeg', '-v', 'error', '-i', f'{D}/p1.mkv', '-vf', f'select=gte(n\\,{XF})', '-fps_mode', 'passthrough', '-frames:v', str(n), '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], stdout=subprocess.PIPE)
enc = subprocess.Popen(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{OUT_W}x{OUT_H}', '-r', str(FPS), '-i', '-', '-c:v', 'ffv1', '-level', '3', '-pix_fmt', 'gbrp', f'{D}/outro.mkv'], stdin=subprocess.PIPE)
keep = {0, 1, n_zoom // 3, n_zoom // 2, 2 * n_zoom // 3, n_zoom, n - 1}
for j in range(n):
    buf = foot.stdout.read(OUT_W * OUT_H * 3)
    if len(buf) < OUT_W * OUT_H * 3:
        raise SystemExit(f'Part 1 ran out at outro frame {j}')
    fr = np.frombuffer(buf, np.uint8).reshape(OUT_H, OUT_W, 3).astype(np.float32)
    k = k0 ** (1 - smootherstep(j / n_zoom)) * k1 ** smootherstep(j / n_zoom)
    off = F - k * f  # output = off + k · screenshot
    out = np.empty((OUT_H, OUT_W, 3), np.float32)
    out[:] = WINDOW_BG
    # the screenshot's footprint in the output
    gx0, gy0 = max(0, int(np.floor(off[0]))), max(0, int(np.floor(off[1])))
    gx1, gy1 = min(OUT_W, int(np.ceil(off[0] + k * W))), min(OUT_H, int(np.ceil(off[1] + k * H)))
    if gx1 > gx0 and gy1 > gy0:
        out[gy0:gy1, gx0:gx1] = resample(img, k, off[0], k, off[1], (gx0, gy0, gx1, gy1), OUT_W, OUT_H)
    # the footage in the band (1:1 at the start)
    kf = k * band_w / OUT_W
    fx, fy = off[0] + k * band_x, off[1] + k * band_y
    bx0, by0 = max(0, int(np.floor(fx))), max(0, int(np.floor(fy)))
    bx1, by1 = min(OUT_W, int(np.ceil(fx + kf * OUT_W))), min(OUT_H, int(np.ceil(fy + kf * OUT_H)))
    if abs(kf - 1) < 1e-9 and abs(fx) < 1e-6 and abs(fy) < 1e-6:
        out = fr.copy()
    elif bx1 > bx0 and by1 > by0:
        sub = resample(fr, kf, fx, kf, fy, (bx0, by0, bx1, by1), OUT_W, OUT_H)
        X = np.arange(bx0, bx1)
        Y = np.arange(by0, by1)
        cx = np.minimum(np.clip(X + 1 - fx, 0, 1), np.clip(fx + kf * OUT_W - X, 0, 1))
        cy = np.minimum(np.clip(Y + 1 - fy, 0, 1), np.clip(fy + kf * OUT_H - Y, 0, 1))
        cov = (cy[:, None] * cx[None, :])[:, :, None]
        out[by0:by1, bx0:bx1] = out[by0:by1, bx0:bx1] * (1 - cov) + sub * cov
    frame = np.clip(np.rint(out), 0, 255).astype(np.uint8)
    if j in keep:
        Image.fromarray(frame).save(f'{D}/outro_{j:04d}.png')
    enc.stdin.write(frame.tobytes())
    if j % 60 == 0:
        print(f'  {j}/{n}', flush=True)
enc.stdin.close()
enc.wait()
foot.stdout.close()
foot.wait()
print(f'outro.mkv: {n} frames ({n / FPS:.2f} s): zoom {n_zoom}, hold {n_hold}')
