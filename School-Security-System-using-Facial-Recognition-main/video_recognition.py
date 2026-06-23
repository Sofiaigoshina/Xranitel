# video_recognition.py (с группировкой по времени + метрики + видео с рамками)
import cv2
import os
import sqlite3
import subprocess
from datetime import datetime
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import numpy as np

# Конфигурация
CONFIDENCE_THRESHOLD = 45
FRAME_SKIP = 15
FACE_DETECTION_SCALE = 1.3
TIME_GAP_SECONDS = 3

# Цвета для разных ролей
ROLE_COLORS = {
    'ученик': (0, 255, 0),  # Зелёный
    'учитель': (0, 200, 255),  # Оранжевый
    'завуч': (255, 100, 0),  # Синий
    'директор': (255, 0, 255),  # Фиолетовый
    'охранник': (0, 100, 255),  # Жёлтый
    'техперсонал': (100, 100, 100),  # Серый
}
DEFAULT_COLOR = (0, 255, 0)


def get_font():
    """Загружает шрифт с поддержкой кириллицы"""
    # Пробуем разные варианты
    font_paths = [
        "Roboto.ttf",
        "arial.ttf",
        "C:/Windows/Fonts/arial.ttf",
        "C:/Windows/Fonts/times.ttf",
        "C:/Diplom/School-Security-System-using-Facial-Recognition-main/Roboto.ttf"
    ]

    for font_path in font_paths:
        try:
            font = ImageFont.truetype(font_path, 14)
            return font
        except:
            continue

    # Если ничего не подошло, используем дефолтный
    return ImageFont.load_default()


def draw_russian_text(img, text, position, color=(255, 255, 255)):
    """Рисует русский текст на изображении через PIL"""
    # Конвертируем OpenCV BGR в RGB для PIL
    img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    pil_img = Image.fromarray(img_rgb)
    draw = ImageDraw.Draw(pil_img)

    # Загружаем шрифт
    font = get_font()

    # Рисуем текст
    draw.text(position, text, font=font, fill=color)

    # Конвертируем обратно в BGR для OpenCV
    return cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)


def get_student_info(student_id):
    """Получает информацию о студенте из БД (с ролью)"""
    try:
        conn = sqlite3.connect('face_recognizer.db')
        cursor = conn.cursor()
        cursor.execute("SELECT Name, Dep, Student_id, role FROM student WHERE Student_id = ?", (student_id,))
        result = cursor.fetchone()
        conn.close()
        if result:
            role = result[3] if result[3] else 'ученик'
            if role == 'ученик':
                role_text = f"ученик {result[1]} класса" if result[1] else "ученик"
            else:
                role_text = role
            return {
                "id": student_id,
                "name": result[0],
                "department": result[1],
                "role": role_text,
                "role_short": role
            }
        return None
    except Exception as e:
        print(f"Ошибка БД: {e}")
        return None


def calculate_metrics(results):
    """Расчёт метрик точности распознавания"""
    total = len(results)
    if total == 0:
        return {
            'total_faces': 0,
            'recognized': 0,
            'unknown': 0,
            'accuracy': 0,
            'avg_confidence': 0,
            'precision': 0,
            'recall': 0,
            'f1_score': 0,
            'eer': 50,
            'high_confidence': 0,
            'medium_confidence': 0,
            'low_confidence': 0
        }

    recognized = [r for r in results if r['name'] != "Неизвестный"]
    unknown = [r for r in results if r['name'] == "Неизвестный"]

    confidences = [r['confidence'] for r in results]
    avg_confidence = sum(confidences) / len(confidences) if confidences else 0

    high_conf = sum(1 for c in confidences if c >= 75)
    medium_conf = sum(1 for c in confidences if 55 <= c < 75)
    low_conf = sum(1 for c in confidences if c < 55)

    accuracy = len(recognized) / total * 100 if total > 0 else 0

    tp = len(recognized)
    fp = len([r for r in results if r['name'] == "Неизвестный" and r['confidence'] > 55]) if results else 0
    fn = len([r for r in results if r['name'] != "Неизвестный" and r['confidence'] < 55]) if results else 0

    precision = (tp / (tp + fp) * 100) if (tp + fp) > 0 else 0
    recall = (tp / (tp + fn) * 100) if (tp + fn) > 0 else 0
    f1_score = (2 * precision * recall / (precision + recall)) if (precision + recall) > 0 else 0

    persons = {}
    for r in recognized:
        name = r['name']
        if name not in persons:
            persons[name] = {'count': 0, 'confidences': []}
        persons[name]['count'] += 1
        persons[name]['confidences'].append(r['confidence'])

    return {
        'total_faces': total,
        'recognized': len(recognized),
        'unknown': len(unknown),
        'accuracy': round(accuracy, 2),
        'avg_confidence': round(avg_confidence, 2),
        'precision': round(precision, 2),
        'recall': round(recall, 2),
        'f1_score': round(f1_score, 2),
        'eer': 50,
        'high_confidence': high_conf,
        'medium_confidence': medium_conf,
        'low_confidence': low_conf,
        'persons': persons
    }


def recognize_faces_in_video(video_path):
    """
    Распознаёт лица в загруженном видео.
    Возвращает список УНИКАЛЬНЫХ появлений с интервалами времени.
    Создаёт видео с рамками и подписями.
    """

    model_path = "classifier.xml"
    if not os.path.exists(model_path):
        print("❌ Модель не найдена")
        return {'sessions': [], 'video_output': None, 'metrics': {}}

    recognizer = cv2.face.LBPHFaceRecognizer_create()
    recognizer.read(model_path)

    cascade_path = "haarcascade_frontalface_default.xml"
    if not os.path.exists(cascade_path):
        print("❌ Каскад Хаара не найден")
        return {'sessions': [], 'video_output': None, 'metrics': {}}

    face_cascade = cv2.CascadeClassifier(cascade_path)

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        return {'sessions': [], 'video_output': None, 'metrics': {}}

    fps = cap.get(cv2.CAP_PROP_FPS)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    # Создаём папку для видео
    output_dir = Path("static/detected_videos")
    output_dir.mkdir(parents=True, exist_ok=True)
    video_name = Path(video_path).stem

    # Временный AVI файл (через OpenCV)
    temp_avi_path = output_dir / f"{video_name}_temp.avi"
    fourcc = cv2.VideoWriter_fourcc(*'XVID')
    temp_writer = cv2.VideoWriter(str(temp_avi_path), fourcc, fps, (width, height))

    # Итоговый MP4 файл (через ffmpeg)
    output_mp4_path = output_dir / f"{video_name}_detected.mp4"

    # Хранилище активных появлений
    active_sessions = {}
    completed_sessions = []
    frame_number = 0
    last_seen = {}
    results = []

    print(f"Обработка видео...")
    print(f"   Временный файл: {temp_avi_path}")
    print(f"   Выходной файл: {output_mp4_path}")

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        frame_number += 1
        current_time = frame_number / fps
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

        faces = face_cascade.detectMultiScale(gray, scaleFactor=FACE_DETECTION_SCALE, minNeighbors=5, minSize=(50, 50))

        for (x, y, w, h) in faces:
            face_roi = gray[y:y + h, x:x + w]
            face_roi_resized = cv2.resize(face_roi, (200, 200))

            try:
                predicted_id, confidence_raw = recognizer.predict(face_roi_resized)
                confidence = max(0, min(100, int(100 * (1 - confidence_raw / 300))))

                student_info = get_student_info(predicted_id)

                if student_info and confidence >= CONFIDENCE_THRESHOLD:
                    name = student_info["name"]
                    role_short = student_info["role_short"]
                    color = ROLE_COLORS.get(role_short, DEFAULT_COLOR)
                    label = f"{name} [{confidence}%]"

                    if name not in active_sessions:
                        active_sessions[name] = {
                            'start_time': current_time,
                            'start_frame': frame_number,
                            'confidence': confidence,
                            'last_frame': frame_number,
                            'student_id': student_info["id"],
                            'department': student_info["department"],
                            'role': student_info["role"]
                        }
                    else:
                        active_sessions[name]['last_frame'] = frame_number
                        active_sessions[name]['confidence'] = max(active_sessions[name]['confidence'], confidence)

                    last_seen[name] = current_time
                    results.append(
                        {'name': name, 'confidence': confidence, 'frame': frame_number, 'time': current_time})

                else:
                    color = (0, 0, 255)
                    label = f"Неизвестный [{confidence}%]"

                    if "Unknown" not in active_sessions:
                        active_sessions["Unknown"] = {
                            'start_time': current_time,
                            'start_frame': frame_number,
                            'confidence': confidence,
                            'last_frame': frame_number,
                            'student_id': None,
                            'department': None,
                            'role': "Неизвестный"
                        }
                    else:
                        active_sessions["Unknown"]['last_frame'] = frame_number

                    last_seen["Unknown"] = current_time
                    results.append(
                        {'name': "Неизвестный", 'confidence': confidence, 'frame': frame_number, 'time': current_time})

                # Рисуем рамку
                cv2.rectangle(frame, (x, y), (x + w, y + h), color, 2)

                # Рисуем фон для текста (белый фон под надпись)
                text_width = len(label) * 9  # приблизительная ширина текста в пикселях
                cv2.rectangle(frame, (x, y - 22), (x + text_width + 8, y), color, -1)

                # Рисуем русский текст через PIL
                frame = draw_russian_text(frame, label, (x + 4, y - 18), color=(255, 255, 255))

            except Exception as e:
                continue

        # Проверяем, кто пропал из кадра
        to_remove = []
        for name, session in active_sessions.items():
            last_time = last_seen.get(name, 0)
            if current_time - last_time > TIME_GAP_SECONDS:
                end_time = session['last_frame'] / fps
                completed_sessions.append({
                    'name': name,
                    'student_id': session.get('student_id'),
                    'department': session.get('department'),
                    'role': session.get('role', 'Неизвестный'),
                    'start_time': session['start_time'],
                    'end_time': end_time,
                    'start_time_str': f"{int(session['start_time'] // 60)}:{int(session['start_time'] % 60):02d}",
                    'end_time_str': f"{int(end_time // 60)}:{int(end_time % 60):02d}",
                    'duration': round(end_time - session['start_time'], 1),
                    'max_confidence': session['confidence'],
                    'start_frame': session['start_frame'],
                    'end_frame': session['last_frame']
                })
                to_remove.append(name)

        for name in to_remove:
            del active_sessions[name]

        # Добавляем информацию на кадр
        cv2.putText(frame, f"Time: {int(current_time // 60)}:{int(current_time % 60):02d}",
                    (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 1, cv2.LINE_AA)
        cv2.putText(frame, f"Faces: {len(faces)}",
                    (10, 55), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (200, 200, 200), 1, cv2.LINE_AA)

        temp_writer.write(frame)

        if frame_number % 30 == 0:
            progress = int((frame_number / total_frames) * 100)
            print(f"   Прогресс: {progress}%", end='\r')

    # Закрываем незавершённые сессии
    for name, session in active_sessions.items():
        end_time = frame_number / fps
        completed_sessions.append({
            'name': name,
            'student_id': session.get('student_id'),
            'department': session.get('department'),
            'role': session.get('role', 'Неизвестный'),
            'start_time': session['start_time'],
            'end_time': end_time,
            'start_time_str': f"{int(session['start_time'] // 60)}:{int(session['start_time'] % 60):02d}",
            'end_time_str': f"{int(end_time // 60)}:{int(end_time % 60):02d}",
            'duration': round(end_time - session['start_time'], 1),
            'max_confidence': session['confidence'],
            'start_frame': session['start_frame'],
            'end_frame': frame_number
        })

    cap.release()
    temp_writer.release()

    # Конвертируем AVI в MP4 через ffmpeg
    try:
        cmd = f'ffmpeg -y -i "{temp_avi_path}" -c:v libx264 -preset fast -crf 23 "{output_mp4_path}"'
        subprocess.run(cmd, shell=True, check=True)
        print(f"Конвертация в MP4 завершена")
        # Удаляем временный AVI
        if temp_avi_path.exists():
            temp_avi_path.unlink()
    except Exception as e:
        print(f"Ошибка конвертации: {e}")
        print(f"Использую AVI файл (может не проигрываться в браузере)")
        output_mp4_path = temp_avi_path

    completed_sessions.sort(key=lambda x: x['start_time'])
    metrics = calculate_metrics(results)

    print(f"\n Обработка завершена!")
    print(f"   Выходное видео: {output_mp4_path}")
    print(f"   Уникальных появлений: {len(completed_sessions)}")
    print(f"   Точность: {metrics['accuracy']}%")

    return {
        'sessions': completed_sessions,
        'video_output': str(output_mp4_path),
        'total_sessions': len(completed_sessions),
        'metrics': metrics,
        'results': results
    }