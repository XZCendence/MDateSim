"""The IRL date: watch SpacetimeDB for what the date demands, detect it on the Kinect, report back.

Flow per player
  date_state.demand = "kneel"  (set by the texting loop when she asks)
    -> this runner builds the matching detector and watches the player
    -> on success: record_gesture(player, "kneel", true, +delta)
       (the module marks the demand met; the texting loop sees it and she reacts)

Talks to SpacetimeDB over its HTTP API (no Python SDK needed):
  POST /v1/database/<db>/sql             text/plain SQL -> rows
  POST /v1/database/<db>/call/<reducer>  JSON array of args

Usage
  python date_runner.py                 # follow whoever is on an IRL date (or has an open demand)
  python date_runner.py --player 0xc2…  # follow one player identity
  python date_runner.py --headless      # no window (just logs)

Keys in the window: d depth overlay, q quit.
"""

from __future__ import annotations

import argparse
import json
import os
import queue
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

import cv2

from gestures import DATE_DETECTORS, Gesture, distance_m, is_facing, make
from kinect import Kinect
from pose import PoseTracker, draw_pose
from pose_stream import PoseStream

HOST = os.environ.get("SPACETIMEDB_HOST", "https://maincloud.spacetimedb.com").rstrip("/")
DB = os.environ.get("SPACETIMEDB_DB_NAME", "m-date-sim-wl608")
POLL_S = 0.5
AFFECTION_FOR = {  # how much she warms up when you actually do it
    "kneel": 15,
    "bow": 10,
    "jacks": 10,
    "dance": 12,
    "heart": 12,
    "blow_kiss": 12,
    "kiss": 20,
    "look": 5,
    "beg": 18,
    "squat": 8,
    "still": 6,
    "wave": 5,
}
WINDOW = "MDateSim IRL date"


# ------------------------------------------------------------ SpacetimeDB ---


def sql(query: str) -> list[dict]:
    """Run a SQL query; returns rows as dicts keyed by column name."""
    req = urllib.request.Request(
        f"{HOST}/v1/database/{DB}/sql",
        data=query.encode(),
        headers={"Content-Type": "text/plain"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as res:
        payload = json.load(res)
    out: list[dict] = []
    for stmt in payload:
        names = [e["name"]["some"] for e in stmt["schema"]["elements"]]
        for row in stmt["rows"]:
            out.append({n: _unwrap(v) for n, v in zip(names, row)})
    return out


def _unwrap(value):
    """Decode SATS-JSON: one-field products (identity, timestamp) come as [x];
    sums such as Option come as [tag, payload] where tag 0 = some, 1 = none."""
    if isinstance(value, list) and len(value) == 1:
        return _unwrap(value[0])
    if isinstance(value, list) and len(value) == 2 and isinstance(value[0], int):
        return None if value[0] == 1 else _unwrap(value[1])
    if isinstance(value, dict) and len(value) == 1:  # alternative named form: {"some": x} / {"none": []}
        k, v = next(iter(value.items()))
        return None if k == "none" else _unwrap(v)
    return value


def call(reducer: str, args: list) -> None:
    """Invoke a reducer. Raises RuntimeError with the module's message on failure."""
    req = urllib.request.Request(
        f"{HOST}/v1/database/{DB}/call/{reducer}",
        data=json.dumps(args).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10):
            return
    except urllib.error.HTTPError as err:
        raise RuntimeError(f"{reducer} failed ({err.code}): {err.read().decode(errors='replace')}") from None


def identity_arg(hex_identity: str):
    """Identity as a reducer argument. SATS-JSON encodes it as a one-field product."""
    return [hex_identity]


def record_gesture(player: str, gesture: str, success: bool) -> None:
    delta = AFFECTION_FOR.get(gesture, 5) if success else -5
    try:
        call("record_gesture", [identity_arg(player), gesture, success, delta])
    except RuntimeError as err:
        # Older encoding fallback, in case the server wants the named form.
        if "identity" in str(err).lower() or "deserializ" in str(err).lower():
            call("record_gesture", [{"__identity__": player}, gesture, success, delta])
        else:
            raise


def follow(player: str | None) -> tuple[str | None, str | None]:
    """(player, open_demand) for whoever we should watch, or (None, None).

    Preference: someone on an IRL date (even with no demand yet, so we can report presence),
    then anyone with an open demand. `--player` pins it to one identity.
    """
    rows = sql("SELECT player, phase, demand, demand_met FROM date_state")
    if player:
        rows = [r for r in rows if r["player"] == player]
    rows.sort(key=lambda r: (0 if r["phase"] == "irl" else 1, 0 if (r["demand"] and not r["demand_met"]) else 1))
    for r in rows:
        open_demand = r["demand"] if (r["demand"] and not r["demand_met"]) else None
        if r["phase"] == "irl" or open_demand or player:
            return r["player"], open_demand
    return None, None


STOP_FILE = Path(__file__).parent / ".stop"  # touch this to make the runner exit cleanly
LEARNED_HELPS = {"kneel", "beg"}  # demands where the learned model is consulted
EMBED_EVERY_S = 0.1


class Learned(threading.Thread):
    """Loads the DINOv2 embedder + trained head in the background (it takes a while).

    Only used if the head was trained with an "idle" class; without one it cannot say
    "none of the above" and would see a kneel in someone standing still.
    """

    def __init__(self):
        super().__init__(name="learned", daemon=True)
        self.ready = False
        self.embedder = None
        self.head = None

    def run(self) -> None:
        try:
            from dino import DinoEmbedder, Head

            head = Head.load()
            if head is None:
                print("[runner] no trained head (Irl/data/head.pkl); geometry only")
                return
            if "idle" not in head.classes:
                print(f"[runner] trained head has no 'idle' class ({head.classes}); geometry only. "
                      "Record idle in pose_lab.py (hold 0), press t, and restart.")
                return
            self.embedder, self.head = DinoEmbedder(), head
            self.ready = True
            print(f"[runner] learned model ready: {head.classes}")
        except Exception as err:
            print(f"[runner] learned model unavailable ({err}); geometry only")

    def probs(self, frame, pose) -> dict[str, float]:
        from dino import person_bbox

        return self.head.predict_proba(self.embedder.embed(frame.color, person_bbox(pose, frame.color.shape)))


class DbLink(threading.Thread):
    """All SpacetimeDB traffic, off the camera thread: poll who to watch, push presence, record gestures."""

    def __init__(self, pinned: str | None):
        super().__init__(name="db-link", daemon=True)
        self.pinned = pinned
        self.player: str | None = None
        self.demand: str | None = None
        self._presence: tuple[bool, bool] = (False, False)
        self._sent: tuple[str | None, bool, bool] | None = None
        self._sent_at = 0.0
        self._done: queue.Queue[tuple[str, str]] = queue.Queue()
        self._skip: set[tuple[str, str]] = set()  # just-recorded demands, until the DB catches up

    def set_presence(self, in_view: bool, facing: bool) -> None:
        self._presence = (in_view, facing)

    def gesture_done(self, player: str, demand: str) -> None:
        self._skip.add((player, demand))
        self.demand = None
        self._done.put((player, demand))

    def run(self) -> None:
        while True:
            try:
                while True:
                    player, demand = self._done.get_nowait()
                    record_gesture(player, demand, True)
            except queue.Empty:
                pass
            except Exception as err:
                print(f"[runner] record_gesture failed: {err}")
            try:
                player, demand = follow(self.pinned)
                if demand is None or (player, demand) not in self._skip:
                    self._skip = {k for k in self._skip if k == (player, demand)}
                    self.player, self.demand = player, demand
                else:
                    self.player, self.demand = player, None
            except Exception as err:
                print(f"[runner] poll failed: {err}")
            try:
                if self.player:
                    now = time.monotonic()
                    state = (self.player, *self._presence)
                    if state != self._sent or now - self._sent_at > 2.0:
                        call("report_presence", [identity_arg(self.player), self._presence[0], self._presence[1]])
                        self._sent, self._sent_at = state, now
            except Exception as err:
                print(f"[runner] presence failed: {err}")
            time.sleep(POLL_S)


# ---------------------------------------------------------------- the loop ---


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--player", help="identity hex (0x…) to follow; default: whoever is on an IRL date")
    ap.add_argument("--headless", action="store_true")
    args = ap.parse_args()

    print(f"[runner] {HOST} / {DB}")
    stream = PoseStream()  # live armature for the website (ws://127.0.0.1:8765)
    tracker = PoseTracker()
    link = DbLink(args.player)
    link.start()
    learned = Learned()
    learned.start()
    last_embed = 0.0
    STOP_FILE.unlink(missing_ok=True)
    detector: Gesture | None = None
    active: tuple[str, str] | None = None  # (player, demand) we're currently detecting
    seen_at = 0.0  # last time a person was in frame (debounces presence flicker)
    facing_at = 0.0
    show_depth = False

    with Kinect() as kinect:
        while True:
            wanted = (link.player, link.demand) if link.player and link.demand in DATE_DETECTORS else None
            if wanted != active:
                active = wanted
                detector = make(active[1]) if active else None
                print(f"[runner] {active[0][:10]}… wants: {active[1]}" if active else "[runner] nothing demanded right now")

            if STOP_FILE.exists():
                STOP_FILE.unlink(missing_ok=True)
                print("[runner] stop requested, closing the Kinect cleanly")
                break

            frame = kinect.read()
            if frame is None:
                continue
            now = time.monotonic()
            pose = tracker.process(frame, kinect)
            if detector is not None and active is not None and learned.ready and active[1] in LEARNED_HELPS:
                if pose is None:
                    detector.hint = {}
                elif now - last_embed >= EMBED_EVERY_S:
                    last_embed = now
                    detector.hint = learned.probs(frame, pose)
            if pose is not None:
                seen_at = now
                if is_facing(pose):
                    facing_at = now
            link.set_presence(now - seen_at < 1.0, now - facing_at < 1.0)
            stream.publish(pose, demand=active[1] if active else None,
                           status=detector.status if detector else "", progress=detector.progress if detector else 0.0)

            if detector is not None and active is not None and detector.update(pose, now):
                print(f"[runner] {active[1]} DONE -> record_gesture")
                link.gesture_done(*active)
                active, detector = None, None  # wait for the next demand

            if args.headless:
                continue

            image = frame.color
            if show_depth:
                cv2.addWeighted(image, 0.6, cv2.applyColorMap(cv2.convertScaleAbs(frame.depth, alpha=255 / 4000), cv2.COLORMAP_TURBO), 0.4, 0, image)
            if pose is not None:
                draw_pose(image, pose)
            image = cv2.flip(image, 1)
            lines = [
                f"watching: {link.player[:12]}…" if link.player else "nobody is on a date",
                f"demand: {active[1]}" if active else "waiting for a demand…",
                f"status: {detector.status}" if detector else "",
                f"in view: {now - seen_at < 1.0}   facing: {now - facing_at < 1.0}",
            ]
            if pose is not None:
                d = distance_m(pose)
                lines.append(f"distance: {d:.2f} m" if d is not None else "distance: ?")
            for i, line in enumerate(l for l in lines if l):
                cv2.putText(image, line, (20, 36 + 30 * i), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 0), 4, cv2.LINE_AA)
                cv2.putText(image, line, (20, 36 + 30 * i), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2, cv2.LINE_AA)
            if detector is not None:
                h, w = image.shape[:2]
                fill = int(20 + (w - 40) * detector.progress)
                cv2.rectangle(image, (20, h - 40), (w - 20, h - 20), (60, 60, 60), -1)
                cv2.rectangle(image, (20, h - 40), (fill, h - 20), (80, 160, 255), -1)

            cv2.imshow(WINDOW, image)
            key = cv2.waitKey(1) & 0xFF
            if key == ord("q"):
                break
            if key == ord("d"):
                show_depth = not show_depth

    tracker.close()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
