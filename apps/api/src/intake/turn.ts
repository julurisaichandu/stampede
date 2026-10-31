import { missingMinimum, type ChatMessage, type PermitApplication } from "../../contracts.ts"
import type { GisLookup } from "../api-types.ts"
import { extractTurn, type IntakeResult, type TurnMessage } from "./extract.ts"
import { readTurn, type IntakeTurn, type TurnFacts } from "./schema.ts"

export type Turn =
  | { ok: true; intent: IntakeTurn["intent"]; ack: string; facts: TurnFacts }
  | { ok: false; reply: string }

const HISTORY = 12
const NO_FACTS: TurnFacts = { address: null, deck: {}, unknown: [], invalid: [] }

const SCOPE =
  "stamp only handles pre-reviews for a new residential backyard deck on a single-family parcel in San Jose."
const VERDICT = /\b(approv\w*|pass(es|ed|ing)?|compliant|complies|fails?)\b/i
const REVIEWERS_DECIDE = "Only the reviewers can decide that, and the pre-review will check it."

const FAILURE_REPLIES: Record<Extract<IntakeResult, { ok: false }>["reason"], string> = {
  refused: "I can't help with that, but I'm glad to keep going on your deck.",
  incomplete: "That got cut off on my side. Could you send it again, a little shorter?",
  invalid: "I didn't quite follow that. Could you say it another way?",
  busy: "I'm handling a lot right now. Please try again in a moment.",
  unavailable: "I can't reach my assistant right now. Please try again in a moment.",
}

const FIELD_NAMES: Record<string, string> = {
  "deck.lengthFt": "length",
  "deck.widthFt": "width",
  "deck.maxHeightIn": "height above the ground",
  "deck.attached": "attachment",
  "deck.ledgerType": "ledger connection",
  "deck.rearSetbackFt": "rear setback",
  "deck.guardHeightIn": "railing height",
  "deck.servesExitDoor": "exit door",
  "deck.servesDoorLanding": "door landing",
}

const QUESTIONS: Record<string, string> = {
  property: "What is the street address of the project in San Jose?",
  "deck.lengthFt": "How long will the deck be, in feet?",
  "deck.widthFt": "How wide will the deck be, in feet?",
  "deck.maxHeightIn": "How high will the deck surface be above the ground at its highest point, in inches?",
  "deck.attached": "Will the deck be attached to the house, or freestanding?",
  "deck.guardHeightIn": "How tall will the railing be, in inches?",
}
const READY = "That's all I need for now. Check your file, then press Run pre-review when it looks right."

const LIST = new Intl.ListFormat("en", { type: "conjunction" })

export function toTurn(result: IntakeResult): Turn {
  if (!result.ok) return { ok: false, reply: FAILURE_REPLIES[result.reason] }
  const { intent, reply } = result.turn
  if (intent === "off_topic") return { ok: true, intent, ack: SCOPE, facts: NO_FACTS }
  const facts = readTurn(result.turn)
  if (facts.invalid.length) {
    const names = LIST.format(facts.invalid.map((path) => FIELD_NAMES[path] ?? path))
    return { ok: true, intent, ack: `I can't use that value for the ${names}. Please give me the correct ${names}.`, facts }
  }
  return { ok: true, intent, ack: VERDICT.test(reply) ? REVIEWERS_DECIDE : reply, facts }
}

export function toMessages(chat: ChatMessage[], text: string): TurnMessage[] {
  // The server appends the user's message before this runs, so it may already be the last entry.
  const last = chat.at(-1)
  const history = last?.role === "user" && last.content === text ? chat.slice(0, -1) : chat
  return [
    ...history.slice(-HISTORY).map(({ role, content }) => ({ role, content })),
    { role: "user" as const, content: text },
  ]
}

export async function readUserTurn(chat: ChatMessage[], text: string): Promise<Turn> {
  try {
    return toTurn(await extractTurn(toMessages(chat, text)))
  } catch {
    return { ok: false, reply: FAILURE_REPLIES.unavailable }
  }
}

export function nextQuestion(p: Pick<PermitApplication, "property" | "deck" | "intake">): string {
  const first = missingMinimum(p)[0]
  if (!first) return READY
  const question = QUESTIONS[first]
  return p.intake.unknownFields.includes(first) ? `I need this one to run the pre-review, and a best guess is fine. ${question}` : question
}

function lookupSentence(lookup: GisLookup | null): string {
  switch (lookup?.status) {
    case "matched": {
      const { address, apn, zoning } = lookup.property!
      const record = `${address}, APN ${apn}, zoning ${zoning ?? "not listed"}`
      return lookup.source === "fixture"
        ? `The city's records aren't answering, so this comes from demo cached data: ${record}.`
        : `I found this in the city's records: ${record}.`
    }
    case "needs_confirm":
      return "The city's records show more than one possible match. Please choose yours in the file."
    case "out_of_city":
      return "That address looks like it is outside San Jose, and stamp only covers San Jose."
    case "not_found":
      return "I couldn't find that address in the city's records."
    case "unavailable":
      return "The city's records aren't answering right now, so I can't confirm the parcel yet. Please send the address again in a moment."
    default:
      return ""
  }
}

// ponytail: restating an unchanged value at revision 2+ reads as a new submission; pass revisions in if that shows up.
function revisionWentIn(turn: Extract<Turn, { ok: true }>, permit: Pick<PermitApplication, "deck" | "revision">) {
  const stated = Object.entries(turn.facts.deck)
  return (
    permit.revision > 1 &&
    stated.length > 0 &&
    stated.every(([key, value]) => permit.deck[key as keyof typeof permit.deck] === value)
  )
}

export function composeReply({
  turn,
  lookup,
  permit,
}: {
  turn: Turn
  lookup: GisLookup | null
  permit: Pick<PermitApplication, "property" | "deck" | "intake" | "status" | "revision">
}): string {
  if (!turn.ok) return turn.reply
  const sentences = (...parts: string[]) => parts.filter(Boolean).join(" ")

  if (permit.status === "CORRECTIONS_REQUESTED") {
    if (turn.facts.invalid.length) return turn.ack
    return revisionWentIn(turn, permit)
      ? sentences(turn.ack, `Revision ${permit.revision} submitted.`, "The reviewers are rechecking what changed.")
      : sentences(turn.ack, "Tell me what you'd like to change and I'll send it back to the reviewers.")
  }
  if (permit.status === "PRE_REVIEW_COMPLETE") {
    return "Your pre-review is finished and the reviewers have the file, so nothing here can change now. Your draft packet lists what's still open."
  }
  if (permit.status !== "INTAKE" || permit.intake.complete) {
    return "Your file is with the reviewers right now, so I can't change anything until they finish."
  }

  const asksAlready = turn.facts.invalid.length > 0 || lookup?.status === "needs_confirm" || lookup?.status === "unavailable"
  const question = asksAlready
    ? ""
    : nextQuestion({
        property: lookup?.property ?? permit.property,
        deck: { ...permit.deck, ...turn.facts.deck },
        intake: {
          ...permit.intake,
          unknownFields: [...new Set([...permit.intake.unknownFields, ...turn.facts.unknown])].filter(
            (path) => !(path.replace("deck.", "") in turn.facts.deck),
          ),
        },
      })
  return sentences(turn.ack, lookupSentence(lookup), question)
}
