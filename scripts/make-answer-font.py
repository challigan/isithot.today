#!/usr/bin/env python3
"""Builds the answer word's font: a static instance of Bricolage Grotesque at the answer's
settings (wght 780, opsz 96), subset to letters, digits and basic punctuation.

    pip install fonttools brotli
    python3 scripts/make-answer-font.py
        apps/web/src/fonts/bricolage-answer.woff2, inlined in the page head so the answer word
        never waits for a font download.

    python3 scripts/make-answer-font.py --ttf [--out PATH]
        apps/ios/Apps/Snow/Resources/Fonts/BricolageAnswer.ttf, the iPhone app's and its widget's
        (iOS build spec, sections 7.1 and 10.1). pnpm mobile:generate runs this when the font is
        out of date. It needs fontTools 4.66.1 exactly, so the same inputs give the same bytes.

The TrueType font is the same instance and subset as the website's: --ttf fails unless every
table but head's timestamps and the name table matches the committed woff2's. It is named
BricolageAnswer, so the app finds it as Font.custom("BricolageAnswer", ...); its name table
carries the Open Font License (the font has no reserved name); and it keeps the source's
timestamps. Its version string ends with its recipe, a SHA-256 of this script, the source font
and the website's woff2, which pnpm mobile:check compares without Python
(packages/mobile/src/exportFont.ts).
"""
import argparse
import hashlib
import io
import sys
from pathlib import Path

from fontTools import subset, version as fonttools_version
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

root = Path(__file__).resolve().parent.parent
WOFF2 = root / "apps/web/src/fonts/bricolage-answer.woff2"
TTF = root / "apps/ios/Apps/Snow/Resources/Fonts/BricolageAnswer.ttf"
# The TrueType build's fontTools, pinned so that it gives the same bytes wherever it runs.
FONTTOOLS = "4.66.1"
NAME = "BricolageAnswer"
# What the version string says before the recipe; exportFont.ts reads it.
RECIPE = "make-answer-font.py recipe "
OFL = "This Font Software is licensed under the SIL Open Font License, Version 1.1."


def source_font() -> Path:
    """The variable font @fontsource-variable/bricolage-grotesque installs: exactly one."""
    found = sorted(
        (root / "node_modules/.pnpm").glob(
            "@fontsource-variable+bricolage-grotesque@*/node_modules/@fontsource-variable/"
            "bricolage-grotesque/files/bricolage-grotesque-latin-opsz-normal.woff2"
        )
    )
    if len(found) != 1:
        sys.exit(f"make-answer-font.py: expected one Bricolage Grotesque source, found {len(found)}")
    return found[0]


def answer_font(source: Path, flavor: str | None) -> TTFont:
    """The answer's instance and subset, the same for the woff2 and the TrueType font."""
    font = instancer.instantiateVariableFont(TTFont(source), {"wght": 780, "opsz": 96})
    options = subset.Options()
    options.flavor = flavor
    options.layout_features = ["kern", "liga", "calt"]
    # As the committed woff2 was built: .notdef keeps its outline, and the name table the
    # licence's URL. With these, fontTools 4.66.1 rebuilds every table of it but head.
    options.notdef_outline = True
    options.name_IDs = ["*"]
    subsetter = subset.Subsetter(options)
    subsetter.populate(
        text="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,'’!?…- "
    )
    subsetter.subset(font)
    font.flavor = flavor
    return font


def recipe(source: Path) -> str:
    """What the TrueType font is made from, as exportFont.ts's fontRecipe computes it."""
    digest = hashlib.sha256()
    for part in (Path(__file__).resolve(), source, WOFF2):
        digest.update(hashlib.sha256(part.read_bytes()).digest())
    return digest.hexdigest()


def saved(font: TTFont) -> bytes:
    """`font` as a file, with the source's timestamps rather than the time of the build."""
    font.recalcTimestamp = False
    data = io.BytesIO()
    font.save(data)
    return data.getvalue()


def differences_from_website(font: TTFont) -> list[str]:
    """Where `font`, as read from a file, differs from the committed woff2 as the woff2 decoder
    reads it: each table's bytes but the name table's, and head but its timestamps and checksum."""
    web = TTFont(WOFF2)
    found = sorted(set(font.keys()) ^ set(web.keys()))
    for tag in sorted(set(font.keys()) & set(web.keys()) - {"GlyphOrder", "head", "name"}):
        if font.getTableData(tag) != web.getTableData(tag):
            found.append(tag)
    web_head = vars(web["head"])
    for field, value in sorted(vars(font["head"]).items()):
        if field not in ("modified", "checkSumAdjustment") and web_head.get(field) != value:
            found.append(f"head.{field}")
    return found


def ttf(out: Path) -> None:
    if fonttools_version != FONTTOOLS:
        sys.exit(
            f"make-answer-font.py --ttf needs fontTools {FONTTOOLS}, not {fonttools_version}: "
            f"pip install fonttools=={FONTTOOLS} brotli"
        )
    source = source_font()
    font = TTFont(io.BytesIO(saved(answer_font(source, None))))
    found = differences_from_website(font)
    if found:
        sys.exit(
            "make-answer-font.py --ttf: the website's woff2 is not this instance and subset "
            f"({', '.join(found)} differ). Build it first (with no arguments), then the TrueType "
            "font, and commit both."
        )
    revision = f"{font['head'].fontRevision:.3f}"
    for name_id, text in (
        (1, NAME),
        (3, f"{revision};{NAME}"),
        (4, NAME),
        (5, f"Version {revision};{RECIPE}{recipe(source)}"),
        (6, NAME),
        (13, OFL),
    ):
        font["name"].setName(text, name_id, 3, 1, 0x409)
    data = saved(font)
    if str(out) == "-":
        sys.stdout.buffer.write(data)
        return
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(data)
    print(f"wrote {out} ({len(data)} bytes)", file=sys.stderr)


def woff2() -> None:
    font = answer_font(source_font(), "woff2")
    font.save(WOFF2)
    print(f"wrote {WOFF2} ({WOFF2.stat().st_size} bytes)")


def main() -> None:
    parser = argparse.ArgumentParser(description="Builds the answer word's font.")
    parser.add_argument("--ttf", action="store_true", help="the iPhone app's TrueType font")
    parser.add_argument("--out", type=Path, help="with --ttf, where to write it (- for stdout)")
    args = parser.parse_args()
    if args.out and not args.ttf:
        parser.error("--out goes with --ttf")
    if args.ttf:
        ttf(args.out or TTF)
    else:
        woff2()


if __name__ == "__main__":
    main()
