"""Classifier sanity on synthetic poses: idle must win when nothing is happening,
and each static gesture must be the top non-idle class while it's held."""

from classifier import IDLE, PoseClassifier
from fixtures import bowing, heart, kneeling, leaning_close, opened, standing


def run(frames):
    clf = PoseClassifier()
    r = None
    for i, p in enumerate(frames):
        r = clf.update(p, now=i / 30)
    return r


def hold(p, seconds=1.0):
    return [p] * int(seconds * 30)


def top_gesture(r):
    return max((n for n in r.probs if n != IDLE), key=lambda n: r.probs[n])


def check(label, cond, detail=""):
    print(f"  {'ok ' if cond else 'FAIL'} {label} {detail}")
    return cond

results = []
r = run(hold(standing))
results.append(check("standing -> idle wins", r.winner == IDLE, f"idle={r.probs[IDLE]:.2f}"))
results.append(check("standing -> idle >= 0.6", r.probs[IDLE] >= 0.6, f"{r.probs[IDLE]:.2f}"))

r = run(hold(None, 0.5))
results.append(check("no player -> idle", r.winner == IDLE and r.probs[IDLE] > 0.9, f"{r.probs[IDLE]:.2f}"))

for label, p, want in [("kneeling", kneeling, "kneel"), ("bowing", bowing, "bow"),
                       ("heart hands", heart, "heart"), ("leaning in close", leaning_close, "kiss")]:
    r = run(hold(p))
    results.append(check(f"{label} -> top is {want}", top_gesture(r) == want, f"top={top_gesture(r)} p={r.probs[top_gesture(r)]:.2f}"))
    results.append(check(f"{label} -> {want} beats idle", r.winner == want, f"idle={r.probs[IDLE]:.2f}"))

# Arms up with feet apart (a jack's open frame, no cycles yet) must NOT be forced into a gesture.
r = run(hold(opened))
results.append(check("one open jack frame -> idle or weak", r.winner in (IDLE, "jacks"), f"winner={r.winner}"))

# A completed detector reports `fired` once and then resets after the latch.
clf = PoseClassifier(latch_s=0.5)
fired = [clf.update(kneeling, now=i / 30).fired for i in range(60)]
results.append(check("kneel fires once in the first second", fired[:30].count("kneel") == 1, f"{fired[:30].count('kneel')}"))
results.append(check("…and again after the latch if still held", fired[30:].count("kneel") == 1, f"{fired[30:].count('kneel')}"))
later = clf.update(standing, now=3.0)
results.append(check("after latch, kneel resets", not clf.detectors["kneel"].done))

print(f"\n{sum(results)}/{len(results)} passed")
raise SystemExit(0 if all(results) else 1)
