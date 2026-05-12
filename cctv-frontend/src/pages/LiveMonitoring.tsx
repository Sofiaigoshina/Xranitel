import { useEffect, useRef, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { 
  Camera, 
  Play, 
  Pause, 
  Volume2,
  VolumeX,
  Settings,
  Maximize,
  AlertTriangle,
  Activity,
  Wifi,
  WifiOff,
  Upload,
  Loader2,
  ShieldAlert,
} from 'lucide-react'

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000'

type RealtimeMode = 'gunshot' | 'fire' | 'fall' | 'fight' | 'crowd' | 'scream'

const REALTIME_MODE_META: Record<
  RealtimeMode,
  { label: string; endpoint: string; defaultPrediction: string; defaultEvent: string }
> = {
  gunshot: {
    label: 'Gunshot',
    endpoint: '/process-video-realtime',
    defaultPrediction: 'No Gunshot',
    defaultEvent: 'Gunshot',
  },
  fire: {
    label: 'Fire/Explosion',
    endpoint: '/process-video-realtime',
    defaultPrediction: 'No Fire',
    defaultEvent: 'Explosion/Fire',
  },
  fall: {
    label: 'Sudden Fall',
    endpoint: '/process-video-realtime',
    defaultPrediction: 'Normal Posture',
    defaultEvent: 'Sudden Fall',
  },
  fight: {
    label: 'Fight',
    endpoint: '/process-video-realtime',
    defaultPrediction: 'No Fight',
    defaultEvent: 'Fight',
  },
  crowd: {
    label: 'Crowd',
    endpoint: '/process-video-realtime',
    defaultPrediction: 'No Crowd',
    defaultEvent: 'Crowd Gathering',
  },
  scream: {
    label: 'Scream',
    endpoint: '/process-video-realtime',
    defaultPrediction: 'No Scream',
    defaultEvent: 'Scream',
  },
}

const cameraFeeds = [
  {
    id: 1,
    name: 'Main Entrance',
    location: 'Building A - Floor 1',
    status: 'online',
    resolution: '1920x1080',
    fps: 30,
    audio: true,
    lastMotion: '2 minutes ago',
    anomalies: 0,
  },
  {
    id: 2,
    name: 'Parking Lot',
    location: 'Building B - Ground Floor',
    status: 'online',
    resolution: '1920x1080',
    fps: 30,
    audio: true,
    lastMotion: '5 minutes ago',
    anomalies: 1,
  },
  {
    id: 3,
    name: 'Lobby',
    location: 'Building A - Ground Floor',
    status: 'offline',
    resolution: '1280x720',
    fps: 25,
    audio: false,
    lastMotion: 'Never',
    anomalies: 0,
  },
  {
    id: 4,
    name: 'Emergency Exit',
    location: 'Building C - Floor 2',
    status: 'online',
    resolution: '1920x1080',
    fps: 30,
    audio: true,
    lastMotion: '1 minute ago',
    anomalies: 0,
  },
]

const liveAlerts = [
  { id: 1, camera: 'Parking Lot', type: 'Suspicious Activity', time: '2 minutes ago', severity: 'high' },
  { id: 2, camera: 'Main Entrance', type: 'Crowd Gathering', time: '5 minutes ago', severity: 'medium' },
]

export default function LiveMonitoring() {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)

  const [uploadedVideo, setUploadedVideo] = useState<File | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [isRunningRealtime, setIsRunningRealtime] = useState(false)
  const [realtimeMode, setRealtimeMode] = useState<RealtimeMode>('gunshot')
  const [monitorMessage, setMonitorMessage] = useState('Upload a video and start realtime monitoring.')
  const [latestTickTime, setLatestTickTime] = useState<number | null>(null)
  const [latestTickConfidence, setLatestTickConfidence] = useState<number | null>(null)
  const [realtimeEvents, setRealtimeEvents] = useState<Array<{ id: string; time: number; confidence: number; label: string }>>([])
  const [realtimePredictions, setRealtimePredictions] = useState<
    Array<{ id: string; time: number; confidence: number; label: string; isDetection: boolean }>
  >([])

  useEffect(() => {
    return () => {
      if (videoUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(videoUrl)
      }
    }
  }, [videoUrl])

  const formatClock = (seconds: number) => {
    const safe = Math.max(0, Math.floor(seconds))
    return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`
  }

  const handleVideoSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0] ?? null
    setUploadedVideo(selectedFile)
    setRealtimeEvents([])
    setRealtimePredictions([])
    setLatestTickTime(null)
    setLatestTickConfidence(null)

    if (!selectedFile) {
      setMonitorMessage('Upload a video and start realtime monitoring.')
      return
    }

    if (videoUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(videoUrl)
    }

    const localUrl = URL.createObjectURL(selectedFile)
    setVideoUrl(localUrl)
    setMonitorMessage(`Ready: ${selectedFile.name}`)
  }

  const handleStartRealtimeDetection = async () => {
    if (!uploadedVideo) {
      setMonitorMessage('Please upload a video first.')
      return
    }

    const modeMeta = REALTIME_MODE_META[realtimeMode]
    const modeLabel = modeMeta.label
    const endpoint = modeMeta.endpoint

    setIsRunningRealtime(true)
    setRealtimeEvents([])
    setRealtimePredictions([])
    setLatestTickTime(0)
    setLatestTickConfidence(0)
    setMonitorMessage(`Realtime ${modeLabel} monitoring started. Playing video and streaming live predictions...`)

    if (videoRef.current) {
      videoRef.current.pause()
      try {
        videoRef.current.currentTime = 0
      } catch {
        // ignore seek errors on not-ready media
      }
    }

    setTimeout(() => {
      videoRef.current?.play().catch(() => {
        setMonitorMessage('Video is loaded. Press play on video controls if browser blocked autoplay.')
      })
    }, 80)

    try {
      const formData = new FormData()
      formData.append('file', uploadedVideo)
      formData.append('mode', realtimeMode)

      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        body: formData,
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }))
        throw new Error(err.detail ?? 'Realtime processing failed')
      }

      const reader = res.body?.getReader()
      if (!reader) {
        throw new Error('No SSE response body received from backend.')
      }

      const decoder = new TextDecoder()
      let buffer = ''

      // eslint-disable-next-line no-constant-condition
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

              if (msg.type === 'tick') {
                setLatestTickTime(Number(msg.time || 0))
                setLatestTickConfidence(Number(msg.confidence || 0))
              } else if (msg.type === 'prediction') {
                const prediction = {
                  id: `${msg.time}-${Date.now()}-${Math.random()}`,
                  time: Number(msg.time || 0),
                  confidence: Number(msg.confidence || 0),
                  label: String(msg.label || modeMeta.defaultPrediction),
                  isDetection: Boolean(msg.is_detection),
                }
                setRealtimePredictions((prev) => [prediction, ...prev].slice(0, 20))
              } else if (msg.type === 'event') {
                const event = {
                  id: `${msg.time}-${Date.now()}-${Math.random()}`,
                  time: Number(msg.time || 0),
                  confidence: Number(msg.confidence || 0),
                  label: String(msg.label || modeMeta.defaultEvent),
                }
                setRealtimeEvents((prev) => [event, ...prev].slice(0, 12))
              } else if (msg.type === 'error') {
                setMonitorMessage(`Error: ${String(msg.message || 'Unknown realtime error')}`)
              } else if (msg.type === 'done') {
                setMonitorMessage(`Realtime ${modeLabel} monitoring finished.`)
              }
            } catch {
              // ignore malformed line
            }
          }
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown realtime error'
      setMonitorMessage(`Error: ${message}`)
    } finally {
      setIsRunningRealtime(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="px-4 sm:px-0">
        <h2 className="text-xl sm:text-2xl font-bold text-gray-900">Live Monitoring</h2>
        <p className="text-sm sm:text-base text-gray-600 mt-1">
          Real-time CCTV feeds with AI-powered anomaly detection
        </p>
        <div className="mt-3 h-1 w-16 bg-[#4a5a6b] rounded-full"></div>
      </div>

      <Card className="bg-white border border-[#4a5a6b]/30 shadow-sm">
        <CardHeader className="bg-blue-50 border-b border-blue-200">
          <CardTitle className="flex items-center gap-2 text-blue-700 text-lg">
            <ShieldAlert className="h-5 w-5 text-[#4a5a6b]" />
            Realtime CCTV Monitoring (All Models)
          </CardTitle>
          <CardDescription className="text-blue-600">
            Upload a video, choose mode, and watch playback with live AI predictions in realtime.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <input
            ref={fileInputRef}
            type="file"
            accept="video/mp4,video/x-msvideo,video/quicktime,.mp4,.avi,.mov"
            className="hidden"
            onChange={handleVideoSelect}
          />

          <div className="flex flex-col sm:flex-row gap-2">
            <Button
              variant={realtimeMode === 'gunshot' ? 'default' : 'outline'}
              onClick={() => setRealtimeMode('gunshot')}
              disabled={isRunningRealtime}
            >
              Gunshot Mode
            </Button>
            <Button
              variant={realtimeMode === 'fire' ? 'default' : 'outline'}
              onClick={() => setRealtimeMode('fire')}
              disabled={isRunningRealtime}
            >
              Fire Mode
            </Button>
            <Button
              variant={realtimeMode === 'fall' ? 'default' : 'outline'}
              onClick={() => setRealtimeMode('fall')}
              disabled={isRunningRealtime}
            >
              Fall Mode
            </Button>
            <Button
              variant={realtimeMode === 'fight' ? 'default' : 'outline'}
              onClick={() => setRealtimeMode('fight')}
              disabled={isRunningRealtime}
            >
              Fight Mode
            </Button>
            <Button
              variant={realtimeMode === 'crowd' ? 'default' : 'outline'}
              onClick={() => setRealtimeMode('crowd')}
              disabled={isRunningRealtime}
            >
              Crowd
            </Button>
            <Button
              variant={realtimeMode === 'scream' ? 'default' : 'outline'}
              onClick={() => setRealtimeMode('scream')}
              disabled={isRunningRealtime}
            >
              Scream Mode
            </Button>
            <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={isRunningRealtime}>
              <Upload className="h-4 w-4 mr-2" />
              Choose Video
            </Button>
            <Button onClick={handleStartRealtimeDetection} disabled={!uploadedVideo || isRunningRealtime}>
              {isRunningRealtime ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Monitoring...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 mr-2" />
                  Start Realtime {REALTIME_MODE_META[realtimeMode].label}
                </>
              )}
            </Button>
          </div>

          {uploadedVideo && (
            <p className="text-sm text-[#4a5a6b]" title={uploadedVideo.name}>
              Selected: {uploadedVideo.name}
            </p>
          )}

          <p className="text-sm text-gray-600">{monitorMessage}</p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-3 rounded-lg border bg-gray-50">
              <div className="text-xs text-gray-500">Latest Tick Time</div>
              <div className="text-lg font-semibold text-gray-800">
                {latestTickTime == null ? '--:--' : formatClock(latestTickTime)}
              </div>
            </div>
            <div className="p-3 rounded-lg border bg-gray-50">
              <div className="text-xs text-gray-500">Latest Confidence</div>
              <div className="text-lg font-semibold text-gray-800">
                {latestTickConfidence == null ? '--' : `${latestTickConfidence.toFixed(1)}%`}
              </div>
            </div>
            <div className="p-3 rounded-lg border bg-gray-50">
              <div className="text-xs text-gray-500">Live Predictions</div>
              <div className="text-lg font-semibold text-gray-800">{realtimePredictions.length}</div>
            </div>
          </div>

          {videoUrl && (
            <div className="rounded-lg overflow-hidden bg-black">
              <video ref={videoRef} src={videoUrl} controls className="w-full max-h-[360px] object-contain" />
            </div>
          )}

          {realtimePredictions.length > 0 && (
            <div className="space-y-2">
              {realtimePredictions.map((item) => (
                <div
                  key={item.id}
                  className={`flex items-center justify-between p-2 border rounded ${
                    item.isDetection ? 'bg-red-50 border-red-200' : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  <div className={`text-sm font-medium ${item.isDetection ? 'text-red-800' : 'text-slate-700'}`}>
                    Prediction: {item.label}
                  </div>
                  <div className={`text-xs ${item.isDetection ? 'text-red-700' : 'text-slate-600'}`}>
                    {formatClock(item.time)} • {item.confidence.toFixed(1)}%
                  </div>
                </div>
              ))}
            </div>
          )}

          {realtimeEvents.length > 0 && (
            <div className="space-y-2">
              {realtimeEvents.map((event) => (
                <div key={event.id} className="flex items-center justify-between p-2 border rounded bg-red-50 border-red-200">
                  <div className="text-sm text-red-800 font-medium">{event.label}</div>
                  <div className="text-xs text-red-700">
                    {formatClock(event.time)} • {event.confidence.toFixed(1)}%
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Live Alerts */}
      {liveAlerts.length > 0 && (
        <Card className="bg-white border border-[#4a5a6b]/30 shadow-sm">
          <CardHeader className="bg-red-50 border-b border-red-200">
            <CardTitle className="flex items-center gap-2 text-red-700 text-lg">
              <AlertTriangle className="h-5 w-5 text-[#4a5a6b]" />
              Live Alerts
            </CardTitle>
            <CardDescription className="text-red-600">
              Real-time security alerts from AI detection
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {liveAlerts.map((alert) => (
                <div key={alert.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-3 border border-red-200 rounded-lg bg-red-50 gap-3">
                  <div className="space-y-1 flex-1 min-w-0">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                      <span className="font-medium text-red-900 truncate">{alert.type}</span>
                      <Badge variant="destructive" className="flex-shrink-0">{alert.severity}</Badge>
                    </div>
                    <div className="text-sm text-red-700">
                      Camera: {alert.camera} • {alert.time}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Button variant="outline" size="sm" className="flex-1 sm:flex-none">
                      <Camera className="h-3 w-3 mr-1" />
                      <span className="hidden sm:inline">View Feed</span>
                      <span className="sm:hidden">View</span>
                    </Button>
                    <Button variant="outline" size="sm" className="flex-1 sm:flex-none">
                      <AlertTriangle className="h-3 w-3 mr-1" />
                      <span className="hidden sm:inline">Investigate</span>
                      <span className="sm:hidden">Investigate</span>
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Camera Grid */}
      <div className="grid gap-4 sm:gap-6 grid-cols-1 lg:grid-cols-2">
        {cameraFeeds.map((camera) => (
          <Card key={camera.id} className="bg-white border border-[#4a5a6b]/30 shadow-sm hover:shadow-md transition-shadow hover:border-[#4a5a6b]/50">
            <CardHeader className="bg-blue-50 border-b border-blue-200">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <CardTitle className="flex items-center gap-2 text-blue-700 text-lg">
                    <Camera className="h-5 w-5 flex-shrink-0" />
                    <span className="truncate">{camera.name}</span>
                  </CardTitle>
                  <CardDescription className="text-blue-600 truncate">
                    {camera.location}
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Badge 
                    variant={camera.status === 'online' ? 'default' : 'secondary'}
                    className={camera.status === 'online' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}
                  >
                    {camera.status === 'online' ? (
                      <Wifi className="h-3 w-3 mr-1" />
                    ) : (
                      <WifiOff className="h-3 w-3 mr-1" />
                    )}
                    {camera.status}
                  </Badge>
                  {camera.anomalies > 0 && (
                    <Badge variant="destructive">
                      <AlertTriangle className="h-3 w-3 mr-1" />
                      {camera.anomalies}
                    </Badge>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {/* Video Feed Placeholder */}
              <div className="relative bg-gray-900 rounded-lg mb-4 aspect-video">
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="text-center text-white">
                    <Camera className="h-8 w-8 sm:h-12 sm:w-12 mx-auto mb-2 opacity-50" />
                    <p className="text-xs sm:text-sm opacity-75">
                      {camera.status === 'online' ? 'Live Feed' : 'Camera Offline'}
                    </p>
                    {camera.status === 'online' && (
                      <div className="flex items-center justify-center gap-2 mt-2">
                        <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></div>
                        <span className="text-xs">REC</span>
                      </div>
                    )}
                  </div>
                </div>
                
                {/* Video Controls */}
                {camera.status === 'online' && (
                  <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between bg-black bg-opacity-50 rounded px-2 py-1">
                    <div className="flex items-center gap-1 sm:gap-2">
                      <Button size="sm" variant="ghost" className="text-white hover:bg-white hover:bg-opacity-20 p-1 sm:p-2">
                        <Play className="h-3 w-3" />
                      </Button>
                      <Button size="sm" variant="ghost" className="text-white hover:bg-white hover:bg-opacity-20 p-1 sm:p-2">
                        <Pause className="h-3 w-3" />
                      </Button>
                      <Button size="sm" variant="ghost" className="text-white hover:bg-white hover:bg-opacity-20 p-1 sm:p-2">
                        {camera.audio ? <Volume2 className="h-3 w-3" /> : <VolumeX className="h-3 w-3" />}
                      </Button>
                    </div>
                    <div className="flex items-center gap-1 sm:gap-2">
                      <Button size="sm" variant="ghost" className="text-white hover:bg-white hover:bg-opacity-20 p-1 sm:p-2">
                        <Settings className="h-3 w-3" />
                      </Button>
                      <Button size="sm" variant="ghost" className="text-white hover:bg-white hover:bg-opacity-20 p-1 sm:p-2">
                        <Maximize className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              {/* Camera Info */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 text-sm">
                <div>
                  <span className="text-gray-600">Resolution:</span>
                  <span className="ml-1 font-medium">{camera.resolution}</span>
                </div>
                <div>
                  <span className="text-gray-600">FPS:</span>
                  <span className="ml-1 font-medium">{camera.fps}</span>
                </div>
                <div>
                  <span className="text-gray-600">Audio:</span>
                  <span className={`ml-1 font-medium ${camera.audio ? 'text-green-600' : 'text-gray-500'}`}>
                    {camera.audio ? 'Enabled' : 'Disabled'}
                  </span>
                </div>
                <div>
                  <span className="text-gray-600">Last Motion:</span>
                  <span className="ml-1 font-medium">{camera.lastMotion}</span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-col sm:flex-row items-center gap-2 mt-4">
                <Button variant="outline" size="sm" className="w-full sm:flex-1">
                  <Camera className="h-3 w-3 mr-1" />
                  Full Screen
                </Button>
                <Button variant="outline" size="sm" className="w-full sm:flex-1">
                  <Settings className="h-3 w-3 mr-1" />
                  Settings
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* System Status */}
      <Card className="bg-white border border-[#4a5a6b]/30 shadow-sm">
        <CardHeader className="bg-green-50 border-b border-green-200">
            <CardTitle className="flex items-center gap-2 text-green-700 text-lg">
              <Activity className="h-5 w-5 text-[#0a1a3a]" />
              System Status
            </CardTitle>
          <CardDescription className="text-green-600">
            AI detection system performance metrics
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
            <div className="text-center p-3 sm:p-4 border border-gray-200 rounded-lg bg-green-50">
              <div className="text-xl sm:text-2xl font-bold text-green-600">4</div>
              <div className="text-xs sm:text-sm text-green-700 font-medium">Active Cameras</div>
            </div>
            <div className="text-center p-3 sm:p-4 border border-gray-200 rounded-lg bg-blue-50">
              <div className="text-xl sm:text-2xl font-bold text-blue-600">98.5%</div>
              <div className="text-xs sm:text-sm text-blue-700 font-medium">Detection Accuracy</div>
            </div>
            <div className="text-center p-3 sm:p-4 border border-gray-200 rounded-lg bg-purple-50">
              <div className="text-xl sm:text-2xl font-bold text-purple-600">2.1s</div>
              <div className="text-xs sm:text-sm text-purple-700 font-medium">Avg Response Time</div>
            </div>
            <div className="text-center p-3 sm:p-4 border border-gray-200 rounded-lg bg-orange-50">
              <div className="text-xl sm:text-2xl font-bold text-orange-600">2</div>
              <div className="text-xs sm:text-sm text-orange-700 font-medium">Active Alerts</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

