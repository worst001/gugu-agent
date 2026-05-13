try {
  localStorage.setItem('cc-haha-locale', 'en')
} catch {
  // localStorage may be unavailable in non-jsdom test environments.
}
