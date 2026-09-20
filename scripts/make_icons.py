# Generate SPOT's app icons from the mark the design actually specifies.
#
# From design-handoff/SPOT iOS App.dc.html, the brand tile is:
#   78x78, border-radius 20px, background #101014
#   inside it, centred: a 34px circle with a 5px #C6FF3D border
#   inside that, inset 8px: an 18px filled #C6FF3D circle
#
# Every ratio below comes from those numbers, so the launcher icon is the same
# mark the app draws on its own screens rather than something redrawn by eye.
import os
from PIL import Image, ImageDraw

INK = (16, 16, 20, 255)        # #101014
VOLT = (198, 255, 61, 255)     # #C6FF3D
WHITE = (255, 255, 255, 255)

# ratios of the 78px design tile
RING_D = 34 / 78      # 0.4359 — outer diameter of the ring
RING_W = 5 / 78       # 0.0641 — ring stroke
DOT_D = 18 / 78       # 0.2308 — the filled centre

SS = 8  # supersample factor; circles get their edges from the downscale


def draw_mark(size, colour=VOLT, scale=1.0, bg=None, radius_ratio=None):
    """The mark on `bg` (or transparent), at `size` px square."""
    s = size * SS
    img = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    if bg is not None:
        if radius_ratio:
            d.rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * radius_ratio), fill=bg)
        else:
            d.rectangle([0, 0, s, s], fill=bg)

    c = s / 2
    ring_outer = s * RING_D * scale
    ring_w = s * RING_W * scale
    dot = s * DOT_D * scale

    # The ring: an outlined circle. `width` grows inwards from the bounding box,
    # exactly like a CSS border on a border-box element.
    r = ring_outer / 2
    d.ellipse([c - r, c - r, c + r, c + r], outline=colour, width=max(1, int(round(ring_w))))

    rd = dot / 2
    d.ellipse([c - rd, c - rd, c + rd, c + rd], fill=colour)

    return img.resize((size, size), Image.LANCZOS)


def save(img, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, 'PNG')
    print(f'  {path}  {img.size[0]}x{img.size[1]}  {os.path.getsize(path)} B')


out = 'assets/images'
print('SPOT icons:')

# 1. iOS / general icon — the full tile, square (the OS applies its own mask).
#    Scaled up from the design's 43.6%: a launcher icon reads better with the
#    mark a little larger than it sits in an in-app tile.
save(draw_mark(1024, VOLT, scale=1.28, bg=INK), f'{out}/icon.png')

# 2. Android adaptive foreground. The mask crops to the centre ~66%, so the mark
#    is drawn smaller here — at the icon's own proportion it would be clipped by
#    a circular mask on some launchers.
save(draw_mark(1024, VOLT, scale=1.0), f'{out}/android-icon-foreground.png')

# 3. Adaptive background: flat ink. A PNG rather than only `backgroundColor`
#    because app.json still names one, and a backgroundImage OVERRIDES the
#    colour — which is why changing the colour alone fixed the splash and not
#    the launcher.
bgimg = Image.new('RGBA', (1024, 1024), INK)
save(bgimg, f'{out}/android-icon-background.png')

# 4. Themed (monochrome) icon: Android tints it, so it must be one flat shape on
#    transparency — no colour of its own.
save(draw_mark(1024, WHITE, scale=1.0), f'{out}/android-icon-monochrome.png')

# 5. Splash: the mark alone on transparency. expo-splash-screen paints #101014
#    behind it (app.json), so a tile here would draw a square inside a square.
save(draw_mark(512, VOLT, scale=2.1), f'{out}/splash-icon.png')

# 6. Web favicon.
save(draw_mark(64, VOLT, scale=1.28, bg=INK, radius_ratio=0.22), f'{out}/favicon.png')
