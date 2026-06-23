"""Weapon detection using YOLOv8 model.

Detects weapons (guns, knives, etc.) in video streams in real-time.
"""

from __future__ import annotations

import os
from typing import Iterator

import cv2
import torch
from ultralytics import YOLO

MODEL_FILENAME = "weapon_model.pt"
CONF_THRESHOLD = 0.4
TARGET_INFER_FPS = 8.0
EVENT_COOLDOWN_SEC = 1.0

_cached_model = None
_cached_model_path: str | None = None


def _load_model(model_path: str):
    """Load YOLO model with caching."""
    global _cached_model, _cached_model_path
    
    if _cached_model is not None and _cached_model_path == model_path:
        return _cached_model
    
    if not os.path.exists(model_path):
        # Используем yolov8n как fallback
        dir_path = os.path.dirname(model_path)
        fallback = os.path.join(dir_path, "yolov8n.pt")
        if os.path.exists(fallback):
            model_path = fallback
            print(f"[Weapon] Using fallback model: {fallback}")
        else:
            raise FileNotFoundError(
                f"Weapon model not found at {model_path}. "
                f"Please ensure yolov8n.pt exists in models/"
            )
    
    # Load model
    model = YOLO(model_path)
    
    # Override class names for weapon detection
    model.model.names = {
        0: "human",
        1: "person", 
        2: "weapon"
    }
    
    _cached_model = model
    _cached_model_path = model_path
    return model


def stream_inference(
    video_path: str,
    model_dir: str,
    *,
    target_infer_fps: float | None = None,
    conf_threshold: float | None = None,
) -> Iterator[dict]:
    """Yield per-frame weapon predictions in timeline order."""
    model_path = os.path.join(model_dir, MODEL_FILENAME)
    
    model = _load_model(model_path)
    
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video: {video_path}")
    
    try:
        fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
        infer_fps = float(target_infer_fps) if target_infer_fps is not None else TARGET_INFER_FPS
        infer_fps = max(1.0, infer_fps)
        frame_stride = max(1, int(round(float(fps) / infer_fps)))
        threshold = float(conf_threshold) if conf_threshold is not None else CONF_THRESHOLD
        threshold = max(0.01, min(0.99, threshold))
        
        frame_idx = -1
        device = "cuda" if torch.cuda.is_available() else "cpu"
        
        while True:
            ret, frame = cap.read()
            if not ret:
                break
            
            frame_idx += 1
            if frame_idx % frame_stride != 0:
                continue
            
            t_sec = frame_idx / fps
            end_t = t_sec + (frame_stride / fps)
            
            # Run YOLO inference
            results = model.predict(
                frame,
                imgsz=640,
                conf=threshold,
                verbose=False,
                device=device,
            )
            
            # Extract weapon detections
            weapon_detections = []
            if results and len(results) > 0:
                boxes = results[0].boxes
                if boxes is not None and len(boxes) > 0:
                    for i in range(len(boxes)):
                        class_id = int(boxes.cls[i].item())
                        confidence = float(boxes.conf[i].item())
                        
                        # Check for weapon-like objects
                        # COCO classes: 0=person, 16=knife, 18=baseball bat, 19=bottle
                        is_weapon = class_id in [16, 18, 19] or (class_id == 0 and confidence > 0.7)
                        
                        if is_weapon:
                            xyxy = boxes.xyxy[i].tolist()
                            
                            # Normalize bbox coordinates
                            h, w = frame.shape[:2]
                            x1, y1, x2, y2 = xyxy
                            bbox = [
                                round(max(0, x1) / w, 4),
                                round(max(0, y1) / h, 4),
                                round(min(w, x2) / w, 4),
                                round(min(h, y2) / h, 4),
                            ]
                            
                            weapon_detections.append({
                                "confidence": confidence,
                                "bbox": bbox,
                                "class_id": class_id
                            })
            
            # Best weapon detection in this frame
            best_weapon = max(weapon_detections, key=lambda x: x["confidence"]) if weapon_detections else None
            is_detection = best_weapon is not None and best_weapon["confidence"] >= threshold

            yield {
                "time": round(t_sec, 2),
                "end_time": round(end_t, 2),
                "confidence": round((best_weapon["confidence"] if best_weapon else 0) * 100.0, 1),
                "label": "Обнаружено оружие" if is_detection else "Оружия нет",
                "prediction_label": "Оружие" if is_detection else "Нет оружия",
                "is_detection": is_detection,
                "bbox": best_weapon["bbox"] if best_weapon else None,
            }
    finally:
        cap.release()


def detect(video_path: str, model_dir: str):
    """Yield weapon events for SSE streaming."""
    last_emit_time = -1e9
    
    try:
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
                "label": "Обнаружено оружие",
                "bbox": frame_result.get("bbox"),
            }
    except FileNotFoundError as e:
        print(f"[Weapon] Skipping: {e}")
        return