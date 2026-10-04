"""Render docs/research/dependency_map_2026-09-28.json (the dependency study) as docs/DEPENDENCY_MAP.md.

The study's four mappers read the code independently, so some ids appear more than once; they are
merged here (the longest text wins, failure signatures are united). Run: python tools/depmap_doc.py
"""
import json
import os
from collections import OrderedDict

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "..", "docs", "research", "dependency_map_2026-09-28.json")
OUT = os.path.join(HERE, "..", "docs", "DEPENDENCY_MAP.md")

# The study is a dated record and stays as it was read; where a later version changed an entry, the
# change is said here, above the entry, instead of editing the record.
SINCE = {
    "account.anthropic-api-key": "Since 5.0.0 (2026-10-04) there is no API key: none is asked for, stored, copied or used. "
    "A key 4.0.0 stored is never used or sent; on the grid an empty `disabled` file is put beside it, the switch a worker "
    "still on grid scripts 7 honours, and `grid.accounts` reports it until `beethoven accounts remove --yes` deletes it; on "
    "the laptop Manage stored tokens or Reset deletes it. The entry below describes 4.0.0, except the step by hand, "
    "which is today's.",
    "account.claude-usage-window": "Since 5.0.0 there is no rotation and no overflow onto an API key: a spent window is "
    "answered `rate_limited` with `retry_after`, and the request is sent again after the reset. No API key and no usage "
    "credits, by anyone: extra usage (usage credits) on the Claude account is the student's to keep off. The assumption, "
    "the repair and the step by hand below are today's; the study's text of 4.0.0 stays in the JSON record.",
    "grid-login.uninstall-clean": "Since grid scripts 9 (5.0.0) `beethoven uninstall --yes`, at a terminal, removes only "
    "what install made (bin/, config.env, READY, log/, workers/, the bashrc block, the links it made) and keeps the Claude "
    "sign-in, accounts/, engine/, projects/, sessions/ and the work folder; `--purge-root` is refused, and so is any run "
    "under an agent marker or without a terminal. The assumption and the check below are today's.",
    "container.claude-transcript-layout": "Since grid scripts 9 (5.0.0) nothing of ours moves, renames or links anything in "
    "a sign-in folder: the daemon no longer moves projects/ to ~/.beethoven/projects and links it back, and grid.accounts "
    "no longer relinks it. A session resumes from the one sign-in it runs under. The repair and the step by hand below "
    "are today's.",
    "container.claude-env-contract": "Since grid scripts 9 (5.0.0) the variables taken away are hpcworker's list, the same "
    "in five places (extension/src/core/services.ts, grid/beethovend.js and grid/phone.js AUTH_VARS, claude_in_alloc in "
    "grid/beethoven, grid/login_relay.sh); src/core/credentialEnv.test.ts fails when they differ.",
    "lab-folder.permission-layout": "Since grid scripts 9 (5.0.0) `access init` leaves shared/ at 2755 and keeps other's "
    "read and enter on shared/beethoven and below (hpcworker's shared copy and the lab's image; the volume root's "
    "other::--- and its named list are the gate); every other entry of shared/ stays 2750, and an rwx entry on the "
    "volume root is never lowered to --x.",
    "lab-folder.library-publish": "Since grid scripts 9 (5.0.0) a publish takes away group and other write only and "
    "keeps other's read and enter, so the folder stays 2755.",
}

# Where the study's text would tell a student to do what is ruled out since then, the rendering says what
# holds now, field by field; the record itself is not edited (SINCE says so above the entry).
NOW = {
    "account.anthropic-api-key": {
        "manual_fix": "Nothing to set up: Beethoven uses no API key. To delete a key 4.0.0 stored: Manage stored tokens or "
        "Reset on the laptop, beethoven accounts remove --yes in a terminal on the grid; revoke the key itself in the "
        "Anthropic Console.",
    },
    "grid-login.uninstall-clean": {
        "assumption": "`beethoven uninstall --yes` cancels worker jobs, removes the bashrc block and what install made in "
        "~/.beethoven, and removes ~/.beethoven itself (and a ~/.ashley link to it) only when nothing else is left. It does "
        "NOT cancel a held access job and does not touch the admin-side status file or ACLs, so a reinstalled account can "
        "reappear as filed, pending or approved.",
        "check": "login node, after uninstall: `test ! -e ~/.beethoven/bin && ! grep -q '# >>> beethoven' ~/.bashrc`, and "
        "~/.beethoven/claude, accounts/, engine/ and the work folder unchanged.",
    },
    "container.claude-transcript-layout": {
        "auto_repair": "None: nothing of ours moves or links anything in a sign-in folder.",
        "manual_fix": "Update fake-claude.js to the new layout.",
    },
    "account.claude-usage-window": {
        "assumption": "Pro/Max five-hour and weekly windows have room. The worker runs only on the student's own "
        "subscription: no API key, no usage credits, no other account, never another person's.",
        "auto_repair": "None: the worker answers rate_limited with retry_after and starts nothing until the reset.",
        "manual_fix": "Wait for the reset, then send the request again. No API key, no usage credits.",
    },
}

LAYERS = [
    ("laptop", "Laptop"), ("vscode", "VS Code"), ("network", "Network"), ("account", "Accounts"),
    ("grid-login", "Grid login node"), ("grid-slurm", "Slurm"), ("grid-node", "Compute node"),
    ("container", "Container"), ("lab-folder", "Lab folder"), ("external", "Outside services"),
]


def merge(nodes):
    by = OrderedDict()
    for n in nodes:
        k = n["id"]
        if k not in by:
            by[k] = dict(n, failure_signatures=list(n.get("failure_signatures") or []), depends_on=list(n.get("depends_on") or []))
            continue
        m = by[k]
        for f in ("title", "assumption", "check", "auto_repair", "manual_fix", "future_risk", "source"):
            if len(str(n.get(f) or "")) > len(str(m.get(f) or "")):
                m[f] = n[f]
        for s in n.get("failure_signatures") or []:
            if s not in m["failure_signatures"]:
                m["failure_signatures"].append(s)
        for d in n.get("depends_on") or []:
            if d not in m["depends_on"]:
                m["depends_on"].append(d)
    return list(by.values())


def one(s):
    return " ".join(str(s or "").split())


def main():
    raw = json.load(open(SRC, encoding="utf-8"))["nodes"]
    nodes = [dict(n, **NOW.get(n["id"], {})) for n in merge(raw)]
    out = [
        "# Dependency map",
        "",
        "Everything Beethoven for VS Code relies on, one entry per assumption: what must be true, how to",
        "check it, what a failure looks like, what repairs it and what could break it later. It comes from",
        "a read-only study of the code on 2026-09-28 (four independent readers and a completeness critic;",
        "raw data in `docs/research/dependency_map_2026-09-28.json`). It is the reference behind the",
        "runtime graph in `docs/DIAGNOSTICS.md`: the troubleshooter checks the entries that can be checked",
        "cheaply and often; this map keeps the rest, so a failure that the troubleshooter cannot name can",
        "still be looked up by its message.",
        "",
        f"{len(nodes)} entries ({len(raw)} before merging duplicates). Generated by `tools/depmap_doc.py`.",
        "Claims marked *found by reading* in an entry were not run by the study; `docs/DIAGNOSTICS.md` lists",
        "which of them were later confirmed and fixed.",
        "",
        "The study read the code when the product was called Ashley (Ashley for VS Code, up to 3.0.0), and",
        "its entries keep the names of that day, error messages included. Since 4.0.0 (2026-09-30) read",
        "them this way: `~/.ashley` is `~/.beethoven`, `grid/ashley` and `ashleyd.js` are `grid/beethoven`",
        "and `beethovend.js`, `~/.ashley-local` is `~/.beethoven-local` on a new computer, the `ashley.*`",
        "settings and command ids are `beethoven.*`, the \"Ashley:\" commands are \"Beethoven:\" in the",
        "Command Palette, the `ashley_*` MCP tools are `beethoven_*`, `ashley-cli` is `beethoven-cli`, and",
        "`/rs/rs_grp_oschome/shared/ashley` is `shared/beethoven`. The old paths on disk and on the grid",
        "still work as links, and the old settings and command ids are still read as aliases",
        "(`docs/ARCHITECTURE.md`, \"The names from before 4.0.0\").",
        "",
        "Since 5.0.0 (2026-10-04) there is no API key: the entries about an Anthropic API key, the",
        "`apikey` account, rotation onto it after a limit and `accounts add-key` describe a feature that",
        "was removed (no usage credits, by anyone, ever). A spent subscription window is now answered",
        "`rate_limited` with `retry_after`, and the request is sent again after the reset; a key an",
        "earlier version stored is never used, only marked `disabled` for workers still on grid scripts 7",
        "(`docs/ARCHITECTURE.md`, \"Credentials\").",
        "",
    ]
    known = {k for k, _ in LAYERS}
    for key, title in LAYERS + [("", "Other")]:
        group = [n for n in nodes if (n.get("layer") == key) or (key == "" and n.get("layer") not in known)]
        if not group:
            continue
        out.append(f"## {title} ({len(group)})")
        out.append("")
        for n in group:
            out.append(f"### `{n['id']}` {one(n.get('title'))}")
            out.append("")
            if n["id"] in SINCE:
                out.append(f"> {SINCE[n['id']]}")
                out.append("")
            if n.get("depends_on"):
                out.append("Depends on: " + ", ".join(f"`{d}`" for d in n["depends_on"]))
                out.append("")
            out.append(f"- **Assumes:** {one(n.get('assumption'))}")
            out.append(f"- **Check:** {one(n.get('check'))}")
            sigs = [one(s) for s in n.get("failure_signatures") or [] if one(s)]
            if sigs:
                out.append("- **Looks like:** " + "; ".join(f"`{s.replace('`', '')}`" for s in sigs))
            if one(n.get("auto_repair")):
                out.append(f"- **Repair:** {one(n.get('auto_repair'))}")
            out.append(f"- **By hand:** {one(n.get('manual_fix'))}")
            if one(n.get("future_risk")):
                out.append(f"- **Could break when:** {one(n.get('future_risk'))}")
            if one(n.get("source")):
                out.append(f"- **Code:** {one(n.get('source'))}")
            out.append("")
    open(OUT, "w", encoding="utf-8", newline="\n").write("\n".join(out))
    print(f"{len(nodes)} entries -> {os.path.relpath(OUT)}")


if __name__ == "__main__":
    main()
