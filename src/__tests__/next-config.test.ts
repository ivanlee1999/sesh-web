import { describe, expect, it } from 'vitest'
import nextConfig from '../../next.config.mjs'

describe('Next.js runtime configuration', () => {
  it('enables instrumentation so timer notifications start when the server starts', () => {
    expect(nextConfig.experimental?.instrumentationHook).toBe(true)
  })
})
