"""Pose lab: live probabilities for every gesture (plus idle), with the winner highlighted.

Right-hand panel shows one bar per class. A gesture only lights up green when it
clearly beats idle; otherwise idle stays on top and nothing is forced.

Learned mode (DINOv2 + logistic head, see dino.py) fuses with the geometry:
  hold 0        record idle frames        hold 1-7   record that gesture
  t             train the head on what's recorded (and save it)
  x + 0-7       drop everything recorded for that label
  l             toggle the learned head on/off
Recorded data lives in Irl/data/poses.npz; the trained head in Irl/data/head.pkl.

Keys: r reset detectors, d depth overlay, q quit.
"""

import time

import cv2
import numpy as np

from classifier import IDLE, PoseClassifier
from dino import Dataset, DinoEmbedder, Head, person_bbox
from gestures import DETECTORS, distance_m
from kinect import Kinect
from pose import PoseTracker, draw_pose

WINDOW = "MDateSim pose lab"
PANEL_W = 420
ROW_H = 54
FONT = cv2.FONT_HERSHEY_SIMPLEX
LABELS = {
    IDLE: "idle",
    "kneel": "kneel",
    "bow": "bow",
    "jacks": "jumping jacks",
    "dance": "dance",
    "heart": "heart hands",
    "blow_kiss": "blow a kiss",
    "kiss": "kiss",
}


def text(img, s, xy, scale=0.7, color=(255, 255, 255), thick=2):
    cv2.putText(img, s, xy, FONT, scale, (0, 0, 0), thick + 2, cv2.LINE_AA)
    cv2.putText(img, s, xy, FONT, scale, color, thick, cv2.LINE_AA)


KEY_LABELS = {ord("0"): IDLE, **{ord(str(i + 1)): n for i, n in enumerate(DETECTORS)}}


def draw_panel(height, result, flash_until, now, recording=None, counts=None, learned_on=True, head=None, embed_ms=0.0):
    panel = np.full((height, PANEL_W, 3), (24, 24, 28), np.uint8)
    text(panel, "what she thinks you're doing", (16, 34), 0.6, (180, 180, 190), 1)
    counts = counts or {}
    order = [IDLE] + [n for n in result.probs if n != IDLE]
    y = 64
    for name in order:
        p = result.probs[name]
        is_winner = name == result.winner
        fired = flash_until.get(name, 0) > now
        bar_x0, bar_x1 = 16, PANEL_W - 16
        cv2.rectangle(panel, (bar_x0, y), (bar_x1, y + 26), (45, 45, 52), -1)
        if fired:
            color = (90, 230, 120)
        elif is_winner and name != IDLE:
            color = (80, 210, 100)
        elif is_winner:
            color = (150, 150, 160)
        else:
            color = (120, 90, 60)
        fill = bar_x0 + int((bar_x1 - bar_x0) * p)
        cv2.rectangle(panel, (bar_x0, y), (fill, y + 26), color, -1)
        if is_winner:
            cv2.rectangle(panel, (bar_x0 - 4, y - 4), (bar_x1 + 4, y + 30), (255, 255, 255), 2)
        label = LABELS.get(name, name)
        key = next((chr(k) for k, v in KEY_LABELS.items() if v == name), "")
        text(panel, f"{key} {label}", (bar_x0 + 8, y + 19), 0.6, (255, 255, 255), 2)
        n = counts.get(name, 0)
        if n:
            text(panel, f"{n}", (bar_x1 - 130, y + 19), 0.5, (200, 200, 120), 1)
        if recording == name:
            cv2.rectangle(panel, (bar_x0 - 4, y - 4), (bar_x1 + 4, y + 30), (60, 60, 255), 3)
            text(panel, "REC", (bar_x1 - 190, y + 19), 0.6, (80, 80, 255), 2)
        text(panel, f"{p * 100:3.0f}%", (bar_x1 - 70, y + 19), 0.6, (255, 255, 255), 2)
        status = result.statuses.get(name, "")
        if name != IDLE and status:
            text(panel, status, (bar_x0 + 8, y + 42), 0.45, (170, 170, 180), 1)
        if fired:
            text(panel, "DONE", (bar_x1 - 150, y + 19), 0.6, (90, 255, 120), 2)
        y += ROW_H
    mode = "learned: " + ("on" if (learned_on and head) else ("no head yet, press t" if learned_on else "off"))
    text(panel, mode + (f"   {embed_ms:.0f} ms" if embed_ms else ""), (16, height - 44), 0.5, (140, 200, 150), 1)
    text(panel, "hold 0-7 record  t train  x+key drop  l toggle  r reset  q quit", (16, height - 16), 0.45, (140, 140, 150), 1)
    return panel


def main():
    tracker = PoseTracker()
    clf = PoseClassifier()
    flash_until: dict[str, float] = {}
    show_depth = False

    embedder = DinoEmbedder()
    dataset = Dataset.load()
    head = Head.load()
    learned_on = True
    recording: str | None = None
    rec_held_until = 0.0  # keys only arrive on press-repeat; treat a label as held for a short grace period
    drop_armed = False
    last_record = 0.0
    last_embed = 0.0
    EMBED_EVERY = 0.1  # s; ~55 ms per embed on CPU, so keep the camera loop snappy
    embed_ms = 0.0
    learned = None
    print(f"[lab] dataset: {dataset.counts()}  head: {'loaded' if head else 'none'}")

    with Kinect() as kinect:
        fps, last = 0.0, time.monotonic()
        while True:
            frame = kinect.read()
            if frame is None:
                continue
            now = time.monotonic()
            pose = tracker.process(frame, kinect)

            vec = None
            if pose is None:
                learned = None
            elif (head and learned_on or recording) and now - last_embed >= EMBED_EVERY:
                last_embed = now
                bbox = person_bbox(pose, frame.color.shape)
                t0 = time.monotonic()
                vec = embedder.embed(frame.color, bbox)
                embed_ms = 0.8 * embed_ms + 0.2 * (time.monotonic() - t0) * 1000
                learned = head.predict_proba(vec) if (head and learned_on) else None
            # else: keep the previous `learned` until the next embed
            if recording and now > rec_held_until:
                recording = None
            if recording and vec is not None and now - last_record >= 0.1:  # ~10 samples/s
                dataset.add(vec, recording)
                last_record = now

            result = clf.update(pose, now, learned)
            if result.fired:
                flash_until[result.fired] = now + 1.5

            image = frame.color
            if show_depth:
                colored = cv2.applyColorMap(cv2.convertScaleAbs(frame.depth, alpha=255 / 4000), cv2.COLORMAP_TURBO)
                cv2.addWeighted(image, 0.5, colored, 0.5, 0, image)
            if pose is not None:
                draw_pose(image, pose)
            image = cv2.flip(image, 1)

            fps = 0.9 * fps + 0.1 / max(now - last, 1e-6)
            last = now
            head = f"{fps:4.1f} fps"
            if pose is None:
                head += "   no player in view"
            else:
                d = distance_m(pose)
                head += f"   {d:.2f} m" if d is not None else "   ? m"
            text(image, head, (20, 36), 0.7)
            if result.winner != IDLE:
                text(image, LABELS.get(result.winner, result.winner).upper(), (20, 90), 1.4, (80, 230, 110), 3)

            panel = draw_panel(image.shape[0], result, flash_until, now, recording, dataset.counts(), learned_on, head, embed_ms)
            cv2.imshow(WINDOW, np.hstack([image, panel]))
            key = cv2.waitKey(1) & 0xFF
            if key == ord("q"):
                break
            if key == ord("d"):
                show_depth = not show_depth
            if key == ord("r"):
                clf.reset()
                flash_until.clear()
            if key == ord("l"):
                learned_on = not learned_on
            if key == ord("x"):
                drop_armed = True
            if key == ord("t"):
                new_head = Head.train(dataset)
                if new_head:
                    head = new_head
                    head.save()
                    dataset.save()
                    print(f"[lab] trained on {len(dataset)} samples: {dataset.counts()}")
                else:
                    print("[lab] need at least 10 samples in two or more classes to train")
            if key in KEY_LABELS:
                label = KEY_LABELS[key]
                if drop_armed:
                    n = dataset.drop(label)
                    dataset.save()
                    print(f"[lab] dropped {n} samples of {label}")
                    drop_armed = False
                else:
                    recording = label
                    rec_held_until = now + 0.35  # key auto-repeat keeps extending this while held
            elif key != 255:
                drop_armed = False

    dataset.save()
    tracker.close()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
