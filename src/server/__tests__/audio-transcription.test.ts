import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'

import { handleAudioTranscriptionApi } from '../api/audio-transcription.js'

let tmpDir: string
let originalConfigDir: string | undefined
let originalDashScopeKey: string | undefined
let originalBailianKey: string | undefined
let originalFetch: typeof fetch

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'audio-transcription-test-'))
  originalConfigDir = process.env.CLAUDE_CONFIG_DIR
  originalDashScopeKey = process.env.DASHSCOPE_API_KEY
  originalBailianKey = process.env.BAILIAN_API_KEY
  originalFetch = globalThis.fetch
  process.env.CLAUDE_CONFIG_DIR = tmpDir
  delete process.env.DASHSCOPE_API_KEY
  delete process.env.BAILIAN_API_KEY
})

afterEach(async () => {
  if (originalConfigDir !== undefined) {
    process.env.CLAUDE_CONFIG_DIR = originalConfigDir
  } else {
    delete process.env.CLAUDE_CONFIG_DIR
  }
  if (originalDashScopeKey !== undefined) {
    process.env.DASHSCOPE_API_KEY = originalDashScopeKey
  } else {
    delete process.env.DASHSCOPE_API_KEY
  }
  if (originalBailianKey !== undefined) {
    process.env.BAILIAN_API_KEY = originalBailianKey
  } else {
    delete process.env.BAILIAN_API_KEY
  }
  globalThis.fetch = originalFetch
  await fs.rm(tmpDir, { recursive: true, force: true })
})

function makeRequest(body: Record<string, unknown>) {
  const url = new URL('http://localhost:3456/api/audio-transcription')
  return {
    req: new Request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    url,
    segments: ['api', 'audio-transcription'],
  }
}

describe('audio transcription API', () => {
  test('transcribes Base64 audio through DashScope ASR', async () => {
    process.env.DASHSCOPE_API_KEY = 'test-key'
    const calls: Array<{ url: string; init?: RequestInit }> = []
    globalThis.fetch = (async (url, init) => {
      calls.push({ url: String(url), init })
      return Response.json({
        model: 'qwen3-asr-flash',
        choices: [
          {
            message: {
              content: '你好，咕咕。',
              annotations: [
                { type: 'audio_info', language: 'zh', emotion: 'neutral' },
              ],
            },
          },
        ],
        usage: { seconds: 1 },
      })
    }) as typeof fetch

    const { req, url, segments } = makeRequest({
      audio: 'data:audio/wav;base64,UklGRg==',
      language: 'zh',
    })
    const response = await handleAudioTranscriptionApi(req, url, segments)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toEqual({
      text: '你好，咕咕。',
      model: 'qwen3-asr-flash',
      language: 'zh',
      emotion: 'neutral',
      usage: { seconds: 1 },
    })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions')
    expect(calls[0].init?.headers).toMatchObject({
      Authorization: 'Bearer test-key',
      'Content-Type': 'application/json',
    })
    const dashScopeBody = JSON.parse(String(calls[0].init?.body))
    expect(dashScopeBody).toMatchObject({
      model: 'qwen3-asr-flash',
      stream: false,
      asr_options: {
        language: 'zh',
        enable_itn: true,
      },
    })
    expect(dashScopeBody.messages[0].content[0].input_audio.data).toBe('data:audio/wav;base64,UklGRg==')
  })

  test('returns a clear error when no DashScope API key is configured', async () => {
    const { req, url, segments } = makeRequest({
      audio: 'data:audio/wav;base64,UklGRg==',
    })

    const response = await handleAudioTranscriptionApi(req, url, segments)
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload).toMatchObject({
      error: 'BAD_REQUEST',
      message: 'Missing DashScope API key. Set DASHSCOPE_API_KEY or BAILIAN_API_KEY in local settings.',
    })
  })

  test('rejects non-audio payloads before calling DashScope', async () => {
    process.env.DASHSCOPE_API_KEY = 'test-key'
    let called = false
    globalThis.fetch = (async () => {
      called = true
      return Response.json({})
    }) as typeof fetch

    const { req, url, segments } = makeRequest({
      audio: 'data:text/plain;base64,SGVsbG8=',
    })
    const response = await handleAudioTranscriptionApi(req, url, segments)

    expect(response.status).toBe(400)
    expect(called).toBe(false)
  })
})
