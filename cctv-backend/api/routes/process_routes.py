import json
import os
import queue
import shutil
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Callable

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pymongo.errors import PyMongoError

from core import app_state as st
from detectors.fall_detector import stream_inference as stream_fall_inference
from detectors.fire_detector import stream_inference as stream_fire_inference
from detectors.fight_detector import stream_inference as stream_fight_inference
from detectors.gunshot_detector import stream_inference as stream_gunshot_inference
from detectors.scream_detector import stream_inference as stream_scream_inference
from detectors.crowd_detector import stream_inference as stream_crowd_inference

router = APIRouter(tags=["processing"])


RealtimeStreamFn = Callable[..., Any]

REALTIME_MODE_CONFIG: dict[str, dict[str, Any]] = {
    "gunshot": {
        "anomaly_id": "gunshot_audio",
        "event_label": "Gunshot",
        "default_prediction": "No Gunshot",
        "threshold_pct": 50.0,
        "stream_fn": stream_gunshot_inference,
        "stream_kwargs": {"step_dur": 0.75, "batch_size": 32},
    },
    "fire": {
        "anomaly_id": "explosion_fire_visual",
        "event_label": "Explosion/Fire",
        "default_prediction": "No Fire",
        "threshold_pct": 35.0,
        "stream_fn": stream_fire_inference,
        "stream_kwargs": {"infer_fps": 6.0, "conf_threshold": 0.35},
    },
    "fall": {
        "anomaly_id": "sudden_fall_visual",
        "event_label": "Sudden Fall",
        "default_prediction": "Normal Posture",
        "threshold_pct": 55.0,
        "stream_fn": stream_fall_inference,
        "stream_kwargs": {"infer_fps": 10.0},
    },
    "fight": {
        "anomaly_id": "fight_visual",
        "event_label": "Fight",
        "default_prediction": "No Fight",
        "threshold_pct": 50.0,
        "stream_fn": stream_fight_inference,
        "stream_kwargs": {"target_infer_fps": 8.0},
    },
    "scream": {
        "anomaly_id": "scream_audio",
        "event_label": "Scream",
        "default_prediction": "No Scream",
        "threshold_pct": 75.0,
        "stream_fn": stream_scream_inference,
        "stream_realtime_clocked": True,
        "stream_kwargs": {
            "window_duration": 1.0,
            "window_hop": 0.1,
            "scream_threshold": 0.75,
            "yamnet_threshold": 0.025,
            "realtime_mode": True,
        },
    },
    "crowd": {
        "anomaly_id": "crowd_gathering_visual",
        "event_label": "Crowd Gathering",
        "default_prediction": "No Crowd",
        "threshold_pct": 65.0,
        "stream_fn": stream_crowd_inference,
        "stream_kwargs": {"target_infer_fps": 6.0, "conf_threshold": 0.35},
    },
}


def _normalize_realtime_mode(mode: str) -> str:
    return (mode or "").strip().lower()


def _get_realtime_mode_config(mode: str) -> dict[str, Any]:
    normalized_mode = _normalize_realtime_mode(mode)
    if normalized_mode not in REALTIME_MODE_CONFIG:
        raise HTTPException(
            status_code=400,
            detail={
                "message": f"Unsupported realtime mode: {mode}",
                "supported_modes": sorted(REALTIME_MODE_CONFIG.keys()),
            },
        )
    return REALTIME_MODE_CONFIG[normalized_mode]


def _build_realtime_mode_response(file: UploadFile, mode: str) -> StreamingResponse:
    config = _get_realtime_mode_config(mode)
    anomaly_id = str(config["anomaly_id"])
    event_label = str(config["event_label"])
    default_prediction = str(config["default_prediction"])
    threshold_pct = float(config["threshold_pct"])
    stream_fn: RealtimeStreamFn = config["stream_fn"]
    stream_realtime_clocked = bool(config.get("stream_realtime_clocked", False))
    stream_kwargs: dict[str, Any] = dict(config.get("stream_kwargs") or {})

    filename, dest_path = _store_uploaded_video(file)
    video_doc_id = _insert_video_doc_if_db_available(file, filename, dest_path, [anomaly_id])

    def realtime_sse_generator():
        event_count = 0
        detector_errors: list[dict[str, str]] = []

        if video_doc_id is not None:
            yield _sse_data(
                {
                    "type": "video_meta",
                    "videoId": str(video_doc_id),
                    "streamUrl": f"/videos/{str(video_doc_id)}/stream",
                    "processedStreamUrl": f"/videos/{str(video_doc_id)}/processed-stream",
                    "mode": _normalize_realtime_mode(mode),
                }
            )

        start_wall_time = time.monotonic()

        try:
            for frame_result in stream_fn(str(dest_path), str(st.MODEL_DIR), **stream_kwargs):
                start_time = float(frame_result.get("time", 0.0) or 0.0)
                end_time = frame_result.get("end_time")
                emit_time = float(end_time) if end_time is not None else start_time

                # Use window end as emission clock so predictions are not revealed
                # before the analyzed segment has actually elapsed.
                if not stream_realtime_clocked:
                    wait_time = emit_time - (time.monotonic() - start_wall_time)
                    if wait_time > 0:
                        time.sleep(wait_time)

                is_detection = bool(frame_result.get("is_detection"))

                yield _sse_data(
                    {
                        "type": "tick",
                        "anomalyId": anomaly_id,
                        "mode": _normalize_realtime_mode(mode),
                        "time": frame_result.get("time", 0),
                        "end_time": frame_result.get("end_time"),
                        "confidence": frame_result.get("confidence", 0),
                        "prediction_label": frame_result.get("prediction_label", default_prediction),
                        "is_detection": is_detection,
                        "threshold": threshold_pct,
                    }
                )

                yield _sse_data(
                    {
                        "type": "prediction",
                        "anomalyId": anomaly_id,
                        "mode": _normalize_realtime_mode(mode),
                        "time": frame_result.get("time", 0),
                        "end_time": frame_result.get("end_time"),
                        "confidence": frame_result.get("confidence", 0),
                        "label": frame_result.get("prediction_label", default_prediction),
                        "is_detection": is_detection,
                        "bbox": frame_result.get("bbox"),
                    }
                )

                if is_detection:
                    event = {
                        "time": frame_result.get("time", 0),
                        "end_time": frame_result.get("end_time"),
                        "confidence": frame_result.get("confidence", 0),
                        "label": event_label,
                        "bbox": frame_result.get("bbox"),
                    }
                    _persist_detection_if_possible(video_doc_id, anomaly_id, event)
                    event_count += 1
                    yield _sse_data({"type": "event", "anomalyId": anomaly_id, "mode": _normalize_realtime_mode(mode), **event})
        except Exception as exc:
            detector_errors.append({"anomalyId": anomaly_id, "message": str(exc)})
            yield _sse_data({"type": "error", "anomalyId": anomaly_id, "mode": _normalize_realtime_mode(mode), "message": str(exc)})

        status = "failed" if detector_errors else "completed"
        _update_video_doc(video_doc_id, status, detector_errors, event_count)

        done_payload: dict[str, Any] = {"type": "done", "mode": _normalize_realtime_mode(mode)}
        if video_doc_id is not None:
            done_payload["videoId"] = str(video_doc_id)
            done_payload["processedStreamUrl"] = f"/videos/{str(video_doc_id)}/processed-stream"
        yield _sse_data(done_payload)

        if st.AUTO_DELETE_UPLOADS:
            try:
                os.remove(dest_path)
            except OSError:
                pass

    return StreamingResponse(realtime_sse_generator(), media_type="text/event-stream")


def _parse_selected_anomalies(anomaly_types: str) -> list[str]:
    try:
        selected: list[str] = json.loads(anomaly_types)
    except (json.JSONDecodeError, TypeError):
        raise HTTPException(status_code=400, detail="anomaly_types must be a JSON array of strings.")

    if not selected:
        raise HTTPException(status_code=400, detail="Select at least one anomaly type.")

    unknown = [anomaly_id for anomaly_id in selected if anomaly_id not in st.DETECTOR_REGISTRY]
    if unknown:
        raise HTTPException(status_code=400, detail=f"Unknown anomaly types: {unknown}")

    return selected


def _store_uploaded_video(file: UploadFile) -> tuple[str, Path]:
    filename = f"{uuid.uuid4().hex}_{Path(file.filename).name}"
    dest_path = st.UPLOAD_DIR / filename

    try:
        with open(dest_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    finally:
        try:
            file.file.close()
        except Exception:
            pass

    return filename, dest_path


def _insert_video_doc_if_db_available(file: UploadFile, filename: str, dest_path: Path, selected: list[str]):
    if not st.db_enabled():
        return None

    try:
        insert_result = st.videos_col.insert_one(
            {
                "original_filename": file.filename,
                "stored_filename": filename,
                "upload_path": str(dest_path),
                "processed_path": None,
                "selected_anomalies": selected,
                "status": "processing",
                "created_at": st.now_utc(),
                "updated_at": st.now_utc(),
                "completed_at": None,
                "total_detections": 0,
                "detector_errors": [],
            }
        )
        return insert_result.inserted_id
    except PyMongoError:
        return None


def _sse_data(payload: dict[str, Any]) -> str:
    return f"data: {json.dumps(payload)}\n\n"


def _update_video_doc(video_doc_id, status: str, detector_errors: list[dict[str, str]], event_count: int) -> None:
    if video_doc_id is None:
        return
    try:
        st.videos_col.update_one(
            {"_id": video_doc_id},
            {
                "$set": {
                    "status": status,
                    "updated_at": st.now_utc(),
                    "completed_at": st.now_utc(),
                    "detector_errors": detector_errors,
                    "total_detections": event_count,
                }
            },
        )
    except PyMongoError:
        pass


def _persist_detection_if_possible(video_doc_id, anomaly_id: str, event: dict[str, Any]) -> None:
    if video_doc_id is None:
        return
    try:
        st.detections_col.insert_one(
            {
                "video_id": video_doc_id,
                "anomaly_id": anomaly_id,
                "label": event.get("label", anomaly_id),
                "time": event.get("time", 0),
                "end_time": event.get("end_time"),
                "confidence": event.get("confidence", 0),
                "bbox": event.get("bbox"),
                "created_at": st.now_utc(),
            }
        )
    except PyMongoError:
        pass


@router.post("/process-video")
async def process_video(
    file: UploadFile = File(...),
    anomaly_types: str = Form(...),
):
    """
    Upload a video and stream detection results as Server-Sent Events.

    Each SSE message is a JSON object with a "type" field:
      - {"type":"event", "anomalyId":"…", "time":…, "confidence":…, "label":"…"}
      - {"type":"error", "anomalyId":"…", "message":"…"}
      - {"type":"detector_done", "anomalyId":"…"}
      - {"type":"done"}  (final message)
    """

    selected = _parse_selected_anomalies(anomaly_types)
    filename, dest_path = _store_uploaded_video(file)
    video_doc_id = _insert_video_doc_if_db_available(file, filename, dest_path, selected)

    def sse_generator():
        q: queue.Queue = queue.Queue()
        event_count = 0
        detector_errors: list[dict[str, str]] = []
        lock = threading.Lock()

        if video_doc_id is not None:
            yield _sse_data(
                {
                    "type": "video_meta",
                    "videoId": str(video_doc_id),
                    "streamUrl": f"/videos/{str(video_doc_id)}/stream",
                    "processedStreamUrl": f"/videos/{str(video_doc_id)}/processed-stream",
                }
            )

        def run_detector(anomaly_id: str):
            nonlocal event_count
            detect_fn = st.DETECTOR_REGISTRY[anomaly_id]
            try:
                for event in detect_fn(str(dest_path), str(st.MODEL_DIR)):
                    if video_doc_id is not None:
                        try:
                            st.detections_col.insert_one(
                                {
                                    "video_id": video_doc_id,
                                    "anomaly_id": anomaly_id,
                                    "label": event.get("label", anomaly_id),
                                    "time": event.get("time", 0),
                                    "end_time": event.get("end_time"),
                                    "confidence": event.get("confidence", 0),
                                    "bbox": event.get("bbox"),
                                    "created_at": st.now_utc(),
                                }
                            )
                        except PyMongoError:
                            pass

                    with lock:
                        event_count += 1

                    q.put(json.dumps({"type": "event", "anomalyId": anomaly_id, **event}))
            except Exception as e:
                with lock:
                    detector_errors.append({"anomalyId": anomaly_id, "message": str(e)})
                q.put(json.dumps({"type": "error", "anomalyId": anomaly_id, "message": str(e)}))
            q.put(json.dumps({"type": "detector_done", "anomalyId": anomaly_id}))

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
                st.videos_col.update_one(
                    {"_id": video_doc_id},
                    {
                        "$set": {
                            "status": "failed" if detector_errors else "completed",
                            "updated_at": st.now_utc(),
                            "completed_at": st.now_utc(),
                            "detector_errors": detector_errors,
                            "total_detections": event_count,
                        }
                    },
                )
            except PyMongoError:
                pass

        done_payload: dict[str, Any] = {"type": "done"}
        if video_doc_id is not None:
            done_payload["videoId"] = str(video_doc_id)
            done_payload["processedStreamUrl"] = f"/videos/{str(video_doc_id)}/processed-stream"
        yield _sse_data(done_payload)

        for t in threads:
            t.join(timeout=5)
        if st.AUTO_DELETE_UPLOADS:
            try:
                os.remove(dest_path)
            except OSError:
                pass

    return StreamingResponse(sse_generator(), media_type="text/event-stream")


@router.post("/process-video-realtime-gunshot")
async def process_video_realtime_gunshot(file: UploadFile = File(...)):
    return _build_realtime_mode_response(file, "gunshot")


@router.post("/process-video-realtime-fire")
async def process_video_realtime_fire(file: UploadFile = File(...)):
    return _build_realtime_mode_response(file, "fire")


@router.post("/process-video-realtime-fall")
async def process_video_realtime_fall(file: UploadFile = File(...)):
    return _build_realtime_mode_response(file, "fall")


@router.post("/process-video-realtime-fight")
async def process_video_realtime_fight(file: UploadFile = File(...)):
    return _build_realtime_mode_response(file, "fight")


@router.post("/process-video-realtime-scream")
async def process_video_realtime_scream(file: UploadFile = File(...)):
    return _build_realtime_mode_response(file, "scream")


@router.post("/process-video-realtime")
async def process_video_realtime(
    file: UploadFile = File(...),
    mode: str = Form(...),
):
    """Unified realtime endpoint for all supported modes.

    Supported modes today: gunshot, fire, fall, fight, scream.
    Future models (e.g., crowd/scream) can be added by extending
    REALTIME_MODE_CONFIG with their stream function + metadata.
    """
    return _build_realtime_mode_response(file, mode)
