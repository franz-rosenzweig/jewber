# Jewber's icon: a techelet tile, a white J in Rubik ExtraBold, a gold kippah on it.
#   python3 design/icon.py   -> web/icons/*.png and the Android launcher layers
# Needs design/Rubik.ttf (OFL), from https://github.com/google/fonts/raw/main/ofl/rubik/Rubik%5Bwght%5D.ttf
import sys
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
HERE = Path(__file__).parent
OUT = HERE.parent / 'web' / 'icons'
OUT.mkdir(parents=True, exist_ok=True)
BLUE, GOLD, WHITE = (35, 71, 217), (245, 184, 46), (255, 255, 255)

def draw(size, pad=0.0, round_=True):
    S = 1024
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if round_:
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=230, fill=BLUE)
    else:
        d.rectangle([0, 0, S, S], fill=BLUE)
    font = ImageFont.truetype(str(HERE / 'Rubik.ttf'), int(760 * (1 - pad)))
    try:
        font.set_variation_by_axes([800])
    except Exception:
        pass
    box = d.textbbox((0, 0), 'J', font=font)
    w, h = box[2] - box[0], box[3] - box[1]
    x = (S - w) / 2 - box[0] - 30 * (1 - pad)
    y = (S - h) / 2 - box[1] + 50 * (1 - pad)
    d.text((x, y), 'J', font=font, fill=WHITE)
    # the kippah: a half disc sitting on the J's top bar, toward its right end
    top = y + box[1]
    kw = 300 * (1 - pad)
    kx = x + box[0] + w * 0.62 - kw / 2
    d.pieslice([kx, top - kw / 2 - 18 * (1 - pad), kx + kw, top + kw / 2 - 18 * (1 - pad)], 180, 360, fill=GOLD)
    return im.resize((size, size), Image.LANCZOS)

draw(512).save(OUT / 'icon-512.png')
draw(192).save(OUT / 'icon-192.png')
draw(512, pad=0.2, round_=False).save(OUT / 'maskable-512.png')
draw(180, round_=False).convert('RGB').save(OUT / 'apple-touch-icon.png')
draw(64).save(OUT / 'favicon.png')
print('ok')

# Android: the adaptive icon's foreground (the J and kippah on transparent, inside the 66dp safe
# zone of 108dp) at each density; the tile colour is the background layer (ic_launcher.xml).
RES = HERE.parent / 'android' / 'app' / 'src' / 'main' / 'res'
def foreground(px, mono=False):
    S = 1024
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    tile = draw(S, round_=False)
    # keep only the white J and the gold kippah: everything that isn't the tile's blue
    px_ = tile.load()
    out = im.load()
    for y in range(S):
        for x in range(S):
            r, g, b, a = px_[x, y]
            if a and not (abs(r - BLUE[0]) < 40 and abs(g - BLUE[1]) < 40 and abs(b - BLUE[2]) < 40):
                out[x, y] = (255, 255, 255, a) if mono else (r, g, b, a)
    # 108dp canvas, art inside the middle ~62dp
    canvas = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    art = im.resize((int(S * 0.62), int(S * 0.62)), Image.LANCZOS)
    canvas.paste(art, ((S - art.width) // 2, (S - art.height) // 2), art)
    return canvas.resize((px, px), Image.LANCZOS)
for name, px in {'mdpi': 108, 'hdpi': 162, 'xhdpi': 216, 'xxhdpi': 324, 'xxxhdpi': 432}.items():
    d = RES / f'mipmap-{name}'
    d.mkdir(parents=True, exist_ok=True)
    foreground(px).save(d / 'ic_launcher_fg.png')
    foreground(px, mono=True).save(d / 'ic_launcher_mono.png')
print('android ok')
