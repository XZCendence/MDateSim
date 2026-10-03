"""Synthetic-pose checks for the gesture detectors. Run: python test_gestures.py

Builds a cartoon skeleton in pixel space (y down), optionally with depth, and
drives each detector through a short timeline. No Kinect needed.
"""

import numpy as np

import gestures as g
from pose import Joint, Pose

J = Joint
SW = 100.0  # shoulder width in px; everything else is relative to it


def skeleton(overrides: dict | None = None) -> dict:
    """Upright person facing the camera, centre x=500, shoulders at y=300. Player's LEFT is image RIGHT."""
    pts = {
        J.NOSE: (500, 230), J.LEFT_EYE: (512, 220), J.RIGHT_EYE: (488, 220),
        J.LEFT_EAR: (522, 225), J.RIGHT_EAR: (478, 225),
        J.LEFT_SHOULDER: (550, 300), J.RIGHT_SHOULDER: (450, 300),
        J.LEFT_ELBOW: (570, 380), J.RIGHT_ELBOW: (430, 380),
        J.LEFT_WRIST: (580, 460), J.RIGHT_WRIST: (420, 460),
        J.LEFT_HIP: (535, 480), J.RIGHT_HIP: (465, 480),
        J.LEFT_KNEE: (535, 620), J.RIGHT_KNEE: (465, 620),
        J.LEFT_ANKLE: (535, 760), J.RIGHT_ANKLE: (465, 760),
    }
    pts.update(overrides or {})
    return pts


def pose(pts: dict, depth: dict | None = None, tilt_deg: float = 0.0, hide: tuple = ()) -> Pose:
    pixels = np.zeros((33, 2), np.float32)
    vis = np.zeros(33, np.float32)
    xyz = np.full((33, 3), np.nan, np.float32)
    local = np.zeros((33, 3), np.float32)
    for j, (x, y) in pts.items():
        pixels[j] = (x, y)
        vis[j] = 0.0 if j in hide else 0.95
        z = (depth or {}).get(j, 2.0)
        if z is not None:
            xyz[j] = ((x - 640) * z / 600, (y - 360) * z / 600, z)
    # MediaPipe metric landmarks: origin mid-hip, y down. Shoulders 0.5 m above hips, tilted forward by tilt_deg.
    t = np.radians(tilt_deg)
    for j in (J.LEFT_SHOULDER, J.RIGHT_SHOULDER):
        local[j] = (0.2 if j == J.LEFT_SHOULDER else -0.2, -0.5 * np.cos(t), -0.5 * np.sin(t))
    return Pose(pixels=pixels, visibility=vis, xyz=xyz, local=local)


def run(detector: g.Gesture, frames: list[tuple[float, Pose | None]]) -> bool:
    """Feed (time, pose) frames; True if the detector fired at any point."""
    return any(detector.update(p, now=t) for t, p in frames)


def hold(p: Pose, seconds: float, start: float = 0.0, fps: int = 30):
    return [(start + i / fps, p) for i in range(int(seconds * fps) + 1)]


def check(label: str, got: bool, want: bool):
    mark = "ok " if got == want else "FAIL"
    print(f"  {mark} {label}: fired={got} (expected {want})")
    return got == want


results = []
print("Kneel")
standing = pose(skeleton())
kneeling = pose(skeleton({J.LEFT_HIP: (535, 560), J.RIGHT_HIP: (465, 560),
                            J.LEFT_KNEE: (535, 640), J.RIGHT_KNEE: (465, 640),
                            J.LEFT_ANKLE: (535, 650), J.RIGHT_ANKLE: (465, 650)}))
squatting = pose(skeleton({J.LEFT_HIP: (535, 580), J.RIGHT_HIP: (465, 580),
                             J.LEFT_KNEE: (560, 620), J.RIGHT_KNEE: (440, 620)}))
results.append(check("standing", run(g.Kneel(), hold(standing, 1.0)), False))
results.append(check("kneeling 1s", run(g.Kneel(), hold(kneeling, 1.0)), True))
results.append(check("kneeling 0.3s only", run(g.Kneel(), hold(kneeling, 0.3)), False))
results.append(check("squat is not kneel", run(g.Kneel(), hold(squatting, 1.0)), False))

print("Bow")
bowing = pose(skeleton({J.NOSE: (500, 330), J.LEFT_EAR: (522, 325), J.RIGHT_EAR: (478, 325),
                          J.LEFT_SHOULDER: (550, 320), J.RIGHT_SHOULDER: (450, 320)}), tilt_deg=60)
shallow = pose(skeleton(), tilt_deg=20)
results.append(check("upright", run(g.Bow(), hold(standing, 1.0)), False))
results.append(check("60° bow", run(g.Bow(), hold(bowing, 1.0)), True))
results.append(check("20° nod", run(g.Bow(), hold(shallow, 1.0)), False))

print("Jumping jacks")
closed = pose(skeleton())
opened = pose(skeleton({J.LEFT_WRIST: (600, 150), J.RIGHT_WRIST: (400, 150),
                          J.LEFT_ANKLE: (600, 760), J.RIGHT_ANKLE: (400, 760)}))
cycle = []
t = 0.0
for _ in range(3):
    cycle += hold(opened, 0.2, t); t += 0.3
    cycle += hold(closed, 0.2, t); t += 0.3
jj = g.JumpingJacks(reps=3)
results.append(check("3 reps counted", run(jj, cycle), True) and jj.count == 3)
jj2 = g.JumpingJacks(reps=5)
results.append(check("3 of 5 not done", run(jj2, cycle), False) and jj2.count == 3)

print("Spin")
facing = pose(skeleton())
away = pose(skeleton({J.LEFT_SHOULDER: (450, 300), J.RIGHT_SHOULDER: (550, 300)}))
sideon = pose(skeleton({J.LEFT_SHOULDER: (505, 300), J.RIGHT_SHOULDER: (495, 300)}))
spin = hold(facing, 0.3, 0) + hold(sideon, 0.3, 0.5) + hold(away, 0.3, 1.0) + hold(sideon, 0.3, 1.5) + hold(facing, 0.3, 2.0)
results.append(check("full spin", run(g.Spin(), spin), True))
results.append(check("half turn only", run(g.Spin(), hold(facing, 0.3, 0) + hold(away, 0.3, 1.0)), False))
slow = hold(facing, 0.3, 0) + hold(away, 0.3, 3.0) + hold(facing, 0.3, 7.0)
results.append(check("too slow (7s)", run(g.Spin(), slow), False))

print("Heart hands")
heart = pose(skeleton({J.LEFT_WRIST: (515, 120), J.RIGHT_WRIST: (485, 120),
                         J.LEFT_ELBOW: (610, 220), J.RIGHT_ELBOW: (390, 220)}))
arms_up_apart = pose(skeleton({J.LEFT_WRIST: (600, 120), J.RIGHT_WRIST: (400, 120),
                                 J.LEFT_ELBOW: (580, 220), J.RIGHT_ELBOW: (420, 220)}))
results.append(check("heart", run(g.HeartHands(), hold(heart, 1.0)), True))
results.append(check("arms up apart", run(g.HeartHands(), hold(arms_up_apart, 1.0)), False))

print("Blow kiss")
at_mouth = pose(skeleton({J.LEFT_WRIST: (505, 258)}), depth={J.LEFT_WRIST: 1.9})
thrown = pose(skeleton({J.LEFT_WRIST: (560, 300)}), depth={J.LEFT_WRIST: 1.6})
flow = hold(at_mouth, 0.3, 0) + hold(thrown, 0.2, 0.4)
results.append(check("hand to mouth then thrown", run(g.BlowKiss(), flow), True))
results.append(check("hand at mouth only", run(g.BlowKiss(), hold(at_mouth, 1.0)), False))
results.append(check("thrown without arming", run(g.BlowKiss(), hold(thrown, 1.0)), False))
late = hold(at_mouth, 0.3, 0) + hold(standing, 1.5, 0.4) + hold(thrown, 0.2, 2.0)
results.append(check("released too late", run(g.BlowKiss(), late), False))

print("Kiss")
leaning_close = pose(skeleton({J.LEFT_EAR: (560, 225), J.RIGHT_EAR: (440, 225)}),
                     depth={J.NOSE: 0.45, J.LEFT_SHOULDER: 0.75, J.RIGHT_SHOULDER: 0.75})
no_depth_close = pose(skeleton({J.LEFT_EAR: (560, 225), J.RIGHT_EAR: (440, 225)}),
                      depth={J.NOSE: None, J.LEFT_SHOULDER: 0.8, J.RIGHT_SHOULDER: 0.8})
upright_far = pose(skeleton(), depth={J.NOSE: 2.0})
close_upright = pose(skeleton(), depth={J.NOSE: 0.5, J.LEFT_SHOULDER: 0.55, J.RIGHT_SHOULDER: 0.55})
results.append(check("leaning in close", run(g.Kiss(), hold(leaning_close, 1.0)), True))
results.append(check("close, depth dropped out", run(g.Kiss(), hold(no_depth_close, 1.0)), True))
results.append(check("upright far", run(g.Kiss(), hold(upright_far, 1.0)), False))
results.append(check("close but upright", run(g.Kiss(), hold(close_upright, 1.0)), False))

print("Factory")
results.append(check("make() knows every name", all(isinstance(g.make(n), g.Gesture) for n in g.DETECTORS), True))

print(f"\n{sum(results)}/{len(results)} passed")
raise SystemExit(0 if all(results) else 1)
