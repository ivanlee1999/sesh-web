'use client'

import { createContext, useContext } from 'react'
import type { AppTab } from '../TabBar'

/**
 * The one header row lives in the shell, but only each screen knows what its
 * subtitle currently says — how many tasks are open, which session is next.
 * Rather than lifting all of that state up, screens report a line and the
 * shell renders it.
 *
 * Reporting is fire-and-forget: a screen that never reports simply shows the
 * static fallback, so nothing here can block a render.
 */
export interface ShellStatus {
  reportSub: (tab: AppTab, sub: string | null) => void
  reportOpenTasks: (count: number | null) => void
}

const noop: ShellStatus = { reportSub: () => {}, reportOpenTasks: () => {} }

export const ShellStatusContext = createContext<ShellStatus>(noop)

export function useShellStatus(): ShellStatus {
  return useContext(ShellStatusContext)
}
