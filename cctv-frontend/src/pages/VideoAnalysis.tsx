import { useEffect, useRef, useState } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { 
  Upload, 
  Play, 
  AlertTriangle,
  Volume2,
  Settings,
  FileVideo,
  Loader2,
  Eye,
  ShieldAlert,
} from 'lucide-react'

// ---- Типы для всплывающих оповещений ----
interface PopupAlert {
  id: string
  label: string
  confidence: number
  time: number
}

type NormalizedBBox = [number, number, number, number]

interface DetectionEvent {
  time: number
  endTime?: number | null
  confidence: number
  label: string
  bbox?: NormalizedBBox | null
}

interface VideoDetectionResponse {
  video: {
    id: string
    filename: string
    status: string
    created_at?: string | null
    completed_at?: string | null
    total_detections: number
    selected_anomalies?: string[]
  }
  detections: Array<{
    id: string
    anomaly_id: string
    label: string
    time: number
    end_time?: number | null
    confidence: number
    bbox?: NormalizedBBox | null
    created_at?: string | null
    video_time?: string
  }>
}

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000'
const POPUP_ALERT_MS = 3000
const MAX_POPUP_ALERTS = 5
const BOX_WINDOW_SECONDS = 0.75

const ANOMALY_OPTIONS = [
  { id: 'gunshot_audio', name: 'Выстрел', type: 'audio', description: 'Звуки выстрелов в аудиопотоке' },
  { id: 'scream_audio', name: 'Крик', type: 'audio', description: 'Крики о помощи в аудиопотоке' },
  { id: 'fight_visual', name: 'Драка', type: 'visual', description: 'Физическая потасовка в видеопотоке' },
  { id: 'sudden_fall_visual', name: 'Падение', type: 'visual', description: 'Человек внезапно падает в зоне наблюдения' },
  { id: 'explosion_fire_visual', name: 'Пожар (взрыв)', type: 'visual', description: 'Вспышка взрыва или присутствие огня' },
  { id: 'crowd_gathering_visual', name: 'Скопление людей', type: 'visual', description: 'Необычное скопление людей' },
  { id: 'weapon_visual', name: 'Оружие', type: 'visual', description: 'Обнаружение оружия' },
] as const

export default function VideoAnalysis() {
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const videoCardRef = useRef<HTMLDivElement | null>(null)
  const [anomalyTypes, setAnomalyTypes] = useState(
    ANOMALY_OPTIONS.map((item) => ({ ...item, enabled: false }))
  )
  const [uploadedVideo, setUploadedVideo] = useState<File | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [processMessage, setProcessMessage] = useState('')
  const [detectionResults, setDetectionResults] = useState<Record<string, DetectionEvent[]>>({})
  const [resultErrors, setResultErrors] = useState<Record<string, string>>({})

  // Состояние видеоплеера
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [pendingSeekTime, setPendingSeekTime] = useState<number | null>(null)
  const [playOnLoad, setPlayOnLoad] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [isVideoPlaying, setIsVideoPlaying] = useState(false)
  const [serverVideoId, setServerVideoId] = useState<string | null>(searchParams.get('videoId'))
  const [videoMode, setVideoMode] = useState<'original' | 'processed'>('original')
  const [usingProcessedFallback, setUsingProcessedFallback] = useState(false)

  // Всплывающие оповещения
  const [popupAlerts, setPopupAlerts] = useState<PopupAlert[]>([])
  const shownEventKeysRef = useRef<Set<string>>(new Set())

  const selectedVideoId = searchParams.get('videoId')
  const selectedFilenameFromQuery = searchParams.get('file')
  const selectedTimeParam = searchParams.get('t')

  const hasValidBBox = (bbox: unknown): bbox is NormalizedBBox => {
    if (!Array.isArray(bbox) || bbox.length !== 4) return false
    return bbox.every((v) => Number.isFinite(Number(v)))
  }

  useEffect(() => {
    if (!selectedVideoId) return

    const controller = new AbortController()

    const loadVideoDetections = async () => {
      try {
        setIsProcessing(false)
        setResultErrors({})
        setDetectionResults({})
        setPopupAlerts([])
        shownEventKeysRef.current.clear()

        const res = await fetch(`${API_BASE}/videos/${encodeURIComponent(selectedVideoId)}/detections`, {
          signal: controller.signal,
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({ detail: res.statusText }))
          const detail =
            typeof err?.detail === 'string'
              ? err.detail
              : err?.detail?.message || err?.message || res.statusText
          throw new Error(detail || 'Не удалось загрузить детекции видео')
        }

        const json = (await res.json()) as VideoDetectionResponse
        const grouped = json.detections.reduce<Record<string, DetectionEvent[]>>(
          (acc, row) => {
            const key = row.anomaly_id || 'unknown'
            if (!acc[key]) acc[key] = []
            acc[key].push({
              time: Number(row.time || 0),
              endTime: row.end_time == null ? null : Number(row.end_time),
              confidence: Number(row.confidence || 0),
              label: row.label || row.anomaly_id || 'Угроза',
              bbox: hasValidBBox(row.bbox) ? row.bbox : null,
            })
            return acc
          },
          {}
        )

        const sortedGrouped = Object.fromEntries(
          Object.entries(grouped).map(([k, events]) => [
            k,
            [...events].sort((a, b) => a.time - b.time),
          ])
        )

        setDetectionResults(sortedGrouped)

        const total = json.detections.length
        const startAt = Number(selectedTimeParam ?? (location.state as { selectedAlertTime?: number } | null)?.selectedAlertTime ?? 0)
        const safeStartAt = Number.isFinite(startAt) && startAt >= 0 ? startAt : 0
        const streamUrl = `${API_BASE}/videos/${encodeURIComponent(selectedVideoId)}/stream`

        setVideoUrl(streamUrl)
        setServerVideoId(selectedVideoId)
        setVideoMode('original')
        setUsingProcessedFallback(false)
        setPendingSeekTime(safeStartAt)
        setPlayOnLoad(false)
        setIsVideoPlaying(true)

        const filename =
          json.video?.filename ||
          selectedFilenameFromQuery ||
          (location.state as { selectedFilename?: string } | null)?.selectedFilename ||
          'Выбранное видео'

        setProcessMessage(
          total > 0
            ? `Загружено ${total} событий угроз для ${filename}${safeStartAt > 0 ? ` • начало в ${Math.floor(safeStartAt / 60)}:${String(Math.floor(safeStartAt % 60)).padStart(2, '0')}` : ''}.`
            : `Сохранённых событий угроз для ${filename} не найдено.`
        )
      } catch (err: unknown) {
        if ((err as Error).name === 'AbortError') return
        const message = err instanceof Error ? err.message : 'Не удалось загрузить сохранённые детекции'
        setProcessMessage(`Ошибка: ${message}`)
      }
    }

    loadVideoDetections()
    return () => controller.abort()
  }, [API_BASE, selectedVideoId, selectedFilenameFromQuery, selectedTimeParam, location.state])

  useEffect(() => {
    if (selectedVideoId) {
      setServerVideoId(selectedVideoId)
      setVideoMode('original')
    }
  }, [selectedVideoId])

  // Объединяем все события для отображения в реальном времени
  const allEvents = Object.entries(detectionResults).flatMap(([anomalyId, events]) =>
    events.map((e) => ({ ...e, anomalyId }))
  )

  const mergeEvents = (events: typeof allEvents) => {
    if (events.length === 0) return events
    const bestByKey: Record<string, typeof allEvents[0]> = {}
    for (const e of events) {
      const sec = Math.floor(e.time)
      const key = `${e.anomalyId}::${sec}`
      if (!bestByKey[key] || e.confidence > bestByKey[key].confidence) {
        bestByKey[key] = e
      }
    }
    return Object.values(bestByKey).sort((a, b) => a.time - b.time)
  }

  const rawVisible = isProcessing
    ? allEvents.filter((e) => e.time <= currentTime)
    : allEvents
  const visibleEvents = mergeEvents(rawVisible)

  const activeBboxEvents = mergeEvents(
    allEvents.filter(
      (e) => hasValidBBox(e.bbox) && Math.abs(e.time - currentTime) <= BOX_WINDOW_SECONDS
    )
  ).filter((e) => hasValidBBox(e.bbox))

  useEffect(() => {
    return () => {
      if (videoUrl?.startsWith('blob:')) URL.revokeObjectURL(videoUrl)
    }
  }, [videoUrl])

  useEffect(() => {
    if (!isVideoPlaying && currentTime === 0) return
    for (const evt of visibleEvents) {
      const key = `${evt.anomalyId}-${evt.time}`
      if (!shownEventKeysRef.current.has(key)) {
        shownEventKeysRef.current.add(key)
        const alert: PopupAlert = {
          id: key + '-' + Date.now(),
          label: evt.label,
          confidence: evt.confidence,
          time: evt.time,
        }
        setPopupAlerts((prev) => [...prev.slice(-(MAX_POPUP_ALERTS - 1)), alert])
        setTimeout(() => {
          setPopupAlerts((prev) => prev.filter((a) => a.id !== alert.id))
        }, POPUP_ALERT_MS)
      }
    }
  }, [visibleEvents, isVideoPlaying, currentTime])

  const onTimeUpdate = () => {
    if (videoRef.current) setCurrentTime(videoRef.current.currentTime)
  }

  const seekTo = (time: number) => {
    if (videoRef.current) {
      videoCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      videoRef.current.currentTime = time
      videoRef.current.pause()
      setCurrentTime(time)
      setIsVideoPlaying(false)
    }
  }

  const onVideoLoadedMetadata = () => {
    if (!videoRef.current) return
    if (pendingSeekTime === null) return

    const seek = Math.max(0, Math.min(pendingSeekTime, Number.isFinite(videoRef.current.duration) ? videoRef.current.duration : pendingSeekTime))
    videoRef.current.currentTime = seek
    setCurrentTime(seek)

    if (playOnLoad) {
      videoRef.current
        .play()
        .then(() => setIsVideoPlaying(true))
        .catch(() => {
          setIsVideoPlaying(false)
          setProcessMessage('Нажмите воспроизведение на элементах управления видео.')
        })
    } else {
      videoRef.current.pause()
      setIsVideoPlaying(false)
    }

    setPlayOnLoad(false)
    setPendingSeekTime(null)
  }

  const enabledAnomalyCount = anomalyTypes.filter((anomaly) => anomaly.enabled).length

  const toggleAnomaly = (id: string) => {
    setAnomalyTypes(prev =>
      prev.map(anomaly =>
        anomaly.id === id
          ? { ...anomaly, enabled: !anomaly.enabled }
          : anomaly
      )
    )
  }

  const handleVideoSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0] ?? null
    setUploadedVideo(selectedFile)

    if (selectedFile) {
      setProcessMessage(`Загружено: ${selectedFile.name}`)
    }
  }

  const handleProcessVideo = async () => {
    if (!uploadedVideo) {
      setProcessMessage('Пожалуйста, сначала загрузите видео.')
      return
    }

    if (enabledAnomalyCount < 1) {
      setProcessMessage('Пожалуйста, выберите хотя бы один тип угроз.')
      return
    }

    setIsProcessing(true)
    setProcessMessage(`Обработка ${uploadedVideo.name} с ${enabledAnomalyCount} типом(ами) угроз…`)
    setDetectionResults({})
    setResultErrors({})
    setCurrentTime(0)
    setPopupAlerts([])
    setServerVideoId(null)
    setVideoMode('original')
    setUsingProcessedFallback(false)
    setPlayOnLoad(false)
    shownEventKeysRef.current.clear()

    if (videoUrl) URL.revokeObjectURL(videoUrl)
    const newUrl = URL.createObjectURL(uploadedVideo)
    setVideoUrl(newUrl)
    setIsVideoPlaying(true)
    setTimeout(() => videoRef.current?.play(), 100)

    let totalEvents = 0

    try {
      const selectedIds = anomalyTypes.filter((a) => a.enabled).map((a) => a.id)
      const formData = new FormData()
      formData.append('file', uploadedVideo)
      formData.append('anomaly_types', JSON.stringify(selectedIds))

      const res = await fetch(`${API_BASE}/process-video`, {
        method: 'POST',
        body: formData,
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }))
        throw new Error(err.detail ?? 'Ошибка обработки')
      }

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const parts = buffer.split('\n\n')
        buffer = parts.pop() || ''

        for (const part of parts) {
          for (const line of part.split('\n')) {
            if (!line.startsWith('data: ')) continue
            const jsonStr = line.slice(6).trim()
            if (!jsonStr) continue

            try {
              const msg = JSON.parse(jsonStr)

              if (msg.type === 'event') {
                totalEvents++
                const { anomalyId, time, confidence, label } = msg
                setDetectionResults((prev) => ({
                  ...prev,
                  [anomalyId]: [
                    ...(prev[anomalyId] || []),
                    {
                      time,
                      endTime: msg.end_time == null ? null : Number(msg.end_time),
                      confidence,
                      label,
                      bbox: hasValidBBox(msg.bbox) ? msg.bbox : null,
                    },
                  ],
                }))
              } else if (msg.type === 'error') {
                setResultErrors((prev) => ({
                  ...prev,
                  [msg.anomalyId]: msg.message,
                }))
              } else if (msg.type === 'video_meta') {
                if (msg.videoId) {
                  setServerVideoId(String(msg.videoId))
                }
              } else if (msg.type === 'done') {
                if (msg.videoId) {
                  setServerVideoId(String(msg.videoId))
                }
              }
            } catch {
              // пропускаем некорректные SSE строки
            }
          }
        }
      }

      setProcessMessage(
        totalEvents > 0
          ? `Готово — обнаружено ${totalEvents} событий в ${selectedIds.length} моделях.`
          : 'Готово — угроз не обнаружено.'
      )
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Неизвестная ошибка'
      setProcessMessage(`Ошибка: ${message}`)
    } finally {
      setIsProcessing(false)
      setIsVideoPlaying(false)
    }
  }

  const handlePlayProcessedOutput = () => {
    if (!serverVideoId) {
      setProcessMessage('Обработанный вывод пока недоступен. Дождитесь завершения обработки.')
      return
    }

    const originalUrl = `${API_BASE}/videos/${encodeURIComponent(serverVideoId)}/stream`
    setVideoUrl(originalUrl)
    setPendingSeekTime(0)
    setPlayOnLoad(true)
    setCurrentTime(0)
    setVideoMode('processed')
    setUsingProcessedFallback(true)
    setIsVideoPlaying(true)
    setPopupAlerts([])
    videoCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    shownEventKeysRef.current.clear()
    setProcessMessage('Воспроизведение полного обработанного вывода на оригинальном видеопотоке.')
  }

  const onVideoPlaybackError = () => {
    if (videoMode === 'processed' && serverVideoId && !usingProcessedFallback) {
      const fallbackUrl = `${API_BASE}/videos/${encodeURIComponent(serverVideoId)}/stream`
      setVideoUrl(fallbackUrl)
      setPendingSeekTime(0)
      setPlayOnLoad(true)
      setCurrentTime(0)
      setUsingProcessedFallback(true)
      setIsVideoPlaying(true)
      setProcessMessage('Обработанный файл не может быть воспроизведён в формате браузера. Переключено на режим наложения.')
      return
    }

    setIsVideoPlaying(false)
    setProcessMessage('Не удалось воспроизвести этот источник видео. Пожалуйста, попробуйте снова.')
  }

  const formatClock = (seconds: number) => {
    const safe = Math.max(0, Math.floor(seconds))
    return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`
  }

  const formatDetectionTimeRange = (event: { time: number; endTime?: number | null }) => {
    const start = formatClock(event.time)
    if (event.endTime == null || !Number.isFinite(event.endTime) || event.endTime <= event.time) {
      return start
    }
    return `${start} : ${formatClock(event.endTime)}`
  }

  return (
    <div className="space-y-6">
      <div className="px-4 sm:px-0">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold text-gray-900">Анализ видео</h2>

            <div className="mt-3 h-1 w-16 bg-[#4a5a6b] rounded-full"></div>
          </div>
          <Button
            size="sm"
            className="self-start sm:mt-1 bg-[#4a5a6b] hover:bg-[#3d4a59] text-white"
            onClick={handleProcessVideo}
            disabled={isProcessing}
          >
            {isProcessing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Обработка...
              </>
            ) : (
              <>
                <Play className="h-4 w-4 mr-2" />
                Обработать видео
              </>
            )}
          </Button>
        </div>
        {processMessage && (
          <p className="mt-3 text-sm text-[#4a5a6b]">{processMessage}</p>
        )}
      </div>

      {/* Видеоплеер */}
      {videoUrl && (
        <Card ref={videoCardRef} className="bg-white border border-[#4a5a6b]/30 shadow-sm hover:shadow-md transition-shadow hover:border-[#4a5a6b]/50">
          <CardHeader className="pb-2 sm:pb-3 border-b border-[#4a5a6b]/10">
            <CardTitle className="flex items-center gap-2 text-gray-800 text-base sm:text-lg">
              <Eye className="h-4 w-4 sm:h-5 sm:w-5 text-[#4a5a6b]" />
              {isProcessing ? 'Анализ в реальном времени' : 'Воспроизведение видео'}
            </CardTitle>
            <CardDescription className="text-xs sm:text-sm">
              {isProcessing
                ? 'Видео воспроизводится, пока модели анализируют его…'
                : 'Просмотрите обнаруженные угрозы, нажав на временные метки ниже'}
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-4 sm:pt-5">
            <div className="flex justify-center">
              <div className="relative inline-block leading-none">
                <video
                  ref={videoRef}
                  src={videoUrl}
                  controls
                  onLoadedMetadata={onVideoLoadedMetadata}
                  onTimeUpdate={onTimeUpdate}
                  onError={onVideoPlaybackError}
                  onEnded={() => setIsVideoPlaying(false)}
                  className="max-w-full max-h-[70vh] rounded-lg bg-black object-contain"
                />

                {/* Ограничивающие рамки */}
                {activeBboxEvents.length > 0 && (
                  <div className="absolute inset-0 pointer-events-none z-[5]">
                    {activeBboxEvents.map((evt, idx) => {
                      if (!hasValidBBox(evt.bbox)) return null
                      const [x1, y1, x2, y2] = evt.bbox
                      const left = Math.max(0, Math.min(100, x1 * 100))
                      const top = Math.max(0, Math.min(100, y1 * 100))
                      const width = Math.max(1, Math.min(100, (x2 - x1) * 100))
                      const height = Math.max(1, Math.min(100, (y2 - y1) * 100))

                      return (
                        <div
                          key={`bbox-${evt.anomalyId}-${evt.time}-${idx}`}
                          className="absolute border-2 border-red-500 shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
                          style={{
                            left: `${left}%`,
                            top: `${top}%`,
                            width: `${width}%`,
                            height: `${height}%`,
                          }}
                        >
                          <div className="absolute -top-6 left-0 bg-red-600 text-white text-[10px] sm:text-xs px-1.5 py-0.5 rounded">
                            {evt.label}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Всплывающие оповещения */}
                {popupAlerts.length > 0 && (
                  <div className="absolute top-3 right-3 flex flex-col gap-2 z-10 pointer-events-none max-w-[280px]">
                    {popupAlerts.map((alert) => (
                      <div
                        key={alert.id}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-600/90 text-white shadow-lg backdrop-blur-sm animate-in fade-in slide-in-from-right-5 duration-300"
                      >
                        <ShieldAlert className="h-4 w-4 flex-shrink-0" />
                        <div className="min-w-0">
                          <p className="text-sm font-semibold truncate">{alert.label} обнаружено</p>
                          <p className="text-xs text-white/80">
                            {Math.floor(alert.time / 60)}:{String(Math.floor(alert.time % 60)).padStart(2, '0')} &bull; {alert.confidence}%
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:gap-6 grid-cols-1 lg:grid-cols-2">
        {/* Секция загрузки видео */}
        <Card className="bg-white border border-[#4a5a6b]/30 shadow-sm hover:shadow-md transition-shadow hover:border-[#4a5a6b]/50">
          <CardHeader className="pb-2 sm:pb-3 border-b border-[#4a5a6b]/10">
            <CardTitle className="flex items-center gap-2 text-gray-800 text-base sm:text-lg">
              <Upload className="h-4 w-4 sm:h-5 sm:w-5 text-[#4a5a6b]" />
              Загрузить видео
            </CardTitle>
            <CardDescription className="text-xs sm:text-sm">
              Выберите видеофайлы для анализа
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-4 sm:pt-5">
            <input
              ref={fileInputRef}
              type="file"
              accept="video/mp4,video/x-msvideo,video/quicktime,.mp4,.avi,.mov"
              className="hidden"
              onChange={handleVideoSelect}
            />
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-4 sm:p-6 text-center hover:border-gray-400 transition-colors">
              <FileVideo className="h-8 w-8 sm:h-12 sm:w-12 text-gray-400 mx-auto mb-3" />
              <h3 className="font-medium text-gray-900 mb-2 text-sm sm:text-base">Перетащите видеофайлы сюда</h3>
              <p className="text-gray-600 mb-3 text-xs sm:text-sm">или нажмите, чтобы выбрать файлы</p>
              <Button
                variant="outline"
                size="sm"
                className="mb-2 text-xs sm:text-sm border-[#4a5a6b] text-[#4a5a6b] hover:bg-[#4a5a6b] hover:text-white"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-3 w-3 sm:h-4 sm:w-4 mr-1" />
                Выбрать файлы
              </Button>
              {uploadedVideo && (
                <p className="text-xs sm:text-sm text-[#4a5a6b] mb-2 truncate" title={uploadedVideo.name}>
                  Выбрано: {uploadedVideo.name}
                </p>
              )}
              <p className="text-xs sm:text-sm text-gray-500">
                MP4, AVI, MOV до 5 ГБ
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Выбор аномалий */}
        <Card className="bg-white border border-[#4a5a6b]/30 shadow-sm hover:shadow-md transition-shadow hover:border-[#4a5a6b]/50">
          <CardHeader className="pb-2 sm:pb-3 border-b border-[#4a5a6b]/10">
            <CardTitle className="flex items-center gap-2 text-gray-800 text-base sm:text-lg">
              <Settings className="h-4 w-4 sm:h-5 sm:w-5 text-[#4a5a6b]" />
              Выберите угрозы
            </CardTitle>
            <CardDescription className="text-xs sm:text-sm">
              Выберите, какие угрозы нужно обнаружить
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-4 sm:pt-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">
              {anomalyTypes.map((anomaly) => (
                <Button
                  key={anomaly.id}
                  variant={anomaly.enabled ? "default" : "outline"}
                  className={`h-auto p-3 sm:p-4 flex flex-col items-center gap-2 cursor-pointer ${
                    anomaly.enabled
                      ? 'text-white border-[#4a5a6b]'
                      : 'hover:bg-gray-50 border-gray-200'
                  }`}
                  style={anomaly.enabled ? { backgroundColor: '#4a5a6b' } : {}}
                  onClick={() => toggleAnomaly(anomaly.id)}
                >
                  <div className={`p-2 rounded ${
                    anomaly.enabled
                      ? 'bg-white/20'
                      : anomaly.type === 'audio'
                        ? 'bg-orange-100'
                        : 'bg-red-100'
                  }`}>
                    {anomaly.type === 'audio' ? (
                      <Volume2 className={`h-4 w-4 sm:h-5 sm:w-5 ${
                        anomaly.enabled ? 'text-white' : 'text-orange-600'
                      }`} />
                    ) : (
                      <AlertTriangle className={`h-4 w-4 sm:h-5 sm:w-5 ${
                        anomaly.enabled ? 'text-white' : 'text-red-600'
                      }`} />
                    )}
                  </div>
                  <div className="text-center">
                    <div className="font-medium text-xs sm:text-sm">{anomaly.name}</div>
                    <div className={`text-xs ${
                      anomaly.enabled ? 'text-white/80' : 'text-gray-500'
                    }`}>
                      {anomaly.type === 'audio' ? 'Аудио' : 'Визуальный'}
                    </div>
                  </div>
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Результаты обнаружения */}
      <Card className="bg-white border border-[#4a5a6b]/30 shadow-sm hover:shadow-md transition-shadow hover:border-[#4a5a6b]/50">
        <CardHeader className="border-b border-[#4a5a6b]/10 space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-gray-800">
                <AlertTriangle className="h-5 w-5 text-[#4a5a6b]" />
                Результаты обнаружения
              </CardTitle>
              <CardDescription>
                Обнаруженные угрозы в загруженных видео
              </CardDescription>
            </div>

            {serverVideoId && (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="border-[#4a5a6b]/40 text-[#4a5a6b] hover:bg-[#4a5a6b] hover:text-white"
                  onClick={handlePlayProcessedOutput}
                  disabled={isProcessing}
                >
                  Воспроизвести обработанное видео
                </Button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="pt-4 sm:pt-5">
          <div className="space-y-4">
            {isProcessing && (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-[#4a5a6b]/20 bg-[#4a5a6b]/5 px-3 py-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Loader2 className="h-4 w-4 animate-spin text-[#4a5a6b] flex-shrink-0" />
                  <p className="text-sm text-[#4a5a6b] truncate">
                    Видео всё ещё обрабатывается. Новые обнаружения будут появляться здесь.
                  </p>
                </div>
                <Badge variant="secondary" className="whitespace-nowrap">
                  Обработка
                </Badge>
              </div>
            )}

            {visibleEvents.map((event, idx) => (
              <div
                key={`${event.anomalyId}-${idx}`}
                className="flex flex-col sm:flex-row sm:items-center justify-between p-3 sm:p-4 border border-red-200 rounded-lg bg-red-50 gap-3 animate-in fade-in slide-in-from-bottom-2 duration-300"
              >
                <div className="space-y-1 flex-1 min-w-0">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                    <span className="font-medium text-red-900 truncate">
                      {event.label} обнаружено
                    </span>
                    <Badge variant="destructive" className="flex-shrink-0">
                      {event.confidence >= 80 ? 'Высокий' : event.confidence >= 50 ? 'Средний' : 'Низкий'} приоритет
                    </Badge>
                  </div>
                  <div className="text-sm text-red-700">
                    Время: {formatDetectionTimeRange(event)} • Уверенность: {event.confidence}%
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 sm:flex-none"
                    onClick={() => seekTo(event.time)}
                    disabled={!videoUrl}
                    title={videoUrl ? 'Перейти к временной метке' : 'Загрузите видео для перехода'}
                  >
                    <Play className="h-3 w-3 mr-1" />
                    Просмотр
                  </Button>
                </div>
              </div>
            ))}

            {/* Ошибки детекторов */}
            {Object.entries(resultErrors).map(([anomalyId, errMsg]) => (
              <div
                key={`err-${anomalyId}`}
                className="flex items-center gap-2 p-3 sm:p-4 border border-yellow-200 rounded-lg bg-yellow-50"
              >
                <AlertTriangle className="h-4 w-4 text-yellow-600 flex-shrink-0" />
                <span className="text-sm text-yellow-800">
                  <span className="font-medium">{anomalyId}</span>: {errMsg}
                </span>
              </div>
            ))}

            {/* Пустое состояние */}
            {visibleEvents.length === 0 && Object.keys(resultErrors).length === 0 && !isProcessing && (
              <p className="text-sm text-gray-500 text-center py-6">
                Результатов пока нет. Загрузите видео и нажмите «Обработать видео», чтобы начать.
              </p>
            )}

            {isProcessing && visibleEvents.length === 0 && (
              <div className="flex items-center justify-center gap-2 py-6">
                <Loader2 className="h-4 w-4 animate-spin text-[#4a5a6b]" />
                <p className="text-sm text-gray-500">Анализ видео… ожидание первого обнаружения.</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}