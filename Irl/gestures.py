"""Starter gesture detectors built on `Pose`. Add the date's demands here."""

import time
from collections import deque

import numpy as np

from pose import Joint, Pose

TORSO = [Joint.LEFT_SHOULDER, Joint.RIGHT_SHOULDER, Joint.LEFT_HIP, Joint.RIGHT_HIP]


def distance_m(pose: Pose) -> float | None:
    """How far the player's torso is from the camera, in metres."""
    depths = pose.xyz[TORSO, 2]
    depths = depths[~np.isnan(depths)]
    return float(np.median(depths)) if depths.size else None


def hands_raised(pose: Pose) -> bool:
    """Both wrists above the nose."""
    if not pose.visible(Joint.NOSE, Joint.LEFT_WRIST, Joint.RIGHT_WRIST):
        return False
    nose_y = pose.pixels[Joint.NOSE, 1]
    return bool(pose.pixels[Joint.LEFT_WRIST, 1] < nose_y and pose.pixels[Joint.RIGHT_WRIST, 1] < nose_y)


class WaveDetector:
    """Either hand held above its elbow and swung side to side."""

    ARMS = [
        (Joint.LEFT_WRIST, Joint.LEFT_ELBOW),
        (Joint.RIGHT_WRIST, Joint.RIGHT_ELBOW),
    ]

    def __init__(self, window_s: float = 1.5, min_swings: int = 3, min_travel: float = 0.25):
        self.window_s = window_s
        self.min_swings = min_swings
        self.min_travel = min_travel  # per swing, as a fraction of shoulder width
        self._history = [deque() for _ in self.ARMS]  # (time, wrist x in shoulder widths)

    def update(self, pose: Pose | None) -> bool:
        now = time.monotonic()
        waving = False
        for history, (wrist, elbow) in zip(self._history, self.ARMS):
            if not self._hand_up(pose, wrist, elbow):
                history.clear()
                continue
            shoulder_width = np.linalg.norm(pose.pixels[Joint.LEFT_SHOULDER] - pose.pixels[Joint.RIGHT_SHOULDER])
            history.append((now, pose.pixels[wrist, 0] / max(shoulder_width, 1.0)))
            while now - history[0][0] > self.window_s:
                history.popleft()
            waving |= _count_swings([x for _, x in history], self.min_travel) >= self.min_swings
        return waving

    @staticmethod
    def _hand_up(pose: Pose | None, wrist: Joint, elbow: Joint) -> bool:
        if pose is None or not pose.visible(wrist, elbow, Joint.LEFT_SHOULDER, Joint.RIGHT_SHOULDER):
            return False
        return bool(pose.pixels[wrist, 1] < pose.pixels[elbow, 1])


def _count_swings(xs: list[float], min_travel: float) -> int:
    """Count left/right strokes, ignoring jitter smaller than `min_travel`."""
    swings, direction, anchor = 0, 0, xs[0]
    for x in xs[1:]:
        delta = x - anchor
        if direction == 0:
            if abs(delta) > min_travel:
                swings, direction, anchor = 1, np.sign(delta), x
        elif delta * direction > 0:
            anchor = x  # still travelling the same way
        elif abs(delta) > min_travel:
            swings, direction, anchor = swings + 1, -direction, x
    return swings
