"""Fight detection (visual-based) using sliding-window video inference.

This detector is intentionally aligned with your provided `test.py` flow:
- loads `best_fight_model.pth`
- uses helpers from `fight_model.py` (`NUM_FRAMES`, `FRAME_SIZE`, `DEVICE`,
  `get_transforms`, `get_improved_model`)
- runs sliding-window inference and yields events in real time for SSE.
"""

from __future__ import annotations

import os
import math
import importlib
from collections import deque
from typing import Iterator, List, Tuple

import cv2
import torch
import numpy as np
from PIL import Image


# ===========================================================================
# CONFIGURATION — tweak these values as needed
# ===========================================================================

MODEL_FILENAME = "best_fight_model.pth"
CONF_THRESHOLD = 0.50
STRIDE_DIVISOR = 3          # stride = NUM_FRAMES // STRIDE_DIVISOR
WINDOW_BATCH_SIZE = 4       # number of clips per model forward pass
MIN_EVENT_GAP_SEC = 1.0     # suppress near-duplicate events from overlap
PROB_SMOOTH_RADIUS = 1      # local temporal smoothing over sliding windows
TARGET_INFER_FPS = 8.0      # cap effective model window-rate on very high FPS videos


# ---------------------------------------------------------------------------
# Cached model bundle
# ---------------------------------------------------------------------------

_cached_model = None
_cached_transforms = None
_cached_model_path: str | None = None
_cached_device = None
_cached_num_frames: int | None = None
_cached_frame_size: int | None = None


def _should_emit_event(confidence: float, start_frame: int, last_emit_frame: int, gap_frames: int) -> bool:
    """Return True when confidence is high enough and cooldown window has passed."""
    if confidence < CONF_THRESHOLD:
        return False
    if (start_frame - last_emit_frame) < gap_frames:
        return False
    return True


def _build_fight_event(start_frame: int, fps: float, confidence: float, bbox: List[float] | None) -> dict:
    """Build one fight event payload."""
    return {
        "time": round(start_frame / fps, 2),
        "confidence": round(confidence * 100.0, 1),
        "label": "Fight",
        "bbox": bbox,
    }


def _compute_motion_bbox(
    gray_frames: List[np.ndarray],
    start: int,
    end: int,
    min_area_ratio: float = 0.01,
) -> List[float] | None:
    """Estimate fight region using inter-frame motion and return normalized bbox.

    Returns [x1, y1, x2, y2] normalized to [0,1], or None if no stable motion.
    """
    if not gray_frames:
        return None

    start = max(0, min(start, len(gray_frames) - 1))
    end = max(start + 1, min(end, len(gray_frames)))
    if (end - start) < 2:
        return None

    h, w = gray_frames[start].shape[:2]
    motion = np.zeros((h, w), dtype=np.uint8)

    for idx in range(start + 1, end):
        prev_f = gray_frames[idx - 1]
        cur_f = gray_frames[idx]
        diff = cv2.absdiff(cur_f, prev_f)
        _, th = cv2.threshold(diff, 25, 255, cv2.THRESH_BINARY)
        th = cv2.medianBlur(th, 5)
        motion = cv2.bitwise_or(motion, th)

    kernel = np.ones((5, 5), np.uint8)
    motion = cv2.morphologyEx(motion, cv2.MORPH_CLOSE, kernel, iterations=2)

    contours, _ = cv2.findContours(motion, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None

    min_area = max(1.0, float(w * h) * float(min_area_ratio))
    valid = [c for c in contours if cv2.contourArea(c) >= min_area]
    if not valid:
        # fallback: use the largest contour so we still localize motion region
        valid = [max(contours, key=cv2.contourArea)]

    x1, y1, x2, y2 = w, h, 0, 0
    for c in valid:
        x, y, cw, ch = cv2.boundingRect(c)
        x1 = min(x1, x)
        y1 = min(y1, y)
        x2 = max(x2, x + cw)
        y2 = max(y2, y + ch)

    # Expand slightly so the highlighted region is not too tight
    pad_x = int(0.05 * max(1, (x2 - x1)))
    pad_y = int(0.05 * max(1, (y2 - y1)))
    x1 -= pad_x
    y1 -= pad_y
    x2 += pad_x
    y2 += pad_y

    # Clamp and normalize
    x1 = max(0, min(w - 1, x1))
    y1 = max(0, min(h - 1, y1))
    x2 = max(x1 + 1, min(w, x2))
    y2 = max(y1 + 1, min(h, y2))

    return [
        round(float(x1) / float(w), 4),
        round(float(y1) / float(h), 4),
        round(float(x2) / float(w), 4),
        round(float(y2) / float(h), 4),
    ]


def _compute_motion_bbox_clip(
    gray_clip: List[np.ndarray],
    min_area_ratio: float = 0.003,
    max_single_contour_ratio: float = 0.70,
) -> List[float] | None:
    """Estimate motion bbox from one temporal clip (original frame geometry).

    Uses robust contour filtering so camera noise/full-frame flicker is less likely
    to produce giant inaccurate boxes.
    """
    if not gray_clip or len(gray_clip) < 2:
        return None

    h, w = gray_clip[0].shape[:2]
    motion = np.zeros((h, w), dtype=np.uint8)

    for i in range(1, len(gray_clip)):
        prev_f = gray_clip[i - 1]
        cur_f = gray_clip[i]
        diff = cv2.absdiff(cur_f, prev_f)
        _, th = cv2.threshold(diff, 20, 255, cv2.THRESH_BINARY)
        th = cv2.GaussianBlur(th, (5, 5), 0)
        _, th = cv2.threshold(th, 20, 255, cv2.THRESH_BINARY)
        motion = cv2.bitwise_or(motion, th)

    kernel = np.ones((5, 5), np.uint8)
    motion = cv2.morphologyEx(motion, cv2.MORPH_OPEN, kernel, iterations=1)
    motion = cv2.morphologyEx(motion, cv2.MORPH_CLOSE, kernel, iterations=2)

    contours, _ = cv2.findContours(motion, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None

    frame_area = float(w * h)
    min_area = max(1.0, frame_area * float(min_area_ratio))
    filtered = [c for c in contours if cv2.contourArea(c) >= min_area]
    if not filtered:
        filtered = [max(contours, key=cv2.contourArea)]

    # Remove huge camera-motion blobs when possible.
    non_huge = [
        c for c in filtered
        if (cv2.contourArea(c) / frame_area) <= float(max_single_contour_ratio)
    ]
    if non_huge:
        filtered = non_huge

    # Keep only top-k blobs to avoid over-expanding bbox from scattered noise.
    filtered = sorted(filtered, key=cv2.contourArea, reverse=True)[:3]

    x1, y1, x2, y2 = w, h, 0, 0
    for c in filtered:
        x, y, cw, ch = cv2.boundingRect(c)
        x1 = min(x1, x)
        y1 = min(y1, y)
        x2 = max(x2, x + cw)
        y2 = max(y2, y + ch)

    # Slight padding for visibility.
    pad_x = int(0.04 * max(1, (x2 - x1)))
    pad_y = int(0.04 * max(1, (y2 - y1)))
    x1 = max(0, x1 - pad_x)
    y1 = max(0, y1 - pad_y)
    x2 = min(w, x2 + pad_x)
    y2 = min(h, y2 + pad_y)

    if x2 <= x1 or y2 <= y1:
        return None

    return [
        round(float(x1) / float(w), 4),
        round(float(y1) / float(h), 4),
        round(float(x2) / float(w), 4),
        round(float(y2) / float(h), 4),
    ]


def _sliding_window_indices(total_frames: int, window_size: int, stride: int) -> List[Tuple[int, int]]:
    """Generate start/end indices for sliding windows."""
    indices: List[Tuple[int, int]] = []
    if total_frames <= 0:
        return indices

    if total_frames < window_size:
        return [(0, total_frames)]

    for start in range(0, total_frames - window_size + 1, stride):
        indices.append((start, start + window_size))

    if indices and indices[-1][1] < total_frames:
        indices.append((total_frames - window_size, total_frames))

    return indices


def _smooth_window_probs(raw_probs: List[float], radius: int = 1) -> List[float]:
    """Apply light local max smoothing to improve recall on short fight bursts."""
    if not raw_probs:
        return []
    if radius <= 0:
        return list(raw_probs)

    n = len(raw_probs)
    smoothed: List[float] = []
    for i in range(n):
        left = max(0, i - radius)
        right = min(n, i + radius + 1)
        smoothed.append(float(max(raw_probs[left:right])))
    return smoothed


def _preprocess_clip(frames_rgb: List[np.ndarray], transform, device, num_frames: int) -> torch.Tensor:
    """Convert list of RGB numpy frames to model input tensor (1, C, T, H, W)."""
    clip = list(frames_rgb)
    if not clip:
        raise ValueError("Empty clip encountered during fight preprocessing.")

    # pad edge windows by repeating last frame
    while len(clip) < num_frames:
        clip.append(clip[-1])

    processed = []
    for frame in clip[:num_frames]:
        pil_img = Image.fromarray(frame)
        processed.append(transform(pil_img))

    tensor = torch.stack(processed, dim=1).unsqueeze(0)  # (1, C, T, H, W)
    return tensor.to(device, dtype=torch.float32)


def _load_fight_bundle(model_path: str):
    """Load model + transforms + metadata from user's training helper module."""
    global _cached_model
    global _cached_transforms
    global _cached_model_path
    global _cached_device
    global _cached_num_frames
    global _cached_frame_size

    if _cached_model is not None and _cached_model_path == model_path:
        return (
            _cached_model,
            _cached_transforms,
            _cached_device,
            _cached_num_frames,
            _cached_frame_size,
        )

    try:
        model_module = importlib.import_module("fight_model")
    except Exception as exc:
        raise RuntimeError(
            "Fight detector requires `cctv-backend/fight_model.py` with: "
            "NUM_FRAMES, FRAME_SIZE, DEVICE, get_transforms, get_improved_model. "
            f"Import error: {exc}"
        )

    required = ["NUM_FRAMES", "FRAME_SIZE", "DEVICE", "get_transforms", "get_improved_model"]
    missing = [name for name in required if not hasattr(model_module, name)]
    if missing:
        raise RuntimeError(
            "fight_model.py is missing required symbols for fight detection: "
            f"{missing}."
        )

    num_frames = int(model_module.NUM_FRAMES)
    frame_size = int(model_module.FRAME_SIZE)
    device = model_module.DEVICE
    transform = model_module.get_transforms("val")
    model = model_module.get_improved_model(num_classes=2)

    state = torch.load(model_path, map_location=device, weights_only=False)
    if isinstance(state, dict) and "model_state_dict" in state:
        state = state["model_state_dict"]

    try:
        model.load_state_dict(state)
    except RuntimeError:
        # handle DataParallel checkpoints with "module." prefix
        if isinstance(state, dict):
            fixed = {k.replace("module.", "", 1) if k.startswith("module.") else k: v for k, v in state.items()}
            model.load_state_dict(fixed)
        else:
            raise

    model = model.to(device)
    model.eval()

    _cached_model = model
    _cached_transforms = transform
    _cached_model_path = model_path
    _cached_device = device
    _cached_num_frames = num_frames
    _cached_frame_size = frame_size

    return model, transform, device, num_frames, frame_size


def stream_inference(
    video_path: str,
    model_dir: str,
    *,
    target_infer_fps: float | None = None,
) -> Iterator[dict]:
    """Yield per-window fight predictions in timeline order for realtime UI."""
    model_path = os.path.join(model_dir, MODEL_FILENAME)
    if not os.path.exists(model_path):
        raise FileNotFoundError(
            f"Fight model not found at {model_path}. "
            f"Place your .pth file as {MODEL_FILENAME} inside models/."
        )

    model, transform, device, num_frames, frame_size = _load_fight_bundle(model_path)

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video: {video_path}")

    try:
        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        base_stride = max(1, int(num_frames // STRIDE_DIVISOR))
        infer_fps = float(target_infer_fps) if target_infer_fps is not None else TARGET_INFER_FPS
        infer_fps = max(1.0, infer_fps)
        fps_stride = max(1, int(round(float(fps) / infer_fps)))
        stride = max(base_stride, fps_stride)

        clip_rgb: deque[np.ndarray] = deque(maxlen=num_frames)
        clip_gray: deque[np.ndarray] = deque(maxlen=num_frames)
        recent_probs: deque[float] = deque(maxlen=max(1, PROB_SMOOTH_RADIUS + 1))

        pending_inputs: List[torch.Tensor] = []
        pending_meta: List[Tuple[int, List[np.ndarray]]] = []

        def flush_pending_predictions():
            if not pending_inputs:
                return []

            inputs = torch.cat(pending_inputs, dim=0)
            outputs = model(inputs)
            batch_probs = torch.softmax(outputs, dim=1)[:, 1].detach().cpu().numpy().tolist()

            emitted = []
            for i, prob in enumerate(batch_probs):
                start_frame, gray_clip_for_window = pending_meta[i]
                recent_probs.append(float(prob))
                conf = max(recent_probs)
                bbox = _compute_motion_bbox_clip(gray_clip_for_window)

                emitted.append(
                    {
                        "time": round(start_frame / fps, 2),
                        "end_time": round((start_frame + stride) / fps, 2),
                        "confidence": round(conf * 100.0, 1),
                        "label": "Драка" if conf >= CONF_THRESHOLD else "Нет драки",
                        "prediction_label": "Драка" if conf >= CONF_THRESHOLD else "Нет драки",
                        "is_detection": conf >= CONF_THRESHOLD,
                        "bbox": bbox,
                    }
                )

            pending_inputs.clear()
            pending_meta.clear()
            return emitted

        frame_idx = -1
        windows_seen = 0

        with torch.no_grad():
            while True:
                ret, frame = cap.read()
                if not ret:
                    break

                frame_idx += 1
                rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                resized = cv2.resize(rgb, (frame_size, frame_size))
                gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

                clip_rgb.append(resized)
                clip_gray.append(gray)

                if len(clip_rgb) < num_frames:
                    continue

                if windows_seen > 0 and (frame_idx % stride) != 0:
                    continue

                windows_seen += 1
                start_frame = frame_idx - num_frames + 1

                input_t = _preprocess_clip(list(clip_rgb), transform, device, num_frames)
                pending_inputs.append(input_t)
                pending_meta.append((start_frame, list(clip_gray)))

                if len(pending_inputs) >= WINDOW_BATCH_SIZE:
                    for prediction in flush_pending_predictions():
                        yield prediction

            for prediction in flush_pending_predictions():
                yield prediction
    finally:
        cap.release()


def detect(video_path: str, model_dir: str):
    """Yield fight events in real time for SSE streaming.

    Yields event dicts:
        {"time": <seconds>, "confidence": <0-100>, "label": "Fight"}
    """
    last_emit_time = -1e9

    for frame_result in stream_inference(video_path, model_dir):
        if not frame_result.get("is_detection"):
            continue

        t_sec = float(frame_result.get("time", 0.0) or 0.0)
        if (t_sec - last_emit_time) < MIN_EVENT_GAP_SEC:
            continue

        last_emit_time = t_sec
        yield {
            "time": frame_result.get("time", 0.0),
            "end_time": frame_result.get("end_time"),
            "confidence": frame_result.get("confidence", 0.0),
            "label": "Драка",
            "bbox": frame_result.get("bbox"),
        }
