import { type ReactNode, useEffect, useState, useRef } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  LayoutDashboard,
  AlertTriangle,
  Settings,
  Activity,
  Upload,
  Bell,
  User,
  Menu,
  X,
  Sun,
  Moon,
  Map
} from 'lucide-react'
import { Button } from './ui/button'

interface LayoutProps {
  children: ReactNode
}

const navigation = [
  { name: 'Приборная панель', href: '/', icon: LayoutDashboard },
  { name: 'Карта школы', href: '/map', icon: Map, external: false },
  { name: 'Видео анализ', href: '/analysis', icon: Upload },
  { name: 'Оповещения', href: '/alerts', icon: AlertTriangle },
  { name: 'Аналитика', href: '/analytics', icon: Activity },
  { name: 'Распознавание лиц', href: 'http://localhost:5001', icon: User, external: true },
]

export default function Layout({ children }: LayoutProps) {
  const location = useLocation()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsRef = useRef<HTMLDivElement>(null)

  const [isDark, setIsDark] = useState(() => {
    const saved = localStorage.getItem('theme')
    return saved === 'dark'
  })

  // Close mobile menu after route changes.
  useEffect(() => {
    setMobileMenuOpen(false)
  }, [location.pathname])

  // Close mobile menu when user presses Escape.
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMobileMenuOpen(false)
      }
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [])

  // Закрыть меню настроек при клике вне
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(event.target as Node)) {
        setSettingsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Применение темы
  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark')
      localStorage.setItem('theme', 'dark')
    } else {
      document.documentElement.classList.remove('dark')
      localStorage.setItem('theme', 'light')
    }
  }, [isDark])

  const sidebarClassName =
    `fixed lg:static inset-y-0 left-0 z-50 w-64 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 transform transition-transform duration-300 ease-in-out lg:translate-x-0 ${
      mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
    }`

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 w-full overflow-x-hidden">
      {/* Header */}
      <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 shadow-sm">
        <div className="flex h-16 items-center px-4 sm:px-6">
          {/* Mobile menu button */}
          <Button
            variant="ghost"
            size="sm"
            className="lg:hidden mr-3"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>

          {/* Логотип и название */}
          <div className="flex items-center space-x-3">
            <div>
              <img src="/2.png" alt="logo" className="h-14 w-14 object-contain" />
            </div>
            <div>
              <h1 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white">Хранитель</h1>
              <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 hidden sm:block">Интеллектуальная система безопасности школы</p>
            </div>
          </div>

          {/* Правая панель с кнопками */}
          <div className="ml-auto flex items-center gap-2 sm:gap-4">
            <div className="flex items-center gap-1 sm:gap-2">
              {/* Колокольчик */}
              <Button
                variant="ghost"
                size="sm"
                className="relative"
                onClick={() => alert('Новых уведомлений нет')}
              >
                <Bell className="h-4 w-4 sm:h-5 sm:w-5 text-gray-600 dark:text-gray-400" />
                <span className="absolute -top-1 -right-1 h-3 w-3 bg-red-500 rounded-full"></span>
              </Button>

              {/* Шестерёнка с меню настроек */}
              <div className="relative" ref={settingsRef}>
                <Button
                  variant="ghost"
                  size="sm"
                  className="hidden sm:flex"
                  onClick={() => setSettingsOpen(!settingsOpen)}
                >
                  <Settings className="h-4 w-4 sm:h-5 sm:w-5 text-gray-600 dark:text-gray-400" />
                </Button>

                {settingsOpen && (
                  <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-50">
                    <div className="py-1">
                      <div className="px-4 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 border-b dark:border-gray-700">
                        НАСТРОЙКИ
                      </div>

                      <button
                        onClick={() => {
                          setIsDark(false)
                          setSettingsOpen(false)
                        }}
                        className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
                      >
                        <Sun className="h-4 w-4 text-yellow-500" />
                        Светлая тема
                      </button>

                      <button
                        onClick={() => {
                          setIsDark(true)
                          setSettingsOpen(false)
                        }}
                        className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
                      >
                        <Moon className="h-4 w-4 text-blue-400" />
                        Тёмная тема
                      </button>

                      <div className="border-t dark:border-gray-700 my-1"></div>

                      <div className="px-4 py-2 text-xs text-gray-400 dark:text-gray-500">
                        Хранитель v1.0
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Имя пользователя и выход */}
              <div className="hidden sm:flex items-center gap-2">
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  {localStorage.getItem('userName') || 'Администратор'}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    localStorage.removeItem('isAuthenticated')
                    localStorage.removeItem('userRole')
                    localStorage.removeItem('userName')
                    window.location.href = '/login'
                  }}
                >
                  <User className="h-4 w-4 sm:h-5 sm:w-5 text-gray-600 dark:text-gray-400" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Основная часть с сайдбаром и контентом */}
      <div className="flex">
        {/* Mobile Sidebar Overlay */}
        {mobileMenuOpen && (
          <div
            className="fixed inset-0 z-40 lg:hidden"
            onClick={() => setMobileMenuOpen(false)}
          >
            <div className="absolute inset-0 bg-black bg-opacity-25"></div>
          </div>
        )}

        {/* Sidebar */}
        <nav className={sidebarClassName}>
          <div className="p-4">
            <ul className="space-y-1">
              {navigation.map((item) => {
                const isActive = !item.external && location.pathname === item.href
                const linkClassName = isActive
                  ? 'flex items-center space-x-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors text-white'
                  : 'flex items-center space-x-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'

                return (
                  <li key={item.name}>
                    {item.external ? (
                      <a
                        href={item.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={linkClassName}
                      >
                        <item.icon className="h-5 w-5" />
                        <span>{item.name}</span>
                      </a>
                    ) : (
                      <Link
                        to={item.href}
                        className={linkClassName}
                        style={isActive ? { backgroundColor: '#4a5a6b' } : {}}
                      >
                        <item.icon className="h-5 w-5" />
                        <span>{item.name}</span>
                      </Link>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        </nav>

        {/* Main content */}
        <main className="flex-1 p-4 sm:p-6 bg-gray-50 dark:bg-gray-950 min-h-screen w-full overflow-x-hidden">
          <div className="max-w-7xl mx-auto w-full">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}