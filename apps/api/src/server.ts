import { randomUUID } from "node:crypto"
import { serve } from "@hono/node-server"
import { Hono, type Context } from "hono"
import { bodyLimit } from "hono/body-limit"
import { HTTPException } from "hono/http-exception"
import { z } from "zod"
import {
  currentFindings,
  missingMinimum,
  type ChatMessage,
  type Deck,
  type PermitApplication,
  type RelayEnvelope,
} from "../contracts.ts"
import { actors } from "../generated/index.js"
import { permitActor } from "./actor.ts"
import {
  MAX_PLAN_BYTES,
  planLine,
  type ApiFailure,
  type ChatResponse,
  type CreatePermitResponse,
  type GisLookup,
  type LookupResponse,
  type ReviewBlocked,
  type ReviewOk,
  type SocketGrant,
} from "./api-types.ts"
import { lookup } from "./gis.ts"
import { explainFindings } from "./intake/explain.ts"
import { planMime, readPlanTurn } from "./intake/plan.ts"
import { composeReply, nextQuestion, readUserTurn, type Turn } from "./intake/turn.ts"
import { onNeedsInput, openPermitChannel, post, relayMode } from "./relay.ts"

const PORT = 8787
const HOST = "127.0.0.1" // Vite proxies here. Anything wider lets the venue wifi spend Relay and OpenAI calls.
const MAX_BODY_BYTES = 16 * 1024
const MAX_PLAN_BODY_BYTES = (MAX_PLAN_BYTES * 4) / 3 + 64 * 1024
const PERMIT_ID = /^[A-Za-z0-9._-]+$/
const GREETING = "Upload your plans and I'll read them. No plans yet? Tell me about the deck you want to build, starting with the address."
const REVIEWERS_UNREACHABLE =
  "I couldn't reach the reviewers with your revision. Send me any message and I'll try again."

const ChatBody = z.object({ text: z.string().trim().min(1).max(2000) })
const LookupBody = z.object({ address: z.string().trim().min(1).max(300), apn: z.string().min(1).max(32).nullable() })
const PlanBody = z.object({
  name: z.string().trim().min(1).max(300), // above every filesystem's name limit, so no real file can fail it
  data: z
    .string()
    .min(1)
    .max(Math.ceil((MAX_PLAN_BYTES * 4) / 3) + 4)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/),
  note: z.string().trim().max(2000),
})
const FindingIds = z.array(z.string())

const assistant = (content: string, at = new Date().toISOString()): ChatMessage => ({ role: "assistant", content, at })

// ponytail: one promise per permit for the life of the process, and one API process only.
const tails = new Map<string, Promise<unknown>>()

// A second message must see the first one's writes, or two sends make two revisions.
function serial<T>(id: string, work: () => Promise<T>): Promise<T> {
  const run = (tails.get(id) ?? Promise.resolve()).then(work, work)
  tails.set(id, run)
  return run
}

// The actor answers any id with default state, so empty chat means no such permit.
async function load(id: string) {
  const permit = await permitActor(id).read()
  if (!permit.chat.length) throw new HTTPException(404, { message: "We can't find that permit." })
  return permit
}

function permitId(c: Context): string {
  const id = c.req.param("id")
  if (!id || !PERMIT_ID.test(id)) throw new HTTPException(400, { message: "That permit id isn't valid." })
  return id
}

async function readBody<T>(c: Context, schema: z.ZodType<T>): Promise<T> {
  // A cross-site form can send text/plain with no preflight. It can't send this.
  if (!c.req.header("content-type")?.startsWith("application/json")) {
    throw new HTTPException(400, { message: "That request isn't valid." })
  }
  const parsed = schema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) throw new HTTPException(400, { message: "That request isn't valid." })
  return parsed.data
}

const deckChanges = (from: Deck, to: Partial<Deck>) =>
  Object.entries(to).filter(([key, value]) => from[key as keyof Deck] !== value)
const changedPaths = (changes: [string, unknown][]) => changes.map(([key]) => `deck.${key}`)

function sendRevision(permitId: string, revision: number, changedFields: string[]) {
  const envelope = { permitId, revision, type: "REVISION_SUBMITTED", payload: { changedFields } } as const
  const line = `Intake sent revision ${revision} to Clerk.`
  void (async () => {
    if ((await post(envelope, line)) || (await post(envelope, line))) return
    await permitActor(permitId).appendChat(assistant(REVIEWERS_UNREACHABLE))
  })().catch((err) => console.warn("[api] revision send failed", err))
}

// The contract can't clear a property, so a failed address change has to say what the file still holds.
function noteKeptParcel(reply: string, found: GisLookup | null, property: PermitApplication["property"]) {
  return found && !found.property && property ? `${reply} Your file still shows ${property.address}.` : reply
}

// For a NEEDS_INPUT that was missed or failed. The status event's `at` is the durable dedupe.
async function explainMissed(id: string) {
  const actor = permitActor(id)
  const permit = await actor.read()
  const moved = permit.events.at(-1)
  if (permit.status !== "CORRECTIONS_REQUESTED" || moved?.to !== "CORRECTIONS_REQUESTED") return
  if (permit.chat.some((m) => m.role === "assistant" && m.at >= moved.at)) return
  const corrections = currentFindings(permit.findings).filter((f) => f.status === "CORRECTION")
  if (corrections.length) await actor.appendChat(assistant(await explainFindings(corrections), moved.at))
}

async function chatTurn(
  id: string,
  text: string,
  read: (loaded: Pick<PermitApplication, "chat" | "property">) => Promise<Turn> = ({ chat }) => readUserTurn(chat, text),
): Promise<ChatResponse> {
  const actor = permitActor(id)
  await explainMissed(id)
  const loaded = await load(id)
  await actor.appendChat({ role: "user", content: text, at: new Date().toISOString() })
  const turn = await read(loaded)

  // Read after the model call: Clerk can move the status while it runs.
  let permit = await actor.read()
  const draftOpen = permit.status === "INTAKE" && !permit.intake.complete
  const found = turn.ok && turn.facts.address && draftOpen ? await lookup(turn.facts.address) : null
  let revisionToSend: { revision: number; changedFields: string[] } | null = null
  let outcome: Parameters<typeof composeReply>[0]["outcome"] = "none"

  if (turn.ok && draftOpen) {
    if (found?.property) await actor.setProperty(found.property)
    const stated = changedPaths(Object.entries(turn.facts.deck))
    const unknownFields = [...new Set([...permit.intake.unknownFields, ...turn.facts.unknown])].filter(
      (path) => !stated.includes(path),
    )
    const missingFields = missingMinimum({
      property: found?.property ?? permit.property,
      deck: { ...permit.deck, ...turn.facts.deck },
      intake: { ...permit.intake, unknownFields },
    })
    await actor.applyIntakePatch({ deck: turn.facts.deck, unknownFields, missingFields })
    outcome = "applied"
  } else if (permit.status === "CORRECTIONS_REQUESTED") {
    const frozen = permit.revisions.at(-1)
    if (frozen && permit.revision > frozen.revision) {
      revisionToSend = {
        revision: permit.revision,
        changedFields: changedPaths(deckChanges(frozen.deck, permit.deck)),
      }
      outcome = "revision_pending"
    } else if (turn.ok && !turn.facts.invalid.length) {
      const changes = deckChanges(permit.deck, turn.facts.deck)
      if (changes.length) {
        const changedFields = changedPaths(changes)
        const revision = await actor.submitRevision({ deck: Object.fromEntries(changes), changedFields })
        revisionToSend = { revision, changedFields }
        outcome = "revision_submitted"
      }
    }
  } else if (permit.status !== "INTAKE") {
    outcome = "locked"
  } else if (permit.intake.complete) {
    outcome = "review_not_sent" // Only the office moves the status, so nothing has confirmed the post landed.
  }

  // composeReply needs this read from before the post, while the status is still CORRECTIONS_REQUESTED.
  permit = await actor.read()
  const reply = noteKeptParcel(composeReply({ turn, lookup: found, permit, outcome }), found, permit.property)
  await actor.appendChat(assistant(reply))
  if (revisionToSend) sendRevision(id, revisionToSend.revision, revisionToSend.changedFields)
  return { reply, lookup: found }
}

const PICK: Turn = {
  ok: true,
  intent: "provide_project_details",
  ack: "",
  facts: { address: null, deck: {}, unknown: [], invalid: [] },
}

async function pickCandidate(id: string, address: string, apn: string | null): Promise<LookupResponse> {
  const actor = permitActor(id)
  const permit = await load(id)
  if (permit.status !== "INTAKE" || permit.intake.complete) {
    throw new HTTPException(409, { message: "Your file is already with the reviewers." })
  }
  const found = await lookup(address, { apn })
  await actor.appendChat({ role: "user", content: address, at: new Date().toISOString() })
  if (found.property) {
    await actor.setProperty(found.property)
    await actor.applyIntakePatch({
      deck: {},
      unknownFields: permit.intake.unknownFields,
      missingFields: missingMinimum({ ...permit, property: found.property }),
    })
  }
  const after = await actor.read()
  const reply = noteKeptParcel(
    composeReply({ turn: PICK, lookup: found, permit: after, outcome: "applied" }),
    found,
    after.property,
  )
  await actor.appendChat(assistant(reply))
  return { reply, lookup: found }
}

async function explainCorrections(e: RelayEnvelope) {
  const actor = permitActor(e.permitId)
  const permit = await actor.read()
  if (e.revision < permit.revision) return
  const moved = permit.events.at(-1)?.at
  if (permit.chat.some((m) => m.role === "assistant" && (m.at === e.timestamp || m.at === moved))) return
  const ids = FindingIds.safeParse(e.payload.findingIds)
  const listed = permit.findings.filter((f) => ids.data?.includes(f.findingId))
  if (!listed.length) {
    console.warn("[api] NEEDS_INPUT listed no findings on", e.permitId)
    return explainMissed(e.permitId)
  }
  await actor.appendChat(assistant(await explainFindings(listed), e.timestamp))
}

const app = new Hono()

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json<ApiFailure>({ error: err.message, retryable: false }, err.status)
  }
  console.error("[api]", err)
  return c.json<ApiFailure>({ error: "Something went wrong on our side. Please try again.", retryable: true }, 500)
})
app.notFound((c) => c.json<ApiFailure>({ error: "Not found.", retryable: false }, 404))
const messageLimit = bodyLimit({
  maxSize: MAX_BODY_BYTES,
  onError: (c) => c.json<ApiFailure>({ error: "That message is too long.", retryable: false }, 413),
})
const planLimit = bodyLimit({
  maxSize: MAX_PLAN_BODY_BYTES,
  onError: (c) => c.json<ApiFailure>({ error: "That file is too large. Send a plan under 10 MB.", retryable: false }, 413),
})
app.use("/api/*", (c, next) => (c.req.path.endsWith("/plan") ? planLimit : messageLimit)(c, next))

app.post("/api/permits", async (c) => {
  const id = randomUUID()
  await permitActor(id).appendChat(assistant(GREETING))
  openPermitChannel(id).catch((err) => console.warn("[relay] background open failed", err))
  return c.json<CreatePermitResponse>({ id })
})

app.get("/api/permits/:id", async (c) => {
  const id = permitId(c)
  return c.json({ id, ...(await load(id)) })
})

app.post("/api/permits/:id/chat", async (c) => {
  const id = permitId(c)
  const { text } = await readBody(c, ChatBody)
  return c.json<ChatResponse>(await serial(id, () => chatTurn(id, text)))
})

app.post("/api/permits/:id/plan", async (c) => {
  const id = permitId(c)
  const { name, data, note } = await readBody(c, PlanBody)
  const mime = planMime(data)
  if (!mime) throw new HTTPException(415, { message: "Send your plan as a PDF, PNG, JPEG or WebP." })
  const reply = await serial(id, () =>
    chatTurn(id, planLine(name, note), (permit) => readPlanTurn({ mime, base64: data }, note, permit.property?.address ?? null)),
  )
  return c.json<ChatResponse>(reply)
})

app.post("/api/permits/:id/lookup", async (c) => {
  const id = permitId(c)
  const { address, apn } = await readBody(c, LookupBody)
  return c.json<LookupResponse>(await serial(id, () => pickCandidate(id, address, apn)))
})

app.post("/api/permits/:id/review", async (c) => {
  const id = permitId(c)
  const permit = await serial(id, async () => {
    const current = await load(id)
    if (current.status !== "INTAKE") return current
    const missing = missingMinimum(current)
    if (missing.length) return { ...current, missing }
    if (!current.intake.complete) await permitActor(id).confirmIntake(new Date().toISOString())
    return current
  })
  if ("missing" in permit) {
    return c.json<ReviewBlocked>({ missing: permit.missing, question: nextQuestion(permit) }, 422)
  }
  if (permit.status !== "INTAKE") return c.json<ReviewOk>({ status: permit.status })

  // Outside serial: Relay takes seconds here, and chat should keep answering while it does.
  try {
    await openPermitChannel(id)
    if (await post({ permitId: id, revision: permit.revision, type: "REVIEW_REQUEST", payload: {} }, "Intake sent the file to Clerk.")) {
      return c.json<ReviewOk>({ status: (await permitActor(id).read()).status })
    }
  } catch (err) {
    console.warn("[relay] review send failed", err)
  }
  return c.json<ApiFailure>({ error: "We couldn't reach the reviewers. Please try again.", retryable: true }, 503)
})

app.post("/api/permits/:id/socket", async (c) => {
  c.header("Cache-Control", "no-store")
  const id = permitId(c)
  await load(id)
  // Not awaited: an explanation is a model call, and the page needs its socket now.
  serial(id, () => explainMissed(id)).catch((err) => console.warn("[api] missed explanation failed", err))
  const { websocketUrl } = await actors.Permit.prepareWebsocket({ actorId: id, metadata: { role: "viewer" } })
  return c.json<SocketGrant>({ websocketUrl })
})

if (relayMode() === "local") await import("./agents/index.ts")
onNeedsInput((e) => serial(e.permitId, () => explainCorrections(e)))

serve({ fetch: app.fetch, port: PORT, hostname: HOST }, () => console.log(`[api] listening on ${PORT}, relay mode ${relayMode()}`))

// The first request with a schema is slower. readUserTurn never rejects.
void readUserTurn([], "I want a backyard deck at 14630 Noble Ave, San Jose, about 16 by 12 feet.")
