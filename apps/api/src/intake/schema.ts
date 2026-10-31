import { z } from "zod"
import { Deck } from "../../contracts.ts"

// Strict mode rejects records and plain optionals, so every field is one fixed slot.
// status keeps "the homeowner does not know" apart from "not mentioned".
const slot = <T extends z.ZodType>(value: T) =>
  z.object({
    status: z.enum(["stated", "user_unknown", "not_mentioned"]),
    value: value.nullable(),
    confidence: z.number().min(0).max(1),
  })

// There is no status field here on purpose: chat cannot move a permit.
export const IntakeTurn = z.object({
  intent: z.enum(["provide_project_details", "correct_details", "ask_question", "confirm_summary", "off_topic"]),
  reply: z.string(),
  address: slot(z.string()),
  deck: z.object({
    lengthFt: slot(z.number()),
    widthFt: slot(z.number()),
    maxHeightIn: slot(z.number()),
    attached: slot(z.boolean()),
    ledgerType: slot(z.string()),
    rearSetbackFt: slot(z.number()),
    guardHeightIn: slot(z.number()),
    servesExitDoor: slot(z.boolean()),
    servesDoorLanding: slot(z.boolean()),
  }),
})
export type IntakeTurn = z.infer<typeof IntakeTurn>

const DECK_KEYS = Object.keys(Deck.shape) as (keyof Deck)[]

export type TurnFacts = {
  address: string | null
  deck: Partial<Deck>
  unknown: string[]
  invalid: string[]
}

const MAX_VALUE: Partial<Record<keyof Deck, number>> = {
  lengthFt: 200,
  widthFt: 200,
  maxHeightIn: 240,
  guardHeightIn: 120,
  rearSetbackFt: 500,
}
const MAX_LEDGER_CHARS = 200

const ONES = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split(" ")
const TENS = "twenty thirty forty fifty sixty seventy eighty ninety".split(" ")

function numbersIn(text: string): Set<number> {
  const plain = text.toLowerCase().replace(/(\d),(?=\d{3}\b)/g, "$1")
  const said = new Set((plain.match(/\d+(?:\.\d+)?/g) ?? []).map(Number))
  const words = plain.match(/[a-z]+/g) ?? []
  words.forEach((word, i) => {
    if (ONES.includes(word)) said.add(ONES.indexOf(word))
    const tens = (TENS.indexOf(word) + 2) * 10
    if (!tens) return
    said.add(tens)
    const unit = ONES.indexOf(words[i + 1])
    if (unit > 0 && unit < 10) said.add(tens + unit)
  })
  if (/half|½|1\/2/.test(plain)) for (const n of [...said]) said.add(n + 0.5)
  return said
}

// ponytail: proves the homeowner said this number, not that they said it about this field.
function homeownerSaid(value: number, said: Set<number>) {
  if ([value, value / 12, value * 12].some((n) => said.has(n))) return true
  return [...said].some((feet) => said.has(value - feet * 12))
}

function usable(key: keyof Deck, value: unknown, said: Set<number> | null) {
  if (typeof value === "string") return value.length > 0 && value.length <= MAX_LEDGER_CHARS
  if (typeof value !== "number") return true
  return value <= (MAX_VALUE[key] ?? Infinity) && (!said || homeownerSaid(value, said))
}

// homeownerText is everything the homeowner wrote. Left out, only the shape and range checks run.
export function readTurn(turn: IntakeTurn, homeownerText?: string): TurnFacts {
  const deck: Record<string, unknown> = {}
  const unknown: string[] = []
  const invalid: string[] = []
  const said = homeownerText === undefined ? null : numbersIn(homeownerText)
  for (const key of DECK_KEYS) {
    const field = turn.deck[key]
    if (field.status === "user_unknown") unknown.push(`deck.${key}`)
    if (field.status !== "stated" || field.value === null) continue
    const value = typeof field.value === "string" ? field.value.trim() : field.value
    const parsed = Deck.shape[key].safeParse(value)
    if (parsed.success && usable(key, parsed.data, said)) deck[key] = parsed.data
    else invalid.push(`deck.${key}`)
  }
  const address = turn.address.status === "stated" ? turn.address.value : null
  return { address, deck: deck as Partial<Deck>, unknown, invalid }
}
