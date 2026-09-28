"""Build docs/site/: the public pages the Marketplace listing links to (homepage, support, privacy,
license, third-party notices, the access request page, the admin page). index.html, support.html,
request.html, admin.html and services.json (the service addresses both pages and the extension read)
are hand-written and left as they are; this copies the current LICENSE.txt and renders PRIVACY.md and
THIRD_PARTY_NOTICES.md to HTML with pandoc.
Publish the folder at https://openspineconsortium.com/ashley/ (copy into the site repository's
ashley/ folder). Run: python tools/site_build.py
"""
import os
import shutil
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, ".."))
EXT = os.path.join(REPO, "extension")
SITE = os.path.join(REPO, "docs", "site")
PANDOC = shutil.which("pandoc") or r"C:\Program Files\Pandoc\pandoc.exe"
CSS = """<style>
:root{--ink:#1c1c1c;--muted:#555;--line:#ddd;--accent:#1f3b2e;--bg:#fff}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--ink:#e8e8e8;--muted:#b0b0b0;--line:#333;--accent:#8fd3b0;--bg:#121212}}
:root[data-theme="dark"]{--ink:#e8e8e8;--muted:#b0b0b0;--line:#333;--accent:#8fd3b0;--bg:#121212}
body{margin:0;padding:0 16px 48px;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,"Segoe UI",Helvetica,Arial,sans-serif;max-width:760px;margin-inline:auto}
h1{font-size:1.8em;margin:32px 0 4px}h2{font-size:1.2em;margin:28px 0 8px;color:var(--accent)}a{color:var(--accent)}
table{border-collapse:collapse;width:100%;font-size:.95em}td,th{border:1px solid var(--line);padding:6px 8px;vertical-align:top;text-align:left}
pre{white-space:pre-wrap;border:1px solid var(--line);padding:8px;font-size:.9em}
</style>"""


def render(md_path, out_path, title):
    subprocess.run([PANDOC, md_path, "-o", out_path, "--standalone", "--metadata", f"title={title}", "--metadata", "lang=en", "-f", "markdown+pipe_tables", "-t", "html5"], check=True)
    html = open(out_path, encoding="utf-8").read().replace("</head>", CSS + "\n</head>", 1)
    open(out_path, "w", encoding="utf-8", newline="\n").write(html)


def main():
    os.makedirs(SITE, exist_ok=True)
    shutil.copyfile(os.path.join(EXT, "LICENSE.txt"), os.path.join(SITE, "license.txt"))
    shutil.copyfile(os.path.join(EXT, "LICENSE-FULL.txt"), os.path.join(SITE, "license-full.txt"))
    render(os.path.join(EXT, "PRIVACY.md"), os.path.join(SITE, "privacy.html"), "Ashley privacy statement")
    render(os.path.join(EXT, "THIRD_PARTY_NOTICES.md"), os.path.join(SITE, "third_party_notices.html"), "Ashley third-party notices")
    print("site built:", sorted(os.listdir(SITE)))


if __name__ == "__main__":
    main()
