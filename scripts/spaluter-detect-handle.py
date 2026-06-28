#!/usr/bin/env python3
# Find the cream/white slider handle column in a fader row.
# Usage: detect_handle.py <png> <y> <x0> <x1>
# Prints the handle centre x. The handle is the brightest *neutral* (low-
# saturation) vertical bar, so we score each column by min(R,G,B): the cream
# handle has a high min channel while orange/blue fills and the dark track do not.
import sys
from PIL import Image

png, y, x0, x1 = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4])
im = Image.open(png).convert("RGB")
W, H = im.size
px = im.load()
band = range(max(0, y - 3), min(H, y + 4))
best_x, best_score, scores = x0, -1, []
for x in range(x0, min(x1, W)):
    s = sum(min(px[x, yy]) for yy in band) / len(list(band))
    scores.append((x, s))
    if s > best_score:
        best_score, best_x = s, x
# Expand across the contiguous bright plateau around the peak and take its centre.
thresh = best_score * 0.85
lo = hi = best_x
sd = dict(scores)
while lo - 1 >= x0 and sd.get(lo - 1, 0) >= thresh:
    lo -= 1
while hi + 1 < x1 and sd.get(hi + 1, 0) >= thresh:
    hi += 1
print((lo + hi) // 2)
