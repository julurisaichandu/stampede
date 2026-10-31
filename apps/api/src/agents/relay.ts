// stamped — thin Agent Relay layer. One connection per agent; envelopes out (with their relayLog line) and in
// (deduped in the PermitActor, so redelivery and restarts are safe). Relay is for talking; the actor remembers.
import { setTimeout as sleep } from "node:timers/promises"

import { AgentRelay, type RelayAgentClient } from "@agent-relay/sdk"

import { RelayEnvelope, permitChannel, relayKey, type RelayLogEntry } from "../../contracts.ts"
import { actors } from "../../generated/index.js"

export type AgentName = RelayEnvelope["sender"]

type Received = { metadata?: unknown; text?: string }
type Wire = {
  client?: RelayAgentClient
  post(envelope: RelayEnvelope, key: string): Promise<unknown>
  say(permitId: string, text: string): Promise<unknown>
  listen(dispatch: (message: Received) => void): void
}

const HOSTED = "https://armadillo.agentrelay.com"
const LOCAL_POST_MS = 900

function env(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set in apps/api/.env`)
  return value
}

/** Receivers read metadata first, then JSON.parse(text). Anything else (plain chat lines) is ignored. */
function parse(metadata: unknown, text: string | undefined): RelayEnvelope | null {
  const fromMetadata = RelayEnvelope.safeParse(metadata)
  if (fromMetadata.success) return fromMetadata.data
  try {
    const fromText = RelayEnvelope.safeParse(JSON.parse(text ?? ""))
    return fromText.success ? fromText.data : null
  } catch {
    return null
  }
}

// OFFICE_LOCAL runs the same agents on an in-process bus, for a laptop with no Relay keys or a Relay outage on stage.
const bus = new Set<(message: Received) => void>()
const localWire: Wire = {
  async post(envelope) {
    await sleep(LOCAL_POST_MS)
    for (const listener of bus) listener({ metadata: envelope })
  },
  async say() {},
  listen: (dispatch) => void bus.add(dispatch),
}

async function relayWire(name: AgentName): Promise<Wire> {
  // The SDK reads no env vars: key and base URL go in code.
  const workspaceKey = env("RELAY_WORKSPACE_KEY")
  const baseUrl = process.env.RELAY_BASE_URL || (workspaceKey.startsWith("ar_ws_") ? HOSTED : undefined)
  const relay = new AgentRelay({ workspaceKey, ...(baseUrl ? { baseUrl } : {}) })
  const client = await relay.workspace.reconnect({ apiToken: env(`RELAY_${name.toUpperCase()}_TOKEN`) })
  return {
    client,
    post: (envelope, key) =>
      client.sendMessage({ to: `#${permitChannel(envelope.permitId)}`, text: JSON.stringify(envelope), metadata: envelope, idempotencyKey: key }),
    say: (permitId, text) => client.sendMessage({ to: `#${permitChannel(permitId)}`, text }),
    listen(dispatch) {
      // Live events need Relay's broker ("node transport"), which this process does not run, and an invite does not
      // subscribe anyone. So read the permit channels directly: pick up new ones, then fetch what arrived since the
      // last message seen. The first read replays a channel's history; claims in the actor make re-reads safe.
      const lastSeen = new Map<string, bigint>()
      let busy = false
      const poll = async () => {
        for (const channel of await client.channels.list()) {
          if (channel.name.startsWith("permit-") && !lastSeen.has(channel.name)) lastSeen.set(channel.name, 0n)
        }
        for (const [channel, after] of lastSeen) {
          const fresh = (await client.messages.list(channel, { limit: 100 }))
            .filter((m) => BigInt(m.id) > after)
            .sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1))
          for (const m of fresh) dispatch(m)
          if (fresh.length) lastSeen.set(channel, BigInt(fresh[fresh.length - 1]!.id))
        }
      }
      setInterval(() => {
        if (busy) return
        busy = true
        poll()
          .catch((error) => console.error(`[${name}] reading permit channels failed:`, error))
          .finally(() => (busy = false))
      }, 1500)
    },
  }
}

export async function connect(name: AgentName) {
  const wire = process.env.OFFICE_LOCAL === "1" ? localWire : await relayWire(name)
  const queues = new Map<string, Promise<void>>()

  return {
    name,
    client: wire.client,

    /** Logs one human sentence for the office feed, then posts the envelope at the channel's top level. */
    async send(e: Omit<RelayEnvelope, "sender" | "timestamp">, text: string): Promise<void> {
      const envelope: RelayEnvelope = { ...e, sender: name, timestamp: new Date().toISOString() }
      const key = relayKey(envelope)
      const entry: RelayLogEntry = { at: envelope.timestamp, sender: name, type: envelope.type, revision: envelope.revision, text }
      await actors.Permit.get(e.permitId).logRelay(key, entry)
      await wire.post(envelope, key)
    },

    /** A plain chat line. Not an envelope, so other agents ignore it; it is there for people reading the channel. */
    async say(permitId: string, text: string): Promise<void> {
      await wire.say(permitId, text)
    },

    /** Runs handler once per envelope from another agent, one at a time per permit. */
    on(handler: (e: RelayEnvelope) => Promise<void>): void {
      wire.listen((message) => {
        const envelope = parse(message.metadata, message.text)
        if (!envelope || envelope.sender === name) return
        const work = async () => {
          if (!(await actors.Permit.get(envelope.permitId).claim(name, relayKey(envelope)))) return
          await handler(envelope)
        }
        const next = (queues.get(envelope.permitId) ?? Promise.resolve())
          .then(work)
          .catch((error) => console.error(`[${name}] ${envelope.type} for ${envelope.permitId} failed:`, error))
        queues.set(envelope.permitId, next)
      })
    },
  }
}

export type Agent = Awaited<ReturnType<typeof connect>>
