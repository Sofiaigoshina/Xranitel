# CCTV Backend (FastAPI) — CCTV Anomaly Detection + MongoDB

This backend accepts video uploads, runs selected anomaly detectors in parallel,
streams detections via Server-Sent Events, and stores video metadata + detections in MongoDB.

Quick start (Windows):

1. Install Python 3.9+
2. Install ffmpeg and ensure `ffmpeg` is on your PATH
3. Create a virtual environment and install dependencies:

```powershell
cd cctv-backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

4. Create `cctv-backend/.env`:

```env
MONGODB_URI=mongodb://localhost:27017
MONGODB_DB_NAME=cctv
AUTO_DELETE_UPLOADS=false
```

5. Run the server:

```powershell
python -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

6. Test processing (SSE):

```powershell
curl -N -F "file=@C:\path\to\video.mp4" -F "anomaly_types=[\"gunshot_audio\"]" http://127.0.0.1:8000/process-video
```

Useful APIs:
- `GET /health` → includes MongoDB status
- `POST /process-video` → upload + stream detection events
- `GET /stats/overview` → dashboard totals + anomaly breakdown + recent videos
- `GET /stats/trends?days=7` → daily trends for videos/detections
- `GET /alerts?status=all|active|investigating|resolved&limit=50` → alert feed for Alerts page
- `GET /analytics/summary?days=7` → trends + time patterns + hotspot summary for Analytics page

Notes:
- Uploaded files are stored in `uploads/`.
- Set `AUTO_DELETE_UPLOADS=true` if you want files removed after processing.
- If `MONGODB_URI` is not set, processing still works but stats endpoints return 503.
