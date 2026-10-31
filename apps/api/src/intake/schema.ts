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

export function readTurn(turn: IntakeTurn): TurnFacts {
  const deck: Record<string, unknown> = {}
  const unknown: string[] = []
  const invalid: string[] = []
  for (const key of DECK_KEYS) {
    const field = turn.deck[key]
    if (field.status === "user_unknown") unknown.push(`deck.${key}`)
    if (field.status !== "stated" || field.value === null) continue
    const parsed = Deck.shape[key].safeParse(field.value)
    if (parsed.success) deck[key] = parsed.data
    else invalid.push(`deck.${key}`)
  }
  const address = turn.address.status === "stated" ? turn.address.value : null
  return { address, deck: deck as Partial<Deck>, unknown, invalid }
}
