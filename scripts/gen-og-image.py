#!/usr/bin/env python3
"""Generate the bundled default Open Graph image (1200x630) with no third-party
deps. Brand palette matches public/css/style.css. Run from the repo root:

    python3 scripts/gen-og-image.py

Output: public/images/og-default.png
"""
import os
import struct
import zlib

W, H = 1200, 630

# Brand colors (style.css): pine-deep bg, paper wordmark, gold accent.
BG = (20, 61, 47)        # #143d2f
INK = (243, 238, 227)    # #f3eee3
GOLD = (176, 125, 44)    # #b07d2c
PINE = (30, 90, 69)      # #1e5a45

# 5x7 uppercase bitmap font — only the glyphs the wordmark/tagline need.
FONT = {
    'N': ["10001", "11001", "10101", "10101", "10011", "10001", "10001"],
    'A': ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
    'S': ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
    'R': ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
    'C': ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
    'M': ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
    'P': ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
    'I': ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
    'G': ["01111", "10000", "10000", "10111", "10001", "10001", "01111"],
    'L': ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
    'E': ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
    'D': ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
    '.': ["00000", "00000", "00000", "00000", "00000", "00110", "00110"],
    ' ': ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
}

# Row-major RGB framebuffer.
px = bytearray()
for _ in range(H):
    for _ in range(W):
        px += bytes(BG)


def set_px(x, y, color):
    if 0 <= x < W and 0 <= y < H:
        i = (y * W + x) * 3
        px[i:i + 3] = bytes(color)


def fill_rect(x0, y0, w, h, color):
    for y in range(y0, y0 + h):
        for x in range(x0, x0 + w):
            set_px(x, y, color)


def text_width(s, scale):
    return len(s) * 6 * scale - scale  # 5px glyph + 1px gap, trim trailing gap


def draw_text(s, x, y, scale, color):
    cx = x
    for ch in s.upper():
        glyph = FONT.get(ch, FONT[' '])
        for ry, row in enumerate(glyph):
            for rx, bit in enumerate(row):
                if bit == '1':
                    fill_rect(cx + rx * scale, y + ry * scale, scale, scale, color)
        cx += 6 * scale


def draw_centered(s, y, scale, color):
    draw_text(s, (W - text_width(s, scale)) // 2, y, scale, color)


# Top + bottom gold rule for a framed, branded look.
fill_rect(0, 0, W, 12, GOLD)
fill_rect(0, H - 12, W, 12, GOLD)

# Wordmark + tagline, vertically centered.
draw_centered("NASR.", 232, 26, INK)
fill_rect((W - 220) // 2, 440, 220, 6, GOLD)
draw_centered("CAMPAIGN LEDGER", 478, 8, INK)


def png(path, width, height, buf):
    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data +
                struct.pack(">I", zlib.crc32(tag + data) & 0xffffffff))

    raw = bytearray()
    for y in range(height):
        raw.append(0)  # no filter
        raw += buf[y * width * 3:(y + 1) * width * 3]
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    with open(path, "wb") as f:
        f.write(sig)
        f.write(chunk(b"IHDR", ihdr))
        f.write(chunk(b"IDAT", zlib.compress(bytes(raw), 9)))
        f.write(chunk(b"IEND", b""))


out_dir = os.path.join(os.path.dirname(__file__), "..", "public", "images")
os.makedirs(out_dir, exist_ok=True)
out = os.path.join(out_dir, "og-default.png")
png(out, W, H, px)
print("wrote", os.path.relpath(out))
