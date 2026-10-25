#!/usr/bin/env python3
"""Builds the iPhone app's text faces: three static instances of Bricolage Grotesque, the
website's typeface, at the website's text settings (opsz 16; wght 400, 500 and 600), each the
latin and latin-ext subsets merged, so a place such as Łódź or Reykjavík, or "Météo-France",
never falls back to the system font.

    pip install fonttools==4.66.1 brotli
    python3 scripts/make-text-fonts.py [--out DIR]
        apps/ios/Apps/Snow/Resources/Fonts/BricolageText-{Regular,Medium,SemiBold}.ttf, or the
        same three files in DIR. pnpm mobile:generate runs this when any of them is missing or
        out of date. It needs fontTools 4.66.1 exactly, so the same inputs give the same bytes.

Static instances rather than the variable font, so what ships is what is drawn: it doesn't hang
on whether Core Text applies the optical size of a custom variable font, or on how SwiftUI maps
a weight onto one. The website sets its text between 12.5 and 24 px, where widths change by
under 1% between neighbouring optical sizes, so one optical size draws them all.

Every instance comes out of the instancer named "Bricolage Grotesque 96pt ExtraBold", so the
three would collide when the app registers them: the name table is rewritten, each face with
its own PostScript name (which `Font.custom` and `UIFont(name:)` ask for, and the file is named
after), family "Bricolage Text" and its style. The copyright and the licence's URL stay, and the
name table gains the licence's description, as the answer font's does. Each keeps the source's
timestamps, so two builds are byte for byte the same. Each version string ends with the recipe,
a SHA-256 of this script and the two source fonts, which pnpm mobile:check compares without
Python (packages/mobile/src/exportFont.ts, `TEXT_FONTS`, which names the same faces).
"""
import argparse
import hashlib
import io
import sys
from pathlib import Path

from fontTools import merge, version as fonttools_version
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

root = Path(__file__).resolve().parent.parent
FONTS = root / "apps/ios/Apps/Snow/Resources/Fonts"
# Pinned so that the fonts are the same bytes wherever they are built.
FONTTOOLS = "4.66.1"
FAMILY = "Bricolage Text"
# The faces, as exportFont.ts's TEXT_FONTS lists them: PostScript name (and file name), style,
# weight and optical size.
FACES = [
    ("BricolageText-Regular", "Regular", 400, 16),
    ("BricolageText-Medium", "Medium", 500, 16),
    ("BricolageText-SemiBold", "SemiBold", 600, 16),
]
# What the version string says before the recipe; exportFont.ts reads it.
RECIPE = "make-text-fonts.py recipe "
OFL = "This Font Software is licensed under the SIL Open Font License, Version 1.1."
# The name records kept from the source: the copyright, and the licence's URL (13, the licence's
# description, is set below). Everything else is the source's own name, or its axes'.
KEPT_NAMES = {0, 13, 14}
# OS/2 fsSelection's italic, bold and regular bits.
ITALIC, BOLD, REGULAR = 1 << 0, 1 << 5, 1 << 6


def source_fonts() -> tuple[Path, Path]:
    """The latin and latin-ext variable fonts @fontsource-variable/bricolage-grotesque installs,
    from exactly one copy of the package, as make-answer-font.py finds its source."""
    found = sorted(
        (root / "node_modules/.pnpm").glob(
            "@fontsource-variable+bricolage-grotesque@*/node_modules/@fontsource-variable/"
            "bricolage-grotesque/files"
        )
    )
    if len(found) != 1:
        sys.exit(f"make-text-fonts.py: expected one Bricolage Grotesque source, found {len(found)}")
    files = found[0]
    latin = files / "bricolage-grotesque-latin-opsz-normal.woff2"
    ext = files / "bricolage-grotesque-latin-ext-opsz-normal.woff2"
    for path in (latin, ext):
        if not path.is_file():
            sys.exit(f"make-text-fonts.py: no {path.name} in {files}")
    return latin, ext


def recipe(latin: Path, ext: Path) -> str:
    """What the fonts are made from, as exportFont.ts's textFontRecipe computes it."""
    digest = hashlib.sha256()
    for part in (Path(__file__).resolve(), latin, ext):
        digest.update(hashlib.sha256(part.read_bytes()).digest())
    return digest.hexdigest()


def saved(font: TTFont) -> bytes:
    """`font` as a TrueType file, with the timestamps it holds rather than the time of the build."""
    font.flavor = None
    font.recalcTimestamp = False
    data = io.BytesIO()
    font.save(data)
    return data.getvalue()


def instance(source: Path, weight: int, size: int) -> bytes:
    """One subset of the source at `weight` and optical size `size`, as a file: the merger reads
    files, not fonts."""
    return saved(instancer.instantiateVariableFont(TTFont(source), {"wght": weight, "opsz": size}))


def face(latin: Path, ext: Path, spec: tuple[str, str, int, int], stamp: str) -> bytes:
    """A face of FACES: both subsets at its settings, merged, renamed and stamped with the
    recipe."""
    name, style, weight, size = spec
    parts = [instance(latin, weight, size), instance(ext, weight, size)]
    # vhea and vmtx aren't in the sources, and the merger couldn't merge them if they were.
    merger = merge.Merger(options=merge.Options(drop_tables=["vhea", "vmtx"]))
    font = merger.merge([io.BytesIO(part) for part in parts])
    # The merger stamps `modified` with the time of the build: the source's keeps it the same.
    source_head = TTFont(io.BytesIO(parts[0]))["head"]
    font["head"].created = source_head.created
    font["head"].modified = source_head.modified
    font["head"].macStyle = 0
    os2 = font["OS/2"]
    os2.fsSelection &= ~(ITALIC | BOLD | REGULAR)
    if weight == 400:
        os2.fsSelection |= REGULAR
    names = font["name"]
    names.names = [n for n in names.names if n.nameID in KEPT_NAMES or n.nameID >= 256]
    revision = f"{font['head'].fontRevision:.3f}"
    for name_id, text in (
        (1, FAMILY),
        (2, style),
        (3, f"{revision};{name}"),
        (4, f"{FAMILY} {style}"),
        (5, f"Version {revision};{RECIPE}{stamp}"),
        (6, name),
        (13, OFL),
    ):
        names.setName(text, name_id, 3, 1, 0x409)
    # The axes' names and their values', which nothing in a static font points to any more.
    names.removeUnusedNames(font)
    return saved(font)


def main() -> None:
    parser = argparse.ArgumentParser(description="Builds the iPhone app's text faces.")
    parser.add_argument("--out", type=Path, default=FONTS, help="the folder to write them in")
    args = parser.parse_args()
    if fonttools_version != FONTTOOLS:
        sys.exit(
            f"make-text-fonts.py needs fontTools {FONTTOOLS}, not {fonttools_version}: "
            f"pip install fonttools=={FONTTOOLS} brotli"
        )
    latin, ext = source_fonts()
    stamp = recipe(latin, ext)
    args.out.mkdir(parents=True, exist_ok=True)
    for spec in FACES:
        data = face(latin, ext, spec, stamp)
        path = args.out / f"{spec[0]}.ttf"
        path.write_bytes(data)
        print(f"wrote {path} ({len(data)} bytes)", file=sys.stderr)


if __name__ == "__main__":
    main()
