import { describe, expect, it } from 'vitest'

import * as loginPage from './page'

describe('login page rendering', () => {
  it('evaluates authentication configuration for every request', () => {
    expect(loginPage.dynamic).toBe('force-dynamic')
  })
})
