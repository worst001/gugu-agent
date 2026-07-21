import { describe, expect, it } from 'bun:test'
import { corsHeaders, isTrustedOrigin } from './cors'

describe('corsHeaders', () => {
  it('allows localhost browser origins', () => {
    expect(corsHeaders('http://127.0.0.1:1420')['Access-Control-Allow-Origin']).toBe('http://127.0.0.1:1420')
    expect(corsHeaders('http://localhost:1420')['Access-Control-Allow-Origin']).toBe('http://localhost:1420')
  })

  it('allows tauri webview origins used in production builds', () => {
    expect(corsHeaders('http://tauri.localhost')['Access-Control-Allow-Origin']).toBe('http://tauri.localhost')
    expect(corsHeaders('https://tauri.localhost')['Access-Control-Allow-Origin']).toBe('https://tauri.localhost')
    expect(corsHeaders('tauri://localhost')['Access-Control-Allow-Origin']).toBe('tauri://localhost')
  })

  it('falls back for unknown origins', () => {
    expect(corsHeaders('https://example.com')['Access-Control-Allow-Origin']).toBe('http://localhost:1420')
    expect(corsHeaders(null)['Access-Control-Allow-Origin']).toBe('http://localhost:1420')
  })
})

describe('isTrustedOrigin', () => {
  it('allows requests without an Origin and known desktop origins', () => {
    expect(isTrustedOrigin(null)).toBe(true)
    expect(isTrustedOrigin(undefined)).toBe(true)
    expect(isTrustedOrigin('http://localhost:1420')).toBe(true)
    expect(isTrustedOrigin('tauri://localhost')).toBe(true)
  })

  it('rejects explicit foreign origins', () => {
    expect(isTrustedOrigin('https://attacker.example')).toBe(false)
    expect(isTrustedOrigin('http://127.0.0.1:43123')).toBe(false)
  })
})
