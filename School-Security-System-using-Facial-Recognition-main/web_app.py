from __future__ import annotations
import os
import csv
import json
import sqlite3
import glob
from datetime import datetime
from pathlib import Path
from functools import wraps

import cv2
import numpy as np
from flask import Flask, flash, redirect, render_template, request, url_for, session
from PIL import Image

from blueprints.auth import bp as auth_bp
from site_navigation import nav_sections
from template_loader import FlexibleEncodingFileSystemLoader
from video_recognition import recognize_faces_in_video

BASE_DIR = Path(__file__).resolve().parent
LOCALE: dict = json.loads((BASE_DIR / "locale_ru.json").read_text(encoding="utf-8"))

DB_PATH = BASE_DIR / "face_recognizer.db"
DATA_DIR = BASE_DIR / "data"
UPLOAD_DIR = BASE_DIR / "uploads"
CLASSIFIER_PATH = BASE_DIR / "classifier.xml"
CASCADE_PATH = BASE_DIR / "haarcascade_frontalface_default.xml"
ATTENDANCE_PATH = BASE_DIR / "attendance.csv"

app = Flask(__name__)
app.secret_key = "school-security-russian-ui"
app.register_blueprint(auth_bp)
app.jinja_env.loader = FlexibleEncodingFileSystemLoader(str(BASE_DIR / "templates"))


def L(key: str, **kwargs) -> str:
    s = str(LOCALE[key])
    return s.format(**kwargs) if kwargs else s


def role_required(allowed_roles):
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            return f(*args, **kwargs)

        return decorated_function

    return decorator


@app.context_processor
def inject_nav():
    return {
        "nav_sections": nav_sections(),
        "tr": lambda key, **kwargs: L(key, **kwargs),
    }


def init_storage() -> None:
    DATA_DIR.mkdir(exist_ok=True)
    UPLOAD_DIR.mkdir(exist_ok=True)

    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS student (
                Dep TEXT,
                course TEXT,
                Year TEXT,
                Semester TEXT,
                Student_id TEXT PRIMARY KEY,
                Name TEXT,
                Division TEXT,
                Roll TEXT,
                Gender TEXT,
                Dob TEXT,
                Email TEXT,
                Phone TEXT,
                Address TEXT,
                Teacher TEXT,
                PhotoSample TEXT
            )
            """
        )

        # Добавляем колонку role, если её нет
        try:
            conn.execute("ALTER TABLE student ADD COLUMN role TEXT DEFAULT 'ученик'")
            print("✅ Добавлена колонка 'role' в таблицу student")
        except sqlite3.OperationalError as e:
            if "duplicate column name" in str(e):
                print("⚠️ Колонка 'role' уже существует")
            else:
                print(f"⚠️ Ошибка при добавлении колонки: {e}")

        conn.commit()

    if not ATTENDANCE_PATH.exists():
        with open(ATTENDANCE_PATH, "w", newline="", encoding="utf-8") as file:
            writer = csv.writer(file)
            writer.writerow(["ID", "Roll", "Name", "Department", "Time", "Date", "Status"])

def get_students() -> list[sqlite3.Row]:
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute("SELECT *, role FROM student ORDER BY Student_id").fetchall()
    return rows


def get_student(student_id: str) -> sqlite3.Row | None:
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute("SELECT *, role FROM student WHERE Student_id = ?", (student_id,)).fetchone()
    return row


def next_photo_index(student_id: str) -> int:
    max_num = 0
    for item in DATA_DIR.glob(f"user.{student_id}.*.jpg"):
        parts = item.name.split(".")
        if len(parts) >= 4 and parts[2].isdigit():
            max_num = max(max_num, int(parts[2]))
    return max_num + 1


def detect_face_gray(image_bgr: np.ndarray) -> np.ndarray | None:
    if not CASCADE_PATH.exists():
        return None
    cascade = cv2.CascadeClassifier(str(CASCADE_PATH))
    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
    faces = cascade.detectMultiScale(gray, 1.2, 5)
    if len(faces) == 0:
        return None
    x, y, w, h = faces[0]
    face = gray[y: y + h, x: x + w]
    return cv2.resize(face, (200, 200))


def save_photo_for_student(student_id: str, file_storage) -> bool:
    """Сохраняет фото студента в папку data/"""
    try:
        if not file_storage.filename.lower().endswith(('.jpg', '.jpeg', '.png', '.bmp')):
            print(f"❌ Неверный формат: {file_storage.filename}")
            return False

        file_bytes = file_storage.read()
        np_arr = np.frombuffer(file_bytes, np.uint8)
        img = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)

        if img is None:
            print(f"❌ Не удалось прочитать: {file_storage.filename}")
            return False

        face_gray = detect_face_gray(img)

        if face_gray is None:
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            face_gray = cv2.resize(gray, (200, 200))
            print("⚠️ Лицо не найдено, сохранено всё изображение")

        existing = glob.glob(f"data/user.{student_id}.*.jpg")
        max_num = 0
        for f in existing:
            try:
                num = int(f.split('.')[-2])
                max_num = max(max_num, num)
            except Exception:
                pass
        next_num = max_num + 1

        filename = f"data/user.{student_id}.{next_num}.jpg"
        cv2.imwrite(filename, face_gray)

        print(f"✅ Сохранено: {filename}")
        return True

    except Exception as e:
        print(f"❌ Ошибка: {e}")
        return False


def train_classifier() -> tuple[bool, str]:
    print("🔄 НАЧАЛО ОБУЧЕНИЯ...")

    images = sorted(DATA_DIR.glob("*.jpg"))
    faces: list[np.ndarray] = []
    ids: list[int] = []

    print(f"📸 Найдено фото: {len(images)}")

    for image_path in images:
        parts = image_path.name.split(".")
        if len(parts) < 4 or not parts[1].isdigit():
            continue
        student_id = int(parts[1])
        img = Image.open(image_path).convert("L").resize((200, 200))
        faces.append(np.array(img, "uint8"))
        ids.append(student_id)

    if not faces:
        print("❌ Нет фото для обучения!")
        return False, L("train_no_images")

    print(f"✅ Обучение на {len(faces)} фото...")

    recognizer = cv2.face.LBPHFaceRecognizer_create()
    recognizer.train(faces, np.array(ids))

    # ИСПРАВЛЕНИЕ: сохраняем через временный файл с английским именем
    temp_path = os.path.join(os.path.dirname(__file__), 'temp_model.xml')
    recognizer.write(temp_path)

    # Перемещаем в нужное место (перезаписываем если есть)
    if os.path.exists(str(CLASSIFIER_PATH)):
        os.remove(str(CLASSIFIER_PATH))
    os.rename(temp_path, str(CLASSIFIER_PATH))

    print("✅ МОДЕЛЬ ОБУЧЕНА И СОХРАНЕНА!")

    return True, L("train_done", n=len(faces))

def mark_attendance(student: sqlite3.Row) -> None:
    now = datetime.now()
    today = now.strftime("%d/%m/%Y")
    rows: list[list[str]] = []

    if ATTENDANCE_PATH.exists():
        with open(ATTENDANCE_PATH, "r", encoding="utf-8", newline="") as file:
            rows = list(csv.reader(file))

    for row in rows[1:]:
        if len(row) >= 6 and row[0] == str(student["Student_id"]) and row[5] == today:
            return

    with open(ATTENDANCE_PATH, "a", encoding="utf-8", newline="") as file:
        writer = csv.writer(file)
        writer.writerow(
            [
                student["Student_id"],
                student["Roll"],
                student["Name"],
                student["Dep"],
                now.strftime("%H:%M:%S"),
                today,
                L("attendance_present"),
            ]
        )


def recognize_uploaded(file_storage) -> tuple[bool, str, sqlite3.Row | None]:
    if not CLASSIFIER_PATH.exists():
        return False, L("err_model_not_trained"), None
    if not CASCADE_PATH.exists():
        return False, L("err_no_haar"), None

    upload_path = UPLOAD_DIR / file_storage.filename
    file_storage.save(upload_path)
    image = cv2.imread(str(upload_path))
    upload_path.unlink(missing_ok=True)

    if image is None:
        return False, L("err_bad_image"), None

    cascade = cv2.CascadeClassifier(str(CASCADE_PATH))
    recognizer = cv2.face.LBPHFaceRecognizer_create()
    recognizer.read(str(CLASSIFIER_PATH))

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    faces = cascade.detectMultiScale(gray, 1.2, 5)
    if len(faces) == 0:
        return False, L("err_no_face"), None

    x, y, w, h = faces[0]
    face = cv2.resize(gray[y: y + h, x: x + w], (200, 200))
    predicted_id, distance = recognizer.predict(face)
    confidence = max(0, min(100, int(100 * (1 - distance / 300))))

    student = get_student(str(predicted_id))
    if student is None or confidence < 55:
        return False, L("err_unknown_face", p=confidence), None

    mark_attendance(student)
    return True, L("ok_face", p=confidence), student


# ==================== МАРШРУТЫ ====================


@app.route("/")
def index():
    return render_template("dashboard.html", title=L("title_dashboard"))


@app.route("/admin/camera")
@role_required(['director', 'security'])
def camera_capture():
    students = get_students()
    return render_template("camera_capture.html", students=students, title="Фото с камеры")


@app.route("/students/<student_id>/capture", methods=["POST"])
def capture_photo(student_id):
    if 'photo' not in request.files:
        return {"error": "no file"}, 400

    file = request.files['photo']
    if file.filename == '':
        return {"error": "empty"}, 400

    existing = glob.glob(f"data/user.{student_id}.*.jpg")
    max_num = 0
    for f in existing:
        try:
            num = int(f.split('.')[-2])
            max_num = max(max_num, num)
        except Exception:
            pass
    next_num = max_num + 1

    file.save(f"data/user.{student_id}.{next_num}.jpg")
    return {"ok": True, "photo_num": next_num}

@app.route("/students", methods=["GET", "POST"])
def students():
    if request.method == "POST":
        form = request.form
        student_id = form.get("student_id", "").strip()
        name = form.get("name", "").strip()
        dep = form.get("dep", "").strip()
        person_type = form.get("person_type", "ученик")  # тип: ученик или сотрудник

        if not student_id or not name or not dep:
            flash(L("flash_required"), "error")
            return redirect(url_for("students"))

        if get_student(student_id):
            flash(L("flash_id_exists"), "error")
            return redirect(url_for("students"))

        with sqlite3.connect(DB_PATH) as conn:
            if person_type == "ученик":
                # Вставляем ученика со всеми полями
                conn.execute(
                    """
                    INSERT INTO student
                    (Dep, course, Year, Semester, Student_id, Name, Division, Roll, Gender, Dob, Email, Phone, Address, Teacher, PhotoSample, role)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        dep,  # класс
                        form.get("course", "").strip(),
                        form.get("year", "").strip(),
                        form.get("semester", "").strip(),
                        student_id,
                        name,
                        form.get("division", "").strip(),
                        form.get("roll", "").strip(),
                        form.get("gender", "").strip(),
                        form.get("dob", "").strip(),
                        form.get("email", "").strip(),
                        form.get("phone", "").strip(),
                        form.get("address", "").strip(),
                        form.get("teacher", "").strip(),
                        L("photo_no"),
                        "ученик"
                    ),
                )
            else:
                # Вставляем сотрудника (только основные поля)
                conn.execute(
                    """
                    INSERT INTO student
                    (Dep, Student_id, Name, Phone, Email, PhotoSample, role)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        dep,  # должность
                        student_id,
                        name,
                        form.get("phone", "").strip(),
                        form.get("email", "").strip(),
                        L("photo_no"),
                        "сотрудник"
                    ),
                )
            conn.commit()

        flash(L("flash_student_added"), "ok")
        return redirect(url_for("students"))

    return render_template("students.html", title=L("title_students"), students=get_students())


@app.route("/students/<student_id>/delete", methods=["POST"])
def delete_student(student_id: str):
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("DELETE FROM student WHERE Student_id = ?", (student_id,))
        conn.commit()
    flash(L("flash_student_deleted"), "ok")
    return redirect(url_for("students"))

@app.route('/recognize_video', methods=['POST'])
def recognize_video():
    import os

    if 'video' not in request.files:
        flash('Файл не выбран', 'error')
        return redirect(url_for('recognize'))

    video = request.files['video']

    if video.filename == '':
        flash('Файл не выбран', 'error')
        return redirect(url_for('recognize'))

    os.makedirs('uploads', exist_ok=True)
    os.makedirs('static/detected_videos', exist_ok=True)

    video_path = os.path.join('uploads', video.filename)
    video.save(video_path)

    try:
        output = recognize_faces_in_video(video_path)

        # Получаем путь к выходному видео
        video_output = output.get('video_output', '')
        # Извлекаем только имя файла для статики
        video_filename = os.path.basename(video_output) if video_output else ''

        # Получаем данные для метрик
        metrics = output.get('metrics', {})
        results = output.get('results', [])
        total_faces = metrics.get('total_faces', 0)
        recognized_faces = metrics.get('recognized', 0)
        unique_people = list(metrics.get('persons', {}).keys())

        return render_template('recognize.html',
                               video_sessions=output.get('sessions', []),
                               video_name=video.filename,
                               video_output=video_filename,
                               total_faces=total_faces,
                               recognized_faces=recognized_faces,
                               unique_people=unique_people,
                               metrics=metrics,
                               results=results)
    except Exception as e:
        flash(f'Ошибка при обработке видео: {str(e)}', 'error')
        return redirect(url_for('recognize'))


@app.route("/students/<student_id>/photos", methods=["POST"])
def upload_photos(student_id: str):
    if get_student(student_id) is None:
        flash(L("flash_not_found"), "error")
        return redirect(url_for("students"))

    files = request.files.getlist("photos")
    if not files or not files[0].filename:
        flash(L("flash_pick_photo"), "error")
        return redirect(url_for("students"))

    saved = 0
    for file_storage in files:
        if file_storage and file_storage.filename:
            if save_photo_for_student(student_id, file_storage):
                saved += 1

    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            "UPDATE student SET PhotoSample = ? WHERE Student_id = ?",
            (L("photo_yes") if saved > 0 else L("photo_no"), student_id),
        )
        conn.commit()

    flash(L("flash_saved_photos", n=saved), "ok" if saved else "error")
    return redirect(url_for("students"))


@app.route("/train", methods=["GET", "POST"])
def train():
    if request.method == "POST":
        ok, message = train_classifier()
        if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
            return {"ok": ok, "message": message}
        flash(message, "ok" if ok else "error")
        return redirect(url_for("train"))
    return render_template("train.html", title=L("title_train"))


@app.route("/recognize", methods=["GET", "POST"])
def recognize():
    result = None
    student = None
    video_results = None
    video_name = None
    video_stats = None

    if request.method == "POST":
        # Проверяем, это загрузка фото или видео
        if 'photo' in request.files and request.files['photo'].filename:
            photo = request.files.get("photo")
            if photo and photo.filename:
                ok, message, student = recognize_uploaded(photo)
                result = {"ok": ok, "message": message}
                if ok:
                    flash(L("flash_rec_ok"), "ok")
                else:
                    flash(L("flash_rec_fail"), "error")

        # Если есть результат от видео, они придут через redirect или render_template
        # Видео обрабатывается отдельным маршрутом /recognize_video

    return render_template("recognize.html",
                           title=L("title_recognize"),
                           result=result,
                           student=student,
                           video_results=video_results,
                           video_name=video_name,
                           video_stats=video_stats)


@app.route("/attendance")
def attendance():
    rows: list[list[str]] = []
    if ATTENDANCE_PATH.exists():
        with open(ATTENDANCE_PATH, "r", encoding="utf-8", newline="") as file:
            rows = list(csv.reader(file))
    headers = rows[0] if rows else []
    items = rows[1:] if len(rows) > 1 else []
    return render_template("attendance.html", title=L("title_attendance"), headers=headers, items=items)

@app.route('/set-theme', methods=['POST'])
def set_theme():
    theme = request.get_data(as_text=True)
    session['theme'] = theme
    return '', 200


@app.route("/students/filter")
def filter_students():
    search_name = request.args.get('name', '')
    search_class = request.args.get('class', '')
    person_type = request.args.get('type', '')  # тип: ученик, сотрудник или all

    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        query = "SELECT *, role FROM student WHERE 1=1"
        params = []

        if search_name:
            query += " AND Name LIKE ?"
            params.append(f"%{search_name}%")

        if search_class:
            query += " AND Dep LIKE ?"
            params.append(f"%{search_class}%")

        # Фильтр по типу (ученик/сотрудник)
        if person_type and person_type != 'all':
            query += " AND role = ?"
            params.append(person_type)

        query += " ORDER BY Student_id"
        rows = conn.execute(query, params).fetchall()

    return {"students": [dict(row) for row in rows]}


@app.route("/attendance/filter")
def attendance_filter():
    date = request.args.get('date', '')

    rows = []
    if ATTENDANCE_PATH.exists():
        with open(ATTENDANCE_PATH, "r", encoding="utf-8", newline="") as file:
            reader = csv.reader(file)
            headers = next(reader, None)
            for row in reader:
                if len(row) >= 7:
                    row_date = row[5]  # формат DD/MM/YYYY
                    # Конвертируем выбранную дату (YYYY-MM-DD) в формат DD/MM/YYYY
                    if date:
                        try:
                            year, month, day = date.split('-')
                            formatted_date = f"{day}/{month}/{year}"
                            if row_date == formatted_date:
                                rows.append({
                                    "id": row[0],
                                    "roll": row[1],
                                    "name": row[2],
                                    "department": row[3],
                                    "time": row[4],
                                    "date": row[5],
                                    "status": row[6] if len(row) > 6 else "Присутствует"
                                })
                        except:
                            pass

    return {"attendance": rows}

@app.route("/cameras")
def cameras():
    cameras_list = [
        {"id": 1, "name": "Вход в школу", "status": "Online", "video_file": "cam1.mp4"},
        {"id": 2, "name": "Коридор 1 этаж", "status": "Online", "video_file": "cam2.mp4"},
        {"id": 3, "name": "Столовая", "status": "Online", "video_file": "cam3.mp4"},
        {"id": 4, "name": "Спортзал", "status": "Online", "video_file": "cam4.mp4"},
    ]
    return render_template("cameras.html", title="Камеры", cameras=cameras_list)


init_storage()

if __name__ == "__main__":
    app.run(debug=True, host='0.0.0.0', port=5001)
