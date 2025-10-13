import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import { 
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Clock,
  Download,
  Volume2,
  Eye,
  Shield,
  Activity,
  MapPin,
  Target,
  Thermometer,
} from 'lucide-react'

export default function Analytics() {
  const anomalyTrends = [
    { type: 'Suspicious Activity', current: 12, previous: 8, trend: 'up', change: '+50%', icon: Eye, color: 'text-red-600', bg: 'bg-red-50' },
    { type: 'Audio Anomalies', current: 6, previous: 9, trend: 'down', change: '-33%', icon: Volume2, color: 'text-green-600', bg: 'bg-green-50' },
    { type: 'Crowd Gathering', current: 4, previous: 7, trend: 'down', change: '-43%', icon: Activity, color: 'text-green-600', bg: 'bg-green-50' },
    { type: 'Unauthorized Access', current: 2, previous: 1, trend: 'up', change: '+100%', icon: Shield, color: 'text-red-600', bg: 'bg-red-50' },
  ]

  const timePatterns = [
    { time: '00:00-06:00', anomalies: 1, severity: 'Low', pattern: 'Minimal activity' },
    { time: '06:00-12:00', anomalies: 8, severity: 'High', pattern: 'Morning rush' },
    { time: '12:00-18:00', anomalies: 12, severity: 'Critical', pattern: 'Peak hours' },
    { time: '18:00-24:00', anomalies: 5, severity: 'Medium', pattern: 'Evening activity' },
  ]

  // const anomalyInsights = [
  //   { insight: 'Most anomalies occur during business hours (12:00-18:00)', confidence: 'High', impact: 'Security risk' },
  //   { insight: 'Audio anomalies have decreased by 33% this week', confidence: 'Medium', impact: 'System improvement' },
  //   { insight: 'Suspicious activity peaks on weekdays', confidence: 'High', impact: 'Pattern recognition' },
  //   { insight: 'Unauthorized access incidents doubled', confidence: 'Critical', impact: 'Security alert' },
  // ]

  const heatmapData = [
    { zone: 'Main Entrance', anomalies: 15, risk: 'High', trend: '+25%', color: 'bg-red-500', intensity: 85 },
    { zone: 'Parking Lot', anomalies: 8, risk: 'Medium', trend: '-12%', color: 'bg-orange-500', intensity: 60 },
    { zone: 'Lobby Area', anomalies: 12, risk: 'High', trend: '+40%', color: 'bg-red-500', intensity: 80 },
    { zone: 'Server Room', anomalies: 3, risk: 'Low', trend: '+5%', color: 'bg-green-500', intensity: 30 },
    { zone: 'Emergency Exit', anomalies: 6, risk: 'Medium', trend: '+15%', color: 'bg-yellow-500', intensity: 45 },
    { zone: 'Cafeteria', anomalies: 4, risk: 'Low', trend: '-8%', color: 'bg-green-500', intensity: 35 },
  ]

  const locationInsights = [
    { insight: 'Main Entrance shows highest anomaly density', confidence: 'High', recommendation: 'Increase security presence' },
    { insight: 'Parking lot incidents decreased by 12%', confidence: 'Medium', recommendation: 'Maintain current monitoring' },
    { insight: 'Lobby area requires immediate attention', confidence: 'Critical', recommendation: 'Deploy additional cameras' },
  ]

  return (
    <div className="space-y-6">
      <div className="px-4 sm:px-0">
        <h2 className="text-xl sm:text-2xl font-bold text-gray-900">Analytics</h2>
        <p className="text-sm sm:text-base text-gray-600 mt-1">
          Anomaly detection patterns and security insights
        </p>
        <div className="mt-3 h-1 w-16 bg-[#4a5a6b] rounded-full"></div>
      </div>

      {/* Export Controls */}
      <div className="flex items-center justify-end px-4 sm:px-0">
        <Button variant="outline" size="sm" className="border-gray-300">
          <Download className="h-4 w-4 mr-2" />
          <span className="hidden sm:inline">Export Report</span>
          <span className="sm:hidden">Export</span>
        </Button>
      </div>

      {/* Anomaly Trends */}
      <Card className="bg-white border border-gray-200 shadow-sm hover:shadow-md transition-shadow hover:border-[#4a5a6b]/20">
        <CardHeader className="border-b border-[#4a5a6b]/10">
          <CardTitle className="flex items-center gap-2 text-gray-800">
            <AlertTriangle className="h-5 w-5 text-[#4a5a6b]" />
            Anomaly Detection Trends
          </CardTitle>
          <CardDescription>
            Changes in anomaly types over time
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            {anomalyTrends.map((trend, index) => (
              <div key={index} className="p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${trend.bg}`}>
                      <trend.icon className={`h-5 w-5 ${trend.color}`} />
                    </div>
                    <div>
                      <div className="font-medium text-gray-900">{trend.type}</div>
                      <div className="flex items-center gap-2 text-sm text-gray-600">
                        <span>Current: {trend.current}</span>
                        <span>•</span>
                        <span>Previous: {trend.previous}</span>
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="flex items-center gap-1">
                      {trend.trend === 'up' ? (
                        <TrendingUp className="h-4 w-4 text-red-600" />
                      ) : (
                        <TrendingDown className="h-4 w-4 text-green-600" />
                      )}
                      <span className={`text-sm font-medium ${
                        trend.trend === 'up' ? 'text-red-600' : 'text-green-600'
                      }`}>
                        {trend.change}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Heatmap Analytics */}
      <Card className="bg-white border border-gray-200 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-gray-800">
            <Thermometer className="h-5 w-5" />
            Location Heatmap Analytics
          </CardTitle>
          <CardDescription>
            Anomaly density and risk assessment by location
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {heatmapData.map((zone, index) => (
              <div key={index} className="p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <MapPin className="h-4 w-4 text-gray-600" />
                      <span className="font-medium text-gray-900">{zone.zone}</span>
                    </div>
                    <Badge 
                      variant={zone.risk === 'High' ? 'destructive' : zone.risk === 'Medium' ? 'default' : 'secondary'}
                      className="text-xs"
                    >
                      {zone.risk}
                    </Badge>
                  </div>
                  
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-600">Anomalies:</span>
                      <span className="font-medium text-gray-900">{zone.anomalies}</span>
                    </div>
                    
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-600">Trend:</span>
                      <span className={`font-medium ${
                        zone.trend.startsWith('+') ? 'text-red-600' : 'text-green-600'
                      }`}>
                        {zone.trend}
                      </span>
                    </div>
                    
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs text-gray-600">
                        <span>Risk Intensity</span>
                        <span>{zone.intensity}%</span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div 
                          className={`h-2 rounded-full transition-all duration-500 ${zone.color}`}
                          style={{ width: `${zone.intensity}%` }}
                        ></div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Time-based Patterns */}
        <Card className="bg-white border border-gray-200 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-gray-800">
              <Clock className="h-5 w-5" />
              Time-based Anomaly Patterns
            </CardTitle>
            <CardDescription>
              Anomaly distribution throughout the day
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {timePatterns.map((pattern, index) => (
                <div key={index} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-900">{pattern.time}</span>
                    <span className="text-sm font-bold text-gray-900">{pattern.anomalies} anomalies</span>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-gray-600">
                    <span>Severity: {pattern.severity}</span>
                    <span>•</span>
                    <span>{pattern.pattern}</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div 
                      className={`h-2 rounded-full transition-all duration-500 ${
                        pattern.severity === 'Critical' ? 'bg-red-500' :
                        pattern.severity === 'High' ? 'bg-orange-500' :
                        pattern.severity === 'Medium' ? 'bg-yellow-500' : 'bg-green-500'
                      }`}
                      style={{ width: `${(pattern.anomalies / 12) * 100}%` }}
                    ></div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Location Insights */}
        <Card className="bg-white border border-gray-200 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-gray-800">
              <Target className="h-5 w-5" />
              Location-Based Insights
            </CardTitle>
            <CardDescription>
              AI-generated location analysis and security recommendations
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {locationInsights.map((insight, index) => (
                <div key={index} className="p-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
                  <div className="space-y-2">
                    <div className="text-sm font-medium text-gray-900">{insight.insight}</div>
                    <div className="text-xs text-gray-600 mb-2">{insight.recommendation}</div>
                    <div className="flex items-center gap-2 text-xs">
                      <span className={`px-2 py-1 rounded-full ${
                        insight.confidence === 'High' ? 'bg-green-100 text-green-700' :
                        insight.confidence === 'Medium' ? 'bg-yellow-100 text-yellow-700' :
                        'bg-red-100 text-red-700'
                      }`}>
                        {insight.confidence}
                      </span>
                      <span className="text-gray-600">Location Analysis</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
