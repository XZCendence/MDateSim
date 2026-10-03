"""Live viewer: Kinect colour feed with depth and skeleton overlays and gesture readout.

Keys: d toggles the depth overlay, q quits.
"""

import time

import cv2

from gestures import WaveDetector, distance_m, hands_raised
from kinect import Kinect
from pose import PoseTracker, draw_pose

WINDOW = "MDateSim IRL"
DEPTH_MAX_MM = 4000  # top of the colour scale; the depth mode reads out to ~3.86 m


def overlay_depth(image, depth):
    """Tint a BGR image in place with colourised depth wherever there's a reading."""
    colored = cv2.applyColorMap(cv2.convertScaleAbs(depth, alpha=255 / DEPTH_MAX_MM), cv2.COLORMAP_TURBO)
    blended = cv2.addWeighted(image, 0.4, colored, 0.6, 0)
    valid = depth > 0
    image[valid] = blended[valid]


def main():
    tracker = PoseTracker()
    wave = WaveDetector()
    show_depth = True

    with Kinect() as kinect:
        fps, last = 0.0, time.monotonic()
        while True:
            frame = kinect.read()
            if frame is None:
                continue

            pose = tracker.process(frame, kinect)
            waving = wave.update(pose)

            image = frame.color
            if show_depth:
                overlay_depth(image, frame.depth)
            if pose is not None:
                draw_pose(image, pose)
            image = cv2.flip(image, 1)  # mirror, so it reads like a selfie view

            now = time.monotonic()
            fps = 0.9 * fps + 0.1 / max(now - last, 1e-6)
            last = now

            lines = [f"{fps:4.1f} fps"]
            if pose is None:
                lines.append("no player in view")
            else:
                distance = distance_m(pose)
                lines.append(f"distance: {distance:.2f} m" if distance is not None else "distance: ?")
                lines.append(f"hands raised: {hands_raised(pose)}")
                lines.append(f"waving: {waving}")
            for i, line in enumerate(lines):
                cv2.putText(image, line, (16, 36 + 32 * i), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 0, 0), 4, cv2.LINE_AA)
                cv2.putText(image, line, (16, 36 + 32 * i), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (255, 255, 255), 2, cv2.LINE_AA)

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
