import { useEffect, useState } from 'react'
import { BarChart3, Loader2 } from 'lucide-react'

interface OverviewResponse {
  anomaly_breakdown: Array<{ anomaly_id: string; count: number }>
}

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000'

const anomalyCatalog = [
  { id: 'gunshot_audio', label: 'Выстрел', aliases: ['gunshot_audio', 'gunshot'], barClass: 'bg-gradient-to-r from-red-500 to-rose-500' },
  { id: 'fight_visual', label: 'Драка', aliases: ['fight_visual', 'fight'], barClass: 'bg-gradient-to-r from-orange-500 to-amber-500' },
  { id: 'sudden_fall_visual', label: 'Падение', aliases: ['sudden_fall_visual', 'fall'], barClass: 'bg-gradient-to-r from-yellow-500 to-lime-500' },
  { id: 'scream_audio', label: 'Крик', aliases: ['scream_audio', 'scream'], barClass: 'bg-gradient-to-r from-purple-500 to-fuchsia-500' },
  { id: 'explosion_fire_visual', label: 'Пожар (взрыв)', aliases: ['explosion_fire_visual', 'explosion_fire', 'explosion', 'fire'], barClass: 'bg-gradient-to-r from-pink-500 to-rose-600' },
  { id: 'crowd_gathering_visual', label: 'Скопление людей', aliases: ['crowd_gathering_visual', 'crowd'], barClass: 'bg-gradient-to-r from-blue-500 to-cyan-500' },
]

export default function Analytics() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [overview, setOverview] = useState<OverviewResponse>({ anomaly_breakdown: [] })

  useEffect(() => {
    const controller = new AbortController()

    const fetchFrequency = async () => {
      try {
        setLoading(true)
        setError(null)
        const res = await fetch(`${API_BASE}/stats/overview`, { signal: controller.signal })

        if (!res.ok) {
          const err = await res.json().catch(() => ({ detail: res.statusText }))
          const detail =
            typeof err?.detail === 'string'
              ? err.detail
              : err?.detail?.message || err?.message || res.statusText
          throw new Error(detail || 'Не удалось загрузить частоту аномалий')
        }

        const json = (await res.json()) as OverviewResponse
        setOverview({ anomaly_breakdown: json.anomaly_breakdown || [] })
      } catch (err: unknown) {
        if ((err as Error).name === 'AbortError') return
        setError(err instanceof Error ? err.message : 'Неизвестная ошибка')
      } finally {
        setLoading(false)
      }
    }

    fetchFrequency()
    return () => controller.abort()
  }, [API_BASE])

  const countById = new Map<string, number>()
  for (const row of overview.anomaly_breakdown || []) {
    const key = (row.anomaly_id || '').toLowerCase()
    countById.set(key, (countById.get(key) || 0) + (row.count || 0))
  }

  const anomalyFrequencyData = anomalyCatalog.map((item) => {
    const count = item.aliases.reduce((sum, alias) => sum + (countById.get(alias) || 0), 0)
    return { ...item, count }
  })

  const maxCount = anomalyFrequencyData.reduce((max, row) => Math.max(max, row.count), 0)
  const bars = anomalyFrequencyData.map((row) => ({
    ...row,
    heightPct: maxCount > 0 ? Math.max(12, Math.round((row.count / maxCount) * 100)) : 12,
  }))

  return (
    <div className="space-y-6">
      <div className="px-4 sm:px-0">
        <h2 className="text-xl sm:text-2xl font-bold text-gray-900">Аналитика</h2>
        <p className="text-sm sm:text-base text-gray-600 mt-1">Распределение частоты обнаружения угроз</p>
        <div className="mt-3 h-1 w-16 bg-[#4a5a6b] rounded-full"></div>
      </div>

      {loading && (
        <div className="bg-white border border-[#4a5a6b]/30 shadow-sm rounded-xl p-6 flex items-center gap-2 text-gray-600">
          <Loader2 className="h-4 w-4 animate-spin" /> Загрузка аналитики с сервера...
        </div>
      )}

      {!loading && error && (
        <div className="bg-white border border-red-200 shadow-sm rounded-xl p-6 text-sm text-red-700">Ошибка загрузки аналитики: {error}</div>
      )}

      <section className="space-y-3">
        <div>
          <h3 className="flex items-center gap-2 text-gray-800 text-lg sm:text-xl font-semibold">
            <BarChart3 className="h-5 w-5 text-[#4a5a6b]" />
            Частота угроз
          </h3>
          <p className="text-sm text-gray-600 mt-1">Частота всех типов угроз на основе последних обнаружений</p>
        </div>

        <div className="rounded-lg border border-[#4a5a6b]/15 bg-gray-50/70 p-4 sm:p-6 shadow-sm mx-auto max-w-4xl">
          <div className="h-72 sm:h-80">
            <div className="h-full grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3 items-end justify-items-center">
              {bars.map((item) => (
                <div key={item.id} className="h-full flex flex-col justify-end items-center gap-2">
                  <span className="text-xs sm:text-sm px-2.5 py-1 rounded-full bg-white text-gray-700 border border-gray-200 font-medium shadow-sm">
                    {item.count}
                  </span>
                  <div className="w-[72px] h-[72%] flex items-end justify-center">
                    <div
                      className={`w-full rounded-none shadow-sm ${item.barClass} transition-all duration-700 border border-black/10 hover:brightness-110`}
                      style={{ height: `${item.heightPct}%` }}
                      title={`${item.label}: ${item.count}`}
                    />
                  </div>
                  <span className="text-xs sm:text-sm text-center font-bold text-gray-800 leading-tight min-h-[2.5rem] flex items-center tracking-wide">
                    {item.label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}