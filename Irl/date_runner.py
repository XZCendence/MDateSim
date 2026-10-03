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
  python date_runner.py                 # follow whichever player is in phase "irl"
  python date_runner.py --player 0xc2…  # follow one player identity
  python date_runner.py --headless      # no window (just logs)

Keys in the window: d depth overlay, q quit.
"""

from __future__ import annotations

import argparse
import json
import os
import time
import urllib.error
import urllib.request

import cv2

from gestures import DETECTORS, Gesture, distance_m, make
from kinect import Kinect
from pose import PoseTracker, draw_pose

HOST = os.environ.get("SPACETIMEDB_HOST", "https://maincloud.spacetimedb.com").rstrip("/")
DB = os.environ.get("SPACETIMEDB_DB_NAME", "m-date-sim-wl608")
POLL_S = 0.5
AFFECTION_FOR = {  # how much she warms up when you actually do it
    "kneel": 15,
    "bow": 10,
    "jacks": 10,
    "spin": 8,
    "heart": 12,
    "blow_kiss": 12,
    "kiss": 20,
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


def current_demand(player: str | None) -> tuple[str | None, str | None, bool]:
    """(player, demand, demand_met) for the player we're following, or (None, None, False)."""
    where = f"WHERE player = {player}" if player else "WHERE phase = 'irl'"
    rows = sql(f"SELECT player, demand, demand_met FROM date_state {where}")
    if not rows:
        return None, None, False
    row = rows[0]
    return row["player"], row["demand"] or None, bool(row["demand_met"])


# ---------------------------------------------------------------- the loop ---


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--player", help="identity hex (0x…) to follow; default: whoever is in phase 'irl'")
    ap.add_argument("--headless", action="store_true")
    args = ap.parse_args()

    print(f"[runner] {HOST} / {DB}")
    tracker = PoseTracker()
    detector: Gesture | None = None
    active: tuple[str, str] | None = None  # (player, demand) we're currently detecting
    last_poll = 0.0
    show_depth = True

    with Kinect() as kinect:
        while True:
            now = time.monotonic()

            # Ask the DB what she wants (cheap; twice a second).
            if now - last_poll >= POLL_S:
                last_poll = now
                try:
                    player, demand, met = current_demand(args.player)
                except Exception as err:  # network blip: keep going with what we had
                    print(f"[runner] poll failed: {err}")
                    player, demand, met = (active[0], active[1], False) if active else (None, None, False)
                wanted = (player, demand) if player and demand and not met and demand in DETECTORS else None
                if wanted != active:
                    active = wanted
                    detector = make(active[1]) if active else None
                    if active:
                        print(f"[runner] {active[0][:10]}… she wants: {active[1]}")
                    else:
                        print("[runner] nothing demanded right now")

            frame = kinect.read()
            if frame is None:
                continue
            pose = tracker.process(frame, kinect)

            if detector is not None and active is not None and detector.update(pose):
                player, demand = active
                print(f"[runner] {demand} DONE -> record_gesture")
                try:
                    record_gesture(player, demand, True)
                except RuntimeError as err:
                    print(f"[runner] {err}")
                active, detector = None, None  # wait for the next demand
                last_poll = 0.0

            if args.headless:
                continue

            image = frame.color
            if show_depth:
                cv2.addWeighted(image, 0.6, cv2.applyColorMap(cv2.convertScaleAbs(frame.depth, alpha=255 / 4000), cv2.COLORMAP_TURBO), 0.4, 0, image)
            if pose is not None:
                draw_pose(image, pose)
            image = cv2.flip(image, 1)
            lines = [
                f"demand: {active[1]}" if active else "waiting for her to ask for something…",
                f"status: {detector.status}" if detector else "",
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
