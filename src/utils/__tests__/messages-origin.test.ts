import { describe, expect, test } from 'bun:test'

import { wrapCommandText } from '../messages.js'

describe('wrapCommandText origin handling', () => {
  test('does not present proactive ticks as user messages', () => {
    const text = wrapCommandText('<tick>12:00:00</tick>', {
      kind: 'proactive_tick',
    } as never)

    expect(text).toContain('proactive tick')
    expect(text).toContain('system-generated')
    expect(text).not.toContain('The user sent a new message')
  })
})
