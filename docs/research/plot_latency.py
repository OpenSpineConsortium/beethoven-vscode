"""Plot the prompt-path latency measurements (docs/research/latency_*.csv) as one dot plot.

  python docs/research/plot_latency.py      -> docs/figures/latency.png (+ .svg)

One series, one hue; each row is a path, the dot is the median, the thin line the min..max
of the samples, the value is written beside the dot. Log axis: the paths span 50 ms to 30 s.
"""
import csv, os, statistics
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

HERE = os.path.dirname(os.path.abspath(__file__))
FIG = os.path.join(os.path.dirname(HERE), "figures")
rows = {}
for name in ("latency_baseline.csv", "latency_node.csv", "latency_relay.csv"):
    p = os.path.join(HERE, name)
    if not os.path.exists(p):
        continue
    for r in csv.reader(open(p, encoding="utf-8")):
        if len(r) != 3 or r[0].startswith("#") or r[0] == "path" or r[2] == "NA":
            continue
        try:
            rows.setdefault(r[0], []).append(float(r[2]))
        except ValueError:
            pass

LABELS = [
    ("ssh_node", "ssh to the compute node\n(jump host, node sshd delay)"),
    ("ssh_login", "ssh to the login node\n(one connection)"),
    ("send_call_ssh", "send: one ssh per prompt\n(command returns)"),
    ("receipt_ssh", "prompt received by the worker\nvia one ssh per prompt"),
    ("ping_relay", "relay round trip\n(open session)"),
    ("ack_relay", "relay: queued on the grid\n(ack back on the laptop)"),
    ("receipt_relay", "prompt received by the worker\nvia the relay"),
]
data = [(lab, rows[k]) for k, lab in LABELS if k in rows and rows[k]]

plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 10})
fig, ax = plt.subplots(figsize=(8.6, 0.55 * len(data) + 1.6), dpi=160)
ink = "#1e1e1e"
hue = "#0b573c"
for i, (lab, xs) in enumerate(reversed(data)):
    med = statistics.median(xs)
    lo, hi = min(xs), max(xs)
    ax.plot([lo, hi], [i, i], color=hue, lw=1.2, alpha=0.6, solid_capstyle="round")
    ax.plot([med], [i], "o", color=hue, ms=7, mec="white", mew=1.5)
    ax.text(hi * 1.15, i, f"{med/1000:.2f} s" if med >= 1000 else f"{med:.0f} ms", va="center", ha="left", color=ink, fontsize=9.5)
ax.set_yticks(range(len(data)))
ax.set_yticklabels([lab for lab, _ in reversed(data)], fontsize=9.5)
ax.set_xscale("log")
ax.set_xlim(10, 300000)
ax.set_xticks([10, 100, 1000, 10000, 100000])
ax.set_xticklabels(["10 ms", "100 ms", "1 s", "10 s", "100 s"])
ax.set_xticks([], minor=True)
ax.grid(axis="x", color="#d9ded9", lw=0.6)
for s in ("top", "right", "left"):
    ax.spines[s].set_visible(False)
ax.spines["bottom"].set_color("#9aa")
ax.tick_params(axis="y", length=0)
ax.set_title("Getting a prompt to the grid Claude worker (median, range)", fontsize=10.5, loc="left", color=ink)
fig.text(0.01, 0.005, "Windows 11 laptop, Wayne State grid, 2026-09-28. Receipt = worker's claim time minus the laptop's send time.", fontsize=8, color="#555")
fig.tight_layout(rect=(0, 0.03, 1, 1))
os.makedirs(FIG, exist_ok=True)
fig.savefig(os.path.join(FIG, "latency.png"))
fig.savefig(os.path.join(FIG, "latency.svg"))
for lab, xs in data:
    print(f"{lab.splitlines()[0]:45s} n={len(xs)} median={statistics.median(xs):8.0f} ms  min={min(xs):8.0f}  max={max(xs):8.0f}")
print("wrote", os.path.join(FIG, "latency.png"))
