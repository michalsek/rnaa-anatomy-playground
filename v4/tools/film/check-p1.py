"""M12: check a Part 1 capture's state log (capture-web.mjs → p1-state.jsonl).

    python3 -I tools/film/check-p1.py <p1-state.jsonl> [<another run's p1-state.jsonl>]

Per frame (1/60 s): the camera's yaw and elevation change under 2°, its log zoom under 0.15, its
target slides under 150 CSS px (the eases between close-ups are fast but smooth), and no channel's
velocity reverses for a frame and back (an oscillation). With a second log: the same states and
PNG md5s frame for frame (determinism). Exits non-zero on a failure.
"""
import json
import math
import sys

runs = [[json.loads(line) for line in open(p)] for p in sys.argv[1:]]
L = runs[0]
bad = []
prev = None
for i in range(1, len(L)):
    a, b = L[i - 1]['camera'], L[i]['camera']
    d = [b['yaw'] - a['yaw'], b['elevation'] - a['elevation'], math.log(b['zoom'] / a['zoom'])]
    slide = math.dist(a['target'], b['target']) * b['zoom']
    if abs(d[0]) > 2 or abs(d[1]) > 2 or abs(d[2]) > 0.15 or slide > 150:
        bad.append(f'frame {i}: step {d} slide {slide:.1f} px')
    if prev is not None and i >= 2:
        nxt = L[i + 1]['camera'] if i + 1 < len(L) else None
        if nxt:
            for k, key in enumerate(('yaw', 'elevation')):
                v0, v1, v2 = prev[k], d[k], nxt[key] - b[key]
                if abs(v0) > 1e-3 and abs(v1) > 1e-3 and abs(v2) > 1e-3 and v0 * v1 < 0 and v1 * v2 < 0:
                    bad.append(f'frame {i}: {key} oscillates')
    prev = d
print(f'{len(L)} frames; camera steps: {"ok" if not bad else f"{len(bad)} bad"}')
for line in bad[:20]:
    print(' ', line)
if len(runs) > 1:
    other = runs[1]
    n = min(len(L), len(other))
    diff = [i for i in range(n) if L[i] != other[i]]
    print(f'determinism over {n} frames: {"identical" if not diff else f"{len(diff)} frames differ, first {diff[:10]}"}')
    bad += diff
sys.exit(1 if bad else 0)
