import { useEffect, useMemo, useState } from 'react'
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

export default function Dashboard() {
  const navigate = useNavigate()
  const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000'
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
          throw new Error(detail || 'Failed to load dashboard data')
        }
        const data: OverviewResponse = await res.json()
        if (!cancelled) setOverview(data)
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'Failed to load dashboard data'
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

  const stats = useMemo(() => {
    const totalVideos = overview?.total_videos ?? 0
    const totalDetections = overview?.total_detections ?? 0
    const modelAccuracy = '88.9%'
    const processingTime = '4s'

    return [
      { title: 'Videos Analyzed', value: `${totalVideos}`, icon: FileVideo, color: 'text-blue-600', bg: 'bg-blue-50' },
      { title: 'Anomalies Detected', value: `${totalDetections}`, icon: AlertTriangle, color: 'text-red-600', bg: 'bg-red-50' },
      { title: 'Accuracy', value: modelAccuracy, icon: Shield, color: 'text-green-600', bg: 'bg-green-50' },
      { title: 'Processing time/s', value: processingTime, icon: Activity, color: 'text-purple-600', bg: 'bg-purple-50' },
    ]
  }, [overview])

  const formatTimeAgo = (isoDate?: string) => {
    if (!isoDate) return 'Unknown'
    const diffMs = Date.now() - new Date(isoDate).getTime()
    const mins = Math.floor(diffMs / 60000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins} min ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs} hr ago`
    const days = Math.floor(hrs / 24)
    return `${days} day${days > 1 ? 's' : ''} ago`
  }

  const recentAnalyses = (overview?.recent_videos || [])
    .filter((v) => (v.status || '').toLowerCase() !== 'failed')
    .slice(0, 3)
    .map((v) => ({
      id: v.id,
      filename: v.original_filename || v.stored_filename || 'unknown_video.mp4',
      status: v.status || 'unknown',
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
      title: 'Upload Video', 
      description: 'Upload CCTV footage for AI analysis', 
      icon: Upload, 
      href: '/analysis', 
      primary: true
    },
    { 
      title: 'View Analytics', 
      description: 'Check system performance metrics', 
      icon: BarChart3, 
      href: '/analytics', 
      primary: false
    },
  ]

  return (
    <div className="space-y-6 sm:space-y-8">
      <div className="text-center px-4">
        <h2 className="text-2xl sm:text-3xl font-bold text-gray-900">Welcome to VisionGuard AI</h2>
        <p className="text-base sm:text-lg text-gray-600 mt-2">
          Upload your CCTV footage and let AI detect anomalies automatically
        </p>
        {loading && <p className="mt-2 text-sm text-gray-500">Loading dashboard data…</p>}
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <div className="mt-4 h-1 w-20 bg-[#4a5a6b] rounded-full mx-auto"></div>
      </div>

      {/* Stats Overview */}
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

      <div className="grid gap-6 grid-cols-1 lg:grid-cols-2 items-stretch">
        {/* Recent Analyses */}
        <Card className="h-full bg-white border border-[#4a5a6b]/30 shadow-sm hover:shadow-md transition-shadow hover:border-[#4a5a6b]/50">
          <CardHeader className="pb-3 sm:pb-4 border-b border-[#4a5a6b]/20">
            <CardTitle className="flex items-center gap-2 text-gray-800 text-lg">
              <FileVideo className="h-5 w-5 text-[#4a5a6b]" />
              Recent Analyses
            </CardTitle>
            <CardDescription>
              Latest video processing results
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
                        {analysis.status}
                      </Badge>
                    </div>
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 text-sm text-gray-600">
                      <span>Anomalies: {analysis.anomalies}</span>
                      {analysis.confidence > 0 && (
                        <span>Confidence: {analysis.confidence}%</span>
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
                    View
                    <ChevronRight className="h-3.5 w-3.5 ml-1" />
                  </Button>
                </div>
              )) : (
                <p className="text-sm text-gray-500 text-center py-6">
                  No analyses found yet. Upload a video in Video Analysis to populate this list.
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Quick Actions */}
        <Card className="h-full bg-white border border-[#4a5a6b]/30 shadow-sm hover:shadow-md transition-shadow hover:border-[#4a5a6b]/50">
          <CardHeader className="pb-3 sm:pb-4 border-b border-[#4a5a6b]/20">
            <CardTitle className="flex items-center gap-2 text-gray-800 text-lg">
              <Activity className="h-5 w-5 text-[#4a5a6b]" />
              Quick Actions
            </CardTitle>
            <CardDescription>
              Access system features
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
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#4a5a6b] text-white tracking-wide">PRIMARY</span>
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
