import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'

import {
  Upload,
  AlertTriangle,
  Activity,
  Shield,
  Clock,
  FileVideo,
  BarChart3,
  ArrowRight,
  ChevronRight,
} from 'lucide-react'

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000'

const DEFAULT_STATS = {
  accuracy: '88.9%',
  processingTime: '4с',
}

type OverviewResponse = {
  total_videos: number
  processing_videos: number
  completed_videos: number
  failed_videos: number
  total_detections: number
  anomaly_breakdown: Array<{ anomaly_id: string; count: number }>
  recent_videos: Array<{
    id: string
    original_filename?: string
    stored_filename?: string
    status: string
    created_at?: string
    completed_at?: string | null
    total_detections?: number
    selected_anomalies?: string[]
  }>
}

// Данные камер с видеофайлами
const cameras = [
  { id: 1, name: 'Вход главный', status: 'online', location: 'Здание А - 1 этаж', videoFile: '/videos/cam1.mp4' },
  { id: 2, name: 'Коридор - 1 этаж', status: 'online', location: 'Здание А - 1 этаж', videoFile: '/videos/cam2.mp4' },
  { id: 3, name: 'Спортзал', status: 'online', location: 'Здание А - 1 этаж', videoFile: '/videos/cam3.mp4' },
  { id: 4, name: 'Кабинет 10', status: 'online', location: 'Здание А - 2 этаж', videoFile: '/videos/cam4.mp4' },
  { id: 5, name: 'Актовый зал', status: 'online', location: 'Здание А - 2 этаж', videoFile: '/videos/cam5.mp4' },
  { id: 6, name: 'Коридор - 2 этаж', status: 'online', location: 'Здание А - 2 этаж', videoFile: '/videos/cam6.mp4' },
  { id: 7, name: 'Столовая', status: 'online', location: 'Здание А - 1 этаж', videoFile: '/videos/cam7.mp4' },
  { id: 8, name: 'Коридор', status: 'online', location: 'Здание А - 1 этаж', videoFile: '/videos/cam8.mp4' },
  { id: 9, name: 'Хозяйственная зона', status: 'online', location: 'Территория', videoFile: '/videos/cam9.mp4' },
  { id: 10, name: 'Задний двор', status: 'online', location: 'Территория', videoFile: '/videos/cam10.mp4' },
  { id: 11, name: 'Выход из спортзала', status: 'online', location: 'Территория', videoFile: '/videos/cam11.mp4' },
  { id: 12, name: 'Северная сторона', status: 'online', location: 'Территория', videoFile: '/videos/cam12.mp4' },
]

// Компонент для видеоплеера с автовоспроизведением и зацикливанием
function CameraVideo({ src, isOnline }: { src: string | null; isOnline: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (videoRef.current && isOnline && src) {
      videoRef.current.play().catch(e => console.log('Video play error:', e))
    }
  }, [src, isOnline])

  if (!isOnline || !src) {
    return (
      <div className="bg-black rounded-lg aspect-video flex items-center justify-center mb-2">
        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
          <circle cx="12" cy="13" r="4"/>
        </svg>
      </div>
    )
  }

  return (
    <div className="bg-black rounded-lg aspect-video flex items-center justify-center mb-2 overflow-hidden">
      <video
        ref={videoRef}
        src={src}
        autoPlay
        loop
        muted
        playsInline
        className="w-full h-full object-cover"
      />
    </div>
  )
}

export default function Dashboard() {
  const navigate = useNavigate()
  const [overview, setOverview] = useState<OverviewResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const fetchOverview = async () => {
      try {
        setLoading(true)
        setError(null)
        const res = await fetch(`${API_BASE}/stats/overview`)
        if (!res.ok) {
          const err = await res.json().catch(() => ({ detail: res.statusText }))
          const detail =
            typeof err?.detail === 'string'
              ? err.detail
              : err?.detail?.message || err?.message || res.statusText
          throw new Error(detail || 'Не удалось загрузить данные панели управления')
        }
        const data: OverviewResponse = await res.json()
        if (!cancelled) setOverview(data)
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'Не удалось загрузить данные панели управления'
          setError(message)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchOverview()
    return () => {
      cancelled = true
    }
  }, [API_BASE])

  const formatTimeAgo = (isoDate?: string): string => {
    if (!isoDate) return 'Неизвестно'
    const diffMs = Date.now() - new Date(isoDate).getTime()
    const mins = Math.floor(diffMs / 60000)
    if (mins < 1) return 'только что'
    if (mins < 60) return `${mins} мин назад`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs} ч назад`
    const days = Math.floor(hrs / 24)
    const daysText = days === 1 ? 'день' : (days >= 2 && days <= 4) ? 'дня' : 'дней'
    return `${days} ${daysText} назад`
  }

  const stats = [
    {
      title: 'Видео проанализировано',
      value: String(overview?.total_videos ?? 0),
      icon: FileVideo,
      color: 'text-blue-600',
      bg: 'bg-blue-50',
    },
    {
      title: 'Обнаружено угроз',
      value: String(overview?.total_detections ?? 0),
      icon: AlertTriangle,
      color: 'text-red-600',
      bg: 'bg-red-50',
    },
    {
      title: 'Точность',
      value: DEFAULT_STATS.accuracy,
      icon: Shield,
      color: 'text-green-600',
      bg: 'bg-green-50',
    },
    {
      title: 'Время обработки',
      value: DEFAULT_STATS.processingTime,
      icon: Activity,
      color: 'text-purple-600',
      bg: 'bg-purple-50',
    },
  ]

  const recentAnalyses = (overview?.recent_videos ?? [])
    .filter((v) => (v.status || '').toLowerCase() !== 'failed')
    .slice(0, 3)
    .map((v) => ({
      id: v.id,
      filename: v.original_filename || v.stored_filename || 'неизвестное_видео.mp4',
      status: v.status || 'неизвестно',
      anomalies: v.total_detections || 0,
      time: formatTimeAgo(v.created_at),
      confidence: 0,
    }))

  const statusBadgeClass = (status: string) => {
    switch (status.toLowerCase()) {
      case 'completed':
        return 'bg-green-100 text-green-700 border-green-200'
      case 'processing':
        return 'bg-blue-100 text-blue-700 border-blue-200'
      case 'failed':
        return 'bg-red-100 text-red-700 border-red-200'
      default:
        return 'bg-yellow-100 text-yellow-700 border-yellow-200'
    }
  }

  const statusText = (status: string) => {
    switch (status.toLowerCase()) {
      case 'completed':
        return 'Завершено'
      case 'processing':
        return 'Обработка'
      case 'failed':
        return 'Ошибка'
      default:
        return status
    }
  }

  const handleViewAnalysis = (analysis: { id: string; filename: string; status: string; anomalies: number }) => {
    navigate(`/analysis?videoId=${encodeURIComponent(analysis.id)}&file=${encodeURIComponent(analysis.filename)}`, {
      state: {
        fromDashboard: true,
        selectedVideoId: analysis.id,
        selectedFilename: analysis.filename,
        selectedStatus: analysis.status,
        selectedAnomalies: analysis.anomalies,
      },
    })
  }

  const quickActions = [
    {
      title: 'Загрузить видео',
      description: 'Загрузите видео с камер для анализа',
      icon: Upload,
      href: '/analysis',
      primary: true,
    },
    {
      title: 'Просмотр аналитики',
      description: 'Проверьте метрики производительности системы',
      icon: BarChart3,
      href: '/analytics',
      primary: false,
    },
  ]

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* ПРИВЕТСТВИЕ */}
      <div className="text-center px-4">
        <h2 className="text-2xl sm:text-3xl font-bold text-gray-900">Добро пожаловать в интеллектуальную систему «Хранитель»!</h2>
        <div className="mt-4 h-1 w-20 bg-[#4a5a6b] rounded-full mx-auto"></div>
      </div>

      {/* БЛОК ВИДЕОНАБЛЮДЕНИЯ */}
      <div>
        <h3 className="text-xl sm:text-2xl font-bold text-gray-900 mb-2">Видеонаблюдение</h3>
        <div className="mt-3 h-1 w-50 bg-[#4a5a6b] rounded-full mb-6"></div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {cameras.map((cam) => (
            <div key={cam.id} className="rounded-xl bg-white p-4 shadow-sm border border-[#4a5a6b]/30 hover:shadow-md transition-all">
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-bold text-gray-900">{cam.name}</h4>
                <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                  cam.status === 'online'
                    ? 'bg-green-100 text-green-700'
                    : 'bg-red-100 text-red-700'
                }`}>
                  {cam.status === 'online' ? 'Online' : 'Offline'}
                </span>
              </div>

              {/* Видео или заглушка */}
              <CameraVideo src={cam.videoFile} isOnline={cam.status === 'online'} />
              <p className="text-xs text-gray-400 text-center mt-1">{cam.location}</p>
            </div>
          ))}
        </div>
      </div>

  

      {/* СТАТИСТИКА */}
      {loading && <p className="mt-2 text-sm text-gray-500 text-center">Загрузка данных панели управления…</p>}
      {error && <p className="mt-2 text-sm text-red-600 text-center">{error}</p>}

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.title} className="bg-white border border-[#4a5a6b]/30 shadow-sm hover:shadow-md transition-shadow hover:border-[#4a5a6b]/50">
            <CardContent className="p-4 sm:p-6">
              <div className="flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <p className="text-xs sm:text-sm font-medium text-gray-600 truncate">{stat.title}</p>
                  <p className="text-xl sm:text-2xl font-bold text-gray-900">{stat.value}</p>
                </div>
                <div className={`p-2 sm:p-3 rounded-xl ${stat.bg} flex-shrink-0 border border-[#4a5a6b]/10`}>
                  <stat.icon className={`h-5 w-5 sm:h-6 sm:w-6 ${stat.color}`} />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* НЕДАВНИЕ АНАЛИЗЫ И БЫСТРЫЕ ДЕЙСТВИЯ */}
      <div className="grid gap-6 grid-cols-1 lg:grid-cols-2 items-stretch">
        {/* Недавние анализы */}
        <Card className="h-full bg-white border border-[#4a5a6b]/30 shadow-sm hover:shadow-md transition-shadow hover:border-[#4a5a6b]/50">
          <CardHeader className="pb-3 sm:pb-4 border-b border-[#4a5a6b]/20">
            <CardTitle className="flex items-center gap-2 text-gray-800 text-lg">
              <FileVideo className="h-5 w-5 text-[#4a5a6b]" />
              Недавние анализы
            </CardTitle>
            <CardDescription>
              Результаты последней обработки видео
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-4 sm:pt-5 flex flex-col">
            <div className="space-y-3 flex-1">
              {recentAnalyses.length > 0 ? recentAnalyses.map((analysis) => (
                <div key={analysis.id} className="group flex flex-col sm:flex-row sm:items-center justify-between p-4 border border-gray-200 rounded-xl bg-white hover:bg-gray-50/80 hover:border-[#4a5a6b]/30 transition-all gap-3">
                  <div className="space-y-1.5 flex-1 min-w-0">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                      <span className="font-medium text-gray-900 truncate">{analysis.filename}</span>
                      <Badge
                        variant={analysis.status === 'completed' ? 'default' : 'secondary'}
                        className={`${statusBadgeClass(analysis.status)} border flex-shrink-0`}
                      >
                        {statusText(analysis.status)}
                      </Badge>
                    </div>
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 text-sm text-gray-600">
                      <span>Угроз: {analysis.anomalies}</span>
                      {analysis.confidence > 0 && (
                        <span>Уверенность: {analysis.confidence}%</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 text-sm text-gray-500">
                      <Clock className="h-3 w-3" />
                      {analysis.time}
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-shrink-0 w-full sm:w-auto border-[#4a5a6b]/30 text-[#4a5a6b] hover:bg-[#4a5a6b] hover:text-white rounded-lg"
                    onClick={() => handleViewAnalysis(analysis)}
                  >
                    Просмотр
                    <ChevronRight className="h-3.5 w-3.5 ml-1" />
                  </Button>
                </div>
              )) : (
                <p className="text-sm text-gray-500 text-center py-6">
                  Анализы пока не найдены. Загрузите видео в разделе "Анализ видео", чтобы заполнить этот список.
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Быстрые действия */}
        <Card className="h-full bg-white border border-[#4a5a6b]/30 shadow-sm hover:shadow-md transition-shadow hover:border-[#4a5a6b]/50">
          <CardHeader className="pb-3 sm:pb-4 border-b border-[#4a5a6b]/20">
            <CardTitle className="flex items-center gap-2 text-gray-800 text-lg">
              <Activity className="h-5 w-5 text-[#4a5a6b]" />
              Быстрые действия
            </CardTitle>
            <CardDescription>
              Доступ к функциям системы
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-4 sm:pt-5 flex flex-col">
            <div className="space-y-3 flex-1">
              {quickActions.map((action) => (
                <button
                  key={action.title}
                  type="button"
                  className={`group w-full rounded-xl border p-4 text-left transition-all hover:shadow-sm ${
                    action.primary
                      ? 'border-[#4a5a6b]/35 bg-[#4a5a6b]/5 hover:bg-[#4a5a6b]/10'
                      : 'border-gray-200 bg-white hover:bg-gray-50/80 hover:border-[#4a5a6b]/25'
                  }`}
                  onClick={() => navigate(action.href)}
                >
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg border ${action.primary ? 'bg-[#4a5a6b] border-[#4a5a6b] text-white' : 'bg-[#4a5a6b]/10 border-[#4a5a6b]/20 text-[#4a5a6b]'}`}>
                      <action.icon className="h-4 w-4 sm:h-5 sm:w-5 flex-shrink-0" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <div className="font-semibold text-sm sm:text-base text-gray-800">{action.title}</div>
                        {action.primary && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#4a5a6b] text-white tracking-wide">ОСНОВНОЕ</span>
                        )}
                      </div>
                      <div className="text-xs sm:text-sm text-gray-600 truncate">{action.description}</div>
                    </div>
                    <ArrowRight className="h-4 w-4 text-gray-400 group-hover:text-[#4a5a6b] transition-colors" />
                  </div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}