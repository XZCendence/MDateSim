"""Live viewer: Kinect colour feed with depth and skeleton overlays and a gesture readout.

Keys: 1-7 pick the demand to test, r resets it, d toggles the depth overlay, q quits.
"""

import time

import cv2

from gestures import DETECTORS, distance_m, make
from kinect import Kinect
from pose import PoseTracker, draw_pose

WINDOW = "MDateSim IRL"
DEPTH_MAX_MM = 4000  # top of the colour scale; the depth mode reads out to ~3.86 m
DEMAND_KEYS = {ord(str(i + 1)): name for i, name in enumerate(DETECTORS)}  # 1=kneel, 2=bow, ...


def overlay_depth(image, depth):
    """Tint a BGR image in place with colourised depth wherever there's a reading."""
    colored = cv2.applyColorMap(cv2.convertScaleAbs(depth, alpha=255 / DEPTH_MAX_MM), cv2.COLORMAP_TURBO)
    blended = cv2.addWeighted(image, 0.4, colored, 0.6, 0)
    valid = depth > 0
    image[valid] = blended[valid]


def draw_meter(image, progress, done):
    h, w = image.shape[:2]
    x0, y0, x1, y1 = 20, h - 40, w - 20, h - 20
    cv2.rectangle(image, (x0, y0), (x1, y1), (60, 60, 60), -1)
    fill = int(x0 + (x1 - x0) * max(0.0, min(1.0, progress)))
    cv2.rectangle(image, (x0, y0), (fill, y1), (80, 220, 80) if done else (80, 160, 255), -1)


def main():
    tracker = PoseTracker()
    demand = next(iter(DETECTORS))
    detector = make(demand)
    done_at = None
    show_depth = True

    with Kinect() as kinect:
        fps, last = 0.0, time.monotonic()
        while True:
            frame = kinect.read()
            if frame is None:
                continue

            pose = tracker.process(frame, kinect)
            if detector.update(pose):
                done_at = time.monotonic()

            image = frame.color
            if show_depth:
                overlay_depth(image, frame.depth)
            if pose is not None:
                draw_pose(image, pose)
            image = cv2.flip(image, 1)  # mirror, so it reads like a selfie view

            now = time.monotonic()
            fps = 0.9 * fps + 0.1 / max(now - last, 1e-6)
            last = now

            lines = [f"{fps:4.1f} fps", f"demand: {demand}  [1-{len(DETECTORS)} to switch, r reset]"]
            if pose is None:
                lines.append("no player in view")
            else:
                distance = distance_m(pose)
                lines.append(f"distance: {distance:.2f} m" if distance is not None else "distance: ?")
                lines.append(f"status: {detector.status}")
            if detector.done:
                lines.append(f"DONE  ({now - done_at:.1f}s ago)")
            for i, line in enumerate(lines):
                cv2.putText(image, line, (20, 36 + 30 * i), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 0), 4, cv2.LINE_AA)
                cv2.putText(image, line, (20, 36 + 30 * i), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2, cv2.LINE_AA)
            draw_meter(image, detector.progress, detector.done)

            cv2.imshow(WINDOW, image)
            key = cv2.waitKey(1) & 0xFF
            if key == ord("q"):
                break
            if key == ord("d"):
                show_depth = not show_depth
            if key == ord("r"):
                detector.reset()
                done_at = None
            if key in DEMAND_KEYS:
                demand = DEMAND_KEYS[key]
                detector = make(demand)
                done_at = None

    tracker.close()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
