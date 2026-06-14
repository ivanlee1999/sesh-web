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
      <main className="min-h-screen bg-[var(--bg)] px-6 py-10 text-[var(--ink)]">
        <div className="mx-auto max-w-md rounded-[var(--r-lg)] border border-[var(--line)] bg-[var(--surface)] p-6 shadow-[var(--shadow-md)]">
          <h1 className="text-2xl font-semibold tracking-[-0.03em]">Authentication is not configured</h1>
          <p className="mt-3 text-sm leading-normal text-[var(--ink-2)]">
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
    <main className="flex min-h-screen items-center justify-center bg-[var(--bg)] px-6 py-10 text-[var(--ink)]">
      <div className="w-full max-w-sm rounded-[28px] border border-[var(--line)] bg-[var(--surface)] p-6 shadow-[0_8px_28px_rgba(40,30,18,0.10),0_2px_6px_rgba(40,30,18,0.04)]">
        <div className="mb-7">
          <div className="mb-5 flex items-center gap-[9px]">
            <span className="relative block h-[22px] w-[22px] rounded-[7px] bg-[var(--accent)]">
              <span className="absolute inset-[28%] rounded-full border-2 border-[var(--bg)]" />
            </span>
            <span className="font-[var(--font-display)] text-[21px] font-bold tracking-[-0.04em]">sesh</span>
          </div>
          <p className="text-[12.5px] font-semibold uppercase tracking-[0.07em] text-[var(--accent-ink)]">
            sesh
          </p>
          <h1 className="mt-2 font-[var(--font-display)] text-[30px] font-bold tracking-[-0.04em]">Sign in</h1>
          <p className="mt-2 text-[15px] leading-normal text-[var(--ink-2)]">
            This app is private. Sign in to open the PWA and its API routes.
          </p>
        </div>

        <form action="/api/login" method="post" className="space-y-4">
          <input type="hidden" name="next" value={nextPath} />

          <label className="block">
            <span className="mb-1.5 block text-[12.5px] font-semibold uppercase tracking-[0.07em] text-[var(--ink-3)]">Username</span>
            <input
              name="username"
              autoComplete="username"
              required
              className="w-full rounded-[var(--r-md)] border-[1.5px] border-[var(--line-strong)] bg-[var(--bg)] px-4 py-3 text-base text-[var(--ink)] outline-none transition focus:border-[var(--accent)]"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[12.5px] font-semibold uppercase tracking-[0.07em] text-[var(--ink-3)]">Password</span>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="w-full rounded-[var(--r-md)] border-[1.5px] border-[var(--line-strong)] bg-[var(--bg)] px-4 py-3 text-base text-[var(--ink)] outline-none transition focus:border-[var(--accent)]"
            />
          </label>

          {showError && (
            <p className="rounded-[var(--r-md)] bg-[#C2615A]/10 px-4 py-3 text-sm text-[#C2615A]">
              Incorrect username or password.
            </p>
          )}

          <button
            type="submit"
            className="w-full rounded-[var(--r-pill)] bg-[var(--ink)] px-4 py-[15px] text-base font-semibold tracking-[-0.01em] text-[var(--bg)] transition active:scale-[0.98]"
          >
            Sign in
          </button>
        </form>
      </div>
    </main>
  )
}
