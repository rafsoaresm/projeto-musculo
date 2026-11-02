#!/bin/bash
# scripts/site-models/qa.sh <model> <preview|site> <out-dir>: draws the model and takes its pictures at 1440 and 390
# (out-dir/<model>-<mode>-1440.png and -390.png), cut in parts for reading (…-1440-p0.png, …-390-p0.png…).
set -e
cd "$(dirname "$0")/../.."
mkdir -p node_modules/.cache/site-models "$3"
npx esbuild scripts/site-models/render.tsx --bundle --platform=node --format=esm --jsx=automatic --alias:@=./src --outfile=node_modules/.cache/site-models/render.mjs --log-level=warning --packages=external
node node_modules/.cache/site-models/render.mjs "$1" "$2" "$3/$1-$2.html"
node scripts/site-models/shoot.mjs "$3/$1-$2.html" "$3/$1-$2"
python3 - "$3/$1-$2" <<'PY'
import sys
from PIL import Image
p = sys.argv[1]
for width in (1440, 390):
    im = Image.open(f"{p}-{width}.png")
    w, h = im.size
    step = 2400 if width == 1440 else 1600
    for i, top in enumerate(range(0, h, step)):
        part = im.crop((0, top, w, min(h, top + step)))
        scale = 720 / w if width == 1440 else 1
        part.resize((int(w * scale), int(part.size[1] * scale))).save(f"{p}-{width}-p{i}.png")
PY
