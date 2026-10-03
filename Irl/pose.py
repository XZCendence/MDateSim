"""Pose estimation: MediaPipe landmarks on the colour image, lifted to 3D with Kinect depth."""

import time
from dataclasses import dataclass
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks.python import BaseOptions, vision

from kinect import Frame, Kinect

MODEL_PATH = Path(__file__).parent / "models" / "pose_landmarker_full.task"

Joint = vision.PoseLandmark  # NOSE, LEFT_WRIST, RIGHT_SHOULDER, ... (left/right are the player's own)
CONNECTIONS = [(c.start, c.end) for c in vision.PoseLandmarksConnections.POSE_LANDMARKS]

VISIBLE = 0.5  # visibility above this counts as "the joint is actually in view"


@dataclass
class Pose:
    """One tracked person. All arrays are indexed by `Joint`."""

    pixels: np.ndarray  # (33, 2) x, y in colour-image pixels
    visibility: np.ndarray  # (33,) 0..1
    xyz: np.ndarray  # (33, 3) metres in camera space (x right, y down, z away); NaN where depth is missing
    local: np.ndarray  # (33, 3) MediaPipe's own metric estimate, origin at mid-hip; always populated

    def visible(self, *joints: Joint) -> bool:
        return all(self.visibility[j] > VISIBLE for j in joints)


class PoseTracker:
    def __init__(self, model_path: Path = MODEL_PATH):
        options = vision.PoseLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=str(model_path)),
            running_mode=vision.RunningMode.VIDEO,
            num_poses=1,
        )
        self._landmarker = vision.PoseLandmarker.create_from_options(options)
        self._last_timestamp_ms = -1

    def process(self, frame: Frame, kinect: Kinect) -> Pose | None:
        rgb = cv2.cvtColor(frame.color, cv2.COLOR_BGR2RGB)
        image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)

        # VIDEO mode requires strictly increasing timestamps.
        timestamp_ms = max(time.monotonic_ns() // 1_000_000, self._last_timestamp_ms + 1)
        self._last_timestamp_ms = timestamp_ms

        result = self._landmarker.detect_for_video(image, timestamp_ms)
        if not result.pose_landmarks:
            return None

        landmarks = result.pose_landmarks[0]
        height, width = frame.color.shape[:2]
        pixels = np.array([[lm.x * width, lm.y * height] for lm in landmarks], dtype=np.float32)
        visibility = np.array([lm.visibility for lm in landmarks], dtype=np.float32)
        local = np.array([[lm.x, lm.y, lm.z] for lm in result.pose_world_landmarks[0]], dtype=np.float32)

        # Pinhole back-projection; ignores lens distortion, which is small at these ranges.
        z = np.array([_depth_at(frame.depth, u, v) for u, v in pixels], dtype=np.float32)
        x = (pixels[:, 0] - kinect.cx) * z / kinect.fx
        y = (pixels[:, 1] - kinect.cy) * z / kinect.fy

        return Pose(pixels=pixels, visibility=visibility, xyz=np.stack([x, y, z], axis=1), local=local)

    def close(self):
        self._landmarker.close()


def _depth_at(depth: np.ndarray, u: float, v: float, radius: int = 3) -> float:
    """Median valid depth in metres around pixel (u, v), or NaN if there's no reading."""
    height, width = depth.shape
    u, v = int(round(u)), int(round(v))
    if not (0 <= u < width and 0 <= v < height):
        return np.nan
    patch = depth[max(v - radius, 0) : v + radius + 1, max(u - radius, 0) : u + radius + 1]
    valid = patch[patch > 0]
    return float(np.median(valid)) / 1000.0 if valid.size else np.nan


def draw_pose(image: np.ndarray, pose: Pose) -> None:
    """Draw the skeleton onto a BGR image in place."""
    points = pose.pixels.astype(int)
    for a, b in CONNECTIONS:
        if pose.visible(a, b):
            cv2.line(image, tuple(points[a]), tuple(points[b]), (255, 200, 80), 2, cv2.LINE_AA)
    for joint, point in enumerate(points):
        if pose.visible(joint):
            cv2.circle(image, tuple(point), 4, (80, 80, 255), -1, cv2.LINE_AA)
