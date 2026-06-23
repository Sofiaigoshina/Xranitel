"""
ЛЁГКАЯ ОЦЕНКА ДЕТЕКТОРОВ - по одному видео за раз
Для слабых компьютеров - без перегрева!
Запуск: python evaluate_light.py
"""

import os
import json
import gc
from pathlib import Path
from datetime import datetime

# ПУТИ
TEST_VIDEOS_DIR = Path(__file__).parent.parent / "test_videos"
MODEL_DIR = Path(__file__).parent / "models"
RESULTS_FILE = TEST_VIDEOS_DIR / "evaluation_light.json"

# Какой детектор запускать (ИЗМЕНИТЕ НА НУЖНЫЙ)
# options: 'fight', 'fall', 'fire', 'crowd', 'scream'
CURRENT_DETECTOR = 'fight'  # <--- МЕНЯЙТЕ ЗДЕСЬ

# РУССКИЕ НАЗВАНИЯ
DETECTOR_NAMES = {
    'fight': 'Драка',
    'fall': 'Падение',
    'fire': 'Пожар',
    'crowd': 'Скопление',
    'scream': 'Крик'
}

def load_ground_truth(video_file):
    """Загружает ground truth для конкретного видео"""
    gt_file = TEST_VIDEOS_DIR / "ground_truth.json"
    if not gt_file.exists():
        print(f"[ОШИБКА] Файл {gt_file} не найден")
        return {}

    with open(gt_file, 'r', encoding='utf-8') as f:
        data = json.load(f)

    # Берём только текущее видео
    return data.get(video_file, [])

def load_detector(detector_name):
    """Загружает ТОЛЬКО один детектор (и выгружает старый)"""
    detector_func = None

    if detector_name == 'fight':
        from detectors.fight_detector import detect as func
        detector_func = func
    elif detector_name == 'fall':
        from detectors.fall_detector import detect as func
        detector_func = func
    elif detector_name == 'fire':
        from detectors.fire_detector import detect as func
        detector_func = func
    elif detector_name == 'crowd':
        from detectors.crowd_detector import detect as func
        detector_func = func
    elif detector_name == 'scream':
        from detectors.scream_detector import detect as func
        detector_func = func

    return detector_func

def clear_memory():
    """ОЧИСТКА ПАМЯТИ - важно для слабых ПК"""
    gc.collect()
    try:
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except:
        pass
    print("  [Память очищена]")

def evaluate_video(video_path, detector_name, detector_func):
    """Оценивает ОДНО видео одним детектором"""

    gt_events = load_ground_truth(video_path.name)
    gt_for_type = [e for e in gt_events if e.get("type") == detector_name]

    # Запускаем детектор
    predictions = []
    print(f"  Запуск детектора...")

    try:
        for event in detector_func(str(video_path), str(MODEL_DIR)):
            # Берём только события с уверенностью > 50%
            if event.get("confidence", 0) >= 50:
                predictions.append(event)
        print(f"  Найдено предсказаний: {len(predictions)}")
        print(f"  В разметке событий: {len(gt_for_type)}")
    except Exception as e:
        print(f"  [ОШИБКА] {e}")
        return None

    # Определяем результат
    has_prediction = len(predictions) > 0
    has_truth = len(gt_for_type) > 0

    if has_prediction and has_truth:
        result = "TP"
        print(f"  ✅ TP: угроза найдена правильно")
    elif has_prediction and not has_truth:
        result = "FP"
        print(f"  ❌ FP: ложная тревога")
    elif not has_prediction and has_truth:
        result = "FN"
        print(f"  ❌ FN: угроза пропущена")
    else:
        result = "TN"
        print(f"  ➖ TN: угроз нет, предсказаний нет")

    # Очищаем память после детектора
    clear_memory()

    return {
        "video": video_path.name,
        "detector": detector_name,
        "has_prediction": has_prediction,
        "has_truth": has_truth,
        "result": result,
        "predictions_count": len(predictions),
        "truth_count": len(gt_for_type)
    }

def get_all_videos():
    """Возвращает список видео из папки test_videos"""
    if not TEST_VIDEOS_DIR.exists():
        print(f"[ОШИБКА] Папка {TEST_VIDEOS_DIR} не найдена")
        return []

    videos = list(TEST_VIDEOS_DIR.glob("*.mp4"))
    # Сортируем по имени
    videos.sort(key=lambda x: x.name)
    return videos

def show_instructions():
    print("="*60)
    print("ЛЁГКАЯ ОЦЕНКА ДЕТЕКТОРОВ")
    print("="*60)
    print(f"\nТЕКУЩИЙ ДЕТЕКТОР: {DETECTOR_NAMES.get(CURRENT_DETECTOR, CURRENT_DETECTOR)}")
    print("\nЧтобы оценить другой детектор, измените CURRENT_DETECTOR в начале файла:")
    print("  options: 'fight', 'fall', 'fire', 'crowd', 'scream'")
    print("\nЗапуск: python evaluate_light.py")

def main():
    show_instructions()

    # Проверяем папку с видео
    videos = get_all_videos()
    if not videos:
        print(f"\n[ОШИБКА] В папке {TEST_VIDEOS_DIR} нет видеофайлов .mp4")
        return

    print(f"\nНайдено видео: {len(videos)}")
    print("="*60)

    # Загружаем детектор (один раз)
    print(f"\nЗагрузка детектора '{CURRENT_DETECTOR}'...")
    detector_func = load_detector(CURRENT_DETECTOR)
    if detector_func is None:
        print(f"[ОШИБКА] Детектор '{CURRENT_DETECTOR}' не найден")
        return
    print("[OK] Детектор загружен")

    # Результаты
    results = []

    # Обрабатываем каждое видео ПО ОЧЕРЕДИ
    for i, video_path in enumerate(videos):
        print(f"\n[{i+1}/{len(videos)}] Обработка: {video_path.name}")
        result = evaluate_video(video_path, CURRENT_DETECTOR, detector_func)
        if result:
            results.append(result)

    # Сохраняем результаты
    output = {
        "detector": CURRENT_DETECTOR,
        "detector_name_ru": DETECTOR_NAMES.get(CURRENT_DETECTOR, CURRENT_DETECTOR),
        "timestamp": str(datetime.now()),
        "results": results
    }

    # Считаем метрики
    TP = len([r for r in results if r["result"] == "TP"])
    FP = len([r for r in results if r["result"] == "FP"])
    FN = len([r for r in results if r["result"] == "FN"])

    precision = TP / (TP + FP) * 100 if (TP + FP) > 0 else 0
    recall = TP / (TP + FN) * 100 if (TP + FN) > 0 else 0
    f1 = 2 * (precision * recall) / (precision + recall) if (precision + recall) > 0 else 0

    output["summary"] = {
        "TP": TP,
        "FP": FP,
        "FN": FN,
        "precision": round(precision, 1),
        "recall": round(recall, 1),
        "f1": round(f1, 1)
    }

    # Сохраняем JSON
    with open(RESULTS_FILE, 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    # Выводим итоги
    print("\n" + "="*60)
    print("ИТОГИ ОЦЕНКИ")
    print("="*60)
    print(f"Детектор: {DETECTOR_NAMES.get(CURRENT_DETECTOR, CURRENT_DETECTOR)}")
    print(f"Видео обработано: {len(results)}")
    print(f"\nTP (правильно найдено): {TP}")
    print(f"FP (ложных тревог): {FP}")
    print(f"FN (пропущено угроз): {FN}")
    print(f"\nPrecision (точность): {precision:.1f}%")
    print(f"Recall (полнота): {recall:.1f}%")
    print(f"F1-Score: {f1:.1f}%")
    print("\n" + "="*60)
    print(f"Результаты сохранены в: {RESULTS_FILE}")

if __name__ == "__main__":
    main()