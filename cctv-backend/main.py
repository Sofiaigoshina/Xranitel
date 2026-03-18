import sys
import os
import re
from pathlib import Path
from datetime import datetime, timedelta, timezone
from typing import Any

# Force python protobuf runtime for better compatibility with mediapipe-generated
# descriptors in mixed environments.
os.environ.setdefault("PROTOCOL_BUFFERS_PYTHON_IMPLEMENTATION", "python")

# Ensure this file's directory is on sys.path so `detectors` package is found
# regardless of the working directory uvicorn is launched from.
_THIS_DIR = Path(__file__).resolve().parent
if str(_THIS_DIR) not in sys.path:
    sys.path.insert(0, str(_THIS_DIR))

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse
import shutil
import uuid
import json
import queue
import threading

from dotenv import load_dotenv
from bson import ObjectId
from bson.errors import InvalidId
from pymongo import MongoClient
from pymongo.collection import Collection
from pymongo.database import Database
from pymongo.errors import PyMongoError

from detectors import DETECTOR_REGISTRY

app = FastAPI(title="CCTV Backend – Anomaly Detection")

# Allow the Vite dev server (and any localhost origin) to call the API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = BASE_DIR / "uploads"
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


def init_mongo() -> None:
    """Initialize MongoDB connection and collections lazily.

    This allows the app to recover if MongoDB starts after the API.
    """
    global mongo_client, mongo_db, videos_col, detections_col, mongo_last_error
    if not MONGODB_URI:
        mongo_client = None
        mongo_db = None
        videos_col = None
        detections_col = None
        mongo_last_error = "MONGODB_URI is empty"
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
        mongo_client = None
        mongo_db = None
        videos_col = None
        detections_col = None
        mongo_last_error = f"{type(e).__name__}: {e}"

UPLOAD_DIR.mkdir(exist_ok=True)
MODEL_DIR.mkdir(exist_ok=True)


def now_utc() -> datetime:
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
        # Support common ISO-8601 strings and trailing Z form.
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
    if videos_col is None or detections_col is None:
        init_mongo()
    return videos_col is not None and detections_col is not None


def require_db() -> tuple[Collection, Collection]:
    if not db_enabled():
        raise HTTPException(
            status_code=503,
            detail={
                "message": "MongoDB is not connected.",
                "hint": "Check mongod is running and MONGODB_URI in cctv-backend/.env",
                "last_error": mongo_last_error,
            },
        )
    return videos_col, detections_col  # type: ignore[return-value]


def confidence_to_severity(confidence: float) -> str:
    if confidence >= 90:
        return "critical"
    if confidence >= 75:
        return "high"
    if confidence >= 50:
        return "medium"
    return "low"


def format_video_time(seconds: float) -> str:
    sec = max(0, int(seconds))
    mm = sec // 60
    ss = sec % 60
    return f"{mm}:{ss:02d}"


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------

@app.get("/health")
def health():
    return {
        "status": "ok",
        "mongodb": "connected" if db_enabled() else "disabled",
        "mongo_error": mongo_last_error,
    }


@app.post("/mongo/reconnect")
def mongo_reconnect():
    init_mongo()
    return {
        "mongodb": "connected" if db_enabled() else "disabled",
        "mongo_error": mongo_last_error,
    }


@app.get("/stats/overview")
def stats_overview() -> dict[str, Any]:
    videos, detections = require_db()

    total_videos = videos.count_documents({})
    processing_videos = videos.count_documents({"status": "processing"})
    completed_videos = videos.count_documents({"status": "completed"})
    failed_videos = videos.count_documents({"status": "failed"})
    total_detections = detections.count_documents({})

    anomaly_breakdown = list(
        detections.aggregate(
            [
                {"$group": {"_id": "$anomaly_id", "count": {"$sum": 1}}},
                {"$sort": {"count": -1}},
            ]
        )
    )

    recent_videos = list(
        videos.find(
            {},
            {
                "original_filename": 1,
                "stored_filename": 1,
                "status": 1,
                "created_at": 1,
                "completed_at": 1,
                "total_detections": 1,
                "selected_anomalies": 1,
            },
        )
        .sort("created_at", -1)
        .limit(10)
    )

    for rv in recent_videos:
        rv["id"] = str(rv.pop("_id"))

    return {
        "total_videos": total_videos,
        "processing_videos": processing_videos,
        "completed_videos": completed_videos,
        "failed_videos": failed_videos,
        "total_detections": total_detections,
        "anomaly_breakdown": [
            {"anomaly_id": row["_id"], "count": row["count"]} for row in anomaly_breakdown
        ],
        "recent_videos": recent_videos,
    }


@app.get("/stats/trends")
def stats_trends(days: int = 7) -> dict[str, Any]:
    videos, detections = require_db()

    days = max(1, min(days, 90))
    start = now_utc() - timedelta(days=days - 1)

    videos_by_day = list(
        videos.aggregate(
            [
                {"$match": {"created_at": {"$gte": start}}},
                {
                    "$group": {
                        "_id": {
                            "$dateToString": {
                                "format": "%Y-%m-%d",
                                "date": "$created_at",
                            }
                        },
                        "count": {"$sum": 1},
                    }
                },
                {"$sort": {"_id": 1}},
            ]
        )
    )

    detections_by_day = list(
        detections.aggregate(
            [
                {"$match": {"created_at": {"$gte": start}}},
                {
                    "$group": {
                        "_id": {
                            "$dateToString": {
                                "format": "%Y-%m-%d",
                                "date": "$created_at",
                            }
                        },
                        "count": {"$sum": 1},
                    }
                },
                {"$sort": {"_id": 1}},
            ]
        )
    )

    anomaly_trends = list(
        detections.aggregate(
            [
                {"$match": {"created_at": {"$gte": start}}},
                {
                    "$group": {
                        "_id": {
                            "date": {
                                "$dateToString": {
                                    "format": "%Y-%m-%d",
                                    "date": "$created_at",
                                }
                            },
                            "anomaly_id": "$anomaly_id",
                        },
                        "count": {"$sum": 1},
                    }
                },
                {"$sort": {"_id.date": 1}},
            ]
        )
    )

    return {
        "days": days,
        "videos_by_day": [{"date": row["_id"], "count": row["count"]} for row in videos_by_day],
        "detections_by_day": [{"date": row["_id"], "count": row["count"]} for row in detections_by_day],
        "anomaly_trends": [
            {
                "date": row["_id"]["date"],
                "anomaly_id": row["_id"]["anomaly_id"],
                "count": row["count"],
            }
            for row in anomaly_trends
        ],
    }


@app.get("/videos/{video_id}/detections")
def video_detections(video_id: str) -> dict[str, Any]:
    videos, detections = require_db()

    try:
        oid = ObjectId(video_id)
    except (InvalidId, TypeError):
        raise HTTPException(status_code=400, detail="Invalid video id")

    video = videos.find_one(
        {"_id": oid},
        {
            "original_filename": 1,
            "stored_filename": 1,
            "status": 1,
            "created_at": 1,
            "completed_at": 1,
            "total_detections": 1,
            "selected_anomalies": 1,
        },
    )

    if not video:
        raise HTTPException(status_code=404, detail="Video not found")

    docs = list(
        detections.find(
            {"video_id": oid},
            {
                "anomaly_id": 1,
                "label": 1,
                "time": 1,
                "confidence": 1,
                "created_at": 1,
            },
        ).sort("time", 1)
    )

    items = []
    for doc in docs:
        created_at = ensure_datetime(doc.get("created_at"))
        items.append(
            {
                "id": str(doc.get("_id")),
                "anomaly_id": str(doc.get("anomaly_id") or "unknown"),
                "label": str(doc.get("label") or doc.get("anomaly_id") or "Anomaly"),
                "time": float(doc.get("time", 0) or 0),
                "confidence": float(doc.get("confidence", 0) or 0),
                "created_at": created_at.isoformat() if created_at else None,
                "video_time": format_video_time(float(doc.get("time", 0) or 0)),
            }
        )

    created_at = ensure_datetime(video.get("created_at"))
    completed_at = ensure_datetime(video.get("completed_at"))

    return {
        "video": {
            "id": str(video.get("_id")),
            "filename": str(video.get("original_filename") or video.get("stored_filename") or "Unknown video"),
            "status": str(video.get("status") or "unknown"),
            "created_at": created_at.isoformat() if created_at else None,
            "completed_at": completed_at.isoformat() if completed_at else None,
            "total_detections": int(video.get("total_detections", 0) or 0),
            "selected_anomalies": list(video.get("selected_anomalies") or []),
        },
        "detections": items,
    }


@app.get("/videos/{video_id}/stream")
def stream_video(video_id: str):
    videos, _ = require_db()

    try:
        oid = ObjectId(video_id)
    except (InvalidId, TypeError):
        raise HTTPException(status_code=400, detail="Invalid video id")

    video = videos.find_one({"_id": oid}, {"upload_path": 1, "stored_filename": 1})
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")

    path = str(video.get("upload_path") or "").strip()
    if not path:
        stored = str(video.get("stored_filename") or "").strip()
        if stored:
            path = str((UPLOAD_DIR / stored).resolve())

    if not path or not Path(path).exists():
        raise HTTPException(status_code=404, detail="Video file not found on server")

    return FileResponse(path=path, media_type="video/mp4")


@app.get("/alerts")
def get_alerts(
    limit: int = 50,
    status: str | None = None,
    video_id: str | None = None,
    video_search: str | None = None,
) -> dict[str, Any]:
    _, detections = require_db()

    limit = max(1, min(limit, 500))

    match_stage: dict[str, Any] = {}
    if video_id:
        try:
            match_stage["video_id"] = ObjectId(video_id)
        except (InvalidId, TypeError):
            raise HTTPException(status_code=400, detail="Invalid video id")

    pipeline = [
        {"$match": match_stage} if match_stage else {"$match": {}},
        {"$sort": {"created_at": -1}},
        {"$limit": limit},
        {
            "$lookup": {
                "from": "videos",
                "localField": "video_id",
                "foreignField": "_id",
                "as": "video",
            }
        },
        {"$unwind": {"path": "$video", "preserveNullAndEmptyArrays": True}},
        {
            "$project": {
                "video_id": 1,
                "anomaly_id": 1,
                "label": 1,
                "time": 1,
                "confidence": 1,
                "created_at": 1,
                "resolution_status": 1,
                "resolved_at": 1,
                "video_status": "$video.status",
                "filename": {
                    "$ifNull": ["$video.original_filename", "$video.stored_filename"],
                },
            }
        },
    ]

    search_text = (video_search or "").strip()
    if search_text:
        escaped = re.escape(search_text)
        pipeline.append({"$match": {"filename": {"$regex": escaped, "$options": "i"}}})

    docs = list(detections.aggregate(pipeline))
    alerts: list[dict[str, Any]] = []

    for doc in docs:
        confidence = float(doc.get("confidence", 0) or 0)
        created_at = ensure_datetime(doc.get("created_at"))
        resolved_at = ensure_datetime(doc.get("resolved_at"))
        resolution_status = str(doc.get("resolution_status") or "").lower()
        alert_status = "resolved" if resolution_status == "resolved" or resolved_at else "active"

        if status and status != "all" and status != alert_status:
            continue

        alert = {
            "id": str(doc.get("_id")),
            "video_id": str(doc.get("video_id")) if doc.get("video_id") else None,
            "type": str(doc.get("label") or doc.get("anomaly_id") or "Anomaly"),
            "anomaly_id": str(doc.get("anomaly_id") or "unknown"),
            "description": f"{str(doc.get('label') or doc.get('anomaly_id') or 'Anomaly')} detected in analyzed video",
            "filename": str(doc.get("filename") or "Unknown video"),
            "timestamp": created_at.isoformat() if created_at else None,
            "resolved_at": resolved_at.isoformat() if resolved_at else None,
            "severity": confidence_to_severity(confidence),
            "status": alert_status,
            "confidence": round(confidence, 1),
            "video_time_seconds": float(doc.get("time", 0) or 0),
            "video_time": format_video_time(float(doc.get("time", 0) or 0)),
        }
        alerts.append(alert)

    summary = {
        "total": len(alerts),
        "active": len([a for a in alerts if a["status"] == "active"]),
        "critical": len([a for a in alerts if a["severity"] == "critical"]),
        "resolved": len([a for a in alerts if a["status"] == "resolved"]),
    }

    return {
        "summary": summary,
        "alerts": alerts,
    }


@app.post("/alerts/{alert_id}/resolve")
def resolve_alert(alert_id: str) -> dict[str, Any]:
    _, detections = require_db()

    try:
        oid = ObjectId(alert_id)
    except (InvalidId, TypeError):
        raise HTTPException(status_code=400, detail="Invalid alert id")

    result = detections.update_one(
        {"_id": oid},
        {
            "$set": {
                "resolution_status": "resolved",
                "resolved_at": now_utc(),
            }
        },
    )

    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Alert not found")

    return {"ok": True, "alert_id": alert_id, "status": "resolved"}


@app.post("/alerts/{alert_id}/toggle-resolve")
def toggle_alert_resolve(alert_id: str) -> dict[str, Any]:
    _, detections = require_db()

    try:
        oid = ObjectId(alert_id)
    except (InvalidId, TypeError):
        raise HTTPException(status_code=400, detail="Invalid alert id")

    doc = detections.find_one({"_id": oid}, {"resolution_status": 1, "resolved_at": 1})
    if not doc:
        raise HTTPException(status_code=404, detail="Alert not found")

    is_resolved = str(doc.get("resolution_status") or "").lower() == "resolved" or bool(doc.get("resolved_at"))

    if is_resolved:
        detections.update_one(
            {"_id": oid},
            {
                "$set": {"resolution_status": "active"},
                "$unset": {"resolved_at": ""},
            },
        )
        next_status = "active"
    else:
        detections.update_one(
            {"_id": oid},
            {
                "$set": {
                    "resolution_status": "resolved",
                    "resolved_at": now_utc(),
                }
            },
        )
        next_status = "resolved"

    return {"ok": True, "alert_id": alert_id, "status": next_status}


@app.get("/analytics/summary")
def analytics_summary(days: int = 7) -> dict[str, Any]:
    videos, detections = require_db()

    days = max(1, min(days, 90))
    start = now_utc() - timedelta(days=days - 1)
    prev_start = start - timedelta(days=days)

    def aggregate_counts(match_filter: dict[str, Any]) -> dict[str, int]:
        rows = list(
            detections.aggregate(
                [
                    {"$match": match_filter},
                    {"$group": {"_id": "$anomaly_id", "count": {"$sum": 1}}},
                ]
            )
        )
        return {str(r["_id"]): int(r["count"]) for r in rows}

    current_counts = aggregate_counts({"created_at": {"$gte": start}})
    previous_counts = aggregate_counts({"created_at": {"$gte": prev_start, "$lt": start}})

    anomaly_trends = []
    all_keys = sorted(set(current_counts) | set(previous_counts))
    for key in all_keys:
        current = current_counts.get(key, 0)
        previous = previous_counts.get(key, 0)
        if previous == 0 and current > 0:
            change_pct = 100.0
        elif previous == 0:
            change_pct = 0.0
        else:
            change_pct = ((current - previous) / previous) * 100.0

        anomaly_trends.append(
            {
                "anomaly_id": key,
                "current": current,
                "previous": previous,
                "trend": "up" if change_pct >= 0 else "down",
                "change": round(change_pct, 1),
            }
        )

    hour_rows = list(
        detections.aggregate(
            [
                {"$match": {"created_at": {"$gte": start}}},
                {"$group": {"_id": {"$hour": "$created_at"}, "count": {"$sum": 1}}},
            ]
        )
    )
    hour_counts = {int(r["_id"]): int(r["count"]) for r in hour_rows}

    slots = [
        ("00:00-06:00", 0, 6),
        ("06:00-12:00", 6, 12),
        ("12:00-18:00", 12, 18),
        ("18:00-24:00", 18, 24),
    ]
    time_patterns = []
    for label, start_h, end_h in slots:
        count = sum(hour_counts.get(h, 0) for h in range(start_h, end_h))
        if count >= 15:
            severity = "Critical"
            pattern = "Peak anomaly window"
        elif count >= 8:
            severity = "High"
            pattern = "Elevated anomaly activity"
        elif count >= 4:
            severity = "Medium"
            pattern = "Moderate activity"
        else:
            severity = "Low"
            pattern = "Minimal activity"

        time_patterns.append(
            {
                "time": label,
                "anomalies": count,
                "severity": severity,
                "pattern": pattern,
            }
        )

    top_videos = list(
        videos.find(
            {"created_at": {"$gte": start}},
            {"original_filename": 1, "total_detections": 1, "status": 1},
        )
        .sort("total_detections", -1)
        .limit(5)
    )

    hot_zones = []
    for row in top_videos:
        total = int(row.get("total_detections", 0) or 0)
        intensity = min(100, total * 8)
        risk = "High" if total >= 10 else "Medium" if total >= 5 else "Low"
        hot_zones.append(
            {
                "zone": str(row.get("original_filename") or "Unknown source"),
                "anomalies": total,
                "risk": risk,
                "intensity": intensity,
            }
        )

    return {
        "days": days,
        "anomaly_trends": anomaly_trends,
        "time_patterns": time_patterns,
        "hot_zones": hot_zones,
    }


# ---------------------------------------------------------------------------
# Process video – runs all selected anomaly detectors concurrently
# ---------------------------------------------------------------------------

@app.post("/process-video")
async def process_video(
    file: UploadFile = File(...),
    anomaly_types: str = Form(...),  # JSON-encoded list of anomaly IDs
):
    """
    Upload a video and stream detection results as Server-Sent Events.

    Each SSE message is a JSON object with a "type" field:
      - {"type":"event", "anomalyId":"…", "time":…, "confidence":…, "label":"…"}
      - {"type":"error", "anomalyId":"…", "message":"…"}
      - {"type":"detector_done", "anomalyId":"…"}
      - {"type":"done"}  (final message)
    """

    # ---- parse & validate anomaly selection --------------------------------
    try:
        selected: list[str] = json.loads(anomaly_types)
    except (json.JSONDecodeError, TypeError):
        raise HTTPException(status_code=400, detail="anomaly_types must be a JSON array of strings.")

    if not selected:
        raise HTTPException(status_code=400, detail="Select at least one anomaly type.")

    unknown = [a for a in selected if a not in DETECTOR_REGISTRY]
    if unknown:
        raise HTTPException(status_code=400, detail=f"Unknown anomaly types: {unknown}")

    # ---- save uploaded file ------------------------------------------------
    filename = f"{uuid.uuid4().hex}_{Path(file.filename).name}"
    dest_path = UPLOAD_DIR / filename

    try:
        with open(dest_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    finally:
        try:
            file.file.close()
        except Exception:
            pass

    video_doc_id = None
    if db_enabled():
        try:
            insert_result = videos_col.insert_one(
                {
                    "original_filename": file.filename,
                    "stored_filename": filename,
                    "upload_path": str(dest_path),
                    "selected_anomalies": selected,
                    "status": "processing",
                    "created_at": now_utc(),
                    "updated_at": now_utc(),
                    "completed_at": None,
                    "total_detections": 0,
                    "detector_errors": [],
                }
            )
            video_doc_id = insert_result.inserted_id
        except PyMongoError:
            # Keep processing even if DB write fails
            video_doc_id = None

    # ---- SSE streaming generator -------------------------------------------
    def sse_generator():
        q: queue.Queue = queue.Queue()
        event_count = 0
        detector_errors: list[dict[str, str]] = []
        lock = threading.Lock()

        def run_detector(anomaly_id: str):
            nonlocal event_count
            detect_fn = DETECTOR_REGISTRY[anomaly_id]
            try:
                # Works with generators (yield) and plain lists (return [])
                for event in detect_fn(str(dest_path), str(MODEL_DIR)):
                    if video_doc_id is not None:
                        try:
                            detections_col.insert_one(
                                {
                                    "video_id": video_doc_id,
                                    "anomaly_id": anomaly_id,
                                    "label": event.get("label", anomaly_id),
                                    "time": event.get("time", 0),
                                    "confidence": event.get("confidence", 0),
                                    "created_at": now_utc(),
                                }
                            )
                        except PyMongoError:
                            pass

                    with lock:
                        event_count += 1

                    q.put(json.dumps({
                        "type": "event",
                        "anomalyId": anomaly_id,
                        **event,
                    }))
            except Exception as e:
                with lock:
                    detector_errors.append({"anomalyId": anomaly_id, "message": str(e)})
                q.put(json.dumps({
                    "type": "error",
                    "anomalyId": anomaly_id,
                    "message": str(e),
                }))
            q.put(json.dumps({"type": "detector_done", "anomalyId": anomaly_id}))

        # Launch all detectors in parallel threads
        threads = []
        for aid in selected:
            t = threading.Thread(target=run_detector, args=(aid,), daemon=True)
            t.start()
            threads.append(t)

        finished = 0
        total = len(selected)
        while finished < total:
            try:
                data = q.get(timeout=300)
                parsed = json.loads(data)
                if parsed.get("type") == "detector_done":
                    finished += 1
                yield f"data: {data}\n\n"
            except queue.Empty:
                break

        if video_doc_id is not None:
            try:
                videos_col.update_one(
                    {"_id": video_doc_id},
                    {
                        "$set": {
                            "status": "failed" if detector_errors else "completed",
                            "updated_at": now_utc(),
                            "completed_at": now_utc(),
                            "detector_errors": detector_errors,
                            "total_detections": event_count,
                        }
                    },
                )
            except PyMongoError:
                pass

        yield 'data: {"type":"done"}\n\n'

        # Wait for threads then clean up the uploaded file
        for t in threads:
            t.join(timeout=5)
        if AUTO_DELETE_UPLOADS:
            try:
                os.remove(dest_path)
            except OSError:
                pass

    return StreamingResponse(sse_generator(), media_type="text/event-stream")
