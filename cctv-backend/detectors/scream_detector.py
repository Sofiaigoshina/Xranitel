"""Realtime scream detector using YAMNet + trained classifier (.keras).

Exposes two backend-compatible functions:
- stream_inference(video_path, model_dir, ...): yields per-window predictions
- detect(video_path, model_dir): yields only scream events
"""

from __future__ import annotations

import os
import shutil
import subprocess
import time
from typing import Iterator

import imageio_ffmpeg
import librosa
import numpy as np


MODEL_FILENAME = "scream_classifier.keras"
YAMNET_MODEL_URL = "https://tfhub.dev/google/yamnet/1"
SAMPLE_RATE = 16000

WINDOW_DURATION = 1.0
WINDOW_HOP = 0.1

SCREAM_THRESHOLD = 0.75
YAMNET_SCREAM_THRESHOLD = 0.005
YAMNET_SCREAM_CLASS_IDS = [14, 15, 16]  # 14: Yell, 15: Shout, 16: Scream
EVENT_COOLDOWN_SEC = 0.75


_cached_classifier = None
_cached_yamnet = None
_cached_tf = None
_cached_model_path: str | None = None
_cached_device_type: str | None = None


def _import_tf_stack():
    try:
        import tensorflow as tf  # type: ignore[import-not-found]
        import tensorflow_hub as hub  # type: ignore[import-not-found]
    except Exception as exc:
        raise RuntimeError(f"TensorFlow stack unavailable: {exc}")
    return tf, hub


def _configure_tf_device(tf_module) -> str:
    """Enable GPU memory growth when CUDA is available."""
    try:
        gpus = tf_module.config.list_physical_devices("GPU")
        if not gpus:
            return "cpu"

        for gpu in gpus:
            try:
                tf_module.config.experimental.set_memory_growth(gpu, True)
            except Exception:
                pass

        return "gpu"
    except Exception:
        return "cpu"


def _load_yamnet_model(hub_module):
    try:
        return hub_module.load(YAMNET_MODEL_URL)
    except ValueError as exc:
        message = str(exc)
        is_cache_corruption = (
            "incompatible/unknown type" in message
            and "contains neither 'saved_model.pb' nor 'saved_model.pbtxt'" in message
        )
        if not is_cache_corruption:
            raise

        cache_path = None
        parts = message.split("'")
        if len(parts) >= 2:
            cache_path = parts[1]

        if not cache_path or not os.path.isdir(cache_path):
            raise

        shutil.rmtree(cache_path, ignore_errors=True)
        return hub_module.load(YAMNET_MODEL_URL)


def _load_models(model_path: str):
    global _cached_classifier, _cached_yamnet, _cached_tf, _cached_model_path, _cached_device_type
    if (
        _cached_classifier is not None
        and _cached_yamnet is not None
        and _cached_tf is not None
        and _cached_model_path == model_path
    ):
        return _cached_tf, _cached_yamnet, _cached_classifier

    tf, hub = _import_tf_stack()
    _cached_device_type = _configure_tf_device(tf)
    yamnet_model = _load_yamnet_model(hub)
    classifier = tf.keras.models.load_model(model_path)

    _cached_tf = tf
    _cached_yamnet = yamnet_model
    _cached_classifier = classifier
    _cached_model_path = model_path
    return tf, yamnet_model, classifier


def preload_models(model_dir: str) -> tuple[bool, str]:
    """Best-effort warmup to reduce first-request latency.

    Returns (ok, message).
    """
    model_path = os.path.join(model_dir, MODEL_FILENAME)
    if not os.path.exists(model_path):
        return False, f"Scream model missing: {model_path}"

    try:
        _load_models(model_path)
        return True, "Scream models preloaded"
    except Exception as exc:
        return False, f"Scream preload skipped: {exc}"


def _extract_embedding_and_yamnet_score(tf_module, yamnet_model, waveform: np.ndarray):
    scores, embeddings, _ = yamnet_model(waveform)
    # Max-pool to capture short, high-energy scream bursts within the window.
    mean_embedding = tf_module.reduce_max(embeddings, axis=0).numpy()

    scores_np = scores.numpy()
    scream_scores = scores_np[:, YAMNET_SCREAM_CLASS_IDS]
    yamnet_scream_score = float(np.max(scream_scores))
    return mean_embedding, yamnet_scream_score


def _iter_windows(waveform: np.ndarray, sr: int, window_sec: float, hop_sec: float):
    window_len = max(1, int(window_sec * sr))
    hop_len = max(1, int(hop_sec * sr))
    total = len(waveform)

    start = 0
    while start + window_len <= total:
        end = start + window_len
        yield start / sr, end / sr, waveform[start:end]
        start += hop_len

    if start < total and (total - start) > int(0.5 * sr):
        yield start / sr, total / sr, waveform[start:]


def _iter_windows_from_video_ffmpeg(
    video_path: str,
    sr: int,
    window_sec: float,
    hop_sec: float,
):
    """Stream audio from video via ffmpeg and yield sliding windows incrementally."""
    ffmpeg_path = imageio_ffmpeg.get_ffmpeg_exe()
    window_len = max(1, int(window_sec * sr))
    hop_len = max(1, int(hop_sec * sr))
    bytes_per_sample = 2  # s16le

    ffmpeg_command = [
        ffmpeg_path,
        "-i",
        video_path,
        "-vn",
        "-ac",
        "1",
        "-ar",
        str(sr),
        "-sample_fmt",
        "s16",
        "-f",
        "s16le",
        "pipe:1",
    ]

    proc = subprocess.Popen(
        ffmpeg_command,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        bufsize=10**6,
    )

    if proc.stdout is None:
        proc.kill()
        raise RuntimeError("Failed to open ffmpeg stdout pipe for scream detector")

    buffer = np.empty(0, dtype=np.float32)
    start_sample = 0

    completed_normally = False
    try:
        while True:
            raw = proc.stdout.read(hop_len * bytes_per_sample)
            if not raw:
                completed_normally = True
                break

            chunk = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
            if chunk.size == 0:
                continue

            # Auto-gain for faint signals to preserve acoustic shape.
            chunk_peak = float(np.max(np.abs(chunk)))
            if chunk_peak > 0.005:
                chunk = chunk / chunk_peak

            buffer = np.concatenate((buffer, chunk))

            while buffer.size >= window_len:
                window = buffer[:window_len]
                end_sample = start_sample + window_len
                yield start_sample / sr, end_sample / sr, window
                start_sample += hop_len
                buffer = buffer[hop_len:]

        if buffer.size > int(0.5 * sr):
            yield start_sample / sr, (start_sample + buffer.size) / sr, buffer
    finally:
        try:
            proc.stdout.close()
        except Exception:
            pass

        # If generator is closed early by the consumer, ffmpeg can exit with non-zero
        # due to a broken pipe. Do not treat that as a detector error.
        if completed_normally:
            return_code = proc.wait()
            if return_code != 0:
                raise RuntimeError(f"ffmpeg audio streaming failed with exit code {return_code}")
        else:
            try:
                proc.terminate()
            except Exception:
                pass
            try:
                proc.wait(timeout=1.0)
            except Exception:
                try:
                    proc.kill()
                except Exception:
                    pass


def _fallback_scream_probability(window: np.ndarray, sr: int) -> float:
    """Heuristic fallback when TensorFlow/YAMNet is unavailable.

    Uses a blend of RMS energy + spectral centroid + zero-crossing rate.
    Returns a pseudo-probability in [0,1].
    """
    if window.size == 0:
        return 0.0

    rms = float(np.sqrt(np.mean(np.square(window)) + 1e-9))
    centroid_arr = librosa.feature.spectral_centroid(y=window, sr=sr)
    zcr_arr = librosa.feature.zero_crossing_rate(window)

    centroid = float(np.mean(centroid_arr)) if centroid_arr.size else 0.0
    zcr = float(np.mean(zcr_arr)) if zcr_arr.size else 0.0

    # Empirical normalization ranges for human scream-like segments.
    rms_n = float(np.clip((rms - 0.02) / 0.20, 0.0, 1.0))
    centroid_n = float(np.clip((centroid - 1400.0) / 2600.0, 0.0, 1.0))
    zcr_n = float(np.clip((zcr - 0.04) / 0.16, 0.0, 1.0))

    prob = (0.50 * rms_n) + (0.35 * centroid_n) + (0.15 * zcr_n)
    return float(np.clip(prob, 0.0, 1.0))


def stream_inference(
    video_path: str,
    model_dir: str,
    *,
    window_duration: float | None = None,
    window_hop: float | None = None,
    scream_threshold: float | None = None,
    yamnet_threshold: float | None = None,
    realtime_mode: bool = False,
) -> Iterator[dict]:
    """Yield per-audio-window scream predictions in timeline order."""
    model_path = os.path.join(model_dir, MODEL_FILENAME)
    has_classifier_file = os.path.exists(model_path)

    effective_window_duration = max(0.25, float(window_duration) if window_duration is not None else WINDOW_DURATION)
    effective_window_hop = max(0.05, float(window_hop) if window_hop is not None else WINDOW_HOP)
    effective_scream_threshold = float(scream_threshold) if scream_threshold is not None else SCREAM_THRESHOLD
    effective_yamnet_threshold = float(yamnet_threshold) if yamnet_threshold is not None else YAMNET_SCREAM_THRESHOLD
    wall_start = time.monotonic() if realtime_mode else None

    tf_module = None
    yamnet_model = None
    classifier = None
    use_tf_pipeline = has_classifier_file
    if use_tf_pipeline:
        try:
            tf_module, yamnet_model, classifier = _load_models(model_path)
        except Exception:
            # Graceful fallback: keep realtime running without throwing detector error.
            use_tf_pipeline = False
    else:
        use_tf_pipeline = False

    for start_sec, end_sec, window in _iter_windows_from_video_ffmpeg(
        video_path,
        SAMPLE_RATE,
        effective_window_duration,
        effective_window_hop,
    ):
        if window.size == 0:
            continue

        if wall_start is not None:
            target = wall_start + float(end_sec)
            delay = target - time.monotonic()
            if delay > 0:
                time.sleep(delay)

        if use_tf_pipeline and tf_module is not None and yamnet_model is not None and classifier is not None:
            embedding, yamnet_score = _extract_embedding_and_yamnet_score(tf_module, yamnet_model, window)

            if yamnet_score < effective_yamnet_threshold:
                prob = 0.0
                is_scream = False
            else:
                raw_pred = classifier.predict(embedding[np.newaxis, :], verbose=0)[0][0]
                prob = float(raw_pred)
                is_scream = prob >= effective_scream_threshold
        else:
            prob = _fallback_scream_probability(window, SAMPLE_RATE)
            is_scream = prob >= effective_scream_threshold

        confidence_pct = round(prob * 100.0, 1)
        emit_time = float(end_sec) if realtime_mode else float(start_sec)
        yield {
            "time": round(emit_time, 2),
            "end_time": round(float(end_sec), 2),
            "confidence": confidence_pct,
            "label": "Крик" if is_scream else "Нет крика",
            "prediction_label": "Крик" if is_scream else "Нет крика",
            "is_detection": is_scream,
        }


def detect(video_path: str, model_dir: str):
    """Yield scream events only (for standard detector pipeline)."""
    last_emit_time = -1e9

    for frame_result in stream_inference(video_path, model_dir, realtime_mode=True):
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
            "label": "Крик",
        }
