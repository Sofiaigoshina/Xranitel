import { useCallback, useEffect, useRef, useState } from 'react'
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

// ---- Popup alert types & component for overlaying on video ----
interface PopupAlert {
  id: string
  label: string
  confidence: number
  time: number
  createdAt: number // Date.now() when shown
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
    confidence: number
    created_at?: string | null
    video_time?: string
  }>
}

export default function VideoAnalysis() {
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const videoCardRef = useRef<HTMLDivElement | null>(null)
  const [anomalyTypes, setAnomalyTypes] = useState([
    { id: 'gunshot_audio', name: 'Gunshot', enabled: false, type: 'audio', description: 'Gunshot-like sounds detected in audio stream' },
    { id: 'fight_visual', name: 'Fight', enabled: false, type: 'visual', description: 'Physical altercation detected in video feed' },
    { id: 'sudden_fall_visual', name: 'Sudden Fall', enabled: false, type: 'visual', description: 'Person falling suddenly in monitored area' },
    { id: 'scream_audio', name: 'Scream', enabled: false, type: 'audio', description: 'Screams or distress calls in audio stream' },
    { id: 'explosion_fire_visual', name: 'Explosion/Fire', enabled: false, type: 'visual', description: 'Explosion flash or fire presence in video feed' },
    { id: 'crowd_gathering_visual', name: 'Crowd Gathering', enabled: false, type: 'visual', description: 'Unusual crowd formation or gathering detected' },
  ])
  const [uploadedVideo, setUploadedVideo] = useState<File | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [processMessage, setProcessMessage] = useState('')
  const [detectionResults, setDetectionResults] = useState<Record<string, { time: number; confidence: number; label: string }[]>>({})
  const [resultErrors, setResultErrors] = useState<Record<string, string>>({})

  // Video player state
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [pendingSeekTime, setPendingSeekTime] = useState<number | null>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [isVideoPlaying, setIsVideoPlaying] = useState(false)

  // Popup alerts overlaid on the video player
  const [popupAlerts, setPopupAlerts] = useState<PopupAlert[]>([])
  const shownEventKeysRef = useRef<Set<string>>(new Set())

  const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000'
  const selectedVideoId = searchParams.get('videoId')
  const selectedFilenameFromQuery = searchParams.get('file')
  const selectedTimeParam = searchParams.get('t')

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
          throw new Error(detail || 'Failed to load video detections')
        }

        const json = (await res.json()) as VideoDetectionResponse
        const grouped = json.detections.reduce<Record<string, { time: number; confidence: number; label: string }[]>>(
          (acc, row) => {
            const key = row.anomaly_id || 'unknown'
            if (!acc[key]) acc[key] = []
            acc[key].push({
              time: Number(row.time || 0),
              confidence: Number(row.confidence || 0),
              label: row.label || row.anomaly_id || 'Anomaly',
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
        setPendingSeekTime(safeStartAt)
        setIsVideoPlaying(true)

        const filename =
          json.video?.filename ||
          selectedFilenameFromQuery ||
          (location.state as { selectedFilename?: string } | null)?.selectedFilename ||
          'Selected video'

        setProcessMessage(
          total > 0
            ? `Loaded ${total} stored anomaly event(s) for ${filename}${safeStartAt > 0 ? ` • starting at ${Math.floor(safeStartAt / 60)}:${String(Math.floor(safeStartAt % 60)).padStart(2, '0')}` : ''}.`
            : `No stored anomaly events found for ${filename}.`
        )
      } catch (err: unknown) {
        if ((err as Error).name === 'AbortError') return
        const message = err instanceof Error ? err.message : 'Failed to load saved detections'
        setProcessMessage(`Error: ${message}`)
      }
    }

    loadVideoDetections()
    return () => controller.abort()
  }, [API_BASE, selectedVideoId, selectedFilenameFromQuery, selectedTimeParam, location.state])

  // Flatten all events for real-time reveal (only show events whose time <= video currentTime)
  const allEvents = Object.entries(detectionResults).flatMap(([anomalyId, events]) =>
    events.map((e) => ({ ...e, anomalyId }))
  )

  // Deduplicate detections that fall in the same second for the same anomaly type.
  // Keeps the highest confidence entry per (anomalyId, rounded-second). No events are skipped.
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

  // Only time-filter during active processing; once done, always show all results
  const rawVisible = isProcessing
    ? allEvents.filter((e) => e.time <= currentTime)
    : allEvents
  const visibleEvents = mergeEvents(rawVisible)

  // Clean up object URL when component unmounts or video changes
  useEffect(() => {
    return () => {
      if (videoUrl?.startsWith('blob:')) URL.revokeObjectURL(videoUrl)
    }
  }, [videoUrl])

  // Spawn popup alerts when new events become visible during playback
  useEffect(() => {
    if (!isVideoPlaying && currentTime === 0) return
    for (const evt of visibleEvents) {
      const key = `${evt.anomalyId}-${evt.time}`
      if (!shownEventKeysRef.current.has(key)) {
        shownEventKeysRef.current.add(key)
        const now = Date.now()
        const alert: PopupAlert = {
          id: key + '-' + now,
          label: evt.label,
          confidence: evt.confidence,
          time: evt.time,
          createdAt: now,
        }
        setPopupAlerts((prev) => [...prev.slice(-4), alert]) // keep at most 5
        // Auto-remove after 3 seconds
        setTimeout(() => {
          setPopupAlerts((prev) => prev.filter((a) => a.id !== alert.id))
        }, 3000)
      }
    }
  }, [visibleEvents, isVideoPlaying, currentTime])

  const onTimeUpdate = useCallback(() => {
    if (videoRef.current) setCurrentTime(videoRef.current.currentTime)
  }, [])

  const seekTo = useCallback((time: number) => {
    if (videoRef.current) {
      videoCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      videoRef.current.currentTime = time
      void videoRef.current.play()
    }
  }, [])

  const onVideoLoadedMetadata = useCallback(() => {
    if (!videoRef.current) return
    if (pendingSeekTime === null) return

    const seek = Math.max(0, Math.min(pendingSeekTime, Number.isFinite(videoRef.current.duration) ? videoRef.current.duration : pendingSeekTime))
    videoRef.current.currentTime = seek
    void videoRef.current.play().catch(() => {
      // Autoplay may be blocked by browser; controls remain available for manual play.
    })
    setPendingSeekTime(null)
  }, [pendingSeekTime])

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
      setProcessMessage(`Uploaded: ${selectedFile.name}`)
    }
  }

  const handleProcessVideo = async () => {
    if (!uploadedVideo) {
      setProcessMessage('Please upload a video before processing.')
      return
    }

    if (enabledAnomalyCount < 1) {
      setProcessMessage('Please enable at least one anomaly type.')
      return
    }

    setIsProcessing(true)
    setProcessMessage(`Processing ${uploadedVideo.name} with ${enabledAnomalyCount} anomaly type(s)…`)
    setDetectionResults({})
    setResultErrors({})
    setCurrentTime(0)
    setPopupAlerts([])
    shownEventKeysRef.current.clear()

    // Create object URL and start playing the video immediately
    if (videoUrl) URL.revokeObjectURL(videoUrl)
    const newUrl = URL.createObjectURL(uploadedVideo)
    setVideoUrl(newUrl)
    setIsVideoPlaying(true)
    // Give React a tick to mount the <video>, then play
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
        throw new Error(err.detail ?? 'Processing failed')
      }

      // ---- Read SSE stream — events arrive in real time --------------------
      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        // SSE messages are separated by double newline
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
                  [anomalyId]: [...(prev[anomalyId] || []), { time, confidence, label }],
                }))
              } else if (msg.type === 'error') {
                setResultErrors((prev) => ({
                  ...prev,
                  [msg.anomalyId]: msg.message,
                }))
              }
              // 'detector_done' and 'done' are informational
            } catch {
              // skip malformed SSE lines
            }
          }
        }
      }

      setProcessMessage(
        totalEvents > 0
          ? `Done — ${totalEvents} event(s) detected across ${selectedIds.length} model(s).`
          : 'Done — no anomalies detected.'
      )
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      setProcessMessage(`Error: ${message}`)
    } finally {
      setIsProcessing(false)
      setIsVideoPlaying(false)
    }
  }

  // const recentAnalyses = [
  //   { id: 1, filename: 'security_footage_001.mp4', status: 'completed', anomalies: 3, duration: '2:45', timestamp: '2024-01-15 14:30', confidence: 94 },
  //   { id: 2, filename: 'parking_lot_night.mp4', status: 'processing', anomalies: 0, duration: '5:12', timestamp: '2024-01-15 14:25', confidence: 0 },
  //   { id: 3, filename: 'lobby_morning.mp4', status: 'completed', anomalies: 1, duration: '3:20', timestamp: '2024-01-15 14:20', confidence: 87 },
  // ]

  return (
    <div className="space-y-6">
      <div className="px-4 sm:px-0">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold text-gray-900">Video Analysis</h2>
            <p className="text-sm sm:text-base text-gray-600 mt-1">
              Upload and analyze CCTV footage with AI-powered anomaly detection
            </p>
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
                Processing...
              </>
            ) : (
              <>
                <Play className="h-4 w-4 mr-2" />
                Process Video
              </>
            )}
          </Button>
        </div>
        {processMessage && (
          <p className="mt-3 text-sm text-[#4a5a6b]">{processMessage}</p>
        )}
      </div>

      {/* Video Player — shown when processing or results exist */}
      {videoUrl && (
        <Card ref={videoCardRef} className="bg-white border border-[#4a5a6b]/30 shadow-sm hover:shadow-md transition-shadow hover:border-[#4a5a6b]/50">
          <CardHeader className="pb-2 sm:pb-3 border-b border-[#4a5a6b]/10">
            <CardTitle className="flex items-center gap-2 text-gray-800 text-base sm:text-lg">
              <Eye className="h-4 w-4 sm:h-5 sm:w-5 text-[#4a5a6b]" />
              {isProcessing ? 'Live Analysis' : 'Video Playback'}
            </CardTitle>
            <CardDescription className="text-xs sm:text-sm">
              {isProcessing
                ? 'Video is playing while detection models analyze the video…'
                : 'Review detected anomalies by clicking timestamps below'}
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="relative flex justify-center">
              <video
                ref={videoRef}
                src={videoUrl}
                controls
                onLoadedMetadata={onVideoLoadedMetadata}
                onTimeUpdate={onTimeUpdate}
                onEnded={() => setIsVideoPlaying(false)}
                className="max-w-full max-h-[70vh] rounded-lg bg-black object-contain"
              />

              {/* Popup alerts overlay */}
              {popupAlerts.length > 0 && (
                <div className="absolute top-3 right-3 flex flex-col gap-2 z-10 pointer-events-none max-w-[280px]">
                  {popupAlerts.map((alert) => (
                    <div
                      key={alert.id}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-600/90 text-white shadow-lg backdrop-blur-sm animate-in fade-in slide-in-from-right-5 duration-300"
                    >
                      <ShieldAlert className="h-4 w-4 flex-shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold truncate">{alert.label} Detected</p>
                        <p className="text-xs text-white/80">
                          {Math.floor(alert.time / 60)}:{String(Math.floor(alert.time % 60)).padStart(2, '0')} &bull; {alert.confidence}%
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:gap-6 grid-cols-1 lg:grid-cols-2">
        {/* Upload Section */}
        <Card className="bg-white border border-[#4a5a6b]/30 shadow-sm hover:shadow-md transition-shadow hover:border-[#4a5a6b]/50">
          <CardHeader className="pb-2 sm:pb-3 border-b border-[#4a5a6b]/10">
            <CardTitle className="flex items-center gap-2 text-gray-800 text-base sm:text-lg">
              <Upload className="h-4 w-4 sm:h-5 sm:w-5 text-[#4a5a6b]" />
              Upload Video
            </CardTitle>
            <CardDescription className="text-xs sm:text-sm">
              Select video files for AI analysis
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <input
              ref={fileInputRef}
              type="file"
              accept="video/mp4,video/x-msvideo,video/quicktime,.mp4,.avi,.mov"
              className="hidden"
              onChange={handleVideoSelect}
            />
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-4 sm:p-6 text-center hover:border-gray-400 transition-colors">
              <FileVideo className="h-8 w-8 sm:h-12 sm:w-12 text-gray-400 mx-auto mb-3" />
              <h3 className="font-medium text-gray-900 mb-2 text-sm sm:text-base">Drop video files here</h3>
              <p className="text-gray-600 mb-3 text-xs sm:text-sm">or click to browse files</p>
              <Button 
                variant="outline" 
                size="sm" 
                className="mb-2 text-xs sm:text-sm border-[#4a5a6b] text-[#4a5a6b] hover:bg-[#4a5a6b] hover:text-white"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-3 w-3 sm:h-4 sm:w-4 mr-1" />
                Choose Files
              </Button>
              {uploadedVideo && (
                <p className="text-xs sm:text-sm text-[#4a5a6b] mb-2 truncate" title={uploadedVideo.name}>
                  Selected: {uploadedVideo.name}
                </p>
              )}
              <p className="text-xs sm:text-sm text-gray-500">
                MP4, AVI, MOV up to 5GB
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Anomaly Selection */}
        <Card className="bg-white border border-[#4a5a6b]/30 shadow-sm hover:shadow-md transition-shadow hover:border-[#4a5a6b]/50">
          <CardHeader className="pb-2 sm:pb-3 border-b border-[#4a5a6b]/10">
            <CardTitle className="flex items-center gap-2 text-gray-800 text-base sm:text-lg">
              <Settings className="h-4 w-4 sm:h-5 sm:w-5 text-[#4a5a6b]" />
              Select Anomalies
            </CardTitle>
            <CardDescription className="text-xs sm:text-sm">
              Choose which anomalies to detect
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
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
                      {anomaly.type === 'audio' ? 'Audio' : 'Visual'}
                    </div>
                  </div>
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Analysis Results */}
      <Card className="bg-white border border-[#4a5a6b]/30 shadow-sm hover:shadow-md transition-shadow hover:border-[#4a5a6b]/50">
        <CardHeader className="border-b border-[#4a5a6b]/10">
          <CardTitle className="flex items-center gap-2 text-gray-800">
            <AlertTriangle className="h-5 w-5 text-[#4a5a6b]" />
            Detection Results
          </CardTitle>
          <CardDescription>
            AI-detected anomalies in uploaded videos
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Real-time revealed results */}
            {visibleEvents.map((event, idx) => (
              <div
                key={`${event.anomalyId}-${idx}`}
                className="flex flex-col sm:flex-row sm:items-center justify-between p-3 sm:p-4 border border-red-200 rounded-lg bg-red-50 gap-3 animate-in fade-in slide-in-from-bottom-2 duration-300"
              >
                <div className="space-y-1 flex-1 min-w-0">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                    <span className="font-medium text-red-900 truncate">
                      {event.label} Detected
                    </span>
                    <Badge variant="destructive" className="flex-shrink-0">
                      {event.confidence >= 80 ? 'High' : event.confidence >= 50 ? 'Medium' : 'Low'} Priority
                    </Badge>
                  </div>
                  <div className="text-sm text-red-700">
                    Time: {Math.floor(event.time / 60)}:{String(Math.floor(event.time % 60)).padStart(2, '0')} • Confidence: {event.confidence}%
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 sm:flex-none"
                    onClick={() => seekTo(event.time)}
                    disabled={!videoUrl}
                    title={videoUrl ? 'Jump to timestamp' : 'Upload/open video to seek this timestamp'}
                  >
                    <Play className="h-3 w-3 mr-1" />
                    Review
                  </Button>
                </div>
              </div>
            ))}

            {/* Errors from specific detectors */}
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

            {/* Empty state */}
            {visibleEvents.length === 0 && Object.keys(resultErrors).length === 0 && !isProcessing && (
              <p className="text-sm text-gray-500 text-center py-6">
                No results yet. Upload a video and click Process Video to begin.
              </p>
            )}

            {isProcessing && visibleEvents.length === 0 && (
              <div className="flex items-center justify-center gap-2 py-6">
                <Loader2 className="h-4 w-4 animate-spin text-[#4a5a6b]" />
                <p className="text-sm text-gray-500">Analyzing video… detections will appear in real time.</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
