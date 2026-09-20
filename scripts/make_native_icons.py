# Regenerate the NATIVE Android icon resources with the SPOT mark.
#
# app.json was already pointing at SPOT's own images, but android/ holds the
# icons the launcher actually shows, and those are generated ONCE by
# `expo prebuild` and then never touched again. They still carried the Expo
# logo — which is why the icon looked fixed in some places and not in others.
#
# Regenerated in place rather than by re-running prebuild, because prebuild
# WIPES android/ — the release keystore and the SPOT_UPLOAD_* block in
# gradle.properties go with it.
import os
import sys

from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from make_icons import draw_mark, INK, VOLT, WHITE  # noqa: E402

RES = 'android/app/src/main/res'

# (density, legacy px, adaptive px) — read off the files being replaced.
DENSITIES = [
    ('mdpi', 48, 108),
    ('hdpi', 72, 162),
    ('xhdpi', 96, 216),
    ('xxhdpi', 144, 324),
    ('xxxhdpi', 192, 432),
]

# Splash: expo-splash-screen renders `splashscreen_logo` at imageWidth=76dp over
# #101014, so the logo is the bare mark on transparency.
SPLASH = [('mdpi', 288), ('hdpi', 432), ('xhdpi', 576), ('xxhdpi', 864), ('xxxhdpi', 1152)]


def save_webp(img, path):
    img.save(path, 'WEBP', lossless=True, quality=100)
    print(f'  {path.replace(RES + "/", "")}  {img.size[0]}px  {os.path.getsize(path)} B')


print('Android launcher icons:')
for density, legacy, adaptive in DENSITIES:
    d = f'{RES}/mipmap-{density}'

    # Legacy square icon: the full tile, rounded like the design's 20/78.
    tile = draw_mark(legacy, VOLT, scale=1.28, bg=INK, radius_ratio=20 / 78)
    save_webp(tile, f'{d}/ic_launcher.webp')

    # Legacy round icon: same tile, circular.
    r = draw_mark(legacy * 8, VOLT, scale=1.28, bg=INK)
    mask = Image.new('L', (legacy * 8, legacy * 8), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, legacy * 8 - 1, legacy * 8 - 1], fill=255)
    r.putalpha(mask)
    save_webp(r.resize((legacy, legacy), Image.LANCZOS), f'{d}/ic_launcher_round.webp')

    # Adaptive layers. The mask crops to the centre ~66%, so the mark sits at
    # the design's own proportion rather than the enlarged launcher one.
    save_webp(draw_mark(adaptive, VOLT, scale=1.0), f'{d}/ic_launcher_foreground.webp')
    save_webp(Image.new('RGBA', (adaptive, adaptive), INK), f'{d}/ic_launcher_background.webp')
    # Themed icons are tinted by the system: one flat shape, no colour of its own.
    save_webp(draw_mark(adaptive, WHITE, scale=1.0), f'{d}/ic_launcher_monochrome.webp')

print('Splash logo:')
for density, px in SPLASH:
    p = f'{RES}/drawable-{density}/splashscreen_logo.png'
    img = draw_mark(px, VOLT, scale=2.1)
    img.save(p, 'PNG')
    print(f'  {p.replace(RES + "/", "")}  {px}px  {os.path.getsize(p)} B')
