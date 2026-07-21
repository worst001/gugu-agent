/**
 * CORS middleware for local desktop app communication
 */

const ALLOWED_ORIGIN_RE =
  /^(?:http:\/\/(?:localhost|127\.0\.0\.1):1420|https?:\/\/tauri\.localhost|tauri:\/\/localhost|asset:\/\/localhost)$/

export function isTrustedOrigin(origin?: string | null): boolean {
  return !origin || ALLOWED_ORIGIN_RE.test(origin)
}

export function corsHeaders(origin?: string | null): Record<string, string> {
  // Allow the desktop dev server and Tauri WebView origins.
  const allowedOrigin =
    origin && ALLOWED_ORIGIN_RE.test(origin) ? origin : 'http://localhost:1420'
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  }
}
