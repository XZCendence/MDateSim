"""Pose lab: live probabilities for every gesture (plus idle), with the winner highlighted.

Right-hand panel shows one bar per class. A gesture only lights up green when it
clearly beats idle; otherwise idle stays on top and nothing is forced.

Keys: r reset all detectors, d toggle depth overlay, q quit.
"""

import time

import cv2
import numpy as np

from classifier import IDLE, PoseClassifier
from gestures import distance_m
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
    "spin": "spin around",
    "heart": "heart hands",
    "blow_kiss": "blow a kiss",
    "kiss": "kiss",
}


def text(img, s, xy, scale=0.7, color=(255, 255, 255), thick=2):
    cv2.putText(img, s, xy, FONT, scale, (0, 0, 0), thick + 2, cv2.LINE_AA)
    cv2.putText(img, s, xy, FONT, scale, color, thick, cv2.LINE_AA)


def draw_panel(height, result, flash_until, now):
    panel = np.full((height, PANEL_W, 3), (24, 24, 28), np.uint8)
    text(panel, "what she thinks you're doing", (16, 34), 0.6, (180, 180, 190), 1)
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
        text(panel, f"{label}", (bar_x0 + 8, y + 19), 0.6, (255, 255, 255), 2)
        text(panel, f"{p * 100:3.0f}%", (bar_x1 - 70, y + 19), 0.6, (255, 255, 255), 2)
        status = result.statuses.get(name, "")
        if name != IDLE and status:
            text(panel, status, (bar_x0 + 8, y + 42), 0.45, (170, 170, 180), 1)
        if fired:
            text(panel, "DONE", (bar_x1 - 150, y + 19), 0.6, (90, 255, 120), 2)
        y += ROW_H
    text(panel, "r reset   d depth   q quit", (16, height - 16), 0.5, (140, 140, 150), 1)
    return panel


def main():
    tracker = PoseTracker()
    clf = PoseClassifier()
    flash_until: dict[str, float] = {}
    show_depth = False

    with Kinect() as kinect:
        fps, last = 0.0, time.monotonic()
        while True:
            frame = kinect.read()
            if frame is None:
                continue
            now = time.monotonic()
            pose = tracker.process(frame, kinect)
            result = clf.update(pose, now)
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

            panel = draw_panel(image.shape[0], result, flash_until, now)
            cv2.imshow(WINDOW, np.hstack([image, panel]))
            key = cv2.waitKey(1) & 0xFF
            if key == ord("q"):
                break
            if key == ord("d"):
                show_depth = not show_depth
            if key == ord("r"):
                clf.reset()
                flash_until.clear()

    tracker.close()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
