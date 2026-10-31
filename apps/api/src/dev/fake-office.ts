// Dev only. Stands in for Kris's Clerk, Building and Zoning agents until they land.
import { setTimeout as sleep } from "node:timers/promises"
import {
  currentFindings,
  relayKey,
  type Deck,
  type Finding,
  type PermitApplication,
  type PermitStatus,
  type Property,
  type RelayEnvelope,
  type RelayLogEntry,
} from "../../contracts.ts"
import { actors } from "../../generated/index.js"
import { permitActor } from "../actor.ts"

const STEP_MS = 900
const DECKS_PAGE =
  "https://www.sanjoseca.gov/businesses/development-services-permit-center/start-your-project/single-family-duplex-properties/decks"
const CRC_CHAPTER_3 = "https://up.codes/viewer/california/ca-residential-code-2025/chapter/3/building-planning"
const MUNICIPAL_CODE = "https://library.municode.com/ca/san_jose/codes/code_of_ordinances"

type Result = Pick<Finding, "status" | "observed" | "required" | "reason">
type Rule = Pick<Finding, "ruleId" | "reviewer" | "field" | "citation" | "sourceUrl" | "evidence"> & {
  check(deck: Deck, property: Property | null): Result
}

const RULES: Rule[] = [
  {
    ruleId: "SJ-PERMIT-01",
    reviewer: "building",
    field: "deck.attached",
    citation: "San Jose Decks page",
    sourceUrl: DECKS_PAGE,
    evidence: ["A deck installation, replacement, or repair requires a building permit if any of these conditions apply."],
    check(deck) {
      const area = (deck.lengthFt ?? 0) * (deck.widthFt ?? 0)
      const triggers = [
        area >= 200 && `${area} sq ft`,
        (deck.maxHeightIn ?? 0) >= 30 && `${deck.maxHeightIn} in above ground`,
        deck.attached && "attached to a dwelling",
        deck.servesExitDoor && "serves a required exit door",
        deck.servesDoorLanding && "serves as a door landing",
      ].filter(Boolean)
      return {
        status: "PASS",
        observed: deck.attached,
        required: null,
        reason: triggers.length
          ? `Permit required: ${triggers.join(", ")}.`
          : "None of the permit conditions apply to the facts given.",
      }
    },
  },
  {
    ruleId: "CRC-GUARD-01",
    reviewer: "building",
    field: "deck.guardHeightIn",
    citation: "2025 CRC R321.1.1 and R321.1.2",
    sourceUrl: CRC_CHAPTER_3,
    evidence: [
      "Required guards at open-sided walking surfaces, including stairs, porches, balconies or landings, shall be not less than 42 inches (1067 mm) in height as measured vertically above the adjacent walking surface or the line connecting the nosings.",
    ],
    check(deck) {
      const guard = deck.guardHeightIn
      const base = { observed: guard, required: "42 in" }
      if (deck.maxHeightIn !== null && deck.maxHeightIn <= 30)
        return {
          ...base,
          status: "PASS",
          reason: "The walking surface is not more than 30 in above grade, so R321.1.1 requires no guard.",
        }
      if (guard === null) return { ...base, status: "NEEDS_INFORMATION", reason: "Guard height not given." }
      if (guard >= 42) return { ...base, status: "PASS", reason: `Guard ${guard} in meets the 42 in minimum.` }
      return {
        ...base,
        status: "CORRECTION",
        reason: `Guard ${guard} in. 2025 CRC R321.1.2 requires not less than 42 in where the walking surface is more than 30 in above grade (R321.1.1).`,
      }
    },
  },
  {
    ruleId: "SJ-DETAIL-01",
    reviewer: "building",
    field: "deck.ledgerType",
    citation: "San Jose Plan Set Instructions, Form 352",
    sourceUrl: DECKS_PAGE,
    evidence: ["This rule checks that the details are present, not that they are structurally adequate."],
    check(deck) {
      const base = { observed: deck.ledgerType, required: "Framing, footing and ledger connection details" }
      return deck.ledgerType === null
        ? { ...base, status: "NEEDS_INFORMATION", reason: "Ledger attachment not described." }
        : { ...base, status: "PASS", reason: "Ledger attachment described." }
    },
  },
  {
    ruleId: "SJ-ZONING-01",
    reviewer: "zoning",
    field: "deck.rearSetbackFt",
    citation: "San Jose Municipal Code Ch. 20.30, Table 20-60 (§20.30.200) and §20.30.400",
    sourceUrl: MUNICIPAL_CODE,
    evidence: ["Zoning comes from the city's GIS. The setback rule is not verified for this parcel."],
    check(deck, property) {
      const kind = deck.attached ? "an attached deck" : "a deck"
      const overlay = property?.zoningOverlay ? ` Overlay ${property.zoningOverlay} also applies.` : ""
      return {
        status: "NEEDS_HUMAN_VERIFICATION",
        observed: deck.rearSetbackFt,
        required: null,
        reason: `Rear setback for ${kind} in ${property?.zoningBase ?? "this district"} not verified. Check San Jose Municipal Code Ch. 20.30, Table 20-60 (§20.30.200) and §20.30.400 with a City planner.${overlay}`,
      }
    },
  },
]

function openSocket(url: string) {
  return new Promise<WebSocket>((resolve, reject) => {
    const socket = new WebSocket(url)
    socket.addEventListener("open", () => resolve(socket), { once: true })
    socket.addEventListener("error", () => reject(new Error("clerk socket failed")), { once: true })
  })
}

// Socket sends have no ack, so read until the write shows up.
async function landed(permitId: string, done: (p: Omit<PermitApplication, "id">) => boolean) {
  for (let i = 0; i < 100; i++) {
    const permit = await permitActor(permitId).read()
    if (done(permit)) return permit
    await sleep(50)
  }
  throw new Error("office write did not land")
}

async function run(e: RelayEnvelope, emit: (e: RelayEnvelope) => void | Promise<void>) {
  const { permitId } = e
  const revising = e.type === "REVISION_SUBMITTED"
  const before = await permitActor(permitId).read()
  if (before.status !== (revising ? "CORRECTIONS_REQUESTED" : "INTAKE") || before.revision !== e.revision) return

  const { websocketUrl } = await actors.PermitActor.prepareWebsocket({
    actorId: permitId,
    metadata: { role: "clerk" },
  })
  const socket = await openSocket(websocketUrl)
  const send = (message: actors.PermitActor.Incoming) => socket.send(JSON.stringify(message))
  const now = () => new Date().toISOString()
  const log = (sender: RelayLogEntry["sender"], type: RelayLogEntry["type"], text: string) =>
    send({ type: "relayLog", entry: { at: now(), sender, type, revision: e.revision, text } })
  const move = (to: PermitStatus, why: string) => send({ type: "status", to, why, at: now() })

  try {
    if (revising) {
      move("REVISED", `Homeowner submitted revision ${e.revision}.`)
      log("intake", "REVISION_SUBMITTED", `Intake sent revision ${e.revision} to Clerk.`)
    } else {
      move("READY_FOR_REVIEW", "Homeowner confirmed the draft.")
      log("intake", "REVIEW_REQUEST", "Intake sent the file to Clerk.")
    }
    await sleep(STEP_MS)

    send({ type: "freeze", at: now() })
    const frozen = await landed(permitId, (p) => p.revisions.some((r) => r.revision === e.revision))
    const deck = frozen.revisions.find((r) => r.revision === e.revision)!.deck
    move("IN_REVIEW", `Revision ${e.revision} frozen and sent to the reviewers.`)
    log("clerk", "REVIEW_REQUEST", `Clerk froze revision ${e.revision} and sent it to Building and Zoning.`)

    const changed = (e.payload.changedFields ?? []) as string[]
    const rules = revising ? RULES.filter((rule) => changed.includes(rule.field)) : RULES
    const fresh: Finding[] = []
    for (const { check, ...rule } of rules) {
      await sleep(STEP_MS)
      const finding: Finding = {
        ...rule,
        ...check(deck, before.property),
        findingId: `${permitId}:${e.revision}:${rule.ruleId}`,
        revision: e.revision,
        humanReviewNeeded: rule.ruleId === "SJ-ZONING-01",
      }
      fresh.push(finding)
      send({ type: "finding", finding })
      log(finding.reviewer, "FINDING", `${finding.reviewer === "zoning" ? "Zoning" : "Building"} finished ${finding.ruleId}.`)
    }

    const corrections = currentFindings([...before.findings, ...fresh]).filter((f) => f.status === "CORRECTION")
    await sleep(STEP_MS)
    if (corrections.length === 0) {
      move("PRE_REVIEW_COMPLETE", "No corrections remain.")
      log("clerk", "REVIEW_COMPLETE", "Clerk closed the pre-review with no corrections left.")
    } else {
      move("CORRECTIONS_REQUESTED", `${corrections.length} correction${corrections.length > 1 ? "s" : ""} to make.`)
      log("clerk", "NEEDS_INPUT", "Clerk asked Intake to explain the corrections to the homeowner.")
    }
    // Closing right after a send drops the frame, so wait for the last write.
    await landed(permitId, ({ relayLog }) => {
      const last = relayLog.at(-1)
      return last?.revision === e.revision && (last.type === "NEEDS_INPUT" || last.type === "REVIEW_COMPLETE")
    })
    if (corrections.length === 0) return
    await emit({
      permitId,
      revision: e.revision,
      sender: "clerk",
      type: "NEEDS_INPUT",
      payload: { findingIds: corrections.map((f) => f.findingId) },
      timestamp: now(),
    })
  } finally {
    socket.close()
  }
}

const seen = new Set<string>()

export async function receive(e: RelayEnvelope, emit: (e: RelayEnvelope) => void | Promise<void>) {
  if (e.type !== "REVIEW_REQUEST" && e.type !== "REVISION_SUBMITTED") return
  const key = relayKey(e)
  if (seen.has(key)) return
  seen.add(key)
  await run(e, emit).catch((err) => {
    seen.delete(key)
    throw err
  })
}
