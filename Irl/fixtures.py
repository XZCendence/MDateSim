"""Synthetic skeletons for tests: a cartoon person in pixel space (y down), optional depth."""

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



# ---- named poses shared by the tests ----
standing = pose(skeleton())
kneeling = pose(skeleton({J.LEFT_HIP: (535, 560), J.RIGHT_HIP: (465, 560),
                          J.LEFT_KNEE: (535, 640), J.RIGHT_KNEE: (465, 640),
                          J.LEFT_ANKLE: (535, 650), J.RIGHT_ANKLE: (465, 650)}))
squatting = pose(skeleton({J.LEFT_HIP: (535, 580), J.RIGHT_HIP: (465, 580),
                           J.LEFT_KNEE: (560, 620), J.RIGHT_KNEE: (440, 620)}))
bowing = pose(skeleton({J.NOSE: (500, 330), J.LEFT_EAR: (522, 325), J.RIGHT_EAR: (478, 325),
                        J.LEFT_SHOULDER: (550, 320), J.RIGHT_SHOULDER: (450, 320)}), tilt_deg=60)
opened = pose(skeleton({J.LEFT_WRIST: (600, 150), J.RIGHT_WRIST: (400, 150),
                        J.LEFT_ANKLE: (600, 760), J.RIGHT_ANKLE: (400, 760)}))
heart = pose(skeleton({J.LEFT_WRIST: (515, 120), J.RIGHT_WRIST: (485, 120),
                       J.LEFT_ELBOW: (610, 220), J.RIGHT_ELBOW: (390, 220)}))
leaning_close = pose(skeleton({J.LEFT_EAR: (580, 225), J.RIGHT_EAR: (420, 225)}),
                     depth={J.NOSE: 0.3, J.LEFT_SHOULDER: 0.6, J.RIGHT_SHOULDER: 0.6})
