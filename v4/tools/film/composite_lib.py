"""M12: the compositor's resampling (composite.py, outro.py): separable Lanczos-3 matrices at an exact
sub-pixel affine map, antialiased when shrinking."""
import numpy as np
from scipy import sparse


def lanczos(x, a=3):
    x = np.abs(x)
    out = np.where(x < 1e-9, 1.0, a * np.sin(np.pi * x) * np.sin(np.pi * x / a) / (np.pi * np.pi * x * x + 1e-30))
    return np.where(x < a, out, 0.0)


def resample_matrix(n_out, n_src, scale, offset, lo=0, hi=None):
    """Rows: output pixels lo..hi; cols: source pixels. Output coordinate X = offset + scale·x_src
    (continuous, pixel edges at integers). Lanczos-3, widened by 1/scale when shrinking."""
    hi = n_out if hi is None else hi
    f = min(1.0, scale)
    support = 3.0 / f
    rows, cols, vals = [], [], []
    for o in range(lo, hi):
        c = ((o + 0.5) - offset) / scale  # source coordinate of the output pixel's centre
        idx = np.arange(max(0, int(np.floor(c - support))), min(n_src, int(np.ceil(c + support)) + 1))
        if len(idx) == 0:
            continue
        w = lanczos((idx + 0.5 - c) * f)
        tot = w.sum()
        if abs(tot) < 1e-9:
            continue
        rows += [o - lo] * len(idx)
        cols += list(idx)
        vals += list(w / tot)
    return sparse.csr_matrix((vals, (rows, cols)), shape=(hi - lo, n_src), dtype=np.float32)


def resample(img, sx, ox, sy, oy, box, out_w, out_h):
    """img (H×W×3 float32) → the output box (x0, y0, x1, y1) under X = ox + sx·x, Y = oy + sy·y."""
    x0, y0, x1, y1 = box
    Wx = resample_matrix(out_w, img.shape[1], sx, ox, x0, x1)
    Wy = resample_matrix(out_h, img.shape[0], sy, oy, y0, y1)
    out = np.empty((y1 - y0, x1 - x0, 3), np.float32)
    for ch in range(3):
        out[:, :, ch] = Wy @ (Wx @ img[:, :, ch].T).T
    return out


def smootherstep(u):
    u = min(1.0, max(0.0, u))
    return u * u * u * (u * (u * 6 - 15) + 10)
