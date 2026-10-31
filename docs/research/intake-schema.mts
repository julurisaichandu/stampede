import { z } from "zod";

// Slot replaces both the patch value and the confidence map.
// status separates "user said they do not know" from "not mentioned".
const slot = <T extends z.ZodType>(value: T) =>
  z.object({
    status: z.enum(["stated", "user_unknown", "not_mentioned"]),
    value: value.nullable(),
    confidence: z.number().min(0).max(1),
  });

const IntakeTurn = z.object({
  intent: z.enum(["provide_project_details", "correct_details", "ask_question", "confirm_summary", "off_topic"]),
  address: slot(z.string()),
  deck: z.object({
    lengthFt: slot(z.number()),
    widthFt: slot(z.number()),
    maxHeightIn: slot(z.number()),
    attached: slot(z.boolean()),
    ledgerType: slot(z.enum(["bolted_ledger", "flashed_ledger", "freestanding_no_ledger", "other"])),
    rearSetbackFt: slot(z.number()),
    guardHeightIn: slot(z.number()),
  }),
  nextQuestion: z.string().nullable(),
  requiresConfirmation: z.boolean(),
});
export type IntakeTurn = z.infer<typeof IntakeTurn>;
export { IntakeTurn };

const REQUIRED = ["address", "deck.lengthFt", "deck.widthFt", "deck.maxHeightIn", "deck.attached", "deck.rearSetbackFt"] as const;

// Rebuilds the plan's flat shape in code, so the model cannot disagree with itself.
export function toPatch(t: IntakeTurn) {
  const slots: Record<string, { status: string; value: unknown; confidence: number }> = { address: t.address };
  for (const [k, s] of Object.entries(t.deck)) slots[`deck.${k}`] = s;
  const patch: Record<string, unknown> = {};
  const confidence: Record<string, number> = {};
  const unknownFields: string[] = [];
  for (const [path, s] of Object.entries(slots)) {
    if (s.status === "user_unknown") unknownFields.push(path);
    if (s.status === "stated" && s.value !== null) { patch[path] = s.value; confidence[path] = s.confidence; }
  }
  const required: string[] = [...REQUIRED];
  if (t.deck.attached.status === "stated" && t.deck.attached.value === true) required.push("deck.ledgerType");
  const missingFields = required.filter((path) => slots[path].status !== "stated" || slots[path].value === null);
  return { patch, confidence, unknownFields, missingFields };
}
