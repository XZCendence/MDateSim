"""Azure Kinect capture: colour frames with depth aligned to the colour camera."""

from dataclasses import dataclass

import numpy as np
import pykinect_azure as pykinect


@dataclass
class Frame:
    color: np.ndarray  # HxWx3 BGR
    depth: np.ndarray  # HxW uint16 millimetres, aligned to `color`; 0 = no reading


class Kinect:
    def __init__(self, device_index: int = 0):
        pykinect.initialize_libraries()

        config = pykinect.default_configuration
        config.color_format = pykinect.K4A_IMAGE_FORMAT_COLOR_MJPG
        config.color_resolution = pykinect.K4A_COLOR_RESOLUTION_720P
        # NFOV unbinned has the longest usable range (0.5-3.86 m), which suits a standing player.
        config.depth_mode = pykinect.K4A_DEPTH_MODE_NFOV_UNBINNED
        config.camera_fps = pykinect.K4A_FRAMES_PER_SECOND_30
        config.synchronized_images_only = True

        # pykinect prints and calls sys.exit(1) if the device can't be opened.
        self._device = pykinect.start_device(device_index=device_index, config=config)

        intrinsics = self._device.calibration.color_params
        self.fx, self.fy = intrinsics.fx, intrinsics.fy
        self.cx, self.cy = intrinsics.cx, intrinsics.cy

    def read(self) -> Frame | None:
        """Block until the next capture. Returns None if the capture was unusable."""
        capture = self._device.update()
        ok_color, color = capture.get_color_image()
        ok_depth, depth = capture.get_transformed_depth_image()
        if not (ok_color and ok_depth) or color is None:
            return None
        return Frame(color=color, depth=depth)

    def close(self):
        self._device.close()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()
