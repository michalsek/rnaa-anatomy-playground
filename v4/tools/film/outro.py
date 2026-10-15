"""M12 outro (the user's third version): Part 2 goes straight into a screenshot of the Claude app whose
simulator panel shows the factory app; no zoom into the factory.

    python3 -I tools/film/outro.py <dir> <screenshot.png>

It starts where the composite's settle ends (C2 frame `zoom_from`, before the loop's zoom): the
simulator's screen sits on the outer rendered phone's glass G, on the paper, the rendered case's rim
around it (Part 1's last frame).

1. the bevel (0.6 s): the rendered case fades out to plain paper and the panel's iPhone frame, matted
   from the screenshot, fades in, scaled so its screen opening lands on G; the screen and the paper
   stay as they are;
2. the move (1.4 s, smootherstep): the phone and its screen translate and scale (uniformly, the scale
   in log space) from G to their place in the window's simulator panel (the window fit to the output's
   width: ×0.75, an 11.6 px letterbox in its own background), on the paper;
3. the window (0.8 s, from 60 % of the move): the paper crossfades to the Claude window (the thread,
   the panel, the dark window, the phone's own place filled with the panel's background); the phone
   stays opaque on top;
4. a hold (4 s).

The screen shows the simulator's recording all along, continuing from C2 (the same kept frames, the
same colour fit and the glass-shaped mask inset 1 px as composite.py; after `done` the app is still,
so the recording's later frames hold the last picture). The final frame is the screenshot with its
panel's screen replaced by Part 2's last frame.

Needs <dir>/p1_last.png, p2.mov, p2-summary.json, tail.json (composite.py); writes <dir>/outro.mkv
(FFV1 RGB, 1920 × 1080, 60 fps) and PNGs (outro_*.png, outro_alpha.png). Then `final.sh`.

- The panel's screen is found from its pixels (the paper's sub-pixel edges against the black bezel
  along clean rows and columns), checked against 402 : 874.
- The phone is matted from the screenshot: the pixels over 8 levels off the panel's background (20),
  the component holding the screen plus the side buttons, holes filled; a 2 px ring gets a fractional
  alpha by unmixing against the background and the nearest phone colour. The background under the
  phone (its soft shadow included) is filled in from around it and the phone layer is premultiplied
  against it, so it carries no halo onto the paper, and over the faded-in window the last frame is
  the screenshot's own pixels.
- Every frame is resampled with the compositor's Lanczos-3 matrices (composite_lib.py) at the exact
  sub-pixel map.
"""
import json
import subprocess
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

sys.path.insert(0, __file__.rsplit('/', 1)[0])
from composite_lib import resample, smootherstep  # noqa: E402

D, SHOT = sys.argv[1], sys.argv[2]
FPS = 60
OUT_W, OUT_H = 1920, 1080
T_BEVEL, T_MOVE, T_WIN, T_HOLD = 0.6, 1.4, 0.8, 4.0
WIN_FROM = 0.6  # the window starts fading in at this fraction of the move
WINDOW_BG = np.array([21, 21, 21], np.float32)
PANEL_BG = 20.0

summary = json.load(open(f'{D}/p2-summary.json'))
tail = json.load(open(f'{D}/tail.json'))
geo = summary['armed']['geo']
size = summary['armed']['size']
SIM_W, SIM_H = round(size['width'] * size['dpr']), round(size['height'] * size['dpr'])
G = geo['screen']  # the glass G in the output = the simulator's screen at C2
FIT = tail['colour_fit']
MASK_INSET = tail.get('mask_inset', 1.0)
GLASS_R = geo['glassR']
kept = tail['kept']
start = tail['zoom_from']  # C2's frames before the loop's zoom: the outro takes over here

img = np.asarray(Image.open(SHOT).convert('RGB'), np.float32).copy()
L = img.mean(axis=2)
H, W = L.shape

# ---- the panel's screen ---------------------------------------------------------------------------
cx0 = W * 0.856  # a column through the panel's screen


def cross(p, i, step, thr=126.0):
    """The sub-pixel 50 % crossing walking from i (on the paper) by step (pixel-edge coordinates)."""
    while p[i] > thr:
        i += step
    a, b = p[i - step], p[i]
    return (i - step) + step * (a - thr) / (a - b) + 0.5


rows = [int(H * f) for f in (0.71, 0.745, 0.78, 0.815)]
x0 = float(np.median([cross(L[r], int(cx0), -1) for r in rows]))
x1 = float(np.median([cross(L[r], int(cx0), 1) for r in rows]))
cols = [int(x0 + (x1 - x0) * f) for f in (0.29, 0.31, 0.70, 0.72)]
y0 = float(np.median([cross(L[:, c], int(H * 0.2), -1) for c in cols]))
y1 = float(np.median([cross(L[:, c], int(H * 0.88), 1) for c in cols]))
sx, sy, sw, sh = x0, y0, x1 - x0, y1 - y0
print(f'panel screen: ({sx:.2f}, {sy:.2f}) {sw:.2f} × {sh:.2f}, aspect {sw / sh:.5f} (402:874 = {402 / 874:.5f})')
if abs((sw / sh) / (402 / 874) - 1) > 0.005:
    raise SystemExit('the screen rect is not 402:874 within 0.5 %')
scx, scy = sx + sw / 2, sy + sh / 2  # its centre, the point the moves are about
# The window's rounded corners show the desktop: the window's background there.
for (ys, xs_) in ((slice(0, 16), slice(0, 16)), (slice(0, 16), slice(W - 16, W)), (slice(H - 16, H), slice(0, 16)), (slice(H - 16, H), slice(W - 16, W))):
    blk = img[ys, xs_]
    blk[(blk[..., 2] - blk[..., 0]) > 4] = WINDOW_BG

# ---- the phone's matte ----------------------------------------------------------------------------
d = np.abs(img - PANEL_BG).max(axis=2)
lab, _ = ndimage.label(d > 8)
phone_lab = lab[int(scy), int(scx)]
phone = lab == phone_lab
ys_, xs_ = np.nonzero(phone)
px0, px1, py0, py1 = xs_.min(), xs_.max(), ys_.min(), ys_.max()
for k, sl in enumerate(ndimage.find_objects(lab), start=1):  # the side buttons
    if k == phone_lab or sl is None:
        continue
    a0, a1, b0, b1 = sl[0].start, sl[0].stop, sl[1].start, sl[1].stop
    if a0 > py0 and a1 < py1 and (px0 - 20 <= b1 <= px0 + 2 or px1 - 2 <= b0 <= px1 + 20) and (lab[sl] == k).sum() > 30:
        phone |= lab == k
        px0, px1 = min(px0, b0), max(px1, b1 - 1)
phone = ndimage.binary_fill_holes(phone)
ring = ndimage.binary_dilation(phone, iterations=2) & ~phone
kern = np.ones((7, 7), np.float32)
wsum = ndimage.convolve(phone.astype(np.float32), kern, mode='constant')
fcol = np.stack([ndimage.convolve(img[..., ch] * phone, kern, mode='constant') for ch in range(3)], axis=2) / np.maximum(wsum, 1e-6)[..., None]
fb, pb = fcol - PANEL_BG, img - PANEL_BG
den = (fb * fb).sum(axis=2)
alpha_ring = np.where(den > 100, np.clip((pb * fb).sum(axis=2) / np.maximum(den, 1e-6), 0, 1), (d > 6).astype(np.float32))
alpha = np.where(phone, 1.0, np.where(ring, alpha_ring, 0.0)).astype(np.float32)
support = ndimage.binary_dilation(alpha > 0, iterations=2)
known = (~support).astype(np.float32)
g2 = ndimage.gaussian_filter(known, 6)
bloc = np.stack([ndimage.gaussian_filter(img[..., ch] * known, 6) for ch in range(3)], axis=2) / np.maximum(g2, 1e-6)[..., None]
bloc = np.where((g2 > 0.02)[..., None], bloc, PANEL_BG).astype(np.float32)
# premultiplied against the background under it, over the whole support (the outline's faint outer
# pixels come back exactly too)
P = (img - (1 - alpha[..., None]) * bloc) * support[..., None]
alpha3 = np.repeat(alpha[..., None], 3, axis=2)
winless = np.where(support[..., None], bloc, img).astype(np.float32)
Image.fromarray(np.clip(np.rint(alpha * 255), 0, 255).astype(np.uint8)).save(f'{D}/outro_alpha.png')
print(f'phone matte: bbox x {px0}–{px1}, y {py0}–{py1}')

# ---- placements -----------------------------------------------------------------------------------
K = OUT_W / W  # the window in the final frame
OY = (OUT_H - K * H) / 2
s_g = G['w'] / sw  # the screen opening on G
c_g = np.array([G['x'] + G['w'] / 2, G['y'] + G['h'] / 2])
s_f = K
c_f = np.array([K * scx, OY + K * scy])
print(f'phone scale {s_g:.5f} → {s_f:.5f}; screen centre {c_g.round(2)} → {c_f.round(2)}')

# Part 1's last frame at 1080p exactly as p1.mkv and composite.py have it (ffmpeg's Lanczos).
bg1080 = np.frombuffer(subprocess.run(['ffmpeg', '-v', 'error', '-i', f'{D}/p1_last.png', '-vf', 'scale=1920:1080:flags=lanczos', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True, check=True).stdout, np.uint8).reshape(OUT_H, OUT_W, 3).astype(np.float32)
# The paper: Part 1's last frame where it has no phone (a column away from it), as its own colour.
PAPER = bg1080[540, 100].copy()
win = np.empty((OUT_H, OUT_W, 3), np.float32)
win[:] = WINDOW_BG
gy0, gy1 = int(np.floor(OY)), int(np.ceil(OY + K * H))
win[gy0:gy1] = resample(winless, K, 0, K, OY, (0, gy0, OUT_W, gy1), OUT_W, OUT_H)


def screen_mask(rect, box):
    """The glass-shaped mask (rounded rect, inset as at C2), anti-aliased, over the output box."""
    bx0, by0, bx1, by1 = box
    k = rect[2] / G['w']
    r = (GLASS_R - MASK_INSET) * k
    inset = MASK_INSET * k
    X = np.arange(bx0, bx1) + 0.5
    Y = np.arange(by0, by1) + 0.5
    cx, cy = rect[0] + rect[2] / 2, rect[1] + rect[3] / 2
    hx, hy = rect[2] / 2 - inset - r, rect[3] / 2 - inset - r
    qx = np.maximum(np.abs(X - cx) - hx, 0)[None, :]
    qy = np.maximum(np.abs(Y - cy) - hy, 0)[:, None]
    sd = np.hypot(qx, qy) - r + np.minimum(np.maximum(np.abs(X - cx)[None, :] - hx, np.abs(Y - cy)[:, None] - hy), 0)
    return np.clip(0.5 - sd, 0, 1)[:, :, None].astype(np.float32)


n_bevel = int(round(T_BEVEL * FPS))
n_move = int(round(T_MOVE * FPS))
n_win = int(round(T_WIN * FPS))
m0 = n_bevel
w0 = m0 + int(round(WIN_FROM * n_move))
n = max(m0 + n_move, w0 + n_win) + int(round(T_HOLD * FPS))
use = kept[start:start + n]
if len(use) < n:
    raise SystemExit(f'the recording has {len(use)} frames after C2 frame {start}; the outro needs {n}')
idx = {f: j for j, f in enumerate(use)}
marks = {'bevel mid-fade': n_bevel // 2, 'bevel done': n_bevel, 'mid-move': m0 + n_move // 2, 'mid-thread-fade': w0 + n_win // 2, 'final': n - 1}
keep_png = set(marks.values()) | {0, 1}
enc = subprocess.Popen(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{OUT_W}x{OUT_H}', '-r', str(FPS), '-i', '-',
                        '-c:v', 'ffv1', '-level', '3', '-pix_fmt', 'gbrp', f'{D}/outro.mkv'], stdin=subprocess.PIPE)
dec = subprocess.Popen(['ffmpeg', '-v', 'error', '-i', f'{D}/p2.mov', '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], stdout=subprocess.PIPE)
nb = SIM_W * SIM_H * 3
i = -1
done = 0
while done < n:
    buf = dec.stdout.read(nb)
    if len(buf) < nb:
        raise SystemExit('the recording ran out')
    i += 1
    if i not in idx:
        continue
    j = idx[i]
    sim = np.frombuffer(buf, np.uint8).reshape(SIM_H, SIM_W, 3).astype(np.float32)
    for ch in range(3):
        sim[..., ch] = sim[..., ch] * FIT[ch][0] + FIT[ch][1]
    t_b = smootherstep((j + 1) / n_bevel) if j < n_bevel else 1.0
    u = smootherstep((j - m0) / n_move)
    a = smootherstep((j - w0) / n_win)
    sc = np.exp(np.log(s_g) * (1 - u) + np.log(s_f) * u)
    c = c_g * (1 - u) + c_f * u
    ox, oy = c[0] - sc * scx, c[1] - sc * scy  # output = o + sc · screenshot
    # the background: Part 1's last frame (the rendered case) → paper → the window
    out = bg1080 * (1 - t_b) + PAPER * t_b if t_b < 1 else np.empty_like(bg1080)
    if t_b >= 1:
        out[:] = PAPER
    if a > 0:
        out = out * (1 - a) + win * a
    # the phone (premultiplied over the background), fading in during the bevel
    bx0 = max(0, int(np.floor(ox + sc * (px0 - 3))))
    by0 = max(0, int(np.floor(oy + sc * (py0 - 3))))
    bx1 = min(OUT_W, int(np.ceil(ox + sc * (px1 + 4))))
    by1 = min(OUT_H, int(np.ceil(oy + sc * (py1 + 4))))
    box = (bx0, by0, bx1, by1)
    pr = resample(P, sc, ox, sc, oy, box, OUT_W, OUT_H)
    ar = resample(alpha3, sc, ox, sc, oy, box, OUT_W, OUT_H)
    under = out[by0:by1, bx0:bx1]
    out[by0:by1, bx0:bx1] = under * (1 - t_b) + (pr + (1 - ar) * under) * t_b
    # the simulator's screen on top: the screen opening's rect, the simulator's aspect
    rw = sc * sw
    rh = rw * SIM_H / SIM_W
    rect = (c[0] - rw / 2, c[1] - rh / 2, rw, rh)
    sb = (max(0, int(np.floor(rect[0])) - 1), max(0, int(np.floor(rect[1])) - 1), min(OUT_W, int(np.ceil(rect[0] + rw)) + 1), min(OUT_H, int(np.ceil(rect[1] + rh)) + 1))
    ks = rw / SIM_W
    simo = resample(sim, ks, rect[0], ks, rect[1], sb, OUT_W, OUT_H)
    m = screen_mask(rect, sb)
    out[sb[1]:sb[3], sb[0]:sb[2]] = out[sb[1]:sb[3], sb[0]:sb[2]] * (1 - m) + simo * m
    frame = np.clip(np.rint(out), 0, 255).astype(np.uint8)
    if j in keep_png:
        Image.fromarray(frame).save(f'{D}/outro_{j:04d}.png')
    enc.stdin.write(frame.tobytes())
    done += 1
    if j % 60 == 0:
        print(f'  {j}/{n}', flush=True)
dec.stdout.close()
dec.kill()
enc.stdin.close()
enc.wait()
json.dump({'n': n, 'start': start, 'marks': marks, 'scale': [s_g, s_f], 'centre': [c_g.tolist(), c_f.tolist()], 'screen': [sx, sy, sw, sh]}, open(f'{D}/outro.json', 'w'), indent=1)
print(f'outro.mkv: {n} frames ({n / FPS:.2f} s); marks {marks}')
