#!/usr/bin/env python3
"""Builds reactor/fonts/reactor-pixel.woff2: the few glyphs the page's text
needs that Jersey 10 doesn't have (plus-minus, micro and some Greek). They
are drawn on Jersey 10's own grid (ten pixels to the cap height, 75 font
units to a pixel, two-pixel strokes) and sit behind it in the font stack.

    pip install fonttools brotli
    python3 reactor/tools/pixel-font.py
"""
import os
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

PX = 75                       # one pixel, in font units (Jersey 10's own)
UPM, ASCENT, DESCENT = 1400, 1125, -375

# Twelve rows, top to bottom: ten down to the baseline, then two below it.
GLYPHS = {
    'plusminus': (0xB1, [
        '......', '..XX..', '..XX..', 'XXXXXX', 'XXXXXX',
        '..XX..', '..XX..', '......', 'XXXXXX', 'XXXXXX', '......', '......']),
    'mu': (0xB5, [
        '.......', '.......', 'XX...XX', 'XX...XX', 'XX...XX',
        'XX...XX', 'XX...XX', 'XX...XX', 'XXXXXXX', 'XXXX.XX', 'XX.....', 'XX.....']),
    'Delta': (0x394, [
        '...XX...', '...XX...', '..XXXX..', '..XXXX..', '.XX..XX.',
        '.XX..XX.', 'XX....XX', 'XX....XX', 'XXXXXXXX', 'XXXXXXXX', '........', '........']),
    'Lambda': (0x39B, [
        '...XX...', '...XX...', '..XXXX..', '..XXXX..', '.XX..XX.',
        '.XX..XX.', 'XX....XX', 'XX....XX', 'XX....XX', 'XX....XX', '........', '........']),
    'Sigma': (0x3A3, [
        'XXXXXXX', 'XXXXXXX', '.XX....', '..XX...', '...XX..',
        '...XX..', '..XX...', '.XX....', 'XXXXXXX', 'XXXXXXX', '.......', '.......']),
    'beta': (0x3B2, [
        '.XXXXX.', 'XXXXXXX', 'XX...XX', 'XX...XX', 'XXXXXX.',
        'XXXXXXX', 'XX...XX', 'XX...XX', 'XXXXXXX', 'XXXXXX.', 'XX.....', 'XX.....']),
    'lambda': (0x3BB, [
        'XXX....', '.XXX...', '..XX...', '..XXX..', '..XXX..',
        '.XXXXX.', '.XX.XX.', 'XXX.XXX', 'XX...XX', 'XX...XX', '.......', '.......']),
    'rho': (0x3C1, [
        '.......', '.......', '.XXXXX.', 'XXXXXXX', 'XX...XX',
        'XX...XX', 'XX...XX', 'XX...XX', 'XXXXXXX', 'XXXXXX.', 'XX.....', 'XX.....']),
}


def draw(rows):
    pen = TTGlyphPen(None)
    for r, row in enumerate(rows):
        y = (9 - r) * PX
        for c, ch in enumerate(row):
            if ch != 'X':
                continue
            x = c * PX
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
