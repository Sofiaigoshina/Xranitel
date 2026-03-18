import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, CardContent } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { 
  AlertTriangle, 
  Clock, 
  FileVideo, 
  Filter,
  Search,
  Eye,
  Volume2,
  Activity,
  Shield,
  CheckCircle2,
  RotateCcw,
  Loader2,
} from 'lucide-react'

type AlertStatus = 'active' | 'resolved'
type AlertSeverity = 'critical' | 'high' | 'medium' | 'low'

interface AlertItem {
  id: string
  video_id: string | null
  type: string
  description: string
  filename: string
  timestamp: string | null
  resolved_at?: string | null
  severity: AlertSeverity
  status: AlertStatus
  confidence: number
  video_time_seconds: number
  video_time: string
}

interface AlertsResponse {
  summary: {
    total: number
    active: number
    resolved: number
  }
  alerts: AlertItem[]
}

export default function Alerts() {
  const navigate = useNavigate()
  const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000'
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<'all' | AlertStatus>('all')
  const [searchInput, setSearchInput] = useState('')
  const [videoSearch, setVideoSearch] = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [resolvingAlertId, setResolvingAlertId] = useState<string | null>(null)
  const [alertsData, setAlertsData] = useState<AlertsResponse>({
    summary: { total: 0, active: 0, resolved: 0 },
    alerts: [],
  })

  useEffect(() => {
    const controller = new AbortController()

    const fetchAlerts = async () => {
      try {
        setLoading(true)
        setError(null)
        const params = new URLSearchParams()
        if (statusFilter !== 'all') params.set('status', statusFilter)
        if (videoSearch.trim()) params.set('video_search', videoSearch.trim())
        const qs = params.toString() ? `?${params.toString()}` : ''
        const res = await fetch(`${API_BASE}/alerts${qs}`, { signal: controller.signal })
        if (!res.ok) {
          const err = await res.json().catch(() => ({ detail: res.statusText }))
          const detail =
            typeof err?.detail === 'string'
              ? err.detail
              : err?.detail?.message || err?.message || res.statusText
          throw new Error(detail || 'Failed to load alerts')
        }
        const json = (await res.json()) as AlertsResponse
        setAlertsData(json)
      } catch (err: unknown) {
        if ((err as Error).name === 'AbortError') return
        setError(err instanceof Error ? err.message : 'Unknown error')
      } finally {
        setLoading(false)
      }
    }

    fetchAlerts()
    return () => controller.abort()
  }, [API_BASE, statusFilter, videoSearch])

  const refetchAlerts = async () => {
    const params = new URLSearchParams()
    if (statusFilter !== 'all') params.set('status', statusFilter)
    if (videoSearch.trim()) params.set('video_search', videoSearch.trim())
    const qs = params.toString() ? `?${params.toString()}` : ''
    const res = await fetch(`${API_BASE}/alerts${qs}`)
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }))
      const detail =
        typeof err?.detail === 'string'
          ? err.detail
          : err?.detail?.message || err?.message || res.statusText
      throw new Error(detail || 'Failed to refresh alerts')
    }
    const json = (await res.json()) as AlertsResponse
    setAlertsData(json)
  }

  const alerts = useMemo(() => alertsData.alerts, [alertsData.alerts])

  const videoSuggestions = useMemo(() => {
    const uniqueNames = Array.from(
      new Set(
        alertsData.alerts
          .map((a) => (a.filename || '').trim())
          .filter(Boolean)
      )
    )

    const q = searchInput.trim().toLowerCase()
    if (!q) return uniqueNames.slice(0, 8)

    return uniqueNames
      .filter((name) => name.toLowerCase().includes(q))
      .slice(0, 8)
  }, [alertsData.alerts, searchInput])

  const formatRelativeTime = (iso: string | null) => {
    if (!iso) return 'Unknown time'
    const dt = new Date(iso)
    if (Number.isNaN(dt.getTime())) return 'Unknown time'
    const diffMs = Date.now() - dt.getTime()
    const sec = Math.max(1, Math.floor(diffMs / 1000))
    if (sec < 60) return `${sec}s ago`
    const min = Math.floor(sec / 60)
    if (min < 60) return `${min} min ago`
    const hr = Math.floor(min / 60)
    if (hr < 24) return `${hr}h ago`
    const day = Math.floor(hr / 24)
    return `${day}d ago`
  }

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'destructive'
      case 'high': return 'default'
      case 'medium': return 'secondary'
      case 'low': return 'outline'
      default: return 'outline'
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'destructive'
      case 'resolved': return 'secondary'
      default: return 'outline'
    }
  }

  const getAlertCardBg = (status: AlertStatus, severity: string) => {
    if (status === 'resolved') return 'bg-green-50 border-green-200'

    switch (severity) {
      case 'critical': return 'bg-red-50 border-red-200'
      case 'high': return 'bg-orange-50 border-orange-200'
      case 'medium': return 'bg-yellow-50 border-yellow-200'
      case 'low': return 'bg-blue-50 border-blue-200'
      default: return 'bg-gray-50 border-gray-200'
    }
  }

  const getTypeIcon = (type: string) => {
    if (type.includes('Sound') || type.includes('Audio')) {
      return Volume2
    }
    return AlertTriangle
  }

  const handleToggleResolveAlert = async (alert: AlertItem) => {
    try {
      setResolvingAlertId(alert.id)
      const res = await fetch(`${API_BASE}/alerts/${encodeURIComponent(alert.id)}/toggle-resolve`, {
        method: 'POST',
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }))
        const detail =
          typeof err?.detail === 'string'
            ? err.detail
            : err?.detail?.message || err?.message || res.statusText
        throw new Error(detail || 'Failed to update alert status')
      }
      await refetchAlerts()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update alert status')
    } finally {
      setResolvingAlertId(null)
    }
  }

  const handleViewAlert = (alert: AlertItem) => {
    if (!alert.video_id) return
    navigate(
      `/analysis?videoId=${encodeURIComponent(alert.video_id)}&file=${encodeURIComponent(alert.filename)}&t=${encodeURIComponent(String(alert.video_time_seconds))}`,
      {
        state: {
          fromAlerts: true,
          selectedVideoId: alert.video_id,
          selectedFilename: alert.filename,
          selectedAlertTime: alert.video_time_seconds,
          selectedAlertId: alert.id,
          selectedAlertType: alert.type,
        },
      }
    )
  }

  const applySuggestion = (name: string) => {
    setSearchInput(name)
    setVideoSearch(name)
    setShowSuggestions(false)
  }

  return (
    <div className="space-y-6">
      <div className="px-4 sm:px-0">
        <h2 className="text-xl sm:text-2xl font-bold text-gray-900">Security Alerts</h2>
        <p className="text-sm sm:text-base text-gray-600 mt-1">
          AI-detected anomalies from your video analysis
        </p>
        <div className="mt-3 h-1 w-16 bg-[#4a5a6b] rounded-full"></div>
      </div>

      {/* Search */}
      <div className="w-full flex justify-center px-4 sm:px-0">
        <div className="relative w-full">
          <Search className="h-5 w-5 text-gray-400 absolute left-4 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => {
              const value = e.target.value
              setSearchInput(value)
              setVideoSearch(value)
              setShowSuggestions(true)
            }}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 120)}
            placeholder="Search alerts by video name..."
            className="w-full h-12 rounded-xl border border-gray-300 bg-white pl-12 pr-4 text-base text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#4a5a6b]/30 focus:border-[#4a5a6b]/40 shadow-sm"
          />

          {showSuggestions && videoSuggestions.length > 0 && (
            <div className="absolute z-20 mt-2 w-full rounded-xl border border-gray-200 bg-white shadow-lg overflow-hidden">
              {videoSuggestions.map((name) => (
                <button
                  key={name}
                  type="button"
                  className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    applySuggestion(name)
                  }}
                  onClick={() => applySuggestion(name)}
                >
                  {name}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Alert Summary */}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        <Card className="bg-white border border-[#4a5a6b]/30 shadow-sm hover:shadow-md transition-shadow hover:border-[#4a5a6b]/50">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Total Alerts</p>
                <p className="text-2xl font-bold text-gray-900">{alertsData.summary.total}</p>
              </div>
              <div className="p-2 rounded-lg bg-[#4a5a6b]/10 border border-[#4a5a6b]/20">
                <AlertTriangle className="h-5 w-5 text-[#4a5a6b]" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-white border border-[#4a5a6b]/30 shadow-sm hover:shadow-md transition-shadow hover:border-[#4a5a6b]/50">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Active Alerts</p>
                <p className="text-2xl font-bold text-red-600">
                  {alertsData.summary.active}
                </p>
              </div>
              <div className="p-2 rounded-lg bg-red-50 border border-[#4a5a6b]/10">
                <Activity className="h-5 w-5 text-red-600" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-white border border-[#4a5a6b]/30 shadow-sm hover:shadow-md transition-shadow hover:border-[#4a5a6b]/50">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Resolved</p>
                <p className="text-2xl font-bold text-green-600">
                  {alertsData.summary.resolved}
                </p>
              </div>
              <div className="p-2 rounded-lg bg-green-50 border border-[#4a5a6b]/10">
                <Shield className="h-5 w-5 text-green-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filter */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={statusFilter === 'all' ? 'default' : 'outline'}
            size="sm"
            className={statusFilter === 'all' ? 'bg-[#4a5a6b] hover:bg-[#3e4c5d]' : 'border-gray-300'}
            onClick={() => setStatusFilter('all')}
          >
            <Filter className="h-4 w-4 mr-2" />
            <span className="hidden sm:inline">All</span>
          </Button>
          <Button variant={statusFilter === 'active' ? 'default' : 'outline'} size="sm" className={statusFilter === 'active' ? 'bg-red-600 hover:bg-red-700' : 'border-gray-300'} onClick={() => setStatusFilter('active')}>
            Active
          </Button>
          <Button variant={statusFilter === 'resolved' ? 'default' : 'outline'} size="sm" className={statusFilter === 'resolved' ? 'bg-green-600 hover:bg-green-700' : 'border-gray-300'} onClick={() => setStatusFilter('resolved')}>
            Resolved
          </Button>
          </div>
        </div>
      </div>

      {/* Alerts List */}
      <div className="space-y-4">
        {loading && (
          <Card className="bg-white border border-[#4a5a6b]/30 shadow-sm">
            <CardContent className="p-6 flex items-center gap-2 text-gray-600">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading alerts from backend...
            </CardContent>
          </Card>
        )}

        {!loading && error && (
          <Card className="bg-white border border-red-200 shadow-sm">
            <CardContent className="p-6 text-sm text-red-700">
              Failed to load alerts: {error}
            </CardContent>
          </Card>
        )}

        {!loading && !error && alerts.length === 0 && (
          <Card className="bg-white border border-[#4a5a6b]/30 shadow-sm">
            <CardContent className="p-6 text-sm text-gray-600">No alerts found for this filter.</CardContent>
          </Card>
        )}

        {alerts.map((alert) => {
          const TypeIcon = getTypeIcon(alert.type)
          return (
            <Card key={alert.id} className={`bg-white border border-[#4a5a6b]/30 shadow-sm ${getAlertCardBg(alert.status, alert.severity)}`}>
              <CardContent className="p-4">
                {/* Mobile-first layout */}
                <div className="space-y-3">
                  {/* Header with type and badges */}
                  <div className="flex flex-col space-y-2">
                    <div className="flex items-center gap-2">
                      <TypeIcon className="h-4 w-4 text-gray-600 flex-shrink-0" />
                      <h3 className="font-semibold text-gray-900 text-base">{alert.type}</h3>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge 
                        variant={getSeverityColor(alert.severity)}
                        className="text-xs"
                      >
                        {alert.severity}
                      </Badge>
                      <Badge 
                        variant={getStatusColor(alert.status)}
                        className="text-xs"
                      >
                        {alert.status}
                      </Badge>
                    </div>
                  </div>

                  {/* Description */}
                  <p className="text-sm text-gray-700 leading-relaxed">{alert.description}</p>

                  {/* File info - stacked on mobile */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-1 text-sm text-gray-600">
                      <FileVideo className="h-3 w-3 flex-shrink-0" />
                      <span className="truncate">{alert.filename}</span>
                    </div>
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2 text-sm text-gray-600">
                      <div className="flex items-center gap-1">
                        <Clock className="h-3 w-3 flex-shrink-0" />
                        {formatRelativeTime(alert.timestamp)}
                      </div>
                      <div className="text-gray-500">
                        Video Time: {alert.video_time}
                      </div>
                    </div>
                  </div>

                  {/* Confidence and actions */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-gray-200">
                    <div className="text-sm font-medium text-gray-900">
                      Confidence: {alert.confidence}%
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="default"
                        size="sm"
                        className={`shadow-sm font-semibold flex-1 sm:flex-none border ${
                          alert.status === 'resolved'
                            ? 'bg-amber-500 hover:bg-amber-600 text-white border-amber-500'
                            : 'bg-green-600 hover:bg-green-700 text-white border-green-600'
                        }`}
                        onClick={() => handleToggleResolveAlert(alert)}
                        disabled={resolvingAlertId === alert.id}
                      >
                        {resolvingAlertId === alert.id ? (
                          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                        ) : alert.status === 'resolved' ? (
                          <RotateCcw className="h-3 w-3 mr-1" />
                        ) : (
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                        )}
                        {alert.status === 'resolved' ? 'Mark Active' : 'Mark Resolved'}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-gray-300 flex-1 sm:flex-none"
                        onClick={() => handleViewAlert(alert)}
                        disabled={!alert.video_id}
                        title={alert.video_id ? 'Open video at alert timestamp' : 'Video not available'}
                      >
                        <Eye className="h-3 w-3 mr-1" />
                        View
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
