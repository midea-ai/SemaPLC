// Node 26 defines `localStorage` on globalThis as undefined (Web Compatibility spec),
// which shadows jsdom's window.localStorage. This file restores jsdom's localStorage
// when running in the jsdom environment.
if (typeof document !== 'undefined') {
  // In jsdom, document.defaultView is the real jsdom Window object
  const win = document.defaultView as any
  if (win && typeof win._localStorage !== 'undefined') {
    Object.defineProperty(globalThis, 'localStorage', {
      get: () => win._localStorage,
      set: () => {},
      configurable: true,
    })
  }
}
