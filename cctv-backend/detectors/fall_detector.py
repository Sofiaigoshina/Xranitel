"""Sudden fall detection (visual-based) using posture LSTM model.

Uses:
- models/posture_model_best.pth
- in-file posture model + classifier
- MediaPipe Pose to build frame-wise skeleton sequences
"""

from __future__ import annotations

import os
from collections import deque
from typing import Iterator, List

import cv2
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F


# ===========================================================================
# CONFIGURATION — tweak these values as needed
# ===========================================================================

MODEL_FILENAME = "posture_model_best.pth"
SEQUENCE_LENGTH = 60
MIN_DETECTION_CONFIDENCE = 0.5
MIN_TRACKING_CONFIDENCE = 0.5
FALL_THRESHOLD = 0.55
LYING_THRESHOLD = 0.60
EVENT_COOLDOWN_SEC = 2.0

# model feature settings for posture sequence model
NUM_LANDMARKS = 33
FEATURE_DIM = NUM_LANDMARKS * 2


_cached_classifier = None
_cached_model_path: str | None = None


def _empty_pose_vector() -> np.ndarray:
    """Return an empty fallback pose vector with the right model feature size."""
    return np.zeros(FEATURE_DIM, dtype=np.float32)


def _prob_at(probs: np.ndarray, idx: int) -> float:
    """Read probability at index safely (returns 0.0 if index is out of range)."""
    return float(probs[idx]) if idx < len(probs) else 0.0


class PostureLSTM(nn.Module):
    """LSTM model for classifying posture sequences."""

    def __init__(self, input_size=66, hidden_size=128, num_layers=2, num_classes=3, dropout=0.3):
        super().__init__()

        self.lstm = nn.LSTM(
            input_size=input_size,
            hidden_size=hidden_size,
            num_layers=num_layers,
            batch_first=True,
            dropout=dropout if num_layers > 1 else 0,
            bidirectional=True,
        )

        self.attention = nn.Sequential(
            nn.Linear(hidden_size * 2, hidden_size),
            nn.Tanh(),
            nn.Linear(hidden_size, 1),
        )

        self.fc1 = nn.Linear(hidden_size * 2, hidden_size)
        self.dropout = nn.Dropout(dropout)
        self.fc2 = nn.Linear(hidden_size, num_classes)

    def forward(self, x):
        lstm_out, _ = self.lstm(x)

        attention_weights = self.attention(lstm_out)
        attention_weights = F.softmax(attention_weights, dim=1)
        attended = torch.sum(attention_weights * lstm_out, dim=1)

        out = F.relu(self.fc1(attended))
        out = self.dropout(out)
        logits = self.fc2(out)
        return logits

    def predict_proba(self, x):
        with torch.no_grad():
            logits = self.forward(x)
            return F.softmax(logits, dim=1)


class PostureClassifier:
    """Wrapper class for easier inference."""

    def __init__(self, model_path=None, device=None):
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self.model = PostureLSTM()

        if model_path and os.path.exists(model_path):
            self.model.load_state_dict(torch.load(model_path, map_location=self.device))

        self.model.to(self.device)
        self.model.eval()
        self.class_names = ["normal", "fall", "lying"]


def _bbox_from_landmarks(landmarks: np.ndarray, visibility_thresh: float = 0.2) -> List[float] | None:
    """Build normalized [x1, y1, x2, y2] bbox from MediaPipe landmarks."""
    if landmarks.shape[0] == 0:
        return None

    vis = landmarks[:, 2] if landmarks.shape[1] >= 3 else np.ones((landmarks.shape[0],), dtype=np.float32)
    pts = landmarks[vis >= visibility_thresh][:, :2]
    if pts.shape[0] < 4:
        pts = landmarks[:, :2]

    x1 = float(np.clip(np.min(pts[:, 0]), 0.0, 1.0))
    y1 = float(np.clip(np.min(pts[:, 1]), 0.0, 1.0))
    x2 = float(np.clip(np.max(pts[:, 0]), 0.0, 1.0))
    y2 = float(np.clip(np.max(pts[:, 1]), 0.0, 1.0))

    if (x2 - x1) <= 0.01 or (y2 - y1) <= 0.01:
        return None

    return [round(x1, 4), round(y1, 4), round(x2, 4), round(y2, 4)]


def _import_mediapipe_compat():
    """Import mediapipe with protobuf compatibility fallback.

    Fixes runtime errors like:
      'google._upb._message.FieldDescriptor' object has no attribute 'label'
    """
    # Prefer python implementation for better compatibility with older pb2 code.
    os.environ.setdefault("PROTOCOL_BUFFERS_PYTHON_IMPLEMENTATION", "python")

    try:
        import mediapipe as mp  # type: ignore
        return mp
    except Exception as exc:
        raise RuntimeError(
            "Sudden Fall detector failed to import mediapipe. "
            "This is often caused by protobuf version incompatibility. "
            "Install compatible deps (e.g., protobuf<4,>=3.20.3) and retry. "
            f"Import error: {exc}"
        )


def _normalize_skeleton(landmarks: np.ndarray) -> np.ndarray:
    """Normalize pose for posture sequence inference."""
    left_hip = landmarks[23][:2]
    right_hip = landmarks[24][:2]
    center = (left_hip + right_hip) / 2.0
    coords = landmarks[:, :2] - center

    left_shoulder = landmarks[11][:2]
    right_shoulder = landmarks[12][:2]
    shoulders_center = (left_shoulder + right_shoulder) / 2.0
    hips_center = (left_hip + right_hip) / 2.0

    torso_height = np.linalg.norm(shoulders_center - hips_center) + 1e-6
    coords = coords / torso_height
    return coords.flatten().astype(np.float32)


def _extract_pose_vector_and_bbox(result) -> tuple[np.ndarray, List[float] | None]:
    """Convert MediaPipe result to (pose_vector, bbox)."""
    if not result.pose_landmarks:
        return _empty_pose_vector(), None

    lm = result.pose_landmarks.landmark
    landmarks = np.array([[p.x, p.y, p.visibility] for p in lm], dtype=np.float32)
    bbox = _bbox_from_landmarks(landmarks)

    if landmarks.shape[0] != NUM_LANDMARKS:
        return _empty_pose_vector(), bbox

    return _normalize_skeleton(landmarks), bbox


def _load_classifier(model_path: str):
    global _cached_classifier, _cached_model_path
    if _cached_classifier is not None and _cached_model_path == model_path:
        return _cached_classifier

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    clf = PostureClassifier(model_path=model_path, device=device)

    _cached_classifier = clf
    _cached_model_path = model_path
    return clf


def stream_inference(
    video_path: str,
    model_dir: str,
    *,
    infer_fps: float | None = None,
) -> Iterator[dict]:
    """Yield per-window fall posture predictions in timeline order."""
    model_path = os.path.join(model_dir, MODEL_FILENAME)
    if not os.path.exists(model_path):
        raise FileNotFoundError(
            f"Posture model not found at {model_path}. "
            f"Place your .pth file as {MODEL_FILENAME} inside models/."
        )

    clf = _load_classifier(model_path)
    class_names = getattr(clf, "class_names", ["normal", "fall", "lying"])
    fall_idx = class_names.index("fall") if "fall" in class_names else 1
    lying_idx = class_names.index("lying") if "lying" in class_names else 2

    mp = _import_mediapipe_compat()

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video: {video_path}")

    pose = mp.solutions.pose.Pose(
        static_image_mode=False,
        model_complexity=1,
        enable_segmentation=False,
        min_detection_confidence=MIN_DETECTION_CONFIDENCE,
        min_tracking_confidence=MIN_TRACKING_CONFIDENCE,
    )

    seq = deque(maxlen=SEQUENCE_LENGTH)
    last_bbox: List[float] | None = None

    try:
        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        target_infer_fps = float(infer_fps) if infer_fps is not None else fps
        target_infer_fps = max(1.0, target_infer_fps)
        frame_stride = max(1, int(round(float(fps) / target_infer_fps)))
        frame_idx = 0

        while True:
            ret, frame = cap.read()
            if not ret:
                break

            frame_idx += 1
            if frame_idx % frame_stride != 0:
                continue

            t_sec = frame_idx / fps
            end_t = t_sec + (frame_stride / fps)

            img_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            res = pose.process(img_rgb)

            pose_vec, detected_bbox = _extract_pose_vector_and_bbox(res)
            if detected_bbox is not None:
                last_bbox = detected_bbox

            seq.append(pose_vec)
            if len(seq) < SEQUENCE_LENGTH:
                continue

            x = np.stack(seq, axis=0)
            x_t = torch.from_numpy(x).float().unsqueeze(0).to(clf.device)

            with torch.no_grad():
                probs = clf.model.predict_proba(x_t)[0].detach().cpu().numpy()

            fall_prob = _prob_at(probs, fall_idx)
            lying_prob = _prob_at(probs, lying_idx)
            conf = max(fall_prob, lying_prob)
            is_detection = (fall_prob >= FALL_THRESHOLD) or (lying_prob >= LYING_THRESHOLD)

            yield {
                "time": round(t_sec, 2),
                "end_time": round(end_t, 2),
                "confidence": round(conf * 100.0, 1),
                "label": "Падение" if is_detection else "Нормальная поза",
                "prediction_label": "Падение" if is_detection else "Нормальная поза",
                "is_detection": is_detection,
                "bbox": last_bbox,
            }
    finally:
        cap.release()
        pose.close()


def detect(video_path: str, model_dir: str):
    """Yield sudden-fall events for SSE streaming.

    Yields event dicts:
        {"time": <seconds>, "confidence": <0-100>, "label": "Sudden Fall"}
    """
    last_emit_time = -1e9

    for frame_result in stream_inference(video_path, model_dir):
        if not frame_result.get("is_detection"):
            continue

        t_sec = float(frame_result.get("time", 0.0) or 0.0)
        if (t_sec - last_emit_time) < EVENT_COOLDOWN_SEC:
            continue

        last_emit_time = t_sec
        yield {
            "time": frame_result.get("time", 0.0),
            "end_time": frame_result.get("end_time"),
            "confidence": frame_result.get("confidence", 0.0),
            "label": "Падение",
            "bbox": frame_result.get("bbox"),
        }
