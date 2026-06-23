import os
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import cv2

from dotenv import load_dotenv
from fastapi import HTTPException
from pymongo import MongoClient
from pymongo.collection import Collection
from pymongo.database import Database

from detectors import DETECTOR_REGISTRY

# Force python protobuf runtime for better compatibility with mediapipe-generated
# descriptors in mixed environments.
os.environ.setdefault("PROTOCOL_BUFFERS_PYTHON_IMPLEMENTATION", "python")

BASE_DIR = Path(__file__).resolve().parent.parent
UPLOAD_DIR = BASE_DIR / "uploads"
PROCESSED_DIR = UPLOAD_DIR / "processed"
MODEL_DIR = BASE_DIR / "models"

load_dotenv(BASE_DIR / ".env")

MONGODB_URI = os.getenv("MONGODB_URI", "").strip()
MONGODB_DB_NAME = os.getenv("MONGODB_DB_NAME", "cctv")
AUTO_DELETE_UPLOADS = os.getenv("AUTO_DELETE_UPLOADS", "false").lower() == "true"

mongo_client: MongoClient | None = None
mongo_db: Database | None = None
videos_col: Collection | None = None
detections_col: Collection | None = None
mongo_last_error: str | None = None


def _set_mongo_disconnected(error_message: str) -> None:
    """Reset Mongo globals to disconnected state and keep the error reason."""
    global mongo_client, mongo_db, videos_col, detections_col, mongo_last_error
    mongo_client = None
    mongo_db = None
    videos_col = None
    detections_col = None
    mongo_last_error = error_message


def init_mongo() -> None:
    """Initialize MongoDB connection and collections lazily.

    This allows the app to recover if MongoDB starts after the API.
    """
    global mongo_client, mongo_db, videos_col, detections_col, mongo_last_error
    if not MONGODB_URI:
        _set_mongo_disconnected("MONGODB_URI is empty")
        return

    try:
        mongo_client = MongoClient(MONGODB_URI, serverSelectionTimeoutMS=3000)
        mongo_client.admin.command("ping")
        mongo_db = mongo_client[MONGODB_DB_NAME]
        videos_col = mongo_db["videos"]
        detections_col = mongo_db["detections"]

        # Helpful indexes for dashboard queries
        videos_col.create_index([("created_at", -1)])
        videos_col.create_index([("status", 1), ("updated_at", -1)])
        detections_col.create_index([("video_id", 1), ("created_at", -1)])
        detections_col.create_index([("anomaly_id", 1), ("created_at", -1)])
        mongo_last_error = None
    except Exception as e:
        _set_mongo_disconnected(f"{type(e).__name__}: {e}")


UPLOAD_DIR.mkdir(exist_ok=True)
PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
MODEL_DIR.mkdir(exist_ok=True)


def now_utc() -> datetime:
    """Return current UTC datetime with timezone info."""
    return datetime.now(timezone.utc)


def ensure_datetime(value: Any) -> datetime | None:
    """Normalize values from Mongo into aware UTC datetimes when possible."""
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value

    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        try:
            parsed = datetime.fromisoformat(text)
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            return parsed
        except ValueError:
            return None

    return None


def db_enabled() -> bool:
    """Return True when both videos and detections collections are ready."""
    if videos_col is None or detections_col is None:
        init_mongo()
    return videos_col is not None and detections_col is not None


def require_db() -> tuple[Collection, Collection]:
    if not db_enabled():
        raise HTTPException(
            status_code=503,
            detail={
                "message": "MongoDB не подключена.",
                "hint": "Проверьте, запущен ли MongoDB и правильно ли указан MONGODB_URI в файле cctv-backend/.env",
                "last_error": mongo_last_error,
            },
        )
    return videos_col, detections_col  # type: ignore[return-value]


def confidence_to_severity(confidence: float) -> str:
    """Map confidence score (0-100 scale) to severity label."""
    if confidence >= 90:
        return "critical"
    if confidence >= 75:
        return "high"
    if confidence >= 50:
        return "medium"
    return "low"


def format_video_time(seconds: float) -> str:
    """Format seconds as mm:ss for frontend display."""
    sec = max(0, int(seconds))
    mm = sec // 60
    ss = sec % 60
    return f"{mm}:{ss:02d}"


def safe_float(value: Any, default: float = 0.0) -> float:
    """Convert value to float safely, fallback to default on bad input."""
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def draw_top_alerts_overlay(frame, active_events: list[dict[str, Any]], recent_events: list[dict[str, Any]]) -> None:
    """Draw top banner alerts for currently active/recent anomaly events."""
    if not active_events and not recent_events:
        return

    h, w = frame.shape[:2]
    banner_h = min(120, max(56, int(h * 0.13)))
    overlay = frame.copy()
    cv2.rectangle(overlay, (0, 0), (w, banner_h), (18, 26, 39), -1)
    cv2.addWeighted(overlay, 0.55, frame, 0.45, 0, frame)

    source = active_events if active_events else recent_events
    lines = []
    for e in source[-3:]:
        label = str(e.get("label") or e.get("anomaly_id") or "Anomaly")
        conf = safe_float(e.get("confidence"), 0.0)
        ts = format_video_time(safe_float(e.get("time"), 0.0))
        lines.append(f"{label}  {conf:.1f}%  @ {ts}")

    cv2.putText(
        frame,
        "ALERT",
        (14, 26),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.65,
        (248, 113, 113),
        2,
        cv2.LINE_AA,
    )

    y = 52
    for line in lines:
        cv2.putText(
            frame,
            line,
            (14, y),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.52,
            (241, 245, 249),
            1,
            cv2.LINE_AA,
        )
        y += 22


def draw_bbox_overlays(frame, active_events: list[dict[str, Any]]) -> None:
    """Draw bounding boxes + confidence for events that include bboxes."""
    h, w = frame.shape[:2]
    for e in active_events:
        bbox = e.get("bbox")
        if not isinstance(bbox, list) or len(bbox) != 4:
            continue

        try:
            x1 = max(0, min(w - 1, int(float(bbox[0]) * w)))
            y1 = max(0, min(h - 1, int(float(bbox[1]) * h)))
            x2 = max(x1 + 1, min(w, int(float(bbox[2]) * w)))
            y2 = max(y1 + 1, min(h, int(float(bbox[3]) * h)))
        except (TypeError, ValueError):
            continue

        cv2.rectangle(frame, (x1, y1), (x2, y2), (34, 197, 94), 2)

        label = str(e.get("label") or e.get("anomaly_id") or "Anomaly")
        conf = safe_float(e.get("confidence"), 0.0)
        tag = f"{label} {conf:.1f}%"

        (tw, th), _ = cv2.getTextSize(tag, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
        tag_y1 = max(0, y1 - th - 8)
        cv2.rectangle(frame, (x1, tag_y1), (x1 + tw + 8, y1), (22, 163, 74), -1)
        cv2.putText(
            frame,
            tag,
            (x1 + 4, y1 - 5),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.5,
            (255, 255, 255),
            1,
            cv2.LINE_AA,
        )


def generate_processed_video_file(source_path: Path, output_path: Path, events: list[dict[str, Any]]) -> None:
    """Render full processed output video with overlays from saved detections."""
    cap = cv2.VideoCapture(str(source_path))
    if not cap.isOpened():
        raise RuntimeError(f"Не удается открыть исходное видео: {source_path}")

    try:
        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
        if width <= 0 or height <= 0:
            raise RuntimeError("Неверные размеры исходного видео")

        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        writer = cv2.VideoWriter(str(output_path), fourcc, fps, (width, height))
        if not writer.isOpened():
            raise RuntimeError("Не удается создать выходной видеофайл с обработкой")

        try:
            events_sorted = sorted(events, key=lambda e: safe_float(e.get("time"), 0.0))
            recent_events: deque[dict[str, Any]] = deque()
            next_idx = 0
            frame_idx = -1
            box_window_sec = 0.75
            top_alert_window_sec = 3.0

            while True:
                ok, frame = cap.read()
                if not ok:
                    break

                frame_idx += 1
                t_sec = frame_idx / fps

                while next_idx < len(events_sorted) and safe_float(events_sorted[next_idx].get("time"), 0.0) <= t_sec:
                    recent_events.append(events_sorted[next_idx])
                    next_idx += 1

                while recent_events and safe_float(recent_events[0].get("time"), 0.0) < (t_sec - top_alert_window_sec):
                    recent_events.popleft()

                left = next_idx - 1
                while left >= 0 and safe_float(events_sorted[left].get("time"), 0.0) >= (t_sec - box_window_sec):
                    left -= 1
                left += 1

                right = next_idx
                while right < len(events_sorted) and safe_float(events_sorted[right].get("time"), 0.0) <= (t_sec + box_window_sec):
                    right += 1

                active_events = events_sorted[left:right]
                recent_list = list(recent_events)

                draw_bbox_overlays(frame, active_events)
                draw_top_alerts_overlay(frame, active_events, recent_list)

                writer.write(frame)
        finally:
            writer.release()
    finally:
        cap.release()


def resolve_source_video_path(video_doc: dict[str, Any]) -> Path:
    """Resolve video file path from DB document and verify it exists."""
    path = str(video_doc.get("upload_path") or "").strip()
    if not path:
        stored = str(video_doc.get("stored_filename") or "").strip()
        if stored:
            path = str((UPLOAD_DIR / stored).resolve())

    if not path:
        raise HTTPException(status_code=404, detail="Video file path not available")

    source = Path(path)
    if not source.exists():
        raise HTTPException(status_code=404, detail="Video file not found on server")

    return source
