export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { ensureSchedulerForCurrentTimer } = await import('@/lib/timer-notifications')
    await ensureSchedulerForCurrentTimer()
  }
}
