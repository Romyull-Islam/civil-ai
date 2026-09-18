"""Generates the CivilMate logo set (pure vector SVG, text converted to outlines). Run: python3 scripts/make-logo.py"""
import math
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

FONT = "/usr/share/fonts/truetype/noto/NotoSans-ExtraBold.ttf"
AMBER_TOP, AMBER_BOTTOM = "#F7B53A", "#E5850B"

def mark(x=0, y=0, size=64, mono=None, bold=False):
    """Amber tile + white C + truss triangle. Coordinates designed on a 64-unit grid."""
    s = size / 64
    def P(px, py): return f"{x + px * s:.2f} {y + py * s:.2f}"
    r, cx, cy, a = 17, 30.5, 32, math.radians(42)
    p1 = (cx + r * math.cos(a), cy - r * math.sin(a)); p2 = (cx + r * math.cos(a), cy + r * math.sin(a))
    fill = mono or "url(#cmTile)"
    ink = "#FFFFFF" if not mono else "#FFFFFF"
    nodes = [(24.6, 37.8), (37.4, 37.8), (31.0, 26.8)] if bold else [(25.2, 37.4), (36.8, 37.4), (31.0, 27.4)]
    node_r, edge_w, c_w = (3.9, 3.2, 8.6) if bold else (2.9, 2.1, 7.6)
    edges = " ".join(f"M{P(*nodes[i])} L{P(*nodes[(i + 1) % 3])}" for i in range(3))
    return f'''<rect x="{x + 2 * s:.2f}" y="{y + 2 * s:.2f}" width="{60 * s:.2f}" height="{60 * s:.2f}" rx="{14 * s:.2f}" fill="{fill}"/>
  <path d="M{P(*p1)} A{r * s:.2f} {r * s:.2f} 0 1 0 {P(*p2)}" fill="none" stroke="{ink}" stroke-width="{c_w * s:.2f}" stroke-linecap="round"/>
  <path d="{edges}" fill="none" stroke="{ink}" stroke-width="{edge_w * s:.2f}" stroke-linejoin="round" opacity="0.95"/>
  {"".join(f'<circle cx="{x + nx * s:.2f}" cy="{y + ny * s:.2f}" r="{node_r * s:.2f}" fill="{ink}"/>' for nx, ny in nodes)}'''

GRAD = f'<defs><linearGradient id="cmTile" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{AMBER_TOP}"/><stop offset="1" stop-color="{AMBER_BOTTOM}"/></linearGradient></defs>'

font = TTFont(FONT); gs = font.getGlyphSet(); cmap = font.getBestCmap(); upm = font["head"].unitsPerEm; hmtx = font["hmtx"]
kern = {}
if "kern" in font:
    for t in font["kern"].kernTables: kern.update(t.kernTable)

def text_path(txt, x, baseline, size, tracking=-0.01):
    """Outlines for `txt` starting at x on the given baseline; returns (path d, advance)."""
    sc = size / upm; d = []; pen_x = x; prev = None
    for ch in txt:
        g = cmap[ord(ch)]
        if prev and (prev, g) in kern: pen_x += kern[(prev, g)] * sc
        sp = SVGPathPen(gs)
        gs[g].draw(TransformPen(sp, (sc, 0, 0, -sc, pen_x, baseline)))
        d.append(sp.getCommands())
        pen_x += hmtx[g][0] * sc + tracking * size
        prev = g
    return " ".join(d), pen_x - x

def logo(civil_color, mate_color, mono=None, fname=""):
    size, h = 44, 64
    d1, w1 = text_path("Civil", 78, 47, size)
    d2, w2 = text_path("Mate", 78 + w1 + 1, 47, size)
    width = math.ceil(78 + w1 + 1 + w2 + 4)
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {h}" width="{width * 4}" height="{h * 4}" role="img" aria-label="CivilMate">
  <title>CivilMate</title>
  {GRAD if not mono else ""}
  {mark(0, 0, 64, mono)}
  <path d="{d1}" fill="{civil_color}"/>
  <path d="{d2}" fill="{mate_color}"/>
</svg>
'''
    open(f"public/brand/{fname}", "w").write(svg)

def mark_file(fname, mono=None, size=64, bold=False):
    open(f"public/brand/{fname}", "w").write(f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="{size}" height="{size}" role="img" aria-label="CivilMate">
  <title>CivilMate</title>
  {GRAD if not mono else ""}
  {mark(0, 0, 64, mono, bold)}
</svg>
''')

mark_file("civilmate-mark.svg")
mark_file("civilmate-mark-mono.svg", mono="#14171C")
logo("#F2F4F7", "#F5A524", fname="civilmate-logo-dark-bg.svg")
logo("#14171C", "#D97F06", fname="civilmate-logo-light-bg.svg")
logo("#14171C", "#14171C", mono="#14171C", fname="civilmate-logo-mono.svg")
mark_file("civilmate-mark-small.svg", bold=True)
open("src/app/icon.svg", "w").write(open("public/brand/civilmate-mark-small.svg").read())
print("written: public/brand/*.svg and src/app/icon.svg")
