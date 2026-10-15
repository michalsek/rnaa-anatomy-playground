"""M12 outro: from the loop's last frame to a screenshot of the Claude app whose simulator panel shows
the factory app, the loop's footage playing inside the panel's phone. No zoom (the user):

    python3 -I tools/film/outro.py <dir> <screenshot.png>

1. a crossfade (0.5 s) from the footage, full frame, to the panel's iPhone alone on the window's dark
   background, centred across at its final size and height (the screenshot fit to the output's width:
   ×0.75);
2. a hold (0.6 s);
3. the phone slides right to its place in the panel (smootherstep, 1.2 s);
4. the rest of the window fades in around and behind it (0.8 s, from 60 % of the slide);
5. a hold on the full window (4 s): the same frame as the screenshot with the footage in the panel.

Needs <dir>/p1.mkv (Part 1; the footage continues with its frames after the loop point, 30 on) and
writes <dir>/outro.mkv (FFV1 RGB, 1920 × 1080, 60 fps) plus PNGs (outro_*.png). Then `final.sh` makes
final-light-60.mp4 = the loop + the outro.

- The simulator's screen in the screenshot is found from its pixels: the paper's edges against the
  black bezel along clean rows and columns (sub-pixel crossings), checked against 402 : 874.
- Inside it the screenshot keeps its real status bar and the app's chip row; below the chip row
  (110 pt) the screen is filled with the app's paper, edge to edge, the bottom corners following the
  screen's own corner profile (measured per row), and the footage goes into the film's 16:9 band:
  the screen's full width, centred on the screen (`filmFrame` on the simulator, dy 0).
- The phone is matted from the screenshot: the pixels that differ from the panel's background
  (20) by over 8 levels, the component holding the screen plus the side buttons beside it, holes
  filled; a 2 px ring around that gets a fractional alpha by unmixing against the panel's background
  and the nearest phone colour. The background under the phone (its soft shadow included) is filled in
  from around it, and the phone layer is kept premultiplied against it (P = pixel − (1 − α)·background),
  so over the faded-in window (the screenshot with that background in the phone's place) the last
  frames are the screenshot's own pixels; over the dark canvas no panel halo travels with it.
- Every frame is resampled with the compositor's Lanczos-3 matrices (composite_lib.py) at the exact
  sub-pixel map (the slide moves by fractions of a pixel).
"""
import subprocess
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, __file__.rsplit('/', 1)[0])
from composite_lib import resample, smootherstep  # noqa: E402
from scipy import ndimage  # noqa: E402

args = sys.argv[1:]
D, SHOT = args[0], args[1]
T_FADE, T_HOLD1, T_SLIDE, T_WIN, T_HOLD = 0.5, 0.6, 1.2, 0.8, 4.0
WIN_FROM = 0.6  # the window starts fading in at this fraction of the slide
PANEL_BG = 20.0  # the simulator panel's background around the phone
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

# ---- the phone's matte ---------------------------------------------------------------------------
orig = np.asarray(Image.open(SHOT).convert('RGB'), np.float32)
d = np.abs(orig - PANEL_BG).max(axis=2)
core = d > 8
lab, nlab = ndimage.label(core)
phone_lab = lab[int(sy + sh / 2), int(sx + sw / 2)]
phone = lab == phone_lab
ys_, xs_ = np.nonzero(phone)
px0, px1, py0, py1 = xs_.min(), xs_.max(), ys_.min(), ys_.max()
# The side buttons: small components just outside the frame's left and right edges, within its height.
for k, sl in enumerate(ndimage.find_objects(lab), start=1):
    if k == phone_lab or sl is None:
        continue
    y0_, y1_, x0_, x1_ = sl[0].start, sl[0].stop, sl[1].start, sl[1].stop
    if y0_ > py0 and y1_ < py1 and (px0 - 20 <= x1_ <= px0 + 2 or px1 - 2 <= x0_ <= px1 + 20) and (lab[sl] == k).sum() > 30:
        phone |= lab == k
        px0, px1 = min(px0, x0_), max(px1, x1_ - 1)
phone = ndimage.binary_fill_holes(phone)
ring = ndimage.binary_dilation(phone, iterations=2) & ~phone
# Fractional alpha on the ring: unmix against the background and the nearest phone colour.
kern = np.ones((7, 7), np.float32)
wsum = ndimage.convolve(phone.astype(np.float32), kern, mode='constant')
fcol = np.stack([ndimage.convolve(orig[..., ch] * phone, kern, mode='constant') for ch in range(3)], axis=2) / np.maximum(wsum, 1e-6)[..., None]
fb = fcol - PANEL_BG
pb = orig - PANEL_BG
den = (fb * fb).sum(axis=2)
alpha_ring = np.clip((pb * fb).sum(axis=2) / np.maximum(den, 1e-6), 0, 1)
alpha_ring = np.where(den > 100, alpha_ring, (d > 6).astype(np.float32))
alpha = np.where(phone, 1.0, np.where(ring, alpha_ring, 0.0)).astype(np.float32)
print(f'phone matte: bbox x {px0}–{px1}, y {py0}–{py1}; ring px {int(ring.sum())}, fractional {int(((alpha > 0) & (alpha < 1)).sum())}')
# The panel's background under the phone (its soft shadow included), filled in from around it, and
# the phone layer premultiplied against it: phone over that background gives the screenshot's pixels
# back exactly, and the window without the phone is the screenshot with that background there.
support = ndimage.binary_dilation(alpha > 0, iterations=2)
known = (~support).astype(np.float32)
g2 = ndimage.gaussian_filter(known, 6)
bloc = np.stack([ndimage.gaussian_filter(img[..., ch] * known, 6) for ch in range(3)], axis=2) / np.maximum(g2, 1e-6)[..., None]
bloc = np.where((g2 > 0.02)[..., None], bloc, PANEL_BG).astype(np.float32)
# (Kept over the whole support, not only where α > 0, so the outline's faint outer pixels come back
# exactly too.)
P = (img - (1 - alpha[..., None]) * bloc) * support[..., None]
winless = np.where(support[..., None], bloc, img).astype(np.float32)
Image.fromarray(np.clip(np.rint(alpha * 255), 0, 255).astype(np.uint8)).save(f'{D}/outro_alpha.png')

# ---- the layout ----------------------------------------------------------------------------------
K = OUT_W / W  # the window fills the width
OY = (OUT_H - K * H) / 2  # the letterbox (the window's background)
band_w = sw
band_h = sw * 9 / 16
band_x = sx
band_y = sy + 437 * (sh / 874) - band_h / 2
phone_cx = K * (px0 + px1 + 1) / 2
DX0 = OUT_W / 2 - phone_cx  # the phone centred across; its height is the final one throughout
print(f'band ({band_x:.2f}, {band_y:.2f}) {band_w:.2f} × {band_h:.2f}; scale {K:.4f}, letterbox {OY:.3f}; phone centre x {phone_cx:.2f} → slide {DX0:.2f} px')
Image.fromarray(np.clip(np.rint(img), 0, 255).astype(np.uint8)).save(f'{D}/outro_screen.png')

n_fade = int(round(T_FADE * FPS))
n_hold1 = int(round(T_HOLD1 * FPS))
n_slide = int(round(T_SLIDE * FPS))
n_win = int(round(T_WIN * FPS))
s0 = n_fade + n_hold1  # the slide's first frame
w0 = s0 + int(round(WIN_FROM * n_slide))  # the window's fade-in starts
n = max(s0 + n_slide, w0 + n_win) + int(round(T_HOLD * FPS))
bg = np.empty((OUT_H, OUT_W, 3), np.float32)
bg[:] = WINDOW_BG
win = bg.copy()
gy0, gy1 = int(np.floor(OY)), int(np.ceil(OY + K * H))
win[gy0:gy1] = resample(winless, K, 0, K, OY, (0, gy0, OUT_W, gy1), OUT_W, OUT_H)
foot = subprocess.Popen(['ffmpeg', '-v', 'error', '-i', f'{D}/p1.mkv', '-vf', f'select=gte(n\\,{XF})', '-fps_mode', 'passthrough', '-frames:v', str(n), '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], stdout=subprocess.PIPE)
enc = subprocess.Popen(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{OUT_W}x{OUT_H}', '-r', str(FPS), '-i', '-', '-c:v', 'ffv1', '-level', '3', '-pix_fmt', 'gbrp', f'{D}/outro.mkv'], stdin=subprocess.PIPE)
marks = {'crossfade mid': n_fade // 2, 'centred hold': n_fade + n_hold1 // 2, 'mid-slide': s0 + n_slide // 2, 'mid-fade': w0 + n_win // 2, 'final': n - 1}
keep = set(marks.values()) | {0}
phone_box = (int(np.floor(K * px0)) - 4, int(np.floor(OY + K * py0)) - 4, int(np.ceil(K * (px1 + 1))) + 4, int(np.ceil(OY + K * (py1 + 1))) + 4)
for j in range(n):
    buf = foot.stdout.read(OUT_W * OUT_H * 3)
    if len(buf) < OUT_W * OUT_H * 3:
        raise SystemExit(f'Part 1 ran out at outro frame {j}')
    fr = np.frombuffer(buf, np.uint8).reshape(OUT_H, OUT_W, 3).astype(np.float32)
    u = (j - s0) / n_slide
    dx = DX0 * (1 - smootherstep(u))
    a = smootherstep((j - w0) / n_win)
    out = bg * (1 - a) + win * a if a > 0 else bg.copy()
    # the phone at dx (premultiplied over whatever is under it)
    bx0, by0 = max(0, int(np.floor(phone_box[0] + dx))), max(0, phone_box[1])
    bx1, by1 = min(OUT_W, int(np.ceil(phone_box[2] + dx))), min(OUT_H, phone_box[3])
    box = (bx0, by0, bx1, by1)
    pr = resample(P, K, dx, K, OY, box, OUT_W, OUT_H)
    ar = resample(np.repeat(alpha[..., None], 3, axis=2), K, dx, K, OY, box, OUT_W, OUT_H)
    out[by0:by1, bx0:bx1] = pr + (1 - ar) * out[by0:by1, bx0:bx1]
    # the footage in the band
    kf = K * band_w / OUT_W
    fx, fy = dx + K * band_x, OY + K * band_y
    fx0, fy0 = max(0, int(np.floor(fx))), max(0, int(np.floor(fy)))
    fx1, fy1 = min(OUT_W, int(np.ceil(fx + kf * OUT_W))), min(OUT_H, int(np.ceil(fy + kf * OUT_H)))
    sub = resample(fr, kf, fx, kf, fy, (fx0, fy0, fx1, fy1), OUT_W, OUT_H)
    X = np.arange(fx0, fx1)
    Y = np.arange(fy0, fy1)
    cx = np.minimum(np.clip(X + 1 - fx, 0, 1), np.clip(fx + kf * OUT_W - X, 0, 1))
    cy = np.minimum(np.clip(Y + 1 - fy, 0, 1), np.clip(fy + kf * OUT_H - Y, 0, 1))
    cv = (cy[:, None] * cx[None, :])[:, :, None]
    out[fy0:fy1, fx0:fx1] = out[fy0:fy1, fx0:fx1] * (1 - cv) + sub * cv
    # the crossfade from the footage, full frame
    if j < n_fade:
        w = smootherstep((j + 1) / (n_fade + 1))
        out = fr * (1 - w) + out * w
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
print(f'outro.mkv: {n} frames ({n / FPS:.2f} s); marks {marks}')
