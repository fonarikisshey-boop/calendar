import React, { useState, useEffect, useCallback } from 'react'
import './version.js'

// CACHE_BUST: 1004
// BUILD_TIMESTAMP: 2026-03-12-18-20-001
// FORCE_REBUILD: TRUE

console.log('APP LOADED - CACHE_BUST: 1004, TIMESTAMP: 2026-03-12-18-20-001')

// Московское время (UTC+3) без внешних зависимостей


const formatDate = (date) => {
  return date.toISOString().split('T')[0]
}

const getMonthName = (month) => {
  const months = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 
                  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
  return months[month]
}

// API URL - используем относительный путь для работы везде
const API_URL = ''

function App() {
  const [user, setUser] = useState(null)
  const [currentDate, setCurrentDate] = useState(new Date())
  const [closedDates, setClosedDates] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [initData, setInitData] = useState('')
  const [backgroundImage, setBackgroundImage] = useState(null)

  // Инициализация Telegram WebApp
  useEffect(() => {
    if (window.Telegram?.WebApp?.initData) {
      const tg = window.Telegram.WebApp
      tg.ready()
      tg.expand()
      
      setInitData(tg.initData)
      
      // Устанавливаем цвета
      tg.setHeaderColor('#0a0a0f')
      tg.setBackgroundColor('#0a0a0f')
      
      console.log('✓ Telegram WebApp initialized')
    } else {
      // Fallback для браузера (не Telegram)
      console.log('ℹ Not in Telegram WebApp, using browser mode')
      setInitData('browser_mode')
      setUser({ id: 0, username: 'browser', firstName: 'Browser', role: 'VIEWER' })
      setLoading(false)
    }
  }, [])

  // Загрузка данных пользователя
  useEffect(() => {
    if (!initData) return
    
    fetchUser()
    fetchCalendar()
    fetchSettings()
  }, [initData])

  const fetchUser = async () => {
    try {
      setLoading(true)
      const response = await fetch(`${API_URL}/api/user`, {
        headers: { 'X-Telegram-Init-Data': initData }
      })
      
      if (!response.ok) {
        if (response.status === 401) {
          // Не авторизован — показываем ошибку но не загрузку
          setError('Ошибка авторизации Telegram. Попробуйте обновить страницу.')
          setLoading(false)
          return
        }
        throw new Error('Failed to fetch user')
      }
      
      const data = await response.json()
      setUser(data)
    } catch (err) {
      setError(err.message)
      setLoading(false)
    }
  }

  const fetchCalendar = async () => {
    try {
      setLoading(true)
      const year = currentDate.getFullYear()
      const month = currentDate.getMonth() + 1
      
      const response = await fetch(
        `${API_URL}/api/calendar?year=${year}&month=${month}`,
        { headers: { 'X-Telegram-Init-Data': initData } }
      )
      
      if (!response.ok) throw new Error('Failed to fetch calendar')
      
      const data = await response.json()
      setClosedDates(data.closedDates.map(d => d.date))
      setLoading(false)
    } catch (err) {
      setError(err.message)
      setLoading(false)
    }
  }

  const fetchSettings = async () => {
    try {
      const response = await fetch(`${API_URL}/api/settings`, {
        headers: { 'X-Telegram-Init-Data': initData }
      })
      
      if (response.ok) {
        const data = await response.json()
        setBackgroundImage(data.backgroundImage)
      }
    } catch (err) {
      console.error('Failed to fetch settings:', err)
    }
  }

  const toggleDate = async (dateStr) => {
    if (!canManageDates()) return
    
    try {
      const response = await fetch(`${API_URL}/api/calendar/toggle`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Telegram-Init-Data': initData
        },
        body: JSON.stringify({ date: dateStr })
      })
      
      if (!response.ok) throw new Error('Failed to toggle date')
      
      const data = await response.json()
      
      if (data.status === 'closed') {
        setClosedDates(prev => [...prev, dateStr])
      } else {
        setClosedDates(prev => prev.filter(d => d !== dateStr))
      }
    } catch (err) {
      setError(err.message)
    }
  }

  const canManageDates = () => {
    return user?.role === 'ADMIN' || user?.role === 'OWNER'
  }

  const prevMonth = () => {
    setCurrentDate(prev => {
      const newDate = new Date(prev)
      newDate.setMonth(newDate.getMonth() - 1)
      return newDate
    })
  }

  const nextMonth = () => {
    setCurrentDate(prev => {
      const newDate = new Date(prev)
      newDate.setMonth(newDate.getMonth() + 1)
      return newDate
    })
  }

  // Перезагрузка календаря при смене месяца
  useEffect(() => {
    if (initData) fetchCalendar()
  }, [currentDate])

  const generateCalendarDays = () => {
    const year = currentDate.getFullYear()
    const month = currentDate.getMonth()
    
    const firstDay = new Date(year, month, 1)
    const lastDay = new Date(year, month + 1, 0)
    const daysInMonth = lastDay.getDate()
    
    // День недели первого числа (0 = вс, 1 = пн, ...)
    let startDayOfWeek = firstDay.getDay()
    if (startDayOfWeek === 0) startDayOfWeek = 7 // Воскресенье = 7
    
    const today = new Date()
    const todayStr = formatDate(today)
    
    const days = []
    
    // Пустые дни в начале
    for (let i = 1; i < startDayOfWeek; i++) {
      days.push({ type: 'empty', key: `empty-${i}` })
    }
    
    // Дни месяца
    for (let i = 1; i <= daysInMonth; i++) {
      const date = new Date(year, month, i)
      const dateStr = formatDate(date)
      const todayDate = new Date(); todayDate.setHours(0, 0, 0, 0); 
      // Исправлено: сегодняшний день (12 марта) НЕ должен быть isPast
      const isPast = date.getTime() < todayDate.getTime();
      const isClosed = closedDates.includes(dateStr)
      const isToday = dateStr === todayStr
      
      days.push({
        type: 'day',
        day: i,
        dateStr,
        isPast,
        isClosed,
        isToday,
        key: dateStr
      })
    }
    
    return days
  }

  const weekDays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

  if (loading && !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="loader mx-auto mb-4"></div>
          <p className="text-gray-400">Загрузка...</p>
        </div>
      </div>
    )
  }

  return (
    <div 
      className="min-h-screen p-4"
      style={backgroundImage ? {
        backgroundImage: `linear-gradient(rgba(10, 10, 15, 0.85), rgba(10, 10, 15, 0.9)), url(${backgroundImage})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundAttachment: 'fixed'
      } : {}}
    >
      <div className="max-w-md mx-auto">
        {/* Заголовок */}
        <div className="text-center mb-6 animate-fade-in">
          <h1 className="text-2xl font-bold text-white mb-2">Календарь</h1>
          <p className="text-sm text-gray-400">
            {getMonthName(currentDate.getMonth())} {currentDate.getFullYear()}
          </p>
          
          {user && (
            <div className="mt-2 text-xs">
              <span className="px-2 py-1 rounded bg-dark-700 text-gray-300">
                {user.role === 'OWNER' && 'Владелец'}
                {user.role === 'ADMIN' && 'Администратор'}
                {user.role === 'VIEWER' && 'Просмотр'}
              </span>
            </div>
          )}
        </div>

        {/* Навигация */}
        <div className="flex justify-between items-center mb-6">
          <button
            onClick={prevMonth}
            className="p-3 rounded-full bg-dark-700 hover:bg-dark-600 transition-all hover:scale-110"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          
          <span className="text-lg font-semibold text-white">
            {getMonthName(currentDate.getMonth())} {currentDate.getFullYear()}
          </span>
          
          <button
            onClick={nextMonth}
            className="p-3 rounded-full bg-dark-700 hover:bg-dark-600 transition-all hover:scale-110"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        {/* Ошибка */}
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-900/30 border border-red-500/30 text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Легенда */}
        <div className="flex justify-center gap-4 mb-4 text-xs">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-dark-700 border border-accent-cyan"></div>
            <span className="text-gray-400">Открыто</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-dark-700 border border-accent-red"></div>
            <span className="text-gray-400">Закрыто</span>
          </div>
        </div>

        {/* Дни недели */}
        <div className="calendar-grid mb-2">
          {weekDays.map(day => (
            <div key={day} className="text-center text-xs font-semibold text-gray-500 py-2">
              {day}
            </div>
          ))}
        </div>

        {/* Календарь */}
        <div className="calendar-grid">
          {generateCalendarDays().map(item => {
            if (item.type === 'empty') {
              return <div key={item.key} className="calendar-day disabled"></div>
            }
            
            return (
              <button
                key={item.key}
                onClick={() => !item.isPast && toggleDate(item.dateStr)}
                disabled={item.isPast || !canManageDates()}
                className={`
                  calendar-day
                  ${item.isClosed ? 'closed' : 'open'}
                  ${item.isPast ? 'past' : ''}
                  ${item.isToday ? 'today' : ''}
                  ${canManageDates() && !item.isPast ? 'cursor-pointer' : 'cursor-default'}
                `}
              >
                {item.day}
              </button>
            )
          })}
        </div>

        {/* Подсказка */}
        <div className="mt-6 text-center text-xs text-gray-500">
          {canManageDates() ? (
            <p>Нажмите на дату, чтобы открыть или закрыть</p>
          ) : (
            <p>У вас доступ только для просмотра</p>
          )}
          <p className="mt-1">Московское время (MSK)</p>
        </div>
      </div>
    </div>
  )
}

export default App
