"""M12: composite the loop video (notes/M12-plan.md §3b, with the user's later changes: the splash
covers the simulator's screen; its status bar stays).

    python3 -I tools/film/composite.py <dir>            # needs p1.mkv, p1_last.png, p2.mov, p2-summary.json

Part 1's last frame is the background; the simulator's screen (the recording, its first moving frame
on) goes into the rectangle it covers at the splash camera (`geo.screen` from `__v4.film.state()`:
the glass G, since the glass has the iPhone screen's shape), masked with the glass's shape inset 1 px
(Part 1's glass outline stays). The last `ZOOM` seconds zoom about the output's centre until the
simulator's 16:9 band fills it (S^E(u), E the smootherstep; it arrives as the dissolve begins); the
last `XFADE` seconds dissolve into Part 1's first frames. Every frame is resampled straight from the sources with separable Lanczos-3
matrices (antialiased when shrinking) at the exact sub-pixel affine map: no 8K intermediate and no
integer rounding (composite_lib.py). Writes tail.mkv (FFV1 RGB, 60 fps): the frames that follow Part 1's last one.

Then `loop.sh` concatenates p1.mkv from frame XFADE·60 with tail.mkv into the H.264 master.
"""
import json
import subprocess
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

sys.path.insert(0, __file__.rsplit('/', 1)[0])
from composite_lib import resample as resample_box, smootherstep  # noqa: E402

D = sys.argv[1]
FPS = 60
ZOOM = 2.0
XFADE = 0.5
# The mask's inset from the glass's edge (output px): Part 1's glass outline stays.
MASK_INSET = 1.0
OUT_W, OUT_H = 1920, 1080

summary = json.load(open(f'{D}/p2-summary.json'))
geo = summary['armed']['geo']
size = summary['armed']['size']
SIM_W, SIM_H, DPR = round(size['width'] * size['dpr']), round(size['height'] * size['dpr']), size['dpr']
scr = geo['screen']
s = geo['scale']  # output px per simulator px at the splash
S = geo['S']
band = geo['bandOut']
mask_r = geo['glassR'] - MASK_INSET
print(f'screen {scr}  scale {s:.6f}  S {S:.6f}  band {band}  mask r {mask_r:.2f}')


def resample(img, sx, ox, sy, oy, box):
    return resample_box(img, sx, ox, sy, oy, box, OUT_W, OUT_H)


def rounded_rect_coverage(k, box):
    """The inner screen's mask in the output for zoom k: coverage of the rounded rectangle (in the
    composite's 1080p space) at each output pixel of box, anti-aliased by its signed distance."""
    x0, y0, x1, y1 = box
    X = (np.arange(x0, x1) + 0.5 - 960) / k + 960
    Y = (np.arange(y0, y1) + 0.5 - 540) / k + 540
    cx, cy = scr['x'] + scr['w'] / 2, scr['y'] + scr['h'] / 2
    hx, hy = scr['w'] / 2 - MASK_INSET - mask_r, scr['h'] / 2 - MASK_INSET - mask_r
    qx = np.maximum(np.abs(X - cx) - hx, 0)[None, :]
    qy = np.maximum(np.abs(Y - cy) - hy, 0)[:, None]
    outside = np.hypot(qx, qy) - mask_r
    inside = np.minimum(np.maximum(np.abs(X - cx)[None, :] - hx, np.abs(Y - cy)[:, None] - hy), 0)
    sd = outside + inside  # composite px
    return np.clip(0.5 - sd * k, 0, 1)[:, :, None].astype(np.float32)


def frames(path, w, h, vf='null', pix='rgb24'):
    """Decoded frames (uint8) of a video, every frame as stored (no frame-rate conversion)."""
    p = subprocess.Popen(['ffmpeg', '-v', 'error', '-i', path, '-fps_mode', 'passthrough', '-vf', vf, '-f', 'rawvideo', '-pix_fmt', pix, '-'], stdout=subprocess.PIPE)
    n = w * h * (3 if pix == 'rgb24' else 1)
    while True:
        buf = p.stdout.read(n)
        if len(buf) < n:
            break
        yield np.frombuffer(buf, np.uint8).reshape(h, w, 3) if pix == 'rgb24' else np.frombuffer(buf, np.uint8).reshape(h, w)
    p.wait()


# Part 1's last frame: the 1080p background exactly as p1.mkv holds it (ffmpeg's Lanczos), and the
# 4K PNG for the zoom.
bg4k = np.asarray(Image.open(f'{D}/p1_last.png').convert('RGB'), np.float32)
bg1080 = next(frames(f'{D}/p1_last.png', OUT_W, OUT_H, 'scale=1920:1080:flags=lanczos')).astype(np.float32)
p1_head = [f.astype(np.float32) for _, f in zip(range(int(XFADE * FPS)), frames(f'{D}/p1.mkv', OUT_W, OUT_H, 'null'))]

# The recording is variable-rate: the simulator writes a frame per app frame, plus now and then a
# repeat of the last one within a few ms. Per stored frame: how many pixels changed (> 30 levels)
# and how long after the previous one it came. A repeat (under 50 px changed, under 10 ms after
# the last) is dropped, so the kept frames are the app's frames one for one at 60 fps. The first
# moving frame (over 1000 px changed: the splash's logo starts turning at go()) is C2's first.
pts = [float(x.strip().strip(',')) for x in subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'frame=pts_time', '-of', 'csv=p=0', f'{D}/p2.mov'], capture_output=True, text=True).stdout.split() if x.strip().strip(',')]
changed, prev = [], None
for f in frames(f'{D}/p2.mov', SIM_W, SIM_H, 'format=gray', 'gray'):
    g = f.astype(np.int16)
    changed.append(0 if prev is None else int((np.abs(g - prev) > 30).sum()))
    prev = g
dts = [1.0] + [b - a for a, b in zip(pts, pts[1:])]
keep = [i for i in range(len(changed)) if not (changed[i] < 50 and dts[i] < 0.010)]
tgo = next(i for i in keep if changed[i] > 1000)
kept = [i for i in keep if i >= tgo]
print(f'recording: {len(changed)} frames, {len(changed) - len(keep)} repeats dropped; first moving frame {tgo}')

total = summary['state']['t']  # Part 2's film length from go() (s)
n_c2 = int(round(total * FPS))
z0 = n_c2 - int(ZOOM * FPS)
x0f = n_c2 - int(XFADE * FPS)
print(f'C2 {n_c2} frames ({n_c2 / FPS:.3f} s); zoom from {z0}, dissolve from {x0f}')

enc = subprocess.Popen(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{OUT_W}x{OUT_H}', '-r', str(FPS), '-i', '-',
                        '-c:v', 'ffv1', '-level', '3', '-pix_fmt', 'gbrp', f'{D}/tail.mkv'], stdin=subprocess.PIPE)
keep = {0, 1, 2, z0, (z0 + n_c2) // 2, x0f, n_c2 - 1}
j = 0
use = set(kept[:n_c2])
for i, f in enumerate(frames(f'{D}/p2.mov', SIM_W, SIM_H)):
    if i not in use:
        continue
    if j >= n_c2:
        break
    sim = f.astype(np.float32)
    # The zoom ends where the dissolve starts: Part 1's frames dissolve over the band at exactly S.
    k = 1.0 if j < z0 else S ** smootherstep((j - z0 + 1) / (x0f - z0))
    # composite space (1080p) → output: X = 960 + k·(x − 960)
    if k == 1.0:
        out = bg1080.copy()
    else:
        out = resample(bg4k, k / 2, 960 * (1 - k), k / 2, 540 * (1 - k), (0, 0, OUT_W, OUT_H))
    # the inner screen's box in the output
    bx0 = max(0, int(np.floor(960 + k * (scr['x'] - 960))) - 1)
    by0 = max(0, int(np.floor(540 + k * (scr['y'] - 540))) - 1)
    bx1 = min(OUT_W, int(np.ceil(960 + k * (scr['x'] + scr['w'] - 960))) + 1)
    by1 = min(OUT_H, int(np.ceil(540 + k * (scr['y'] + scr['h'] - 540))) + 1)
    box = (bx0, by0, bx1, by1)
    simo = resample(sim, k * s, 960 + k * (scr['x'] - 960), k * s, 540 + k * (scr['y'] - 540), box)
    if j == 0:
        # The recording decodes about 2 levels darker than Part 1 (the simulator's H.264, limited
        # range): a per-channel gain and offset fitted on the first frame's flat pixels (the
        # splash, the same art as Part 1's last frame) matches it for every frame.
        ref = bg1080[by0:by1, bx0:bx1]
        grad = lambda im: np.hypot(*np.gradient(im.mean(axis=2)))
        flat = ndimage.binary_erosion((grad(ref) + grad(simo)) < 1.5, iterations=2)
        flat[:4], flat[-4:], flat[:, :4], flat[:, -4:] = False, False, False, False
        fit = []
        for ch in range(3):
            x, y = simo[..., ch][flat], ref[..., ch][flat]
            gain, off = np.linalg.lstsq(np.vstack([x, np.ones_like(x)]).T, y, rcond=None)[0]
            fit.append((float(gain), float(off)))
        print('colour fit (gain, offset) per channel:', [(round(g, 4), round(o, 3)) for g, o in fit])
    for ch in range(3):
        simo[..., ch] = simo[..., ch] * fit[ch][0] + fit[ch][1]
    m = rounded_rect_coverage(k, box)
    out[by0:by1, bx0:bx1] = out[by0:by1, bx0:bx1] * (1 - m) + simo * m
    if j >= x0f:
        w = (j - x0f + 1) / (n_c2 - x0f)
        out = out * (1 - w) + p1_head[j - x0f] * w
    frame = np.clip(np.rint(out), 0, 255).astype(np.uint8)
    if j in keep:
        Image.fromarray(frame).save(f'{D}/c2_{j:04d}.png')
    enc.stdin.write(frame.tobytes())
    j += 1
    if j % 60 == 0:
        print(f'  {j}/{n_c2}', flush=True)
enc.stdin.close()
enc.wait()
if j < n_c2:
    raise SystemExit(f'the recording ran out at C2 frame {j} of {n_c2}')
# The app's last moving frame (the logo stops at `done`): later the recorder only shows the codec's
# key-frame flicker (under 100 px), so count real motion only.
moving = [n for n, i in enumerate(kept) if changed[i] > 100]
json.dump({'tgo': tgo, 'kept': kept, 'last_moving_kept': moving[-1], 'colour_fit': fit, 'n_c2': n_c2, 'zoom_from': z0, 'xfade_from': x0f, 'S': S, 'mask_r': mask_r, 'mask_inset': MASK_INSET}, open(f'{D}/tail.json', 'w'))
print('tail.mkv done')
