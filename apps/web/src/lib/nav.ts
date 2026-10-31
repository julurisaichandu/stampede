import { useSyncExternalStore } from 'react'
import { flushSync } from 'react-dom'

const listeners = new Set<() => void>()
const notify = () => listeners.forEach((listener) => listener())

function subscribe(listener: () => void) {
  listeners.add(listener)
  window.addEventListener('popstate', listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('popstate', listener)
  }
}

export const usePathname = () => useSyncExternalStore(subscribe, () => location.pathname)

export function navigate(path: string) {
  history.pushState(null, '', path)
  notify()
}

// flushSync commits the new screen inside the callback, or the browser snapshots the old one twice.
export function morphTo(path: string) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
  if (!document.startViewTransition || reduced) return navigate(path)
  document.startViewTransition(() => flushSync(() => navigate(path)))
}
