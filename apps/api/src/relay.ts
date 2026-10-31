import { permitChannel, type RelayEnvelope } from "../contracts.ts"
import { connect as connectAgent, type Agent } from "./agents/relay.ts"

const OFFICE_AGENTS = ["clerk", "building", "zoning"]
const LISTEN_RETRY_MS = 5_000

type Handler = (e: RelayEnvelope) => void | Promise<void>

export function relayMode(): "real" | "local" | "off" {
  if (process.env.OFFICE_LOCAL === "1") return "local"
  return process.env.RELAY_WORKSPACE_KEY && process.env.RELAY_INTAKE_TOKEN ? "real" : "off"
}

// The SDK sets no fetch timeout. Read per call so a check can shorten it.
function within<T>(work: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("relay timeout")), Number(process.env.RELAY_POST_TIMEOUT_MS ?? 12_000))
  })
  return Promise.race([work, limit]).finally(() => clearTimeout(timer))
}

let intake: Promise<Agent> | undefined

function connect(): Promise<Agent> {
  intake ??= within(connectAgent("intake")).catch((err) => {
    intake = undefined
    throw err
  })
  return intake
}

const channels = new Map<string, Promise<void>>()

// Each Relay write takes seconds and an open is five of them, so the bound is per write.
async function openChannel(permitId: string) {
  const name = permitChannel(permitId)
  const { client } = await connect()
  await within(client!.channels.create({ name, topic: `Permit ${permitId}` })).catch((err) => {
    if (err?.code !== "name_conflict") throw err
  })
  await within(client!.channels.join(name))
  // A failed open must reject: an agent left uninvited never hears REVIEW_REQUEST, and /review would still return 200.
  for (const agent of OFFICE_AGENTS) {
    await within(client!.channels.invite(name, agent)).catch(() => within(client!.channels.invite(name, agent)))
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

export async function post(e: Omit<RelayEnvelope, "sender" | "timestamp">, text: string): Promise<boolean> {
  if (relayMode() === "off") {
    console.warn("[relay] no RELAY keys and OFFICE_LOCAL is not 1. Nothing reaches the office.")
    return false
  }
  try {
    const agent = await connect()
    await within(agent.send(e, text))
    return true
  } catch (err) {
    console.warn("[relay] post failed", err)
    return false
  }
}

export function onNeedsInput(handler: Handler) {
  if (relayMode() === "off") return
  connect()
    .then((agent) =>
      agent.on(async (e) => {
        if (e.type === "NEEDS_INPUT" && e.sender === "clerk") await handler(e)
      }),
    )
    .catch((err) => {
      console.warn("[relay] connect failed", err)
      setTimeout(() => onNeedsInput(handler), LISTEN_RETRY_MS)
    })
}
