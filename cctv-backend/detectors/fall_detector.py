"""Sudden fall detection (visual-based) using posture LSTM model.

Uses:
- models/posture_model_best.pth
- posture_module/model.py (PostureClassifier)
- MediaPipe Pose to build frame-wise skeleton sequences
"""

from __future__ import annotations

import os
from collections import deque
from typing import Dict, List, Tuple

import cv2
import numpy as np
import torch


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

# model feature settings from posture_module
NUM_LANDMARKS = 33
FEATURE_DIM = NUM_LANDMARKS * 2


_cached_classifier = None
_cached_model_path: str | None = None


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
    """Normalize pose exactly like posture_module/extract_pose_sequences.py."""
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


def _load_classifier(model_path: str):
    global _cached_classifier, _cached_model_path
    if _cached_classifier is not None and _cached_model_path == model_path:
        return _cached_classifier

    try:
        from posture_module.model import PostureClassifier
    except Exception as exc:
        raise RuntimeError(
            "Fall detector requires `cctv-backend/posture_module/model.py` "
            f"with PostureClassifier. Import error: {exc}"
        )

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    clf = PostureClassifier(model_path=model_path, device=device)

    _cached_classifier = clf
    _cached_model_path = model_path
    return clf


def detect(video_path: str, model_dir: str):
    """Yield sudden-fall events for SSE streaming.

    Yields event dicts:
        {"time": <seconds>, "confidence": <0-100>, "label": "Sudden Fall"}
    """
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
    last_emit_time = -1e9

    try:
        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        frame_idx = 0

        while True:
            ret, frame = cap.read()
            if not ret:
                break

            frame_idx += 1
            t_sec = frame_idx / fps

            img_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            res = pose.process(img_rgb)

            if res.pose_landmarks:
                lm = res.pose_landmarks.landmark
                landmarks = np.array([[p.x, p.y, p.visibility] for p in lm], dtype=np.float32)
                if landmarks.shape[0] == NUM_LANDMARKS:
                    pose_vec = _normalize_skeleton(landmarks)
                else:
                    pose_vec = np.zeros(FEATURE_DIM, dtype=np.float32)
            else:
                pose_vec = np.zeros(FEATURE_DIM, dtype=np.float32)

            seq.append(pose_vec)
            if len(seq) < SEQUENCE_LENGTH:
                continue

            x = np.stack(seq, axis=0)
            x_t = torch.from_numpy(x).float().unsqueeze(0).to(clf.device)

            with torch.no_grad():
                probs = clf.model.predict_proba(x_t)[0].detach().cpu().numpy()

            fall_prob = float(probs[fall_idx]) if fall_idx < len(probs) else 0.0
            lying_prob = float(probs[lying_idx]) if lying_idx < len(probs) else 0.0

            trigger = (fall_prob >= FALL_THRESHOLD) or (lying_prob >= LYING_THRESHOLD)
            if not trigger:
                continue

            if (t_sec - last_emit_time) < EVENT_COOLDOWN_SEC:
                continue

            conf = max(fall_prob, lying_prob)
            label = "Sudden Fall"
            last_emit_time = t_sec

            yield {
                "time": round(t_sec, 2),
                "confidence": round(conf * 100.0, 1),
                "label": label,
            }
    finally:
        cap.release()
        pose.close()
