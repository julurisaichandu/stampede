// stampede — deterministic rules. No LLM in here. The model only explains these results.
// Rules read the Clerk's frozen copy of the deck, never the live draft. null means not provided, never a default.
// Citations came from the applicant side's research. Check them against the sources before they appear on stage.
import type { Deck, Finding, PermitApplication, Property } from "../contracts.ts"

const SRC = {
  sjDecks: {
    url: "https://www.sanjoseca.gov/businesses/development-services-permit-center/start-your-project/single-family-duplex-properties/decks",
    citation: "San Jose Decks page",
  },
  crc: {
    url: "https://up.codes/viewer/california/ca-residential-code-2025/chapter/3/building-planning",
    citation: "2025 CRC R321.1.1, R321.1.2",
  },
  sjForm352: {
    url: "https://www.sanjoseca.gov/home/showpublisheddocument/107050/638593203745800000",
    citation: "San Jose Form 352 plan set instructions",
  },
  sjZoning: {
    url: "https://library.municode.com/ca/san_jose/codes/code_of_ordinances",
    citation: "San Jose Municipal Code Ch. 20.30, Table 20-60 (§20.30.200), §20.30.400",
  },
}

// Permit triggers (source: San Jose Decks page). Re-check the page the morning of the demo.
const PERMIT_AREA_SQFT = 200
const PERMIT_HEIGHT_IN = 30 // permit when ≥ 30 in at any point
// Guards (source: 2025 CRC R321.1.1, R321.1.2): required when > 30 in; deck guards at least 42 in. Not stair guards.
// Deliberately not shared with PERMIT_HEIGHT_IN: the permit trigger is ≥ 30, the guard trigger is > 30.
const GUARD_TRIGGER_IN = 30
const GUARD_MIN_HEIGHT_IN = 42

export const BUILDING_RULES = ["SJ-PERMIT-01", "CRC-GUARD-01", "SJ-DETAIL-01"] as const
export const ZONING_RULES = ["SJ-ZONING-01"] as const
export const ALL_RULES = [...BUILDING_RULES, ...ZONING_RULES]
export type RuleId = (typeof ALL_RULES)[number]

export type RuleInput = { permitId: string; revision: number; deck: Deck; property: Property | null }

type Check = Pick<Finding, "status" | "field" | "reason"> &
  Partial<Pick<Finding, "observed" | "required" | "evidence" | "humanReviewNeeded">>

type Rule = { reviewer: Finding["reviewer"]; src: { url: string; citation: string }; check: (input: RuleInput) => Check }

const shown = (d: Deck, ...keys: (keyof Deck)[]) => keys.map((k) => `deck.${k} = ${d[k] ?? "not provided"}`)

const RULES: Record<RuleId, Rule> = {
  "SJ-PERMIT-01": {
    reviewer: "building",
    src: SRC.sjDecks,
    check: ({ deck: d }) => {
      const evidence = shown(d, "lengthFt", "widthFt", "maxHeightIn", "attached", "servesExitDoor", "servesDoorLanding")
      const area = d.lengthFt != null && d.widthFt != null ? d.lengthFt * d.widthFt : null
      // Any one trigger requires a permit, even while other answers are still unknown.
      const triggers = [
        area != null && area >= PERMIT_AREA_SQFT && `area ${area} sq ft ≥ ${PERMIT_AREA_SQFT}`,
        d.maxHeightIn != null && d.maxHeightIn >= PERMIT_HEIGHT_IN && `${d.maxHeightIn} in above grade (≥ ${PERMIT_HEIGHT_IN} in at any point)`,
        d.attached === true && "attached to the dwelling",
        d.servesExitDoor === true && "serves an exit door",
        d.servesDoorLanding === true && "serves as a door landing",
      ].filter((t): t is string => typeof t === "string")
      if (triggers.length) {
        return {
          status: "PASS", field: "deck", observed: triggers.join("; "), required: "Building permit required",
          reason: `A building permit is required: ${triggers.join(", ")}.`, evidence,
        }
      }
      const unknown = [
        area == null && "length and width",
        d.maxHeightIn == null && "height above grade at the highest point",
        d.attached == null && "whether it is attached to the house",
        d.servesExitDoor == null && "whether it serves an exit door",
        d.servesDoorLanding == null && "whether it serves as a door landing",
      ].filter((t): t is string => typeof t === "string")
      if (unknown.length) {
        return {
          status: "NEEDS_INFORMATION", field: "deck",
          reason: `Need ${unknown.join(", ")} to decide whether a permit is required.`, evidence,
        }
      }
      return {
        status: "PASS", field: "deck", observed: "none of the triggers", required: "Permit may not be required; confirm with the City",
        reason: "None of the City's five permit triggers apply; confirm with the City before building.", evidence, humanReviewNeeded: true,
      }
    },
  },

  "CRC-GUARD-01": {
    reviewer: "building",
    src: SRC.crc,
    check: ({ deck: d }) => {
      const evidence = shown(d, "maxHeightIn", "guardHeightIn")
      if (d.maxHeightIn == null) {
        return {
          status: "NEEDS_INFORMATION", field: "deck.maxHeightIn",
          reason: "Need the deck's height above grade at its highest point to decide whether a guard is required.", evidence,
        }
      }
      if (d.maxHeightIn <= GUARD_TRIGGER_IN) {
        return {
          status: "PASS", field: "deck.maxHeightIn", observed: d.maxHeightIn, required: `guard only above ${GUARD_TRIGGER_IN} in`,
          reason: `Deck is ${d.maxHeightIn} in above grade; a guard is not required at or below ${GUARD_TRIGGER_IN} in.`, evidence,
        }
      }
      if (d.guardHeightIn == null) {
        return {
          status: "NEEDS_INFORMATION", field: "deck.guardHeightIn",
          reason: `Deck is ${d.maxHeightIn} in above grade, so a guard is required. State the guard height.`, evidence,
        }
      }
      if (d.guardHeightIn < GUARD_MIN_HEIGHT_IN) {
        return {
          status: "CORRECTION", field: "deck.guardHeightIn", observed: d.guardHeightIn, required: `${GUARD_MIN_HEIGHT_IN} in minimum`,
          reason: `Deck guard is ${d.guardHeightIn} in; California requires at least ${GUARD_MIN_HEIGHT_IN} in for a deck ${d.maxHeightIn} in above grade.`,
          evidence,
        }
      }
      return {
        status: "PASS", field: "deck.guardHeightIn", observed: d.guardHeightIn, required: `${GUARD_MIN_HEIGHT_IN} in minimum`,
        reason: `Deck guard is ${d.guardHeightIn} in, which meets the ${GUARD_MIN_HEIGHT_IN} in minimum.`, evidence,
      }
    },
  },

  "SJ-DETAIL-01": {
    reviewer: "building",
    src: SRC.sjForm352,
    check: ({ deck: d }) => {
      const evidence = shown(d, "attached", "ledgerType")
      if (d.attached == null) {
        return {
          status: "NEEDS_INFORMATION", field: "deck.attached",
          reason: "Need to know whether the deck is attached to the house to check the ledger connection.", evidence,
        }
      }
      if (!d.attached) {
        return { status: "PASS", field: "deck.ledgerType", observed: "freestanding", reason: "Freestanding deck; no ledger connection needed.", evidence }
      }
      // Presence only: the plan reviewer judges the connection itself.
      const ledger = d.ledgerType?.trim()
      if (!ledger) {
        return {
          status: "NEEDS_INFORMATION", field: "deck.ledgerType", required: "Ledger connection shown on the plans",
          reason: "The deck is attached to the house, but the ledger connection (for example lag screws or through-bolts) is not described. Plans must show it.",
          evidence,
        }
      }
      return {
        status: "PASS", field: "deck.ledgerType", observed: ledger, required: "Ledger connection shown on the plans",
        reason: `Ledger connection is described: ${ledger}.`, evidence,
      }
    },
  },

  "SJ-ZONING-01": {
    reviewer: "zoning",
    src: SRC.sjZoning,
    // Always a planner's call, whether or not a setback is stated. We never hard-code a setback
    // (Table 20-70's "None" covers detached structures) and the City's 2025 local amendments were not retrieved.
    check: ({ deck: d, property: p }) => {
      const district = p?.zoningBase ?? p?.zoning
      const where = district ? `in ${district}` : "on this parcel (zoning district not retrieved)"
      const stated = d.rearSetbackFt == null ? "No rear setback is stated." : `The stated rear setback is ${d.rearSetbackFt} ft.`
      const overlay = p?.zoningOverlay ? ` The parcel also carries a ${p.zoningOverlay} overlay, which can change these standards.` : ""
      return {
        status: "NEEDS_HUMAN_VERIFICATION", field: "deck.rearSetbackFt", observed: d.rearSetbackFt,
        required: `A City planner verifies the rear setback ${where}`,
        reason:
          `Rear setback for ${d.attached ? "an attached deck" : "this deck"} ${where} not verified. ${stated}${overlay} ` +
          "Check San Jose Municipal Code Ch. 20.30, Table 20-60 (§20.30.200) and §20.30.400 with a City planner.",
        evidence: [
          `property.zoning = ${p?.zoning ?? "not retrieved"}`,
          `property.zoningOverlay = ${p?.zoningOverlay ?? "none"}`,
          ...shown(d, "attached", "rearSetbackFt"),
        ],
        humanReviewNeeded: true,
      }
    },
  },
}

/** Run one rule against a frozen revision and attach ids and citation. */
export function runRule(ruleId: RuleId, input: RuleInput): Finding {
  const { reviewer, src, check } = RULES[ruleId]
  const c = check(input)
  return {
    findingId: `${input.permitId}-r${input.revision}-${ruleId}`,
    ruleId,
    reviewer,
    revision: input.revision,
    status: c.status,
    field: c.field,
    observed: c.observed ?? null,
    required: c.required ?? null,
    reason: c.reason,
    citation: src.citation,
    sourceUrl: src.url,
    evidence: c.evidence ?? [],
    humanReviewNeeded: c.humanReviewNeeded ?? false,
  }
}

/** Which rules a field change affects (so a revision reruns only those). */
export const FIELD_TO_RULES: Record<string, RuleId[]> = {
  "deck.lengthFt": ["SJ-PERMIT-01"],
  "deck.widthFt": ["SJ-PERMIT-01"],
  "deck.maxHeightIn": ["SJ-PERMIT-01", "CRC-GUARD-01"],
  "deck.attached": ["SJ-PERMIT-01", "SJ-DETAIL-01", "SJ-ZONING-01"],
  "deck.servesExitDoor": ["SJ-PERMIT-01"],
  "deck.servesDoorLanding": ["SJ-PERMIT-01"],
  "deck.guardHeightIn": ["CRC-GUARD-01"],
  "deck.ledgerType": ["SJ-DETAIL-01"],
  "deck.rearSetbackFt": ["SJ-ZONING-01"],
  "property.zoning": ["SJ-ZONING-01"],
  "property.zoningBase": ["SJ-ZONING-01"],
  "property.zoningOverlay": ["SJ-ZONING-01"],
}

/** Deck fields that differ between the current frozen revision and the one before it. Read from the record, not a message. */
export function changedFields(state: Pick<PermitApplication, "revision" | "revisions">): string[] {
  const current = state.revisions.find((r) => r.revision === state.revision)
  const previous = state.revisions.find((r) => r.revision === state.revision - 1)
  if (!current || !previous) return []
  return (Object.keys(current.deck) as (keyof Deck)[])
    .filter((k) => current.deck[k] !== previous.deck[k])
    .map((k) => `deck.${k}`)
}

/** Rules touched by a set of changed fields, in checklist order. */
export function affectedRules(fields: string[]): RuleId[] {
  const hit = new Set(fields.flatMap((field) => FIELD_TO_RULES[field] ?? []))
  return ALL_RULES.filter((ruleId) => hit.has(ruleId))
}

/* Expected on the demo deck (16 × 12 ft, 36 in, attached, guard 36 in, no ledger, no setback, R-1-8):
   SJ-PERMIT-01 → PASS (permit required: 36 in ≥ 30 and attached; 192 sq ft is under 200)
   CRC-GUARD-01 → CORRECTION (36 in < 42 in)
   SJ-DETAIL-01 → NEEDS_INFORMATION (attached, ledger not described)
   SJ-ZONING-01 → NEEDS_HUMAN_VERIFICATION (R-1-8, no setback stated)
   Revision 2, guard 42 in: only CRC-GUARD-01 reruns → PASS. No CORRECTION left → PRE_REVIEW_COMPLETE.
   Ledger and setback carry into the packet.
*/
