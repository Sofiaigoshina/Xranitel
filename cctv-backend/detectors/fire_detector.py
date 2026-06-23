"""Explosion / Fire detector (visual) using YOLO weights.

This module exposes `detect(video_path, model_dir)` for backend SSE streaming.
It yields events in timeline order while scanning frames, so UI can update in
near-real-time like CCTV alerts.
"""

from __future__ import annotations

import os
import importlib
from typing import Iterator, List

import cv2


MODEL_FILENAME = "fire_model_best.pt"
CONF_THRESHOLD = 0.35
TARGET_INFER_FPS = 6.0
EVENT_COOLDOWN_SEC = 0.75


_cached_model = None
_cached_model_path: str | None = None


def _import_yolo():
    try:
        ultralytics_module = importlib.import_module("ultralytics")
        YOLO = getattr(ultralytics_module, "YOLO")
    except Exception as exc:
        raise RuntimeError(
            "Fire detector requires `ultralytics`. Install it and retry. "
            f"Import error: {exc}"
        )
    return YOLO


def _load_model(model_path: str):
    global _cached_model, _cached_model_path
    if _cached_model is not None and _cached_model_path == model_path:
        return _cached_model

    YOLO = _import_yolo()
    model = YOLO(model_path)

    _cached_model = model
    _cached_model_path = model_path
    return model


def _xyxy_to_norm_bbox(x1: float, y1: float, x2: float, y2: float, w: int, h: int) -> List[float] | None:
    if w <= 0 or h <= 0:
        return None

    x1 = max(0.0, min(float(w - 1), float(x1)))
    y1 = max(0.0, min(float(h - 1), float(y1)))
    x2 = max(x1 + 1.0, min(float(w), float(x2)))
    y2 = max(y1 + 1.0, min(float(h), float(y2)))

    return [
        round(x1 / float(w), 4),
        round(y1 / float(h), 4),
        round(x2 / float(w), 4),
        round(y2 / float(h), 4),
    ]


def _best_box(result):
    boxes = getattr(result, "boxes", None)
    if boxes is None or len(boxes) == 0:
        return None, 0.0

    best_idx = -1
    best_conf = -1.0
    conf_arr = boxes.conf

    for idx in range(len(boxes)):
        conf = float(conf_arr[idx].item())
        if conf > best_conf:
            best_conf = conf
            best_idx = idx

    if best_idx < 0:
        return None, 0.0

    return boxes.xyxy[best_idx].tolist(), best_conf


def stream_inference(
    video_path: str,
    model_dir: str,
    *,
    infer_fps: float | None = None,
    conf_threshold: float | None = None,
) -> Iterator[dict]:
    """Yield frame-window prediction results in timeline order for realtime UI."""
    model_path = os.path.join(model_dir, MODEL_FILENAME)
    if not os.path.exists(model_path):
        raise FileNotFoundError(
            f"Fire model not found at {model_path}. "
            f"Place your weights as {MODEL_FILENAME} inside models/."
        )

    model = _load_model(model_path)

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"Unable to open video: {video_path}")

    try:
        fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
        target_infer_fps = float(infer_fps) if infer_fps is not None else TARGET_INFER_FPS
        target_infer_fps = max(1.0, target_infer_fps)
        frame_stride = max(1, int(round(float(fps) / target_infer_fps)))
        threshold = float(conf_threshold) if conf_threshold is not None else CONF_THRESHOLD
        threshold = max(0.01, min(0.99, threshold))
        frame_idx = -1

        while True:
            ok, frame = cap.read()
            if not ok:
                break

            frame_idx += 1
            if frame_idx % frame_stride != 0:
                continue

            t_sec = frame_idx / fps
            end_t = t_sec + (frame_stride / fps)

            results = model.predict(frame, conf=0.01, verbose=False)
            if not results:
                yield {
                    "time": round(t_sec, 2),
                    "end_time": round(end_t, 2),
                    "confidence": 0.0,
                    "label": "Нет пожара",
                    "prediction_label": "Нет пожара",
                    "is_detection": False,
                    "bbox": None,
                }
                continue

            result = results[0]
            xyxy, best_conf = _best_box(result)
            h, w = frame.shape[:2]
            bbox = None
            if xyxy is not None:
                bbox = _xyxy_to_norm_bbox(xyxy[0], xyxy[1], xyxy[2], xyxy[3], w, h)

            is_detection = best_conf >= threshold

            yield {
                "time": round(t_sec, 2),
                "end_time": round(end_t, 2),
                "confidence": round(best_conf * 100.0, 1),
                "label": "Пожар" if is_detection else "Нет пожара",
                "prediction_label": "Пожар" if is_detection else "Нет пожара",
                "is_detection": is_detection,
                "bbox": bbox,
            }
    finally:
        cap.release()


def detect(video_path: str, model_dir: str):
    """Yield fire/explosion events for SSE streaming.

    Yields dict like:
      {"time": <seconds>, "confidence": <0-100>, "label": "Explosion/Fire", "bbox": [x1,y1,x2,y2]}
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
            "label": "Пожар",
            "bbox": frame_result.get("bbox"),
        }
