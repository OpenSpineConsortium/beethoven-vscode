"""Manage the list of AccessIDs pre-approved to use Ashley (extension/media/allowlist.json).

  python tools/allow.py list
  python tools/allow.py add ab1234 cd5678
  python tools/allow.py remove ab1234

The list ships inside the VSIX, so rebuild after a change (cd extension && npm run package) and
send students the new .vsix. For a list that updates without a rebuild, publish the same JSON at
a URL and set the setting ashley.allowlistUrl.
"""
import json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
PATH = os.path.join(HERE, "..", "extension", "media", "allowlist.json")
ACCESS_ID = re.compile(r"^[a-z]{2}\d{4}$")


def load():
    with open(PATH, encoding="utf-8") as f:
        return json.load(f)


def save(d):
    d["accessIds"] = sorted(set(d["accessIds"]))
    with open(PATH, "w", encoding="utf-8", newline="\n") as f:
        json.dump(d, f, indent=2)
        f.write("\n")


def main(argv):
    if len(argv) < 2 or argv[1] not in ("list", "add", "remove"):
        print(__doc__)
        return 1
    d = load()
    if argv[1] == "list":
        print("\n".join(d["accessIds"]) or "(empty)")
        return 0
    ids = [a.strip().lower() for a in argv[2:]]
    bad = [a for a in ids if not ACCESS_ID.match(a)]
    if bad:
        print(f"not AccessIDs (two letters, four digits): {', '.join(bad)}")
        return 1
    if argv[1] == "add":
        d["accessIds"] += ids
    else:
        d["accessIds"] = [a for a in d["accessIds"] if a not in ids]
    save(d)
    print(f"{len(d['accessIds'])} pre-approved: {', '.join(d['accessIds'])}")
    print("rebuild the VSIX: cd extension && npm run package")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
