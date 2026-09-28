"""Build docs/manual.html and docs/manual.pdf from the markdown sources.

  python docs/manual/build_manual.py            (from the repository root)

Order: pitch, getting started, how it works (ARCHITECTURE + figures), limits, install,
troubleshooting, appendix pointers. pandoc embeds the SVG figures and the CSS; Edge headless
prints the PDF; the HTML is also copied into extension/media so "Ashley: Open the manual" shows it.
"""
from __future__ import annotations
import os, re, shutil, subprocess, sys, datetime
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DOCS = os.path.join(ROOT, "docs")
MAN = os.path.join(DOCS, "manual")
BUILD = os.path.join(DOCS, "build")
os.makedirs(BUILD, exist_ok=True)

def read(rel):
    with open(os.path.join(DOCS, rel), encoding="utf-8") as f:
        return f.read()

def demote(md, by=1):
    """Shift headings so each source file's H1 becomes a section under the manual's H1."""
    return re.sub(r"^(#{1,5}) ", lambda m: "#" * min(6, len(m.group(1)) + by) + " ", md, flags=re.M)

def figure(path, caption):
    return f"\n![{caption}]({path})\n\n"

parts = []
today = datetime.date.today().isoformat()
parts.append(f"""---
title: "Ashley"
subtitle: "The Wayne State grid and Claude Code, from one wizard. Manual, version 1.0.0"
date: "{today}"
---

> Ashley is a VS Code extension for medical students in OpenSpineConsortium projects. It sets up the laptop for the Wayne State HPC grid, keeps a Claude Code worker running there on the student's own subscription, and lets the Claude Code extension on the laptop hand work to it. This manual is the pitch, the first hour, how it works, what you can and cannot ask, installation, and troubleshooting. The design notes and the research behind them are in the repository (`docs/ARCHITECTURE.md`, `docs/RESEARCH.md`).

""")
parts.append("# Why\n\n" + demote(read("PITCH.md")).split("\n", 1)[1])
gs = read("manual/00_getting_started.md").replace("](figures/", "](../figures/")
parts.append("# Getting started\n\n" + demote(gs).split("\n", 1)[1])
arch = read("ARCHITECTURE.md")
arch = demote(arch).split("\n", 1)[1]
# insert the rendered figures beside the ASCII sketch and the queue section
arch = arch.replace("## Topology\n", "## Topology\n" + figure("../figures/topology.svg", "The three places and what runs in each; every laptop action is one ssh to the login node."), 1)
arch = arch.replace("## The request queue\n", "## The request queue\n" + figure("../figures/lifecycle.svg", "One request, from the laptop's ssh to the RESULT line."), 1)
arch = arch.replace("## Credentials\n", "## Credentials\n" + figure("../figures/accounts.svg", "Rotation among a student's own credentials; a limit becomes a cooldown, not a failure."), 1)
parts.append("# How it works\n\n" + arch)
parts.append("# What you can ask, and what you cannot\n\n" + demote(read("LIMITS.md")).split("\n", 1)[1])
parts.append("# Installing and building\n\n" + demote(read("INSTALL.md")).split("\n", 1)[1])
parts.append("# Troubleshooting\n\n" + demote(read("manual/90_troubleshooting.md")).split("\n", 1)[1])
parts.append("""# Appendix

- `docs/RESEARCH.md`: the research behind the design (Claude Code headless mode, subscription limits and terms, containers on this grid, multi-account tools, orchestration patterns, VS Code Remote-SSH on old glibc, Xcode, literature APIs), with sources and which findings were independently verified.
- `docs/CHECKPOINT_2026-09-28.md`: the state of the project on the day this manual was built, including what was tested and what was not.
- `Student_Projects/RECIPE.md`: the lab's method; Ashley is the on-ramp to it.
- C&IT: "How to SSH to the Grid in Visual Studio Code" and "How do I set up and use Google Authenticator for the Grid" (services.wayne.edu knowledge base).
""")
src = os.path.join(BUILD, "manual.md")
with open(src, "w", encoding="utf-8") as f:
    f.write("\n\n".join(parts))

pandoc = shutil.which("pandoc") or r"C:\Program Files\Pandoc\pandoc.exe"
html = os.path.join(DOCS, "manual.html")
cmd = [pandoc, src, "-o", html, "--standalone", "--embed-resources", "--toc", "--toc-depth=2", "--css", os.path.join(MAN, "style.css"),
       "--resource-path", MAN + os.pathsep + DOCS, "--metadata", "lang=en", "-f", "markdown+pipe_tables+yaml_metadata_block", "-t", "html5"]
print(" ".join(cmd))
subprocess.run(cmd, check=True)
size = os.path.getsize(html)
print(f"wrote {html} ({size//1024} KB)")

# copy into the extension so the command "Ashley: Open the manual" can show it offline
media = os.path.join(ROOT, "extension", "media", "manual.html")
shutil.copyfile(html, media)
print("copied to", media)

# PDF via Edge (or Chrome) headless
pdf = os.path.join(DOCS, "manual.pdf")
browsers = [r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe", r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
            r"C:\Program Files\Google\Chrome\Application\chrome.exe", shutil.which("msedge") or "", shutil.which("google-chrome") or "", shutil.which("chromium") or ""]
browser = next((b for b in browsers if b and os.path.exists(b)), None)
if browser:
    if os.path.exists(pdf):
        os.remove(pdf)
    cmd = [browser, "--headless=new", "--disable-gpu", "--no-pdf-header-footer", f"--print-to-pdf={pdf}", "file:///" + html.replace("\\", "/")]
    print(" ".join(cmd))
    subprocess.run(cmd, check=False, timeout=180)
    if os.path.exists(pdf):
        print(f"wrote {pdf} ({os.path.getsize(pdf)//1024} KB)")
    else:
        print("PDF not produced", file=sys.stderr)
else:
    print("no Edge/Chrome found for the PDF", file=sys.stderr)
