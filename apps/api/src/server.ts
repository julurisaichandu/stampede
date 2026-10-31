import { randomUUID } from "node:crypto"
import { serve } from "@hono/node-server"
import { Hono, type Context } from "hono"
import { HTTPException } from "hono/http-exception"
import { z } from "zod"
import { missingMinimum, type ChatMessage, type Deck, type RelayEnvelope } from "../contracts.ts"
import { actors } from "../generated/index.js"
import { permitActor } from "./actor.ts"
import type {
  ApiFailure,
  ChatResponse,
  CreatePermitResponse,
  LookupResponse,
  ReviewBlocked,
  ReviewOk,
  SocketGrant,
} from "./api-types.ts"
import { lookup } from "./gis.ts"
import { explainFindings } from "./intake/explain.ts"
import { composeReply, nextQuestion, readUserTurn, type Turn } from "./intake/turn.ts"
import { onNeedsInput, openPermitChannel, post, relayMode } from "./relay.ts"

const PORT = 8787
const PERMIT_ID = /^[A-Za-z0-9._-]+$/
const GREETING = "Tell me about the deck you want to build. I'll start with the address."
const REVIEWERS_UNREACHABLE =
  "I couldn't reach the reviewers with your revision. Send me any message and I'll try again."

const ChatBody = z.object({ text: z.string().trim().min(1).max(2000) })
const LookupBody = z.object({ address: z.string().trim().min(1).max(300), apn: z.string().min(1).max(32).nullable() })
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
  const parsed = schema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) throw new HTTPException(400, { message: "That request isn't valid." })
  return parsed.data
}

const deckChanges = (from: Deck, to: Partial<Deck>) =>
  Object.entries(to).filter(([key, value]) => from[key as keyof Deck] !== value)
const changedPaths = (changes: [string, unknown][]) => changes.map(([key]) => `deck.${key}`)

function sendRevision(permitId: string, revision: number, changedFields: string[]) {
  const envelope = { permitId, revision, type: "REVISION_SUBMITTED", payload: { changedFields } } as const
  void (async () => {
    if ((await post(envelope)) || (await post(envelope))) return
    await permitActor(permitId).appendChat(assistant(REVIEWERS_UNREACHABLE))
  })().catch((err) => console.warn("[api] revision send failed", err))
}

async function chatTurn(id: string, text: string): Promise<ChatResponse> {
  const actor = permitActor(id)
  const { chat } = await load(id)
  await actor.appendChat({ role: "user", content: text, at: new Date().toISOString() })
  const turn = await readUserTurn(chat, text)

  // Read after the model call: Clerk can move the status while it runs.
  let permit = await actor.read()
  const draftOpen = permit.status === "INTAKE" && !permit.intake.complete
  const found = turn.ok && turn.facts.address && draftOpen ? await lookup(turn.facts.address) : null
  let revisionToSend: { revision: number; changedFields: string[] } | null = null

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
  } else if (permit.status === "CORRECTIONS_REQUESTED") {
    const frozen = permit.revisions.at(-1)
    if (frozen && permit.revision > frozen.revision) {
      revisionToSend = {
        revision: permit.revision,
        changedFields: changedPaths(deckChanges(frozen.deck, permit.deck)),
      }
    } else if (turn.ok && !turn.facts.invalid.length) {
      const changes = deckChanges(permit.deck, turn.facts.deck)
      if (changes.length) {
        const changedFields = changedPaths(changes)
        const revision = await actor.submitRevision({ deck: Object.fromEntries(changes), changedFields })
        revisionToSend = { revision, changedFields }
      }
    }
  }

  // composeReply needs this read from before the post, while the status is still CORRECTIONS_REQUESTED.
  permit = await actor.read()
  const reply = composeReply({ turn, lookup: found, permit })
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
  const reply = composeReply({ turn: PICK, lookup: found, permit: await actor.read() })
  await actor.appendChat(assistant(reply))
  return { reply, lookup: found }
}

async function explainCorrections(e: RelayEnvelope) {
  const actor = permitActor(e.permitId)
  const permit = await actor.read()
  if (e.revision < permit.revision) return
  if (permit.chat.some((m) => m.role === "assistant" && m.at === e.timestamp)) return
  const ids = FindingIds.safeParse(e.payload.findingIds)
  const listed = permit.findings.filter((f) => ids.data?.includes(f.findingId))
  if (!listed.length) return console.warn("[api] NEEDS_INPUT listed no findings on", e.permitId)
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
    if (await post({ permitId: id, revision: permit.revision, type: "REVIEW_REQUEST", payload: {} })) {
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
  const { websocketUrl } = await actors.PermitActor.prepareWebsocket({ actorId: id, metadata: { role: "viewer" } })
  return c.json<SocketGrant>({ websocketUrl })
})

onNeedsInput((e) => serial(e.permitId, () => explainCorrections(e)))

serve({ fetch: app.fetch, port: PORT }, () => console.log(`[api] listening on ${PORT}, relay mode ${relayMode()}`))

// The first request with a schema is slower. readUserTurn never rejects.
void readUserTurn([], "I want a backyard deck at 14630 Noble Ave, San Jose, about 16 by 12 feet.")
