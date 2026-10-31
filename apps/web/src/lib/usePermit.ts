import { useEffect, useState } from 'react'
import { emptyPermit, type PermitApplication } from '../../../api/contracts.ts'
import type { SocketGrant } from '../../../api/src/api-types.ts'

type Live = { id: string; permit: PermitApplication | null; connected: boolean; missing: boolean }

type Frame =
  | { type: 'state'; state: Partial<PermitApplication> }
  | { type: 'state_update'; changes: Partial<PermitApplication>; removed?: string[] }
  | { type: string }

// The state frame has no id, because id is the actor's address, so it comes from the URL.
export function mergeFrame(id: string, permit: PermitApplication | null, frame: Frame): PermitApplication | null {
  const empty = emptyPermit(id)
  if (frame.type === 'state' && 'state' in frame) return { ...empty, ...frame.state, id }
  if (frame.type !== 'state_update' || !('changes' in frame)) return permit
  const next: PermitApplication = { ...(permit ?? empty), ...frame.changes, id }
  for (const key of frame.removed ?? []) {
    if (key in empty) Object.assign(next, { [key]: empty[key as keyof PermitApplication] })
  }
  return next
}

const MAX_RETRY_MS = 8_000

export function usePermit(id: string): { permit: PermitApplication | null; connected: boolean; missing: boolean } {
  const [live, setLive] = useState<Live>({ id, permit: null, connected: false, missing: false })

  useEffect(() => {
    let cancelled = false
    let socket: WebSocket | null = null
    let retry: ReturnType<typeof setTimeout> | undefined
    let attempt = 0

    const update = (change: (prev: Live) => Partial<Live>) =>
      setLive((prev) => {
        const base = prev.id === id ? prev : { id, permit: null, connected: false, missing: false }
        return { ...base, ...change(base) }
      })

    const reconnect = () => {
      if (cancelled) return
      update(() => ({ connected: false }))
      retry = setTimeout(connect, Math.min(500 * 2 ** attempt, MAX_RETRY_MS))
      attempt += 1
    }

    // Grants last about 60 s, so every attempt fetches a new one.
    async function connect() {
      let grant: SocketGrant
      try {
        const res = await fetch(`/api/permits/${encodeURIComponent(id)}/socket`, { method: 'POST' })
        if (cancelled) return
        if (res.status === 404) return update(() => ({ missing: true, connected: false }))
        if (!res.ok) return reconnect()
        grant = await res.json()
      } catch {
        return reconnect()
      }
      if (cancelled) return

      const ws = new WebSocket(grant.websocketUrl)
      socket = ws
      ws.addEventListener('message', (event) => {
        if (cancelled) return
        const frame = JSON.parse(event.data) as Frame
        if (frame.type === 'state') {
          attempt = 0
          update(() => ({ connected: true, missing: false }))
        }
        update((prev) => ({ permit: mergeFrame(id, prev.permit, frame) }))
      })
      ws.addEventListener('close', reconnect)
    }

    connect()
    return () => {
      cancelled = true
      clearTimeout(retry)
      socket?.close()
    }
  }, [id])

  return live.id === id ? live : { permit: null, connected: false, missing: false }
}
