"""Crowd gathering detection (visual-based) using YOLO person detection.

Detects abnormal crowd formation with heuristics (density, clustering, sudden growth)
and yields realtime predictions for SSE and batch events for video processing.
"""

from __future__ import annotations

import importlib
import os
from collections import deque
from typing import Deque, Iterator, List, Optional, Tuple

import cv2
import numpy as np
import torch


MODEL_FILENAME = "yolov8n.pt"
PERSON_CLASS_ID = 0

HISTORY_WINDOW_SECONDS = 5.0
SUDDEN_INCREASE_THRESHOLD = 5
PERSON_CONFIDENCE = 0.35
MIN_PEOPLE_FOR_DENSITY_CHECK = 6
MAX_CROWD_BBOX_AREA_RATIO = 0.18
MIN_PEOPLE_FOR_CLUSTER_CHECK = 5
MAX_MEAN_PAIRWISE_DIST_RATIO = 0.22

TARGET_INFER_FPS = 6.0
EVENT_COOLDOWN_SEC = 1.0

USE_RESTRICTED_ZONE = False
RESTRICTED_ZONE_NORM: Optional[Tuple[float, float, float, float]] = None
MIN_PEOPLE_IN_ZONE_TO_ALERT = 4


_cached_model = None
_cached_model_path: str | None = None


def _import_yolo():
    try:
        ultralytics_module = importlib.import_module("ultralytics")
        YOLO = getattr(ultralytics_module, "YOLO")
    except Exception as exc:
        raise RuntimeError(
            "Crowd detector requires `ultralytics`. Install it and retry. "
            f"Import error: {exc}"
        )
    return YOLO


def _auto_device() -> str:
    return "cuda" if torch.cuda.is_available() else "cpu"


def _load_model(model_path: str):
    global _cached_model, _cached_model_path
    if _cached_model is not None and _cached_model_path == model_path:
        return _cached_model

    YOLO = _import_yolo()
    model = YOLO(model_path)

    _cached_model = model
    _cached_model_path = model_path
    return model


def _detect_people(
    frame: np.ndarray,
    model,
    conf_threshold: float = PERSON_CONFIDENCE,
    device: str | None = None,
) -> Tuple[List[Tuple[int, int, int, int]], List[float]]:
    device = device or _auto_device()
    results = model.predict(
        source=frame,
        classes=[PERSON_CLASS_ID],
        conf=conf_threshold,
        verbose=False,
        device=device,
    )

    boxes: List[Tuple[int, int, int, int]] = []
    scores: List[float] = []

    if not results or results[0].boxes is None or len(results[0].boxes) == 0:
        return boxes, scores

    xyxy = results[0].boxes.xyxy.cpu().numpy()
    conf = results[0].boxes.conf.cpu().numpy()

    for i in range(len(xyxy)):
        x1, y1, x2, y2 = xyxy[i]
        boxes.append((int(x1), int(y1), int(x2), int(y2)))
        scores.append(float(conf[i]))

    return boxes, scores


def _box_center(box: Tuple[int, int, int, int]) -> Tuple[float, float]:
    x1, y1, x2, y2 = box
    return (x1 + x2) / 2.0, (y1 + y2) / 2.0


def _crowd_bbox_area_ratio(
    boxes: List[Tuple[int, int, int, int]],
    frame_w: int,
    frame_h: int,
) -> float:
    if len(boxes) < 2:
        return 1.0

    xs: List[float] = []
    ys: List[float] = []
    for b in boxes:
        cx, cy = _box_center(b)
        xs.append(cx)
        ys.append(cy)

    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    w = max(1.0, max_x - min_x)
    h = max(1.0, max_y - min_y)
    span_area = w * h
    frame_area = float(frame_w * frame_h)
    return span_area / frame_area


def _mean_pairwise_center_distance_ratio(
    boxes: List[Tuple[int, int, int, int]],
    frame_w: int,
    frame_h: int,
) -> float:
    n = len(boxes)
    if n < 2:
        return 1.0

    centers = [_box_center(b) for b in boxes]
    dist_sum = 0.0
    pair_count = 0
    for i in range(n):
        for j in range(i + 1, n):
            dx = centers[i][0] - centers[j][0]
            dy = centers[i][1] - centers[j][1]
            dist_sum += float(np.hypot(dx, dy))
            pair_count += 1

    mean_dist = dist_sum / max(1, pair_count)
    diagonal = float(np.hypot(frame_w, frame_h))
    return mean_dist / diagonal


def _count_people_in_restricted_zone(
    boxes: List[Tuple[int, int, int, int]],
    frame_w: int,
    frame_h: int,
    zone_norm: Tuple[float, float, float, float],
) -> int:
    zx1 = int(zone_norm[0] * frame_w)
    zy1 = int(zone_norm[1] * frame_h)
    zx2 = int(zone_norm[2] * frame_w)
    zy2 = int(zone_norm[3] * frame_h)

    inside = 0
    for b in boxes:
        cx, cy = _box_center(b)
        if zx1 <= cx <= zx2 and zy1 <= cy <= zy2:
            inside += 1
    return inside


def _filter_boxes_in_zone(
    boxes: List[Tuple[int, int, int, int]],
    frame_w: int,
    frame_h: int,
    zone_norm: Tuple[float, float, float, float],
) -> List[Tuple[int, int, int, int]]:
    zx1 = int(zone_norm[0] * frame_w)
    zy1 = int(zone_norm[1] * frame_h)
    zx2 = int(zone_norm[2] * frame_w)
    zy2 = int(zone_norm[3] * frame_h)

    kept: List[Tuple[int, int, int, int]] = []
    for b in boxes:
        cx, cy = _box_center(b)
        if zx1 <= cx <= zx2 and zy1 <= cy <= zy2:
            kept.append(b)
    return kept


def _detect_crowd_anomaly(
    current_count: int,
    time_seconds: float,
    history: Deque[Tuple[float, int]],
    boxes: List[Tuple[int, int, int, int]],
    frame_w: int,
    frame_h: int,
) -> Tuple[bool, List[str]]:
    reasons: List[str] = []

    while history and (time_seconds - history[0][0]) > HISTORY_WINDOW_SECONDS:
        history.popleft()

    if len(history) > 0 and current_count >= MIN_PEOPLE_FOR_DENSITY_CHECK:
        past_counts = [c for _, c in history]
        min_in_window = min(past_counts)
        if current_count - min_in_window > SUDDEN_INCREASE_THRESHOLD:
            reasons.append("Sudden crowd growth")

    if current_count >= MIN_PEOPLE_FOR_DENSITY_CHECK:
        ratio = _crowd_bbox_area_ratio(boxes, frame_w, frame_h)
        if ratio < MAX_CROWD_BBOX_AREA_RATIO:
            reasons.append("High local density")

    if USE_RESTRICTED_ZONE and RESTRICTED_ZONE_NORM is not None and current_count > 0:
        in_zone = _count_people_in_restricted_zone(boxes, frame_w, frame_h, RESTRICTED_ZONE_NORM)
        if in_zone >= MIN_PEOPLE_IN_ZONE_TO_ALERT:
            reasons.append("Crowd in restricted zone")

    if current_count >= MIN_PEOPLE_FOR_CLUSTER_CHECK:
        dist_ratio = _mean_pairwise_center_distance_ratio(boxes, frame_w, frame_h)
        if dist_ratio < MAX_MEAN_PAIRWISE_DIST_RATIO:
            reasons.append("Tight clustering")

    history.append((time_seconds, current_count))
    is_anomaly = len(reasons) > 0
    return is_anomaly, reasons


def _crowd_bbox_normalized(
    boxes: List[Tuple[int, int, int, int]],
    frame_w: int,
    frame_h: int,
) -> List[float] | None:
    if not boxes or frame_w <= 0 or frame_h <= 0:
        return None

    x1 = min(b[0] for b in boxes)
    y1 = min(b[1] for b in boxes)
    x2 = max(b[2] for b in boxes)
    y2 = max(b[3] for b in boxes)

    x1 = max(0, min(frame_w - 1, int(x1)))
    y1 = max(0, min(frame_h - 1, int(y1)))
    x2 = max(x1 + 1, min(frame_w, int(x2)))
    y2 = max(y1 + 1, min(frame_h, int(y2)))

    return [
        round(x1 / float(frame_w), 4),
        round(y1 / float(frame_h), 4),
        round(x2 / float(frame_w), 4),
        round(y2 / float(frame_h), 4),
    ]


def _build_confidence(reasons: List[str], people_count: int) -> float:
    base = 60.0 + (len(reasons) * 10.0)
    crowd_boost = min(20.0, max(0.0, (people_count - MIN_PEOPLE_FOR_DENSITY_CHECK) * 2.0))
    return min(99.0, base + crowd_boost)


def stream_inference(
    video_path: str,
    model_dir: str,
    *,
    target_infer_fps: float | None = None,
    conf_threshold: float | None = None,
) -> Iterator[dict]:
    """Yield per-frame predictions with optional bbox for realtime UI."""
    model_path = os.path.join(model_dir, MODEL_FILENAME)
    if not os.path.exists(model_path):
        raise FileNotFoundError(
            f"Crowd model not found at {model_path}. "
            f"Place your weights as {MODEL_FILENAME} inside models/."
        )

    model = _load_model(model_path)

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video: {video_path}")

    try:
        fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
        infer_fps = float(target_infer_fps) if target_infer_fps is not None else TARGET_INFER_FPS
        infer_fps = max(1.0, infer_fps)
        frame_stride = max(1, int(round(float(fps) / infer_fps)))
        threshold = float(conf_threshold) if conf_threshold is not None else PERSON_CONFIDENCE
        threshold = max(0.01, min(0.99, threshold))

        history: Deque[Tuple[float, int]] = deque()
        frame_idx = -1
        device = _auto_device()

        while True:
            ok, frame = cap.read()
            if not ok:
                break

            frame_idx += 1
            if frame_idx % frame_stride != 0:
                continue

            t_sec = frame_idx / fps
            end_t = t_sec + (frame_stride / fps)

            boxes, _ = _detect_people(frame, model, conf_threshold=threshold, device=device)
            total_people = len(boxes)

            h, w = frame.shape[:2]
            if USE_RESTRICTED_ZONE and RESTRICTED_ZONE_NORM is not None:
                area_boxes = _filter_boxes_in_zone(boxes, w, h, RESTRICTED_ZONE_NORM)
                area_people = len(area_boxes)
            else:
                area_boxes = boxes
                area_people = total_people

            is_alert, reasons = _detect_crowd_anomaly(
                area_people, t_sec, history, area_boxes, w, h
            )

            confidence = _build_confidence(reasons, area_people) if is_alert else 0.0
            bbox = _crowd_bbox_normalized(area_boxes, w, h) if is_alert else None

            yield {
                "time": round(t_sec, 2),
                "end_time": round(end_t, 2),
                "confidence": round(confidence, 1),
                "label": "Скопление людей" if is_alert else "Нет скопления",
                "prediction_label": "Скопление людей" if is_alert else "Нет скопления",
                "is_detection": is_alert,
                "bbox": bbox,
            }
    finally:
        cap.release()


def detect(video_path: str, model_dir: str) -> Iterator[dict]:
    """Yield crowd events for batch processing.

    Yields dict like:
      {"time": <seconds>, "confidence": <0-100>, "label": "Crowd Gathering", "bbox": [x1,y1,x2,y2]}
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
            "label": "Скопление людей",
            "bbox": frame_result.get("bbox"),
        }
