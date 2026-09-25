"""Google Play's feature graphic — 1024x500 PNG, generated, not designed by hand.

Play refuses a listing without it. It is the banner at the top of the store page,
and it is the one asset where it is easy to promise something the app does not
do: a collage of fake screenshots, invented numbers, five stars nobody gave. So
this draws the brand and the app's own approved one-line description
(store/listing.md) and nothing else.

    python scripts/make_feature_graphic.py

Writes store/assets/feature-graphic-{az,ru,en}.png. Play wants one per listing
language; the image carries text, so each language gets its own.
"""
import io
import os

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "store", "assets")

W, H = 1024, 500
INK = (16, 16, 20)        # #101014 — the app's background
VOLT = (198, 255, 61)     # #C6FF3D — the one accent colour
WHITE = (255, 255, 255)
MUTED = (150, 150, 158)

FONTS = os.path.join(ROOT, "node_modules", "@expo-google-fonts", "inter")


def font(weight_dir, name, size):
    path = os.path.join(FONTS, weight_dir, name)
    return ImageFont.truetype(path, size)


# The approved copy, character-for-character from store/listing.md. Nothing here
# is written for the picture: if the description changes, it changes here too.
COPY = {
    "az": ("Zalını seç, məşq yoldaşını tap,", "hər məşqini qeyd et."),
    "ru": ("Выбери зал, найди напарника,", "записывай каждую тренировку."),
    "en": ("Pick your gym, find a partner,", "log every workout."),
}
NOTE = {"az": "SPOT ödəniş almır", "ru": "SPOT не принимает оплату", "en": "SPOT takes no payment"}


def build(lang):
    img = Image.new("RGB", (W, H), INK)
    d = ImageDraw.Draw(img)

    # One diagonal, cropped by the frame: a dark wedge with a thin accent stripe
    # lying along its edge, so the two read as a single shape rather than two
    # unrelated corners. Enough to look like the app; not enough to look like a
    # claim about it.
    d.polygon([(W, 0), (W, H), (W - 300, H)], fill=(24, 30, 12))
    d.polygon([(W, 0), (W - 34, 0), (W - 334, H), (W - 300, H)], fill=VOLT)

    # The icon, so the banner and the store tile read as one thing.
    icon_path = os.path.join(ROOT, "assets", "images", "icon.png")
    if os.path.exists(icon_path):
        icon = Image.open(icon_path).convert("RGBA").resize((132, 132), Image.LANCZOS)
        img.paste(icon, (72, 96), icon)

    f_word = font("900Black", "Inter_900Black.ttf", 92)
    f_line = font("500Medium", "Inter_500Medium.ttf", 33)
    f_note = font("600SemiBold", "Inter_600SemiBold.ttf", 25)

    d.text((236, 104), "SPOT", font=f_word, fill=WHITE)

    l1, l2 = COPY[lang]
    d.text((240, 232), l1, font=f_line, fill=(214, 214, 220))
    d.text((240, 278), l2, font=f_line, fill=(214, 214, 220))

    # The one promise on the banner is the one the app can always keep: there is
    # no payment rail in it at all.
    d.rounded_rectangle([240, 348, 240 + int(d.textlength(NOTE[lang], font=f_note)) + 44, 404],
                        radius=28, fill=(30, 38, 14))
    d.text((262, 362), NOTE[lang], font=f_note, fill=VOLT)

    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, f"feature-graphic-{lang}.png")
    img.save(path, "PNG")
    size = os.path.getsize(path)
    # Play's ceiling is 15 MB; a flat-colour PNG this size is far under it, but
    # a silent 20 MB file would be refused at upload with no explanation.
    assert size < 15 * 1024 * 1024, f"{path} is {size} bytes"
    print(f"{os.path.relpath(path, ROOT)}  {img.size[0]}x{img.size[1]}  {size // 1024} KB")


for lang in COPY:
    build(lang)
