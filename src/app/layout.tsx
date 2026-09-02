import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'sesh — Pomodoro Timer',
  description: 'A focused Pomodoro timer with session tracking',
  manifest: '/manifest.json',
  icons: {
    icon: [
      { url: '/icons/icon.svg', type: 'image/svg+xml' },
      { url: '/icons/icon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: [{ url: '/icons/icon-180.png', sizes: '180x180', type: 'image/png' }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'sesh',
  },
}

export const viewport: Viewport = {
  themeColor: '#f4f2ef',
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
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
        <link rel="apple-touch-icon" sizes="180x180" href="/icons/icon-180.png" />
        <link rel="icon" type="image/svg+xml" href="/icons/icon.svg" />
      </head>
      <body>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                var raw = localStorage.getItem('sesh-settings');
                var parsed = raw ? JSON.parse(raw) : {};
                var dark = !!parsed.darkMode;
                document.documentElement.classList.toggle('dark', dark);
                document.documentElement.dataset.theme = dark ? 'dark' : 'light';
                document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
                var tc = dark ? '#161514' : '#f4f2ef';
                var m = document.querySelector('meta[name="theme-color"]');
                if (m) m.content = tc;
                // The accent the last session settled on, already worked out
                // for both grounds (see lib/accent) so there is no colour
                // maths to repeat here — only a pick and two writes.
                var accent = JSON.parse(localStorage.getItem('sesh:accent') || 'null');
                var a = accent && (dark ? accent.dark : accent.light);
                if (a && a.base) {
                  document.documentElement.style.setProperty('--accent-base', a.base);
                  document.documentElement.style.setProperty('--accent-on', a.on || '#ffffff');
                  if (a.ground) document.documentElement.style.setProperty('--accent-ground', a.ground);
                }
              } catch(e) {}
            `,
          }}
        />
        {children}
      </body>
    </html>
  )
}
