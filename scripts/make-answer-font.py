#!/usr/bin/env python3
"""Builds apps/web/src/fonts/bricolage-answer.woff2: a static instance of Bricolage Grotesque
at the answer's settings (wght 780, opsz 96), subset to letters, digits and basic punctuation.
It is inlined in the page head so the answer word never waits for a font download.

    pip install fonttools brotli
    python3 scripts/make-answer-font.py
"""
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

root = Path(__file__).resolve().parent.parent
source = next(
    (root / "node_modules/.pnpm").glob(
        "@fontsource-variable+bricolage-grotesque@*/node_modules/@fontsource-variable/"
        "bricolage-grotesque/files/bricolage-grotesque-latin-opsz-normal.woff2"
    )
)
font = instancer.instantiateVariableFont(TTFont(source), {"wght": 780, "opsz": 96})
options = subset.Options()
options.flavor = "woff2"
options.layout_features = ["kern", "liga", "calt"]
subsetter = subset.Subsetter(options)
subsetter.populate(
    text="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,'’!?…- "
)
subsetter.subset(font)
font.flavor = "woff2"
out = root / "apps/web/src/fonts/bricolage-answer.woff2"
font.save(out)
print(f"wrote {out} ({out.stat().st_size} bytes)")
