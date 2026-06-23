from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from flask import Flask, render_template, request, redirect, url_for, flash
import os
from video_recognition import recognize_faces_in_video

# ========== СОЗДАЕМ ПРИЛОЖЕНИЕ FLASK ==========
app = Flask(__name__)
app.secret_key = 'school-security-key'

# Создаем папки если их нет
os.makedirs('uploads', exist_ok=True)
os.makedirs('detected_faces', exist_ok=True)
os.makedirs('data/students', exist_ok=True)

_BASE = Path(__file__).resolve().parent
_LOCALE: dict[str, Any] = json.loads((_BASE / "locale_ru.json").read_text(encoding="utf-8"))


def get_locale(key: str) -> str:
    return str(_LOCALE.get(key, key))


def nav_sections() -> list[dict[str, Any]]:
    L = _LOCALE

    return [
        {
            "id": "admin",
            "title": "Администрирование",
            "links": [
                {"endpoint": "camera_capture", "label": "📸 Фото с камеры"},
            ],
        },
        {
            "id": "main",
            "title": L.get("nav_main", "ГЛАВНОЕ"),
            "links": [
                {"endpoint": "index", "label": L.get("nav_panel", "Панель управления")},
            ],
        },
        {
            "id": "biometric",
            "title": L.get("nav_biometric", "ЛИЦА И УЧЁТ"),
            "links": [
                {"endpoint": "students", "label": L.get("nav_students", "Ученики и фото")},
                {"endpoint": "train", "label": "🧠 Обучение модели"},
                {"endpoint": "recognize", "label": L.get("nav_recognize", "Распознавание")},
                {"endpoint": "attendance", "label": L.get("nav_attendance", "Посещаемость")},
            ],
        },
    ]


# ========== ГЛАВНАЯ СТРАНИЦА ==========
@app.route('/')
def index():
    return render_template('index.html')


# ========== ЗАГРУЗКА ВИДЕО И РАСПОЗНАВАНИЕ ==========
@app.route('/upload_video', methods=['GET', 'POST'])
def upload_video():
    if request.method == 'POST':
        # Проверяем, есть ли файл
        if 'video' not in request.files:
            flash('Файл не выбран', 'error')
            return redirect(request.url)

        video = request.files['video']

        if video.filename == '':
            flash('Файл не выбран', 'error')
            return redirect(request.url)

        # Сохраняем видео
        video_path = os.path.join('uploads', video.filename)
        video.save(video_path)

        # Запускаем распознавание лиц в видео
        results = recognize_faces_in_video(video_path)

        return render_template('video_results.html', results=results)

    return render_template('upload_video.html')


# ========== ЗАПУСК СЕРВЕРА ==========
if __name__ == "__main__":
    print("=== НАВИГАЦИЯ ===")
    for section in nav_sections():
        print(f"\n📁 {section['title']}")
        for link in section["links"]:
            print(f"   → {link['label']}")

    print("\n🚀 Запуск сервера...")
    app.run(debug=True, host='0.0.0.0', port=5000)