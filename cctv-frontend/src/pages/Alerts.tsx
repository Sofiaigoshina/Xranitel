import { Card, CardContent } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { 
  AlertTriangle, 
  Clock, 
  FileVideo, 
  Filter,
  Download,
  Eye,
  Trash2,
  Volume2,
  Activity,
  Shield
} from 'lucide-react'

export default function Alerts() {
  const alerts = [
    {
      id: 1,
      type: 'Suspicious Activity',
      description: 'Unusual movement pattern detected in uploaded video',
      filename: 'security_footage_001.mp4',
      timestamp: '2 min ago',
      severity: 'high',
      status: 'active',
      confidence: 94.5,
      videoTime: '1:23'
    },
    {
      id: 2,
      type: 'Gunshot Sound',
      description: 'Gunshot sound detected in audio analysis',
      filename: 'parking_lot_night.mp4',
      timestamp: '5 min ago',
      severity: 'critical',
      status: 'investigating',
      confidence: 98.2,
      videoTime: '2:45'
    },
    {
      id: 3,
      type: 'Crowd Gathering',
      description: 'Large group formation detected in video',
      filename: 'lobby_morning.mp4',
      timestamp: '8 min ago',
      severity: 'medium',
      status: 'resolved',
      confidence: 87.3,
      videoTime: '3:20'
    },
    {
      id: 4,
      type: 'Medical Emergency',
      description: 'Person appears to have fainted or fallen',
      filename: 'hallway_cam.mp4',
      timestamp: '12 min ago',
      severity: 'critical',
      status: 'resolved',
      confidence: 91.7,
      videoTime: '4:15'
    },
    {
      id: 5,
      type: 'Unauthorized Access',
      description: 'Person detected in restricted area',
      filename: 'server_room.mp4',
      timestamp: '15 min ago',
      severity: 'high',
      status: 'active',
      confidence: 96.1,
      videoTime: '0:45'
    }
  ]

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
      case 'investigating': return 'default'
      case 'resolved': return 'secondary'
      default: return 'outline'
    }
  }

  const getSeverityBg = (severity: string) => {
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

  return (
    <div className="space-y-6">
      <div className="px-4 sm:px-0">
        <h2 className="text-xl sm:text-2xl font-bold text-gray-900">Security Alerts</h2>
        <p className="text-sm sm:text-base text-gray-600 mt-1">
          AI-detected anomalies from your video analysis
        </p>
        <div className="mt-3 h-1 w-16 bg-[#4a5a6b] rounded-full"></div>
      </div>

      {/* Alert Summary */}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="bg-white border border-gray-200 shadow-sm hover:shadow-md transition-shadow hover:border-[#4a5a6b]/20">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Total Alerts</p>
                <p className="text-2xl font-bold text-gray-900">{alerts.length}</p>
              </div>
              <div className="p-2 rounded-lg bg-[#4a5a6b]/10 border border-[#4a5a6b]/20">
                <AlertTriangle className="h-5 w-5 text-[#4a5a6b]" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-white border border-gray-200 shadow-sm hover:shadow-md transition-shadow hover:border-[#4a5a6b]/20">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Active Alerts</p>
                <p className="text-2xl font-bold text-red-600">
                  {alerts.filter(alert => alert.status === 'active').length}
                </p>
              </div>
              <div className="p-2 rounded-lg bg-red-50 border border-[#4a5a6b]/10">
                <Activity className="h-5 w-5 text-red-600" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-white border border-gray-200 shadow-sm hover:shadow-md transition-shadow hover:border-[#4a5a6b]/20">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Critical</p>
                <p className="text-2xl font-bold text-red-600">
                  {alerts.filter(alert => alert.severity === 'critical').length}
                </p>
              </div>
              <div className="p-2 rounded-lg bg-red-50 border border-[#4a5a6b]/10">
                <AlertTriangle className="h-5 w-5 text-red-600" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-white border border-gray-200 shadow-sm hover:shadow-md transition-shadow hover:border-[#4a5a6b]/20">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Resolved</p>
                <p className="text-2xl font-bold text-green-600">
                  {alerts.filter(alert => alert.status === 'resolved').length}
                </p>
              </div>
              <div className="p-2 rounded-lg bg-green-50 border border-[#4a5a6b]/10">
                <Shield className="h-5 w-5 text-green-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filter and Export */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" className="border-gray-300">
            <Filter className="h-4 w-4 mr-2" />
            <span className="hidden sm:inline">Filter</span>
          </Button>
          <Button variant="outline" size="sm" className="border-gray-300">
            <Download className="h-4 w-4 mr-2" />
            <span className="hidden sm:inline">Export</span>
          </Button>
        </div>
      </div>

      {/* Alerts List */}
      <div className="space-y-4">
        {alerts.map((alert) => {
          const TypeIcon = getTypeIcon(alert.type)
          return (
            <Card key={alert.id} className={`bg-white border shadow-sm ${getSeverityBg(alert.severity)}`}>
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
                        {alert.timestamp}
                      </div>
                      <div className="text-gray-500">
                        Video Time: {alert.videoTime}
                      </div>
                    </div>
                  </div>

                  {/* Confidence and actions */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-gray-200">
                    <div className="text-sm font-medium text-gray-900">
                      Confidence: {alert.confidence}%
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" className="border-gray-300 flex-1 sm:flex-none">
                        <Eye className="h-3 w-3 mr-1" />
                        View
                      </Button>
                      <Button variant="outline" size="sm" className="border-gray-300 flex-1 sm:flex-none">
                        <Trash2 className="h-3 w-3 mr-1" />
                        Dismiss
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
