import React, { type ReactNode, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { 
  LayoutDashboard, 
  AlertTriangle, 
  Settings, 
  Camera,
  Activity,
  Upload,
  Bell,
  User,
  Menu,
  X
} from 'lucide-react'
import { Button } from './ui/button'
import { cn } from '../lib/utils'

interface LayoutProps {
  children: ReactNode
}

const navigation = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard },
  { name: 'Video Analysis', href: '/analysis', icon: Upload },
  { name: 'Alerts', href: '/alerts', icon: AlertTriangle },
  { name: 'Analytics', href: '/analytics', icon: Activity },
]

export default function Layout({ children }: LayoutProps) {
  const location = useLocation()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  // Close mobile menu on route change
  React.useEffect(() => {
    setMobileMenuOpen(false)
  }, [location.pathname])

  // Close mobile menu on escape key
  React.useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMobileMenuOpen(false)
      }
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [])

  return (
    <div className="min-h-screen bg-gray-50 w-full overflow-x-hidden">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 shadow-sm">
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

          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-lg" style={{ backgroundColor: '#4a5a6b' }}>
              <Camera className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="text-lg sm:text-xl font-bold text-gray-900">VisionGuard AI</h1>
              <p className="text-xs sm:text-sm text-gray-600 hidden sm:block">Intelligent Surveillance Platform</p>
            </div>
          </div>
          
          <div className="ml-auto flex items-center gap-2 sm:gap-4">
            <div className="flex items-center gap-1 sm:gap-2">
              <Button variant="ghost" size="sm" className="relative">
                <Bell className="h-4 w-4 sm:h-5 sm:w-5 text-gray-600" />
                <span className="absolute -top-1 -right-1 h-3 w-3 bg-red-500 rounded-full"></span>
              </Button>
              <Button variant="ghost" size="sm" className="hidden sm:flex">
                <Settings className="h-4 w-4 sm:h-5 sm:w-5 text-gray-600" />
              </Button>
              <Button variant="ghost" size="sm" className="hidden sm:flex">
                <User className="h-4 w-4 sm:h-5 sm:w-5 text-gray-600" />
              </Button>
            </div>
          </div>
        </div>
      </header>

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
        <nav className={cn(
          "fixed lg:static inset-y-0 left-0 z-50 w-64 bg-white border-r border-gray-200 transform transition-transform duration-300 ease-in-out lg:translate-x-0",
          mobileMenuOpen ? "translate-x-0" : "-translate-x-full"
        )}>
          <div className="p-4">
            <ul className="space-y-1">
              {navigation.map((item) => {
                const isActive = location.pathname === item.href
                return (
                  <li key={item.name}>
                    <Link
                      to={item.href}
                      className={cn(
                        "flex items-center space-x-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                        isActive
                          ? "text-white"
                          : "text-gray-700 hover:bg-gray-100"
                      )}
                      style={isActive ? { backgroundColor: '#4a5a6b' } : {}}
                      onClick={() => setMobileMenuOpen(false)}
                    >
                      <item.icon className="h-5 w-5" />
                      <span>{item.name}</span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        </nav>

        {/* Main content */}
        <main className="flex-1 p-4 sm:p-6 bg-gray-50 min-h-screen w-full overflow-x-hidden">
          <div className="max-w-7xl mx-auto w-full">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
