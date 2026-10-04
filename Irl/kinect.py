"""Azure Kinect capture: colour frames with depth aligned to the colour camera."""

import time
from dataclasses import dataclass

import numpy as np
import pykinect_azure as pykinect


@dataclass
class Frame:
    color: np.ndarray  # HxWx3 BGR
    depth: np.ndarray  # HxW uint16 millimetres, aligned to `color`; 0 = no reading


class Kinect:
    STALL_S = 3.0  # this long without a usable frame = the stream is dead; reopen the device

    def __init__(self, device_index: int = 0):
        pykinect.initialize_libraries()
        self._device_index = device_index
        self.dropped = 0
        self._bad_since: float | None = None
        self._open()

    def _open(self) -> None:
        config = pykinect.default_configuration
        config.color_format = pykinect.K4A_IMAGE_FORMAT_COLOR_MJPG
        config.color_resolution = pykinect.K4A_COLOR_RESOLUTION_720P
        # NFOV unbinned has the longest usable range (0.5-3.86 m), which suits a standing player.
        config.depth_mode = pykinect.K4A_DEPTH_MODE_NFOV_UNBINNED
        config.camera_fps = pykinect.K4A_FRAMES_PER_SECOND_30
        config.synchronized_images_only = True

        # pykinect prints and calls sys.exit(1) if the device can't be opened.
        self._device = pykinect.start_device(device_index=self._device_index, config=config)

        intrinsics = self._device.calibration.color_params
        self.fx, self.fy = intrinsics.fx, intrinsics.fy
        self.cx, self.cy = intrinsics.cx, intrinsics.cy

    def read(self) -> Frame | None:
        """Next capture, or None if it was unusable.

        A single dropped frame is skipped. If nothing usable arrives for STALL_S (a USB hiccup
        leaves the SDK's capture queue disabled for good), the device is closed and reopened,
        and that keeps being retried until it comes back. Callers just keep calling read().
        """
        frame = self._read_once()
        if frame is not None:
            self._bad_since = None
            return frame
        now = time.monotonic()
        if self._bad_since is None:
            self._bad_since = now
        elif now - self._bad_since > self.STALL_S:
            self._reopen()
            self._bad_since = time.monotonic()
        else:
            time.sleep(0.01)  # failures return instantly; don't spin a core
        return None

    def _reopen(self) -> None:
        print("[kinect] stream stalled, reopening the device")
        try:
            self._device.close()
        except BaseException:  # noqa: BLE001 - includes pykinect's SystemExit
            pass
        try:
            self._open()
            print("[kinect] reconnected")
        except BaseException as err:  # noqa: BLE001
            print(f"[kinect] reopen failed ({err!r}); retrying in a few seconds (is it plugged in?)")

    def _read_once(self) -> Frame | None:
        try:
            capture = self._device.update()
            ok_color, color = capture.get_color_image()
            ok_depth, depth = capture.get_transformed_depth_image()
        except (SystemExit, Exception) as err:
            # pykinect calls sys.exit() on a dropped capture ("Get capture failed!").
            self.dropped += 1
            if self.dropped in (1, 10, 100) or self.dropped % 1000 == 0:
                print(f"[kinect] dropped capture #{self.dropped} ({type(err).__name__})")
            return None
        if not (ok_color and ok_depth) or color is None:
            return None
        return Frame(color=color, depth=depth)

    def close(self):
        self._device.close()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()
