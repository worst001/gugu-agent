import { describe, expect, test } from 'bun:test'
import { enqueue } from './chat-queue.js'

describe('chat queue', () => {
  test('returns task failures while allowing the next task to run', async () => {
    const originalError = console.error
    console.error = () => {}
    const order: string[] = []

    try {
      const failed = enqueue('queue-regression', async () => {
        order.push('failed')
        throw new Error('boom')
      })
      const next = enqueue('queue-regression', async () => {
        order.push('next')
      })

      await expect(failed).rejects.toThrow('boom')
      await next
      expect(order).toEqual(['failed', 'next'])
    } finally {
      console.error = originalError
    }
  })
})