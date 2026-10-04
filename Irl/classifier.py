"""Turn the per-gesture soft scores into one probability distribution, with an explicit idle class.

    clf = PoseClassifier()
    r = clf.update(pose)       # every frame
    r.probs    -> {"idle": 0.8, "kneel": 0.1, ...}  (sums to 1)
    r.winner   -> "idle" or a gesture name; a gesture only wins when it clearly beats idle
    r.fired    -> gesture name on the frame its detector completed, else None

Idle is not a detector. Its score is "how far the best gesture is from certain", so
standing around produces a confident idle rather than forcing the least-bad gesture.
"""

from __future__ import annotations

import math
import time
from dataclasses import dataclass, field

from gestures import DETECTORS, Gesture, make
from pose import Pose

IDLE = "idle"


@dataclass
class Result:
    probs: dict[str, float]
    winner: str
    fired: str | None = None
    statuses: dict[str, str] = field(default_factory=dict)
    progress: dict[str, float] = field(default_factory=dict)


class PoseClassifier:
    def __init__(
        self,
        names: list[str] | None = None,
        idle_floor: float = 0.35,  # idle never scores below this: a gesture must beat it to win
        temperature: float = 0.12,  # softmax sharpness over scores
        win_margin: float = 1.5,  # winner prob must be this many times idle's prob
        smoothing: float = 0.35,  # EMA weight of the new frame (1 = no smoothing)
        latch_s: float = 1.5,  # how long a completed detector stays lit before resetting
        learned_weight: float = 0.6,  # share of the fused score that comes from the DINOv2 head
    ):
        self.learned_weight = learned_weight
        self.names = names or list(DETECTORS)
        self.detectors: dict[str, Gesture] = {n: make(n) for n in self.names}
        self.idle_floor = idle_floor
        self.temperature = temperature
        self.win_margin = win_margin
        self.smoothing = smoothing
        self.latch_s = latch_s
        self._probs: dict[str, float] = {IDLE: 1.0, **{n: 0.0 for n in self.names}}
        self._done_at: dict[str, float] = {}

    def reset(self) -> None:
        for d in self.detectors.values():
            d.reset()
        self._done_at.clear()
        self._probs = {IDLE: 1.0, **{n: 0.0 for n in self.names}}

    def update(self, pose: Pose | None, now: float | None = None,
               learned: dict[str, float] | None = None) -> Result:
        """`learned` is an optional probability dict from the DINOv2 head (dino.Head.predict_proba).
        When present, each gesture's score blends geometry with the learned probability, and the
        learned idle probability raises the idle score, so neither source alone can force a pose."""
        now = time.monotonic() if now is None else now
        fired = None
        for name, d in self.detectors.items():
            if d.update(pose, now):
                fired = name
                self._done_at[name] = now
            elif d.done and now - self._done_at.get(name, now) > self.latch_s:
                d.reset()

        scores = {n: float(min(1.0, max(0.0, d.score))) for n, d in self.detectors.items()}
        if learned:
            for n in scores:
                if n in learned and not self.detectors[n].done:
                    scores[n] = self.learned_weight * learned[n] + (1 - self.learned_weight) * scores[n]
        best = max(scores.values(), default=0.0)
        scores[IDLE] = max(self.idle_floor, 1.0 - best) if pose is not None else 1.0
        if learned and IDLE in learned and pose is not None:
            scores[IDLE] = max(scores[IDLE], learned[IDLE])

        # Softmax over scores, then EMA for a steady display.
        exps = {n: math.exp(s / self.temperature) for n, s in scores.items()}
        total = sum(exps.values())
        for n, e in exps.items():
            p = e / total
            self._probs[n] = (1 - self.smoothing) * self._probs[n] + self.smoothing * p

        top = max(self.names, key=lambda n: self._probs[n])
        winner = top if self._probs[top] >= self.win_margin * self._probs[IDLE] else IDLE
        if fired:
            winner = fired

        return Result(
            probs=dict(self._probs),
            winner=winner,
            fired=fired,
            statuses={n: d.status for n, d in self.detectors.items()},
            progress={n: d.progress for n, d in self.detectors.items()},
        )
