// stamped — the Clerk's line to the PermitActor. The actor has no status RPC: status moves only over a socket whose
// grant carries role "clerk". Grants are signed with DURABLE_ACTORS_SECRET, so only this backend can mint one.
// Browser-facing routes must never mint role "clerk".
import { actors } from "../generated/index.js"
import type { PermitStatus } from "../contracts.ts"

type Role = actors.Permit.Metadata["role"]
type Reply = { type: "ack"; requestId: string; status: PermitStatus } | { type: "denied"; requestId: string; reason: string }

const TIMEOUT_MS = 5000

export async function openStatusSocket(permitId: string, role: Role = "clerk") {
  const { websocketUrl } = await actors.Permit.prepareWebsocket({ actorId: permitId, metadata: { role } })
  const socket = new WebSocket(websocketUrl)
  const pending = new Map<string, (reply: Reply) => void>()

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data)) as { type: string }
    if (message.type !== "ack" && message.type !== "denied") return // state frames are for screens
    const reply = message as Reply
    pending.get(reply.requestId)?.(reply)
    pending.delete(reply.requestId)
  })
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true })
    socket.addEventListener("error", reject, { once: true })
  })

  return {
    /** Resolves with the new status, or rejects with the actor's reason. */
    setStatus(to: PermitStatus, why: string): Promise<PermitStatus> {
      const requestId = crypto.randomUUID()
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(requestId)
          reject(new Error(`No reply to setStatus ${to} within ${TIMEOUT_MS} ms`))
        }, TIMEOUT_MS)
        pending.set(requestId, (reply) => {
          clearTimeout(timer)
          if (reply.type === "ack") resolve(reply.status)
          else reject(new Error(reply.reason))
        })
        socket.send(JSON.stringify({ type: "setStatus", to, why, requestId }))
      })
    },
    close: () => socket.close(),
  }
}
