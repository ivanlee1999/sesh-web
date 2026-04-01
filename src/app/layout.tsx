import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'sesh — Pomodoro Timer',
  description: 'A focused Pomodoro timer with session tracking',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'sesh',
  },
}

export const viewport: Viewport = {
  themeColor: '#FFFFFF',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
      </head>
      <body>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                var raw = localStorage.getItem('sesh-settings');
                var dark = raw ? !!JSON.parse(raw).darkMode : false;
                document.documentElement.classList.toggle('dark', dark);
                document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
                var tc = dark ? '#1c1c1e' : '#FFFFFF';
                var m = document.querySelector('meta[name="theme-color"]');
                if (m) m.content = tc;
              } catch(e) {}
            `,
          }}
        />
        {children}
      </body>
    </html>
  )
}
