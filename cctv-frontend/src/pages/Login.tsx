import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Eye, EyeOff } from 'lucide-react'

export default function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const navigate = useNavigate()

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    // Администратор
    if (username === 'admin' && password === 'admin123') {
      localStorage.setItem('isAuthenticated', 'true')
      localStorage.setItem('userRole', 'admin')
      localStorage.setItem('userName', 'Администратор')
      navigate('/')
    } else {
      setError('Неверный логин или пароль')
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          {/* ВОТ ЗДЕСЬ ВАША КАРТИНКА НАД НАДПИСЬЮ */}
          <div className="flex justify-center mb-4">
            <img src="/2.png" alt="logo" className="h-24 w-24 object-contain" />
          </div>
          <CardTitle className="text-2xl">Хранитель</CardTitle>
          <CardDescription>
            Интеллектуальная система безопасности школы
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Логин
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#4a5a6b]"
                placeholder="Введите логин"
                required
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Пароль
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#4a5a6b]"
                  placeholder="Введите пароль"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {error && (
              <div className="text-sm text-red-600 text-center">
                {error}
              </div>
            )}

            <Button
              type="submit"
              className="w-full"
              style={{ backgroundColor: '#4a5a6b' }}
            >
              Войти в систему
            </Button>
          </form>

          <div className="mt-4 text-center text-xs text-gray-500">
            <p>Доступ: admin / admin123</p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}