"""Write the Windows Sandbox file that tries Beethoven for VS Code on a clean Windows: nothing on the machine but
what bootstrap.ps1 puts there (VS Code and the extension). The file carries absolute host paths,
so it is written per checkout and not committed.

  python tools/sandbox/make_wsb.py                  -> tools/sandbox/Beethoven-VirginWindows.wsb (installs the VSIX in dist/)
  python tools/sandbox/make_wsb.py --marketplace    -> tools/sandbox/Beethoven-VirginWindows-Marketplace.wsb (installs from the Marketplace)
  python tools/sandbox/make_wsb.py --memory 8192    give the sandbox more memory (MB; 4096 by default)

Then double-click the .wsb. README.md in this folder says what to test and what the sandbox lacks.
"""
import argparse
import glob
import os
import sys
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
DIST = os.path.join(REPO, "dist")
DESKTOP = r"C:\Users\WDAGUtilityAccount\Desktop"  # the sandbox's one user; the same on every machine
# the item since 4.0.0; openspineconsortium.ashley, the retired item, serves Ashley for VS Code 3.0.0
MARKETPLACE_ID = "openspineconsortium.beethoven"
# VS Code, Edge for the sign-ins and the installer fit in 4 GB with room to spare; the sandbox
# gives memory it does not use back to the host, so more costs nothing while it is idle.
MEMORY_MB = 4096
# host folder -> sandbox folder, both read-only: the sandbox can never write to the checkout
FOLDERS = [(DIST, DESKTOP + r"\beethoven-dist"), (HERE, DESKTOP + r"\sandbox")]


def newest_vsix():
    """The VSIX bootstrap.ps1 will install: the most recently modified dist/beethoven-*.vsix (same rule there;
    the ashley-*.vsix beside it are the builds before the rename and are never picked)."""
    found = glob.glob(os.path.join(DIST, "beethoven-*.vsix"))
    found.sort(key=lambda p: (os.path.getmtime(p), os.path.basename(p)), reverse=True)
    return found[0] if found else None


def build(marketplace, memory_mb):
    """The .wsb document (Windows Sandbox's configuration XML)."""
    root = ET.Element("Configuration")
    ET.SubElement(root, "VGpu").text = "Default"
    ET.SubElement(root, "Networking").text = "Default"
    # Disable is the documented spelling of "off": the protected client mode runs the sandbox's
    # apps in an extra container that keeps the logon command away from the mapped folders.
    ET.SubElement(root, "ProtectedClient").text = "Disable"
    ET.SubElement(root, "MemoryInMB").text = str(memory_mb)
    mapped = ET.SubElement(root, "MappedFolders")
    for host, inside in FOLDERS:
        m = ET.SubElement(mapped, "MappedFolder")
        ET.SubElement(m, "HostFolder").text = host
        ET.SubElement(m, "SandboxFolder").text = inside
        ET.SubElement(m, "ReadOnly").text = "true"
    command = "cmd /c " + DESKTOP + r"\sandbox\bootstrap.cmd" + (" -Marketplace" if marketplace else "")
    ET.SubElement(ET.SubElement(root, "LogonCommand"), "Command").text = command
    ET.indent(root, space="  ")
    return ET.tostring(root, encoding="unicode") + "\n"


def check(path):
    """Read the file back the way Windows Sandbox will: well-formed XML, the folders present on the host."""
    root = ET.parse(path).getroot()
    if root.tag != "Configuration":
        raise SystemExit(f"{path}: root element is {root.tag}, not Configuration")
    hosts = [m.findtext("HostFolder") for m in root.iter("MappedFolder")]
    missing = [h for h in hosts if not os.path.isdir(h)]
    if missing:
        raise SystemExit(f"{path}: mapped host folder missing (the sandbox would refuse to start): {', '.join(missing)}")
    command = root.findtext("LogonCommand/Command")
    if not command or "bootstrap.cmd" not in command:
        raise SystemExit(f"{path}: no logon command")
    return hosts, command


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--marketplace", action="store_true", help=f"install {MARKETPLACE_ID} from the Marketplace instead of the VSIX in dist/")
    ap.add_argument("--memory", type=int, default=MEMORY_MB, metavar="MB", help=f"memory for the sandbox in MB (default {MEMORY_MB})")
    args = ap.parse_args(argv[1:])
    if os.name != "nt":
        print("run this with the Windows python: the .wsb needs Windows paths and Windows Sandbox runs only there")
        return 1
    if args.memory < 2048:
        print(f"--memory {args.memory}: Windows Sandbox needs at least 2048 MB")
        return 1
    vsix = None
    if not args.marketplace:
        vsix = newest_vsix()
        if not vsix:
            print(f"no beethoven-*.vsix in {DIST}: package first (cd extension && npm run package) or use --marketplace")
            return 1
    name = "Beethoven-VirginWindows-Marketplace.wsb" if args.marketplace else "Beethoven-VirginWindows.wsb"
    out = os.path.join(HERE, name)
    with open(out, "w", encoding="utf-8", newline="\n") as f:
        f.write(build(args.marketplace, args.memory))
    hosts, command = check(out)
    print(f"wrote {out}")
    for host, (_, inside) in zip(hosts, FOLDERS):
        print(f"  {host}  ->  {inside} (read-only)")
    print(f"  logon: {command}")
    print(f"  memory: {args.memory} MB")
    if vsix:
        print(f"will install: {os.path.basename(vsix)} (the newest VSIX in dist/)")
    else:
        print(f"will install: {MARKETPLACE_ID} from the Marketplace")
    print("double-click the .wsb to start; the report appears on the sandbox desktop as sandbox-report.txt")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
