import { missingMinimum, type ChatMessage, type PermitApplication } from "../../contracts.ts"
import type { GisLookup } from "../api-types.ts"
import { extractTurn, type IntakeResult, type TurnMessage } from "./extract.ts"
import { readTurn, type IntakeTurn, type TurnFacts } from "./schema.ts"

export type Turn =
  | { ok: true; intent: IntakeTurn["intent"]; ack: string; facts: TurnFacts; readback?: string }
  | { ok: false; reply: string }

export type ReplyOutcome = "applied" | "locked" | "revision_submitted" | "revision_pending" | "review_not_sent" | "none"

const HISTORY = 12
export const NO_FACTS: TurnFacts = { address: null, deck: {}, unknown: [], invalid: [] }

const SCOPE =
  "stampede only handles pre-reviews for a new residential backyard deck on a single-family parcel in San Jose."
export const VERDICT = /\b(approv\w*|pass(es|ed|ing)?|compliant|complies|fails?)\b/i
export const REVIEWERS_DECIDE = "Only the reviewers can decide that, and the pre-review will check it."

export const FAILURE_REPLIES: Record<Extract<IntakeResult, { ok: false }>["reason"], string> = {
  refused: "I can't help with that, but I'm glad to keep going on your deck.",
  incomplete: "That got cut off on my side. Could you send it again, a little shorter?",
  invalid: "I didn't quite follow that. Could you say it another way?",
  busy: "I'm handling a lot right now. Please try again in a moment.",
  unavailable: "I can't reach my assistant right now. Please try again in a moment.",
  unreadable: "I can't reach my assistant right now. Please try again in a moment.",
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

export const LIST = new Intl.ListFormat("en", { type: "conjunction" })

export function invalidSentence(invalid: string[]): string {
  const names = LIST.format(invalid.map((path) => FIELD_NAMES[path] ?? path))
  return `I can't use that value for the ${names}. Please give me the correct ${names}.`
}

export function toTurn(result: IntakeResult, homeownerText: string): Turn {
  if (!result.ok) return { ok: false, reply: FAILURE_REPLIES[result.reason] }
  const { intent, reply } = result.turn
  if (intent === "off_topic") return { ok: true, intent, ack: SCOPE, facts: NO_FACTS }
  const facts = readTurn(result.turn, homeownerText)
  if (facts.invalid.length) return { ok: true, intent, ack: invalidSentence(facts.invalid), facts }
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

export const READBACK_LEAD = "From your plan I read:"

// A readback's numbers came from the homeowner's own plan, so confirming them isn't inventing them.
export const homeownerWords = (messages: TurnMessage[]) =>
  messages.filter((m) => m.role === "user" || m.content.includes(READBACK_LEAD)).map((m) => m.content).join("\n")

export async function readUserTurn(chat: ChatMessage[], text: string): Promise<Turn> {
  try {
    const messages = toMessages(chat, text)
    return toTurn(await extractTurn(messages), homeownerWords(messages))
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
      return "That address looks like it is outside San Jose, and stampede only covers San Jose."
    case "not_found":
      return "I couldn't find that address in the city's records."
    case "unavailable":
      return "The city's records aren't answering right now, so I can't confirm the parcel yet. Please send the address again in a moment."
    default:
      return ""
  }
}

export function composeReply({
  turn,
  lookup,
  permit,
  outcome,
}: {
  turn: Turn
  lookup: GisLookup | null
  permit: Pick<PermitApplication, "property" | "deck" | "intake" | "status" | "revision">
  outcome: ReplyOutcome
}): string {
  if (!turn.ok) return turn.reply
  const sentences = (...parts: (string | undefined)[]) => parts.filter(Boolean).join(" ")

  switch (outcome) {
    case "revision_submitted":
      return sentences(turn.ack, turn.readback, `Revision ${permit.revision} submitted.`, "The reviewers are rechecking what changed.")
    case "revision_pending":
      return Object.keys(turn.facts.deck).length || turn.facts.invalid.length
        ? `I didn't save that. Revision ${permit.revision} is still on its way to the reviewers, and I've sent it again. Tell me the change again once they've answered.`
        : `Revision ${permit.revision} hadn't reached the reviewers, so I've sent it again.`
    case "review_not_sent":
      return "Your file hasn't reached the reviewers yet, so it's locked and I didn't save anything. Press Try again on Run pre-review if it's showing."
    case "locked":
      return permit.status === "PRE_REVIEW_COMPLETE"
        ? "Your pre-review is finished and the reviewers have the file, so nothing here can change now. Your draft packet lists what's still open."
        : "Your file is with the reviewers right now, so I can't change anything until they finish."
  }

  if (permit.status === "CORRECTIONS_REQUESTED") {
    if (turn.facts.invalid.length) return sentences(turn.ack, turn.readback && "I didn't save anything from this plan.")
    return Object.keys(turn.facts.deck).length
      ? "That's already what your file says, so nothing new went to the reviewers. Tell me what you'd like to change."
      : sentences(turn.ack, "Tell me what you'd like to change and I'll send it back to the reviewers.")
  }

  // The model writes its ack before the city answers, so a failed lookup makes "updated the address" false.
  const lookupFailed = lookup !== null && lookup.status !== "matched"
  const asksAlready =
    turn.facts.invalid.length > 0 ||
    lookup?.status === "needs_confirm" ||
    lookup?.status === "unavailable" ||
    (lookupFailed && permit.property !== null)
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
  return sentences(lookupFailed && !turn.facts.invalid.length ? "" : turn.ack, turn.readback, lookupSentence(lookup), question)
}
