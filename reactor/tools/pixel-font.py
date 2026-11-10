#!/usr/bin/env python3
"""Builds reactor/fonts/reactor-pixel.woff2: the few glyphs the page draws
itself because Tiny5's are hard to read at this size. It sits in front of
Tiny5 in the font stack and shares its grid (five pixels to the cap height,
128 font units to a pixel), so the two mix without a seam.

    pip install fonttools brotli
    python3 reactor/tools/pixel-font.py
"""
import os
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

PX = 128                      # one pixel, in font units (Tiny5's own)
UPM, ASCENT, DESCENT = 1024, 896, -256

# Rows run top to bottom, the last one sitting on the baseline.
GLYPHS = {
    'percent': (0x25, [
        'XX..X',
        'XX.X.',
        '..X..',
        '.X.XX',
        'X..XX',
    ]),
}


def draw(rows):
    pen = TTGlyphPen(None)
    for r, row in enumerate(reversed(rows)):
        for c, ch in enumerate(row):
            if ch != 'X':
                continue
            x, y = c * PX, r * PX
            pen.moveTo((x, y))
            pen.lineTo((x, y + PX))
            pen.lineTo((x + PX, y + PX))
            pen.lineTo((x + PX, y))
            pen.closePath()
    return pen.glyph()


def main():
    names = ['.notdef'] + list(GLYPHS)
    fb = FontBuilder(UPM, isTTF=True)
    fb.setupGlyphOrder(names)
    fb.setupCharacterMap({code: name for name, (code, _) in GLYPHS.items()})
    glyphs = {'.notdef': TTGlyphPen(None).glyph()}
    metrics = {'.notdef': (PX * 4, 0)}
    for name, (_, rows) in GLYPHS.items():
        glyphs[name] = draw(rows)
        metrics[name] = ((len(rows[0]) + 1) * PX, 0)
    fb.setupGlyf(glyphs)
    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader(ascent=ASCENT, descent=DESCENT)
    fb.setupNameTable({'familyName': 'Reactor Pixel', 'styleName': 'Regular'})
    fb.setupOS2(sTypoAscender=ASCENT, sTypoDescender=DESCENT, sTypoLineGap=0,
                usWinAscent=ASCENT, usWinDescent=-DESCENT)
    fb.setupPost()
    fb.font.flavor = 'woff2'
    out = os.path.join(os.path.dirname(__file__), '..', 'fonts', 'reactor-pixel.woff2')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    fb.save(out)
    print('wrote', os.path.normpath(out), os.path.getsize(out), 'bytes')


if __name__ == '__main__':
    main()
