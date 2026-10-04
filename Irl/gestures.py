"""Gesture detectors built on `Pose`: the things the date can demand IRL.

Every detector has the same shape so the runner (and the demo overlay) can treat
them alike:

    detector.update(pose, now) -> bool   # True on the frame the demand is satisfied
    detector.progress            -> float 0..1, for the on-screen meter
    detector.status              -> short string for the overlay / logs
    detector.reset()

Names match the `DEMANDS` list in Server/spacetimedb/src/index.ts.

Geometry notes
- `pose.pixels` is (33, 2) image pixels, y grows DOWN. "Above" means smaller y.
- `pose.xyz` is metres in camera space (z away from the camera), NaN where the
  Kinect had no depth reading. Depth is unreliable under ~0.5 m, which is exactly
  the "kiss" range, so close-range checks fall back to pixel geometry.
- Lengths are normalised by shoulder width so distance from the camera doesn't
  matter.
"""

from __future__ import annotations

import time
from collections import deque
from dataclasses import dataclass

import numpy as np

from pose import Joint, Pose

TORSO = [Joint.LEFT_SHOULDER, Joint.RIGHT_SHOULDER, Joint.LEFT_HIP, Joint.RIGHT_HIP]


# ---------------------------------------------------------------- helpers ---


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


def _mid(pose: Pose, a: Joint, b: Joint) -> np.ndarray:
    return (pose.pixels[a] + pose.pixels[b]) / 2


def _shoulder_width(pose: Pose) -> float:
    return float(max(np.linalg.norm(pose.pixels[Joint.LEFT_SHOULDER] - pose.pixels[Joint.RIGHT_SHOULDER]), 1.0))


def _torso_length(pose: Pose) -> float:
    """Mid-shoulder to mid-hip, in pixels. Shrinks when the player bends forward."""
    return float(np.linalg.norm(_mid(pose, Joint.LEFT_SHOULDER, Joint.RIGHT_SHOULDER) - _mid(pose, Joint.LEFT_HIP, Joint.RIGHT_HIP)))


def _ramp(x: float, lo: float, hi: float) -> float:
    """Linear 0..1 as x goes lo -> hi (works with hi < lo for a falling ramp)."""
    if hi == lo:
        return 1.0 if x >= hi else 0.0
    return float(min(1.0, max(0.0, (x - lo) / (hi - lo))))


def _depth(pose: Pose, *joints: Joint) -> float | None:
    """Median valid depth (m) over joints, or None."""
    z = pose.xyz[list(joints), 2]
    z = z[~np.isnan(z)]
    return float(np.median(z)) if z.size else None


# ------------------------------------------------------------- base class ---


class Gesture:
    """Base class. Subclasses implement `_check(pose, now)`; the base handles holds and one-shot firing."""

    name = "gesture"
    hold_s = 0.0  # how long the condition must stay true

    def __init__(self):
        self.reset()

    def reset(self) -> None:
        self._since: float | None = None
        self.done = False
        self.status = ""
        self.score = 0.0  # soft 0..1 "how much does this look like the gesture right now"

    @property
    def progress(self) -> float:
        if self.done:
            return 1.0
        if self._since is None or self.hold_s <= 0:
            return 0.0
        return min(1.0, (time.monotonic() - self._since) / self.hold_s)

    def update(self, pose: Pose | None, now: float | None = None) -> bool:
        """Returns True exactly once, on the frame the gesture completes."""
        if self.done:
            self.score = 1.0
            return False
        now = time.monotonic() if now is None else now
        if pose is None:
            self.score = 0.0
            self._since = None
            return False
        if not self._check(pose, now):
            self._since = None
            return False
        if self._since is None:
            self._since = now
        if now - self._since >= self.hold_s:
            self.done = True
            return True
        return False

    def _check(self, pose: Pose, now: float) -> bool:  # pragma: no cover - abstract
        raise NotImplementedError


# -------------------------------------------------------------- the moves ---


class Kneel(Gesture):
    """Hips dropped to knee height with the shins flat on the floor."""

    name = "kneel"
    hold_s = 0.6

    def _check(self, pose: Pose, now: float) -> bool:
        if not pose.visible(Joint.LEFT_HIP, Joint.RIGHT_HIP, Joint.LEFT_KNEE, Joint.RIGHT_KNEE, *TORSO[:2]):
            self.status = "can't see your legs"
            self.score = 0.0
            return False
        torso = _torso_length(pose)
        hip_y = _mid(pose, Joint.LEFT_HIP, Joint.RIGHT_HIP)[1]
        knee_y = _mid(pose, Joint.LEFT_KNEE, Joint.RIGHT_KNEE)[1]
        drop = (knee_y - hip_y) / max(torso, 1.0)
        hips_down = drop < 0.45  # standing: roughly 1.0-1.3 torso lengths
        s_drop = _ramp(drop, 1.1, 0.45)
        s_ankle = 1.0
        if pose.visible(Joint.LEFT_ANKLE, Joint.RIGHT_ANKLE):
            shin = (_mid(pose, Joint.LEFT_ANKLE, Joint.RIGHT_ANKLE)[1] - knee_y) / max(torso, 1.0)
            s_ankle = _ramp(shin, 0.8, 0.35)
        self.score = s_drop * (0.4 + 0.6 * s_ankle)
        if not hips_down:
            self.status = "get lower"
            return False
        # Kneeling puts the ankles level with (or hidden behind) the knees; a squat keeps them well below.
        if pose.visible(Joint.LEFT_ANKLE, Joint.RIGHT_ANKLE):
            ankle_y = _mid(pose, Joint.LEFT_ANKLE, Joint.RIGHT_ANKLE)[1]
            if (ankle_y - knee_y) > 0.35 * torso:
                self.status = "that's a squat, knees on the floor"
                return False
        self.status = "kneeling"
        return True


class Bow(Gesture):
    """Torso folded forward from the hips, head below the shoulders, legs still standing."""

    name = "bow"
    hold_s = 0.5

    def __init__(self, min_tilt_deg: float = 45.0):
        super().__init__()
        self.min_tilt_deg = min_tilt_deg

    def _check(self, pose: Pose, now: float) -> bool:
        if not pose.visible(Joint.NOSE, *TORSO):
            self.status = "stand where I can see you"
            self.score = 0.0
            return False
        # Torso tilt from MediaPipe's metric landmarks: angle between shoulder->hip and straight down.
        sh = (pose.local[Joint.LEFT_SHOULDER] + pose.local[Joint.RIGHT_SHOULDER]) / 2
        hp = (pose.local[Joint.LEFT_HIP] + pose.local[Joint.RIGHT_HIP]) / 2
        v = sh - hp
        vertical = abs(v[1])
        horizontal = float(np.hypot(v[0], v[2]))
        tilt = float(np.degrees(np.arctan2(horizontal, max(vertical, 1e-6))))
        # Head must actually dip: nose at or below the shoulder line in the image.
        nose_y = pose.pixels[Joint.NOSE, 1]
        shoulder_y = _mid(pose, Joint.LEFT_SHOULDER, Joint.RIGHT_SHOULDER)[1]
        sw = _shoulder_width(pose)
        head_down = nose_y >= shoulder_y - 0.1 * sw
        s_head = _ramp((nose_y - shoulder_y) / sw, -0.7, -0.1)
        self.score = _ramp(tilt, 15.0, self.min_tilt_deg) * (0.4 + 0.6 * s_head)
        # Not a squat/kneel: hips stay above the knees.
        if pose.visible(Joint.LEFT_KNEE, Joint.RIGHT_KNEE):
            hip_y = _mid(pose, Joint.LEFT_HIP, Joint.RIGHT_HIP)[1]
            knee_y = _mid(pose, Joint.LEFT_KNEE, Joint.RIGHT_KNEE)[1]
            if knee_y - hip_y < 0.3 * sw:
                self.status = "that's not a bow"
                self.score = 0.0
                return False
        self.tilt_deg = tilt
        if tilt < self.min_tilt_deg or not head_down:
            self.status = f"deeper ({tilt:.0f}°)"
            return False
        self.status = f"bowing ({tilt:.0f}°)"
        return True


class JumpingJacks(Gesture):
    """Count full open/close cycles: arms overhead + feet apart, then arms down + feet together."""

    name = "jacks"

    def __init__(self, reps: int = 5):
        self.reps = reps
        super().__init__()

    def reset(self) -> None:
        super().reset()
        self.count = 0
        self._open = False
        self._cycle_times: deque[float] = deque()

    @property
    def progress(self) -> float:
        return 1.0 if self.done else min(1.0, self.count / self.reps)

    def _check(self, pose: Pose, now: float) -> bool:
        needed = (Joint.NOSE, Joint.LEFT_WRIST, Joint.RIGHT_WRIST, Joint.LEFT_SHOULDER, Joint.RIGHT_SHOULDER,
                  Joint.LEFT_ANKLE, Joint.RIGHT_ANKLE)
        if not pose.visible(*needed):
            self.status = f"{self.count}/{self.reps} (step back, I need your feet)"
            self.score = 0.0
            return False
        sw = _shoulder_width(pose)
        nose_y = pose.pixels[Joint.NOSE, 1]
        shoulder_y = _mid(pose, Joint.LEFT_SHOULDER, Joint.RIGHT_SHOULDER)[1]
        wl, wr = pose.pixels[Joint.LEFT_WRIST, 1], pose.pixels[Joint.RIGHT_WRIST, 1]
        feet = float(abs(pose.pixels[Joint.LEFT_ANKLE, 0] - pose.pixels[Joint.RIGHT_ANKLE, 0])) / sw

        is_open = wl < nose_y and wr < nose_y and feet > 1.3
        is_closed = wl > shoulder_y and wr > shoulder_y and feet < 0.9

        if not self._open and is_open:
            self._open = True
        elif self._open and is_closed:
            self._open = False
            self.count += 1
            self._cycle_times.append(now)
        while self._cycle_times and now - self._cycle_times[0] > 3.0:
            self._cycle_times.popleft()
        arms = _ramp((shoulder_y - (wl + wr) / 2) / sw, 0.0, 1.2)
        openness = 0.5 * arms + 0.5 * _ramp(feet, 0.8, 1.4)
        recent = _ramp(len(self._cycle_times), 0, 2)
        self.score = max(0.45 * openness, 0.5 * openness + 0.5 * recent)
        self.status = f"{self.count}/{self.reps}"
        return self.count >= self.reps


class Spin(Gesture):
    """A full turn: the shoulders' left/right order flips and flips back within a few seconds."""

    name = "spin"

    def __init__(self, window_s: float = 5.0, min_width: float = 0.3):
        self.window_s = window_s
        self.min_width = min_width  # |signed shoulder width| / max seen, below this we're side-on
        super().__init__()

    def reset(self) -> None:
        super().reset()
        self._phases: deque[tuple[float, int]] = deque()  # (time, +1 facing / -1 away)
        self._max_width = 1.0

    @property
    def progress(self) -> float:
        if self.done:
            return 1.0
        return {0: 0.0, 1: 0.2, 2: 0.6}.get(len(self._phases), 0.6)

    def _check(self, pose: Pose, now: float) -> bool:
        if not pose.visible(Joint.LEFT_SHOULDER, Joint.RIGHT_SHOULDER):
            self.score = 0.0
            return False
        signed = float(pose.pixels[Joint.RIGHT_SHOULDER, 0] - pose.pixels[Joint.LEFT_SHOULDER, 0])
        self._max_width = max(self._max_width, abs(signed))
        while self._phases and now - self._phases[0][0] > self.window_s:
            self._phases.popleft()
        side_on = 1.0 - abs(signed) / self._max_width
        self.score = max({0: 0.0, 1: 0.0, 2: 0.6}.get(len(self._phases), 0.6), 0.5 * _ramp(side_on, 0.4, 0.9))
        if abs(signed) / self._max_width < self.min_width:
            self.status = "turning…"
            return False  # side-on, ambiguous
        facing = 1 if signed > 0 else -1
        if not self._phases or self._phases[-1][1] != facing:
            self._phases.append((now, facing))
        if len(self._phases) >= 3:  # facing -> away -> facing
            self.status = "spun!"
            return True
        self.status = "keep turning" if len(self._phases) == 2 else "spin around"
        return False


class HeartHands(Gesture):
    """Both hands together above the head, elbows flared out: a heart over the head."""

    name = "heart"
    hold_s = 0.6

    def _check(self, pose: Pose, now: float) -> bool:
        needed = (Joint.NOSE, Joint.LEFT_WRIST, Joint.RIGHT_WRIST, Joint.LEFT_ELBOW, Joint.RIGHT_ELBOW,
                  Joint.LEFT_SHOULDER, Joint.RIGHT_SHOULDER)
        if not pose.visible(*needed):
            self.status = "hands where I can see them"
            self.score = 0.0
            return False
        sw = _shoulder_width(pose)
        nose_y = pose.pixels[Joint.NOSE, 1]
        wl, wr = pose.pixels[Joint.LEFT_WRIST], pose.pixels[Joint.RIGHT_WRIST]
        el, er = pose.pixels[Joint.LEFT_ELBOW], pose.pixels[Joint.RIGHT_ELBOW]
        above = wl[1] < nose_y and wr[1] < nose_y
        gap = float(np.linalg.norm(wl - wr)) / sw
        together = gap < 0.6
        wrist_mid_x = (wl[0] + wr[0]) / 2
        flare = min(abs(el[0] - wrist_mid_x), abs(er[0] - wrist_mid_x)) / sw
        flared = flare > 0.5
        s_above = _ramp((nose_y - (wl[1] + wr[1]) / 2) / sw, -0.3, 0.5)
        self.score = s_above * _ramp(gap, 1.2, 0.4) * (0.5 + 0.5 * _ramp(flare, 0.2, 0.6))
        elbows_up = el[1] < pose.pixels[Joint.LEFT_SHOULDER, 1] and er[1] < pose.pixels[Joint.RIGHT_SHOULDER, 1]
        if not above:
            self.status = "higher, over your head"
        elif not together:
            self.status = "hands together"
        elif not (flared and elbows_up):
            self.status = "elbows out, make the heart"
        else:
            self.status = "♥"
            return True
        return False


class BlowKiss(Gesture):
    """Hand to the mouth, then flung away from the face (ideally toward the camera)."""

    name = "blow_kiss"

    def __init__(self, at_mouth_s: float = 0.15, release_within_s: float = 1.0, min_travel: float = 0.9):
        self.at_mouth_s = at_mouth_s
        self.release_within_s = release_within_s
        self.min_travel = min_travel  # shoulder widths
        super().__init__()

    def reset(self) -> None:
        super().reset()
        self._armed: dict[Joint, tuple[float, float | None]] = {}  # wrist -> (time armed, wrist depth then)
        self._at_mouth_since: dict[Joint, float] = {}

    @property
    def progress(self) -> float:
        return 1.0 if self.done else (0.5 if self._armed else 0.0)

    def _check(self, pose: Pose, now: float) -> bool:
        if not pose.visible(Joint.NOSE, Joint.LEFT_SHOULDER, Joint.RIGHT_SHOULDER):
            self.score = 0.0
            return False
        sw = _shoulder_width(pose)
        mouth = pose.pixels[Joint.NOSE] + np.array([0.0, 0.25 * sw])  # just below the nose
        shoulder_y = _mid(pose, Joint.LEFT_SHOULDER, Joint.RIGHT_SHOULDER)[1]
        fired = False
        nearest = 9.0
        for wrist in (Joint.LEFT_WRIST, Joint.RIGHT_WRIST):
            if not pose.visible(wrist):
                self._at_mouth_since.pop(wrist, None)
                continue
            d = float(np.linalg.norm(pose.pixels[wrist] - mouth)) / sw
            nearest = min(nearest, d)
            z = pose.xyz[wrist, 2]
            z = None if np.isnan(z) else float(z)
            if d < 0.5:
                self._at_mouth_since.setdefault(wrist, now)
                if now - self._at_mouth_since[wrist] >= self.at_mouth_s:
                    self._armed[wrist] = (now, z)
            else:
                self._at_mouth_since.pop(wrist, None)
                armed = self._armed.get(wrist)
                if armed is None:
                    continue
                t0, z0 = armed
                if now - t0 > self.release_within_s:
                    self._armed.pop(wrist, None)
                    continue
                toward_camera = z is not None and z0 is not None and (z0 - z) > 0.12
                # A throw goes out or forward; a hand just dropping to the side ends below the shoulders.
                outward = pose.pixels[wrist, 1] < shoulder_y + 0.3 * sw
                if outward and (d > self.min_travel or toward_camera):
                    fired = True
        self.score = 1.0 if fired else (0.7 if self._armed else 0.55 * _ramp(nearest, 1.2, 0.3))
        self.status = "mwah!" if fired else ("now throw it" if self._armed else "hand to your lips")
        return fired


class Kiss(Gesture):
    """Face pushed right up to the camera, leaning in. Depth dies this close, so pixels carry it."""

    name = "kiss"
    hold_s = 0.4

    def __init__(self, max_nose_m: float = 0.55, min_face_ratio: float = 0.9):
        self.max_nose_m = max_nose_m
        self.min_face_ratio = min_face_ratio  # ear-to-ear width / shoulder width; ~0.4 when upright
        super().__init__()

    def _check(self, pose: Pose, now: float) -> bool:
        if not pose.visible(Joint.NOSE, Joint.LEFT_SHOULDER, Joint.RIGHT_SHOULDER):
            self.status = "come closer"
            self.score = 0.0
            return False
        sw = _shoulder_width(pose)
        nose_z = pose.xyz[Joint.NOSE, 2]
        shoulder_z = _depth(pose, Joint.LEFT_SHOULDER, Joint.RIGHT_SHOULDER)
        # Face apparent size vs shoulders: grows fast as the head leads toward the lens.
        if pose.visible(Joint.LEFT_EAR, Joint.RIGHT_EAR):
            face = float(np.linalg.norm(pose.pixels[Joint.LEFT_EAR] - pose.pixels[Joint.RIGHT_EAR]))
        else:  # ears drop out this close; eyes are a fair stand-in
            face = 2.5 * float(np.linalg.norm(pose.pixels[Joint.LEFT_EYE] - pose.pixels[Joint.RIGHT_EYE]))
        ratio = face / sw

        s_close = max(
            _ramp(nose_z, 1.1, self.max_nose_m) if not np.isnan(nose_z) else 0.0,
            _ramp(shoulder_z, 1.4, 0.9) if (np.isnan(nose_z) and shoulder_z is not None) else 0.0,
            _ramp(ratio, 0.45, self.min_face_ratio),
        )
        s_lean = max(
            _ramp(ratio, 0.45, self.min_face_ratio),
            _ramp(shoulder_z - nose_z, 0.0, 0.15) if (not np.isnan(nose_z) and shoulder_z is not None) else 0.0,
        )
        self.score = s_close * (0.5 + 0.5 * s_lean)
        close = (not np.isnan(nose_z) and nose_z < self.max_nose_m) or (
            np.isnan(nose_z) and shoulder_z is not None and shoulder_z < 0.9  # nose too close to read at all
        )
        leaning = ratio > self.min_face_ratio or (
            not np.isnan(nose_z) and shoulder_z is not None and (shoulder_z - nose_z) > 0.15
        )
        if close and leaning:
            self.status = "💋"
            return True
        self.status = "closer…" if not close else "lean in"
        return False


# -------------------------------------------------------------- the runner ---


def make(name: str, **kwargs) -> Gesture:
    """Build a detector by demand name (as stored in SpacetimeDB's date_state.demand)."""
    cls = DETECTORS.get(name)
    if cls is None:
        raise KeyError(f"unknown demand {name!r}; known: {sorted(DETECTORS)}")
    return cls(**kwargs)


DETECTORS: dict[str, type[Gesture]] = {
    Kneel.name: Kneel,
    Bow.name: Bow,
    JumpingJacks.name: JumpingJacks,
    Spin.name: Spin,
    HeartHands.name: HeartHands,
    BlowKiss.name: BlowKiss,
    Kiss.name: Kiss,
}


@dataclass
class Demand:
    """What the date currently wants, with the live detector for it."""

    name: str
    detector: Gesture

    @classmethod
    def of(cls, name: str, **kwargs) -> "Demand":
        return cls(name, make(name, **kwargs))


# ------------------------------------------------- legacy helpers kept as-is ---


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
            shoulder_width = _shoulder_width(pose)
            history.append((now, pose.pixels[wrist, 0] / shoulder_width))
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
