import { afterEach, describe, expect, it, mock } from 'bun:test'
import { WecomClient } from './client.js'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('WecomClient', () => {
  it('uploads image media and sends an image message', async () => {
    const fetchMock = mock(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url)
      if (href.includes('/cgi-bin/gettoken')) {
        return jsonResponse({ errcode: 0, access_token: 'token_123', expires_in: 7200 })
      }
      if (href.includes('/cgi-bin/media/upload')) {
        expect(href).toContain('type=image')
        expect(init?.method).toBe('POST')
        expect(init?.body).toBeInstanceOf(FormData)
        return jsonResponse({ errcode: 0, media_id: 'media_123' })
      }
      if (href.includes('/cgi-bin/message/send')) {
        const body = JSON.parse(String(init?.body))
        expect(body.touser).toBe('zhangsan')
        expect(body.msgtype).toBe('image')
        expect(body.agentid).toBe(1000002)
        expect(body.image.media_id).toBe('media_123')
        return jsonResponse({ errcode: 0, errmsg: 'ok' })
      }
      throw new Error(`unexpected fetch: ${href}`)
    })
    globalThis.fetch = fetchMock as any

    const client = new WecomClient('wwcorp', 'secret', '1000002')
    await client.sendImage('zhangsan', Buffer.from('PNGDATA'), 'shot.png')

    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('refreshes expired token while uploading image media', async () => {
    let uploadAttempts = 0
    const fetchMock = mock(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url)
      if (href.includes('/cgi-bin/gettoken')) {
        return jsonResponse({ errcode: 0, access_token: `token_${uploadAttempts}`, expires_in: 7200 })
      }
      if (href.includes('/cgi-bin/media/upload')) {
        uploadAttempts += 1
        if (uploadAttempts === 1) {
          return jsonResponse({ errcode: 42001, errmsg: 'access_token expired' })
        }
        return jsonResponse({ errcode: 0, media_id: 'media_after_retry' })
      }
      if (href.includes('/cgi-bin/message/send')) {
        const body = JSON.parse(String(init?.body))
        expect(body.image.media_id).toBe('media_after_retry')
        return jsonResponse({ errcode: 0, errmsg: 'ok' })
      }
      throw new Error(`unexpected fetch: ${href}`)
    })
    globalThis.fetch = fetchMock as any

    const client = new WecomClient('wwcorp', 'secret', '1000002')
    await client.sendImage('zhangsan', Buffer.from('PNGDATA'), 'shot.png')

    expect(uploadAttempts).toBe(2)
  })
})
