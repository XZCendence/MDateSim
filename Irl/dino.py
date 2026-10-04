"""Learned pose classifier: frozen DINOv2 embeddings + a tiny logistic-regression head.

    emb = DinoEmbedder()                  # loads facebook/dinov2-small once (CPU is fine)
    v = emb.embed(frame_bgr, bbox)        # 384-d vector for the person crop

    ds = Dataset.load()                   # Irl/data/poses.npz (embeddings + labels)
    ds.add(v, "kneel")
    ds.save()

    head = Head.train(ds)                 # seconds on CPU; saved to Irl/data/head.pkl
    head.predict_proba(v) -> {"idle": .9, "kneel": .05, ...}

Labels are the gesture names from gestures.DETECTORS plus "idle". Dynamic moves
(jacks, dance) can be recorded too, but the geometric detectors still own counting.
"""

from __future__ import annotations

import pickle
import time
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np

DATA_DIR = Path(__file__).parent / "data"
DATASET_PATH = DATA_DIR / "poses.npz"
HEAD_PATH = DATA_DIR / "head.pkl"
MODEL_ID = "facebook/dinov2-small"
IDLE = "idle"


# --------------------------------------------------------------- embedder ---


class DinoEmbedder:
    """Frozen DINOv2; returns the CLS embedding of a person crop. Lazy so importing is cheap."""

    def __init__(self, model_id: str = MODEL_ID, size: int = 224, device: str | None = None):
        import torch
        from transformers import AutoImageProcessor, AutoModel

        self.torch = torch
        self.size = size
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        t0 = time.monotonic()
        self.processor = AutoImageProcessor.from_pretrained(model_id)
        self.model = AutoModel.from_pretrained(model_id).to(self.device).eval()
        self.dim = self.model.config.hidden_size
        print(f"[dino] {model_id} on {self.device} ({time.monotonic() - t0:.1f}s)")

    def embed(self, frame_bgr: np.ndarray, bbox: tuple[int, int, int, int] | None = None) -> np.ndarray:
        """bbox = (x0, y0, x1, y1) in pixels; None uses the whole frame."""
        crop = frame_bgr
        if bbox is not None:
            x0, y0, x1, y1 = bbox
            crop = frame_bgr[max(y0, 0) : max(y1, y0 + 1), max(x0, 0) : max(x1, x0 + 1)]
        rgb = cv2.cvtColor(_square(crop, self.size), cv2.COLOR_BGR2RGB)
        inputs = self.processor(images=rgb, return_tensors="pt", do_resize=False, do_center_crop=False)
        with self.torch.no_grad():
            out = self.model(pixel_values=inputs["pixel_values"].to(self.device))
        v = out.last_hidden_state[0, 0].float().cpu().numpy()  # CLS token
        return v / (np.linalg.norm(v) + 1e-8)


def _square(img: np.ndarray, size: int) -> np.ndarray:
    """Letterbox to a square of `size`, keeping aspect, so the pose isn't squashed."""
    h, w = img.shape[:2]
    scale = size / max(h, w, 1)
    resized = cv2.resize(img, (max(int(w * scale), 1), max(int(h * scale), 1)), interpolation=cv2.INTER_AREA)
    out = np.zeros((size, size, 3), np.uint8)
    y, x = (size - resized.shape[0]) // 2, (size - resized.shape[1]) // 2
    out[y : y + resized.shape[0], x : x + resized.shape[1]] = resized
    return out


def person_bbox(pose, frame_shape: tuple[int, ...], pad: float = 0.15) -> tuple[int, int, int, int] | None:
    """Bounding box around the visible landmarks, padded. None if we can't see enough of them."""
    vis = pose.visibility > 0.5
    if vis.sum() < 6:
        return None
    pts = pose.pixels[vis]
    x0, y0 = pts.min(axis=0)
    x1, y1 = pts.max(axis=0)
    px, py = (x1 - x0) * pad, (y1 - y0) * pad
    h, w = frame_shape[:2]
    return (int(max(x0 - px, 0)), int(max(y0 - py, 0)), int(min(x1 + px, w)), int(min(y1 + py, h)))


# ---------------------------------------------------------------- dataset ---


@dataclass
class Dataset:
    X: list[np.ndarray] = field(default_factory=list)
    y: list[str] = field(default_factory=list)

    @classmethod
    def load(cls, path: Path = DATASET_PATH) -> "Dataset":
        if not path.exists():
            return cls()
        z = np.load(path, allow_pickle=False)
        return cls(X=list(z["X"]), y=[str(s) for s in z["y"]])

    def save(self, path: Path = DATASET_PATH) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        np.savez_compressed(path, X=np.array(self.X, dtype=np.float32), y=np.array(self.y))

    def add(self, v: np.ndarray, label: str) -> None:
        self.X.append(v.astype(np.float32))
        self.y.append(label)

    def drop(self, label: str) -> int:
        keep = [i for i, l in enumerate(self.y) if l != label]
        n = len(self.y) - len(keep)
        self.X = [self.X[i] for i in keep]
        self.y = [self.y[i] for i in keep]
        return n

    def counts(self) -> dict[str, int]:
        out: dict[str, int] = {}
        for l in self.y:
            out[l] = out.get(l, 0) + 1
        return out

    def __len__(self) -> int:
        return len(self.y)


# ------------------------------------------------------------------- head ---


class Head:
    """Logistic regression over embeddings. Tiny, trains in well under a second."""

    def __init__(self, clf, classes: list[str]):
        self.clf = clf
        self.classes = [str(c) for c in classes]

    @classmethod
    def train(cls, ds: Dataset, min_per_class: int = 10) -> "Head | None":
        from sklearn.linear_model import LogisticRegression

        counts = ds.counts()
        usable = [l for l, n in counts.items() if n >= min_per_class]
        if len(usable) < 2:
            return None
        idx = [i for i, l in enumerate(ds.y) if l in usable]
        X = np.array([ds.X[i] for i in idx], dtype=np.float32)
        y = [ds.y[i] for i in idx]
        clf = LogisticRegression(C=2.0, max_iter=2000, class_weight="balanced")
        clf.fit(X, y)
        return cls(clf, list(clf.classes_))

    def predict_proba(self, v: np.ndarray) -> dict[str, float]:
        p = self.clf.predict_proba(v[None, :].astype(np.float32))[0]
        return {str(c): float(pi) for c, pi in zip(self.classes, p)}

    def save(self, path: Path = HEAD_PATH) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "wb") as f:
            pickle.dump({"clf": self.clf, "classes": self.classes}, f)

    @classmethod
    def load(cls, path: Path = HEAD_PATH) -> "Head | None":
        if not path.exists():
            return None
        with open(path, "rb") as f:
            d = pickle.load(f)
        return cls(d["clf"], d["classes"])
