# 📹 Видеопотоки - Инструкции

## 📂 Структура папок

```
school/
└── static/
    └── videos/
        ├── fight_test.mp4          # Основное тестовое видео (по умолчанию)
        ├── normal_scene.mp4        # Обычная сцена
        └── другое_видео.mp4        # Дополнительные видео
```

## 🎬 Как добавить видео

### 1. Поместить видеофайл в папку

Скопируйте ваши MP4 видеофайлы в папку `static/videos/`

**Рекомендуемые параметры видео:**
- Кодек: H.264 (AVC)
- Разрешение: 640x480, 1280x720 или 1920x1080
- FPS: 30 или 25
- Битрейт: 2-5 Mbps

### 2. Создать видео используя FFmpeg

Если необходимо конвертировать видео:

```bash
# Конвертировать в MP4 с хорошим сжатием
ffmpeg -i input.avi -c:v libx264 -preset medium -b:v 3M -c:a aac output.mp4

# Изменить разрешение
ffmpeg -i input.mp4 -s 640x480 output.mp4

# Создать видео из изображений (для тестирования)
ffmpeg -framerate 30 -i frame_%04d.jpg -c:v libx264 -pix_fmt yuv420p output.mp4
```

## 🔗 Использование видеопотоков

### В HTML (прямое отображение)

```html
<!-- Основное видео (fight_test.mp4) -->
<img src="{{ url_for('video_feed') }}" alt="Video Stream" style="width: 100%; max-width: 960px;">

<!-- Настраиваемое видео -->
<img src="{{ url_for('video_feed_custom', path='videos/other_video.mp4') }}" alt="Custom Video Stream">
```

### В JavaScript

```javascript
// Обновить источник видео
const videoImg = document.querySelector('img[src*="video_feed"]');
videoImg.src = '/video_feed_custom?path=videos/my_video.mp4';
```

## 🔄 Особенности реализации

### Автоматический перезапуск видео

Когда видео закончилось:
1. Функция `generate_frames()` обнаруживает конец видео (`success = False`)
2. Использует `camera.set(cv2.CAP_PROP_POS_FRAMES, 0)` для перемотки на начало
3. Увеличивает счетчик циклов (`loop_count`)
4. Продолжает выдавать кадры с начала видео

```python
if not success:
    # Видео закончилось
    camera.set(cv2.CAP_PROP_POS_FRAMES, 0)  # Перемотка на начало
    loop_count += 1  # Увеличить счетчик циклов
    success, frame = camera.read()  # Прочитать первый кадр
```

### Обработка ошибок

Если видеофайл не найден:
- Отображается черный экран с текстом "VIDEO NOT FOUND"
- Логируется ошибка
- Система продолжает работать

```python
if not os.path.exists(full_path):
    logger.error(f"❌ Видеофайл не найден: {full_path}")
    # Генерировать черный экран с сообщением об ошибке
    yield (b'--frame\r\n'
           b'Content-Type: image/jpeg\r\n'
           ... # черный кадр с текстом
```

## 📊 Информация на кадре

На каждом кадре отображается:
- `Frame: X` - номер текущего кадра
- `Loop: Y` - количество полных циклов видео
- `FPS: Z` - кадры в секунду

Пример:
```
Frame: 1250 | Loop: 3 | FPS: 30.0
```

## 🛠️ API маршруты

### GET `/video_feed`
Получить видеопоток основного видео (fight_test.mp4)

```
Content-Type: multipart/x-mixed-replace; boundary=frame
```

**Пример использования в HTML:**
```html
<img src="/video_feed" alt="Video Stream">
```

### GET `/video_feed_custom?path=видео/файл.mp4`
Получить видеопоток с пользовательским путем

**Параметры:**
- `path` - путь к видео относительно папки `static/`
- Требует аутентификации (login_required)

**Пример:**
```
/video_feed_custom?path=videos/fight.mp4
/video_feed_custom?path=videos/danger.avi
```

**Проверки безопасности:**
- Путь не должен содержать `..`
- Путь не должен начинаться с `/`
- Файл должен существовать

## 📝 Логирование видеопотока

В консоли сервера можно видеть информацию о видео:

```
✅ Видео открыто: 1280x720 @ 30.0 FPS, 300 кадров
📊 Обработано 100 кадров (цикл #0)
📊 Обработано 200 кадров (цикл #0)
🔄 Видео перезапущено (цикл #1)
📊 Обработано 100 кадров (цикл #1)
```

## 🎯 Создание тестовых видео

### Вариант 1: Скачать готовые видео

Используйте сайты для поиска видео:
- [Pexels](https://www.pexels.com/videos/)
- [Pixabay](https://pixabay.com/videos/)
- [Unsplash](https://unsplash.com/videos/)

### Вариант 2: Записать веб-камеру

```bash
# Linux/Mac
ffmpeg -f avfoundation -i 0 -t 60 fight_test.mp4

# Windows (если установлен ffmpeg)
ffmpeg -f dshow -i video="Ваша Камера" -t 60 fight_test.mp4
```

### Вариант 3: Синтезировать видео

```python
import cv2
import numpy as np

# Создать видео 30 кадров
fourcc = cv2.VideoWriter_fourcc(*'mp4v')
out = cv2.VideoWriter('fight_test.mp4', fourcc, 30.0, (640, 480))

for i in range(300):  # 10 сек при 30 FPS
    frame = np.zeros((480, 640, 3), dtype=np.uint8)
    
    # Добавить что-то интересное
    cv2.circle(frame, (320 + i % 100, 240), 50, (0, 255, 0), -1)
    cv2.putText(frame, f"Frame {i}", (50, 50), cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 0), 2)
    
    out.write(frame)

out.release()
print("✅ Видео создано: fight_test.mp4")
```

## 🔧 Настройка видео

### Изменить по умолчанию видео

В `app.py` функция `generate_frames()`:

```python
@app.route('/video_feed')
def video_feed():
    # Изменить путь здесь
    return Response(
        generate_frames('static/videos/ваше_видео.mp4'),  # ← измените путь
        mimetype='multipart/x-mixed-replace; boundary=frame'
    )
```

### Оптимизировать производительность

```python
# Изменить размер кадра
frame = cv2.resize(frame, (640, 480))  # раскомментировать в generate_frames()

# Пропускать кадры
if frame_count % 2 == 0:  # показать каждый второй кадр
    continue
```

## 📊 Мониторинг

### Проверить видеопоток

```bash
# Linux
curl http://localhost:5000/video_feed > /dev/null

# Или открыть в браузере
http://localhost:5000/video_feed
```

### Логирование в файл

```python
# Добавить в app.py
logging.basicConfig(
    filename='security_system.log',
    level=logging.INFO
)
```

## 🚨 Проблеши и решения

### "VIDEO NOT FOUND"

**Проблема:** На странице видит черный экран с текстом "VIDEO NOT FOUND"

**Решение:**
1. Проверить что файл `static/videos/fight_test.mp4` существует
2. Проверить правильность пути
3. Убедиться что папка `static/videos` создана

### Видео не воспроизводится

**Проблема:** Видео открывается но не показывает кадры

**Решение:**
1. Убедиться что видеофайл не поврежден
2. Проверить формат видео (должно быть MP4 с H.264)
3. Перекодировать видео:
   ```bash
   ffmpeg -i input.mp4 -c:v libx264 -preset fast output.mp4
   ```

### Высокое потребление CPU

**Проблема:** Сервер использует много ресурсов при воспроизведении

**Решение:**
1. Уменьшить разрешение видео
2. Пропускать кадры (показать каждый 2-й или 3-й)
3. Использовать более эффективный кодек

## 📚 Дополнительно

- [OpenCV VideoCapture документация](https://docs.opencv.org/master/d8/dfe/classcv_1_1VideoCapture.html)
- [MJPEG формат](https://en.wikipedia.org/wiki/Motion_JPEG)
- [FFmpeg документация](https://ffmpeg.org/documentation.html)

---

**Все готово для работы с видеопотоками!** 🎬
