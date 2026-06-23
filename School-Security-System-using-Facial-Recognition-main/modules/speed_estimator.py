# modules/speed_estimator.py
import time
import math
from collections import deque, defaultdict
import numpy as np
import cv2

# Настройки (можно вынести в config.yaml)
DEFAULT_PERSON_HEIGHT_M = 1.70     # средний рост человека (м)
MIN_SPEED_KMPH = 0.5               # ниже этого считаем 0
RUNNING_KMPH_THRESHOLD = 10.0      # выше этого = бег
EMA_ALPHA = 0.45                   # сглаживание скорости

# Хранилище истории треков
track_histories = defaultdict(lambda: deque(maxlen=8))
# Сглаженная скорость
speed_ema = {}


def compute_ppm_from_bbox(bbox_h_pixels, expected_height_m=DEFAULT_PERSON_HEIGHT_M):
    """Переводит высоту bounding box в пиксели на метр"""
    if bbox_h_pixels <= 0 or expected_height_m <= 0:
        return None
    return float(bbox_h_pixels) / float(expected_height_m)


def _estimate_velocity_regression(history):
    """Оценивает скорость через линейную регрессию"""
    if len(history) < 2:
        return None, 0.0, None

    ts = np.array([h[2] for h in history], dtype=np.float64)
    xs = np.array([h[0] for h in history], dtype=np.float64)
    ys = np.array([h[1] for h in history], dtype=np.float64)
    ppms = [h[4] for h in history if h[4] is not None]

    t0 = ts.mean()
    T = ts - t0

    try:
        a_x, b_x = np.polyfit(T, xs, 1)
        a_y, b_y = np.polyfit(T, ys, 1)
        vx = float(a_x)
        vy = float(a_y)
        px_per_s = math.hypot(vx, vy)
    except Exception:
        x1, y1, t1 = xs[-2], ys[-2], ts[-2]
        x2, y2, t2 = xs[-1], ys[-1], ts[-1]
        dt = max(1e-3, t2 - t1)
        px_per_s = math.hypot(x2 - x1, y2 - y1) / dt

    used_ppm = float(np.median(ppms)) if len(ppms) else None

    if used_ppm and used_ppm > 1e-6:
        m_per_s = px_per_s / used_ppm
        kmph = m_per_s * 3.6
        return float(kmph), float(px_per_s), used_ppm
    else:
        return None, float(px_per_s), None


def process_person_detections(detections, frame, camera_id="Cam_1",
                              landmarks_map=None,
                              expected_person_height_m=DEFAULT_PERSON_HEIGHT_M):
    """
    Обрабатывает детекции людей и вычисляет скорость
    detections: список кортежей (track_id, x1, y1, x2, y2, label)
    """
    now = time.time()
    for det in detections:
        try:
            track_id, x1, y1, x2, y2, label = det
        except Exception:
            continue
        if label != "person":
            continue

        # Центр объекта
        if landmarks_map and track_id in landmarks_map:
            cx, cy = landmarks_map[track_id]
        else:
            cx = (x1 + x2) / 2.0
            cy = (y1 + y2) / 2.0

        bbox_h = max(1.0, float(y2 - y1))
        ppm = compute_ppm_from_bbox(bbox_h, expected_person_height_m)

        # Сохраняем в историю
        hist = track_histories[track_id]
        hist.append((float(cx), float(cy), now, float(bbox_h), ppm))

        # Вычисляем скорость
        speed_kmph, pxps, used_ppm = _estimate_velocity_regression(list(hist))

        # Сглаживание
        prev = speed_ema.get(track_id)
        if speed_kmph is not None:
            if prev is None:
                smoothed = speed_kmph
            else:
                smoothed = (1 - EMA_ALPHA) * prev + EMA_ALPHA * speed_kmph
            speed_ema[track_id] = float(smoothed)
        else:
            smoothed = prev if prev is not None else None

        if smoothed is None and pxps and used_ppm:
            smoothed = (pxps / used_ppm) * 3.6

        display_speed = float(smoothed) if smoothed and smoothed >= MIN_SPEED_KMPH else 0.0

        # Отображаем скорость на кадре
        text = f"ID:{track_id} {display_speed:.1f} km/h"
        cv2.putText(frame, text, (int(x1), max(20, int(y1)-10)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 200, 0), 2)

        # Алерт при беге
        if display_speed >= RUNNING_KMPH_THRESHOLD:
            print(f"[ALERT] Бег на {camera_id} | ID:{track_id} | {display_speed:.1f} km/h")

    return frame


def cleanup_stale_tracks(max_age_sec=5.0):
    """Очищает старые треки"""
    now = time.time()
    remove = []
    for tid, hist in list(track_histories.items()):
        if not hist:
            remove.append(tid)
            continue
        if now - hist[-1][2] > max_age_sec:
            remove.append(tid)
    for tid in remove:
        track_histories.pop(tid, None)
        speed_ema.pop(tid, None)