import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import {
  APP_SESSION_COOKIE,
  getAppAuthConfig,
  getAppAuthDisableEnv,
  isAppAuthDisabled,
  sanitizeNextPath,
  validateSessionToken,
} from '@/lib/app-auth'

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: { error?: string; next?: string }
}) {
  if (isAppAuthDisabled(getAppAuthDisableEnv(process.env))) {
    redirect('/')
  }

  const authConfig = getAppAuthConfig(process.env)
  if (!authConfig) {
    return (
      <main className="min-h-screen bg-gray-50 px-6 py-10 text-gray-900 dark:bg-black dark:text-white">
        <div className="mx-auto max-w-md rounded-3xl bg-white p-6 shadow-sm dark:bg-neutral-900">
          <h1 className="text-2xl font-semibold">Authentication is not configured</h1>
          <p className="mt-3 text-sm text-gray-600 dark:text-gray-300">
            Set <code>APP_AUTH_USERNAME</code> and <code>APP_AUTH_PASSWORD</code> (or the legacy
            <code> BASIC_AUTH_USERNAME</code> / <code>BASIC_AUTH_PASSWORD</code>) plus
            <code> NEXTAUTH_SECRET</code> before exposing this app publicly.
          </p>
        </div>
      </main>
    )
  }

  const cookieStore = await cookies()
  const existingSession = cookieStore.get(APP_SESSION_COOKIE)?.value
  const nextPath = sanitizeNextPath(searchParams?.next)

  if (await validateSessionToken(existingSession, authConfig)) {
    redirect(nextPath)
  }

  const showError = searchParams?.error === '1'

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-6 py-10 dark:bg-black">
      <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-sm dark:bg-neutral-900">
        <div className="mb-6">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-gray-500 dark:text-gray-400">
            sesh
          </p>
          <h1 className="mt-2 text-3xl font-semibold text-gray-900 dark:text-white">Sign in</h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
            This app is private. Sign in to open the PWA and its API routes.
          </p>
        </div>

        <form action="/api/login" method="post" className="space-y-4">
          <input type="hidden" name="next" value={nextPath} />

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-200">Username</span>
            <input
              name="username"
              autoComplete="username"
              required
              className="w-full rounded-2xl border border-gray-300 bg-white px-4 py-3 text-base text-gray-900 outline-none transition focus:border-gray-500 dark:border-neutral-700 dark:bg-neutral-950 dark:text-white"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-200">Password</span>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="w-full rounded-2xl border border-gray-300 bg-white px-4 py-3 text-base text-gray-900 outline-none transition focus:border-gray-500 dark:border-neutral-700 dark:bg-neutral-950 dark:text-white"
            />
          </label>

          {showError && (
            <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
              Incorrect username or password.
            </p>
          )}

          <button
            type="submit"
            className="w-full rounded-2xl bg-gray-900 px-4 py-3 text-base font-medium text-white transition hover:bg-black dark:bg-white dark:text-black dark:hover:bg-gray-200"
          >
            Sign in
          </button>
        </form>
      </div>
    </main>
  )
}
