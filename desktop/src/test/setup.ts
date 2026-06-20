try {
  localStorage.setItem('cc-haha-locale', 'en')
} catch {
  // localStorage may be unavailable in non-jsdom test environments.
}

const originalConsoleError = console.error.bind(console)

console.error = (...args: unknown[]) => {
  const first = typeof args[0] === 'string' ? args[0] : ''
  // Full-shell UI tests intentionally mount async hydration effects; keep the generic act noise out of regression output.
  const isReactActWarning =
    first.startsWith('Warning: An update to ') &&
    first.includes(' inside a test was not wrapped in act(...)')
  const showActWarnings =
    (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.GUGU_SHOW_ACT_WARNINGS ===
    '1'

  if (isReactActWarning && !showActWarnings) {
    return
  }

  originalConsoleError(...args)
}
