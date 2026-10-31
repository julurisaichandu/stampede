import { AgentRelay, type RelayAgentClient } from "@agent-relay/sdk"
import { permitChannel, relayKey, RelayEnvelope } from "../contracts.ts"

const OFFICE_AGENTS = ["clerk", "building", "zoning"]

type Handler = (e: RelayEnvelope) => void | Promise<void>
const handlers = new Set<Handler>()

export function relayMode(): "real" | "fake" | "off" {
  if (process.env.RELAY_WORKSPACE_KEY && process.env.RELAY_INTAKE_TOKEN) return "real"
  return process.env.FAKE_OFFICE === "1" ? "fake" : "off"
}

// The SDK sets no fetch timeout. Read per call so a check can shorten it.
function within<T>(work: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("relay timeout")), Number(process.env.RELAY_POST_TIMEOUT_MS ?? 12_000))
  })
  return Promise.race([work, limit]).finally(() => clearTimeout(timer))
}

// ponytail: in-memory dedupe, gone on restart. The NEEDS_INPUT handler's chat check is the durable one.
const seen = new Set<string>()
const latestRevision = new Map<string, number>()

export async function deliver(e: RelayEnvelope) {
  const key = relayKey(e)
  if (e.type !== "NEEDS_INPUT" || seen.has(key)) return
  if (e.revision < (latestRevision.get(e.permitId) ?? 0)) return
  seen.add(key)
  latestRevision.set(e.permitId, e.revision)
  try {
    await Promise.all([...handlers].map((handler) => handler(e)))
  } catch (err) {
    seen.delete(key)
    console.warn("[relay] NEEDS_INPUT handler failed", err)
  }
}

function readEnvelope(metadata: unknown, text: string): RelayEnvelope | null {
  const fromMetadata = RelayEnvelope.safeParse(metadata)
  if (fromMetadata.success) return fromMetadata.data
  try {
    return RelayEnvelope.safeParse(JSON.parse(text)).data ?? null
  } catch {
    return null
  }
}

let intake: Promise<RelayAgentClient> | undefined

function connect(): Promise<RelayAgentClient> {
  intake ??= within(
    (async () => {
      const workspaceKey = process.env.RELAY_WORKSPACE_KEY!
      const relay = new AgentRelay({
        workspaceKey,
        baseUrl:
          process.env.RELAY_BASE_URL ??
          (workspaceKey.startsWith("ar_ws_") ? "https://armadillo.agentrelay.com" : undefined),
        retryPolicy: { maxRetries: 1 }, // the default 3 costs about 7 s against a dead host
        onError: (err, ctx) => console.warn("[relay]", ctx, err),
      })
      const client = await relay.workspace.reconnect({ apiToken: process.env.RELAY_INTAKE_TOKEN! })
      relay.addListener("message.created", async ({ message, envelope }) => {
        if (envelope.from?.name !== "clerk" || !envelope.channel?.name?.startsWith("permit-")) return
        const parsed = readEnvelope(message.metadata, message.text)
        if (parsed) await deliver(parsed)
      })
      return client
    })(),
  ).catch((err) => {
    intake = undefined
    throw err
  })
  return intake
}

const channels = new Map<string, Promise<void>>()

// Each Relay write takes seconds and an open is five of them, so the bound is per write.
async function openChannel(permitId: string) {
  const name = permitChannel(permitId)
  const client = await connect()
  await within(client.channels.create({ name, topic: `Permit ${permitId}` })).catch((err) => {
    if (err?.code !== "name_conflict") throw err
  })
  await within(client.channels.join(name))
  // A failed open must reject: an agent left uninvited never hears REVIEW_REQUEST, and /review would still return 200.
  for (const agent of OFFICE_AGENTS) {
    await within(client.channels.invite(name, agent)).catch(() => within(client.channels.invite(name, agent)))
  }
}

export async function openPermitChannel(permitId: string): Promise<void> {
  if (relayMode() !== "real") return
  let open = channels.get(permitId)
  if (!open) {
    open = openChannel(permitId).catch((err) => {
      channels.delete(permitId)
      throw err
    })
    channels.set(permitId, open)
  }
  return open
}

let warnedOff = false

export async function post(e: Omit<RelayEnvelope, "sender" | "timestamp">): Promise<boolean> {
  const envelope: RelayEnvelope = { ...e, sender: "intake", timestamp: new Date().toISOString() }
  const mode = relayMode()
  try {
    if (mode === "fake") {
      const { receive } = await import("./dev/fake-office.ts")
      receive(envelope, deliver).catch((err) => console.warn("[fake office] run failed", err))
      return true
    }
    if (mode === "real") {
      await within(
        connect().then((client) =>
          client.sendMessage({
            to: `#${permitChannel(e.permitId)}`,
            text: JSON.stringify(envelope),
            metadata: envelope,
            idempotencyKey: relayKey(e),
          }),
        ),
      )
      return true
    }
  } catch (err) {
    console.warn("[relay] post failed", err)
    return false
  }
  if (!warnedOff) console.warn("[relay] no RELAY keys and FAKE_OFFICE is not 1. Nothing reaches the office.")
  warnedOff = true
  return false
}

export function onNeedsInput(handler: Handler): () => void {
  handlers.add(handler)
  if (relayMode() === "real") connect().catch((err) => console.warn("[relay] connect failed", err))
  return () => handlers.delete(handler)
}
