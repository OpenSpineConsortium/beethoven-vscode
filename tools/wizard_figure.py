"""Draw docs/figures/wizard.svg: the wizard's steps in their strict order, in three bands.
Run: python tools/wizard_figure.py   (keep the step list in sync with extension/src/core/wizard.ts)
"""
import os

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "docs", "figures", "wizard.svg")

BANDS = [
    ("You and your accounts (kept on this laptop)", "you", [
        ("1", "License", "your key, or a trial"),
        ("2", "Wayne State", "Microsoft sign-in"),
        ("3", "GitHub", "browser, one click"),
        ("4", "Hugging Face", "copy the token"),
        ("5", "Claude here", "Claude Code signed in"),
    ]),
    ("The grid (one pass)", "st", [
        ("6", "Account + 2FA", "OnDemand"),
        ("7", "SSH key", "made for you"),
        ("8", "SSH config", "written for you"),
        ("9", "Log in once", "password + code"),
        ("10", "Install", "scripts, tokens, license"),
    ]),
    ("The lab", "lab", [
        ("11", "Join the lab", "one request; approval = ACL"),
        ("12", "Claude on the grid", "you sign in, once, in a terminal"),
    ]),
]

W, H = 980, 470
BOX_W, BOX_H, GAP = 168, 56, 14
x0 = 30


def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;")


def main():
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="13">',
        '  <defs>',
        '    <marker id="c" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#555"/></marker>',
        '    <style>',
        '      .st{fill:#fff;stroke:#333;stroke-width:1.4;rx:8}',
        '      .you{fill:#fff8e1;stroke:#b8860b;stroke-width:1.4;rx:8}',
        '      .lab{fill:#e8f5e9;stroke:#2e7d32;stroke-width:1.6;rx:8}',
        '      .n{font-weight:600;fill:#222}.s{fill:#555;font-size:11.5px}.b{fill:#333;font-size:12.5px;font-weight:600}',
        '      .a{stroke:#555;stroke-width:1.3;fill:none;marker-end:url(#c)}',
        '      .band{fill:none;stroke:#bbb;stroke-dasharray:4 4;rx:12}',
        '    </style>',
        '  </defs>',
        f'  <text x="{x0}" y="26" font-size="15" font-weight="600" fill="#222">The setup, in order: a step starts only when every step above it is green</text>',
    ]
    y = 46
    prev_last = None
    for title, cls, steps in BANDS:
        band_h = BOX_H + 44
        parts.append(f'  <rect class="band" x="{x0 - 10}" y="{y}" width="{W - 2 * x0 + 20}" height="{band_h}"/>')
        parts.append(f'  <text class="b" x="{x0}" y="{y + 18}">{esc(title)}</text>')
        by = y + 30
        for i, (num, name, sub) in enumerate(steps):
            bx = x0 + i * (BOX_W + GAP)
            parts.append(f'  <rect class="{cls}" x="{bx}" y="{by}" width="{BOX_W}" height="{BOX_H}"/>')
            parts.append(f'  <text class="n" x="{bx + 12}" y="{by + 23}">{num} {esc(name)}</text>')
            parts.append(f'  <text class="s" x="{bx + 12}" y="{by + 42}">{esc(sub)}</text>')
            if i > 0:
                parts.append(f'  <line class="a" x1="{bx - GAP + 1}" y1="{by + BOX_H / 2}" x2="{bx - 2}" y2="{by + BOX_H / 2}"/>')
        if prev_last is not None:
            px, py = prev_last
            parts.append(f'  <path class="a" d="M{px} {py} C {px} {py + 22}, {x0 + BOX_W / 2} {by - 26}, {x0 + BOX_W / 2} {by - 2}"/>')
        prev_last = (x0 + (len(steps) - 1) * (BOX_W + GAP) + BOX_W / 2, by + BOX_H)
        y += band_h + 16
    parts.append(f'  <text class="s" x="{x0}" y="{y + 8}">Renew next to a token signs you in again and updates the grid. Ashley never sees your Claude sign-in: Claude Code makes it and keeps it, on the laptop and in your grid account.</text>')
    parts.append('</svg>')
    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(parts) + "\n")
    print(f"wrote {os.path.relpath(OUT)}")


if __name__ == "__main__":
    main()
