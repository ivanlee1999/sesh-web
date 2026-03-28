'use client'
import { useEffect } from 'react'
import AppLayout from '@/components/AppLayout'
import { SettingsProvider } from '@/context/SettingsContext'

export default function Home() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {})
    }
  }, [])

  return (
    <SettingsProvider>
      <AppLayout />
    </SettingsProvider>
  )
}
