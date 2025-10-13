import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { 
  Upload, 
  Play, 
  Download,
  AlertTriangle,
  Volume2,
  Settings,
  FileVideo,
} from 'lucide-react'

export default function VideoAnalysis() {
  const [anomalyTypes, setAnomalyTypes] = useState([
    { id: 'suspicious_activity', name: 'Suspicious Activity', enabled: true, type: 'visual', description: 'Unusual behavior patterns and movements' },
    { id: 'crowd_gathering', name: 'Crowd Gathering', enabled: true, type: 'visual', description: 'Large group formations and gatherings' },
    { id: 'medical_emergency', name: 'Medical Emergency', enabled: false, type: 'visual', description: 'Person falling, fainting, or medical distress' },
    { id: 'unauthorized_access', name: 'Unauthorized Access', enabled: true, type: 'visual', description: 'Access to restricted areas' },
    { id: 'gunshot_sound', name: 'Gunshot Sound', enabled: true, type: 'audio', description: 'Gunshot or explosive sounds' },
    { id: 'scream_sound', name: 'Scream Sound', enabled: true, type: 'audio', description: 'Screams or distress calls' },
    { id: 'glass_breaking', name: 'Glass Breaking', enabled: false, type: 'audio', description: 'Glass shattering sounds' },
  ])

  const toggleAnomaly = (id: string) => {
    setAnomalyTypes(prev => 
      prev.map(anomaly => 
        anomaly.id === id 
          ? { ...anomaly, enabled: !anomaly.enabled }
          : anomaly
      )
    )
  }

  // const recentAnalyses = [
  //   { id: 1, filename: 'security_footage_001.mp4', status: 'completed', anomalies: 3, duration: '2:45', timestamp: '2024-01-15 14:30', confidence: 94 },
  //   { id: 2, filename: 'parking_lot_night.mp4', status: 'processing', anomalies: 0, duration: '5:12', timestamp: '2024-01-15 14:25', confidence: 0 },
  //   { id: 3, filename: 'lobby_morning.mp4', status: 'completed', anomalies: 1, duration: '3:20', timestamp: '2024-01-15 14:20', confidence: 87 },
  // ]

  return (
    <div className="space-y-6">
      <div className="px-4 sm:px-0">
        <h2 className="text-xl sm:text-2xl font-bold text-gray-900">Video Analysis</h2>
        <p className="text-sm sm:text-base text-gray-600 mt-1">
          Upload and analyze CCTV footage with AI-powered anomaly detection
        </p>
        <div className="mt-3 h-1 w-16 bg-[#4a5a6b] rounded-full"></div>
      </div>

      <div className="grid gap-4 sm:gap-6 grid-cols-1 lg:grid-cols-2">
        {/* Upload Section */}
        <Card className="bg-white border border-gray-200 shadow-sm hover:shadow-md transition-shadow hover:border-[#4a5a6b]/20">
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
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-4 sm:p-6 text-center hover:border-gray-400 transition-colors">
              <FileVideo className="h-8 w-8 sm:h-12 sm:w-12 text-gray-400 mx-auto mb-3" />
              <h3 className="font-medium text-gray-900 mb-2 text-sm sm:text-base">Drop video files here</h3>
              <p className="text-gray-600 mb-3 text-xs sm:text-sm">or click to browse files</p>
              <Button 
                variant="outline" 
                size="sm" 
                className="mb-2 text-xs sm:text-sm border-[#4a5a6b] text-[#4a5a6b] hover:bg-[#4a5a6b] hover:text-white"
              >
                <Upload className="h-3 w-3 sm:h-4 sm:w-4 mr-1" />
                Choose Files
              </Button>
              <p className="text-xs sm:text-sm text-gray-500">
                MP4, AVI, MOV up to 5GB
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Anomaly Selection */}
        <Card className="bg-white border border-gray-200 shadow-sm hover:shadow-md transition-shadow hover:border-[#4a5a6b]/20">
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
      <Card className="bg-white border border-gray-200 shadow-sm hover:shadow-md transition-shadow hover:border-[#0a1a3a]/20">
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
            <div className="flex flex-col sm:flex-row sm:items-center justify-between p-3 sm:p-4 border border-red-200 rounded-lg bg-red-50 gap-3">
              <div className="space-y-1 flex-1 min-w-0">
                <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                  <span className="font-medium text-red-900 truncate">Suspicious Activity Detected</span>
                  <Badge variant="destructive" className="flex-shrink-0">High Priority</Badge>
                </div>
                <div className="text-sm text-red-700">
                  Video: security_footage_001.mp4 • Time: 1:23 • Confidence: 94%
                </div>
                <div className="text-sm text-red-600">
                  Person loitering near restricted area for extended period
                </div>
              </div>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <Button variant="outline" size="sm" className="flex-1 sm:flex-none">
                  <Play className="h-3 w-3 mr-1" />
                  Review
                </Button>
                <Button variant="outline" size="sm" className="flex-1 sm:flex-none">
                  <Download className="h-3 w-3 mr-1" />
                  Export
                </Button>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between p-3 sm:p-4 border border-yellow-200 rounded-lg bg-yellow-50 gap-3">
              <div className="space-y-1 flex-1 min-w-0">
                <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                  <span className="font-medium text-yellow-900 truncate">Unusual Sound Detected</span>
                  <Badge variant="secondary" className="flex-shrink-0">Medium Priority</Badge>
                </div>
                <div className="text-sm text-yellow-700">
                  Video: parking_lot_night.mp4 • Time: 2:45 • Confidence: 87%
                </div>
                <div className="text-sm text-yellow-600">
                  Loud noise detected - possible glass breaking
                </div>
              </div>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <Button variant="outline" size="sm" className="flex-1 sm:flex-none">
                  <Play className="h-3 w-3 mr-1" />
                  Review
                </Button>
                <Button variant="outline" size="sm" className="flex-1 sm:flex-none">
                  <Download className="h-3 w-3 mr-1" />
                  Export
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
