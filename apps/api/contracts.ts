// Shared contract between the applicant side (Saichandu) and the office side (Kris).
// Agreed 2026-10-31 13:00 with the office-side changes marked "Office side:". Neither side changes it without telling the other.
import { z } from "zod"

// PRE_REVIEW_COMPLETE confirmed (the build plan names it in full).
// Clerk moves here when currentFindings() holds no CORRECTION (blocksStamp).
// Open NEEDS_* findings do not block the stamp. They carry into the packet as still required.
export const PermitStatus = z.enum([
  "INTAKE",
  "READY_FOR_REVIEW",
  "IN_REVIEW",
  "CORRECTIONS_REQUESTED",
  "REVISED",
  "PRE_REVIEW_COMPLETE",
])
export type PermitStatus = z.infer<typeof PermitStatus>

// Office side: the only moves the Clerk may make. The actor rejects anything else.
export const ALLOWED_TRANSITIONS: Record<PermitStatus, PermitStatus[]> = {
  INTAKE: ["READY_FOR_REVIEW"],
  READY_FOR_REVIEW: ["IN_REVIEW"],
  IN_REVIEW: ["CORRECTIONS_REQUESTED", "PRE_REVIEW_COMPLETE"],
  CORRECTIONS_REQUESTED: ["REVISED"],
  REVISED: ["IN_REVIEW"],
  PRE_REVIEW_COMPLETE: [],
}

export const Property = z.object({
  address: z.string(),
  lat: z.number(),
  lng: z.number(),
  apn: z.string(), // 8 digits, no dashes, exactly as the city returns it
  parcelId: z.string(),
  zoning: z.string().nullable(), // raw city value, such as "R-1-8" or "R-1-8(PD)"
  zoningBase: z.string().nullable(), // "R-1-8"
  zoningOverlay: z.string().nullable(), // "PD", "CL". SJ-ZONING-01 flags any overlay
  rezoningFile: z.string().nullable(),
  lookupConfidence: z.number().min(0).max(100), // geocoder score
  source: z.enum(["live", "fixture"]), // "fixture" must show "demo cached data"
  fetchedAt: z.string(),
})
export type Property = z.infer<typeof Property>

// null means not provided. Rules treat null as missing, never as a default.
export const Deck = z.object({
  lengthFt: z.number().positive().nullable(),
  widthFt: z.number().positive().nullable(),
  maxHeightIn: z.number().positive().nullable(),
  attached: z.boolean().nullable(),
  ledgerType: z.string().nullable(), // free text. SJ-DETAIL-01 checks presence only
  rearSetbackFt: z.number().nonnegative().nullable(),
  guardHeightIn: z.number().positive().nullable(),
  servesExitDoor: z.boolean().nullable(),
  servesDoorLanding: z.boolean().nullable(),
})
export type Deck = z.infer<typeof Deck>

export const EMPTY_DECK: Deck = {
  lengthFt: null,
  widthFt: null,
  maxHeightIn: null,
  attached: null,
  ledgerType: null,
  rearSetbackFt: null,
  guardHeightIn: null,
  servesExitDoor: null,
  servesDoorLanding: null,
}

export const Intake = z.object({
  complete: z.boolean(), // set by confirmIntake(). Locks the draft
  missingFields: z.array(z.string()), // paths such as "deck.guardHeightIn"
  unknownFields: z.array(z.string()), // the homeowner said they do not know
  confirmedAt: z.string().nullable(),
})
export type Intake = z.infer<typeof Intake>

export const ChatMessage = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  at: z.string(),
})
export type ChatMessage = z.infer<typeof ChatMessage>

export const FindingStatus = z.enum(["PASS", "CORRECTION", "NEEDS_INFORMATION", "NEEDS_HUMAN_VERIFICATION"])
export type FindingStatus = z.infer<typeof FindingStatus>

export const Finding = z.object({
  findingId: z.string(),
  ruleId: z.string(),
  reviewer: z.enum(["building", "zoning"]),
  revision: z.number().int(),
  status: FindingStatus,
  field: z.string(),
  observed: z.union([z.number(), z.string(), z.boolean()]).nullable(),
  required: z.string().nullable(),
  reason: z.string(),
  citation: z.string(), // shown on both screens, such as "2025 CRC R321.1.2"
  sourceUrl: z.string(),
  evidence: z.array(z.string()),
  humanReviewNeeded: z.boolean(),
})
export type Finding = z.infer<typeof Finding>

export const PermitEvent = z.object({
  at: z.string(),
  who: z.string(),
  why: z.string(),
  from: PermitStatus.nullable(),
  to: PermitStatus.nullable(),
})
export type PermitEvent = z.infer<typeof PermitEvent>

export const RelaySender = z.enum(["intake", "clerk", "building", "zoning"])
export const RelayType = z.enum([
  "REVIEW_REQUEST",
  "FINDING",
  "NEEDS_INPUT",
  "REVISION_SUBMITTED",
  "REVIEW_COMPLETE",
  "PACKET_READY",
])

// One line per Relay message, so the office feed can read the actor.
// text is a short human sentence, never the envelope. No raw JSON on screen.
export const RelayLogEntry = z.object({
  at: z.string(),
  sender: RelaySender,
  type: RelayType,
  revision: z.number().int(),
  text: z.string(),
})
export type RelayLogEntry = z.infer<typeof RelayLogEntry>

// Clerk appends one at each freeze. Rules read this copy, not the live deck.
export const FrozenRevision = z.object({
  revision: z.number().int(),
  deck: Deck,
  frozenAt: z.string(),
})
export type FrozenRevision = z.infer<typeof FrozenRevision>

// The actor keeps one @Persisted @Emittable field per key here, with the same name,
// so the socket's state frame already has this shape. id comes from the URL.
export const PermitApplication = z.object({
  id: z.string(),
  status: PermitStatus,
  revision: z.number().int(), // starts at 1. Only submitRevision() raises it
  property: Property.nullable(),
  deck: Deck, // the working draft. submitRevision() overwrites it
  intake: Intake,
  chat: z.array(ChatMessage),
  revisions: z.array(FrozenRevision),
  findings: z.array(Finding), // append only, across all revisions
  events: z.array(PermitEvent),
  relayLog: z.array(RelayLogEntry),
})
export type PermitApplication = z.infer<typeof PermitApplication>

export function emptyPermit(id: string): PermitApplication {
  return {
    id,
    status: "INTAKE",
    revision: 1,
    property: null,
    deck: EMPTY_DECK,
    intake: { complete: false, missingFields: [], unknownFields: [], confirmedAt: null },
    chat: [],
    revisions: [],
    findings: [],
    events: [],
    relayLog: [],
  }
}

// The actor methods the applicant side calls. Status is absent on purpose:
// status moves only through Clerk's signed socket, never through RPC.
export interface ApplicantActorApi {
  read(): Promise<Omit<PermitApplication, "id">>
  appendChat(message: ChatMessage): Promise<void>
  setProperty(property: Property): Promise<void>
  // Both throw unless status is INTAKE and intake.complete is false.
  applyIntakePatch(input: {
    deck: Partial<Deck>
    missingFields: string[]
    unknownFields: string[]
  }): Promise<void>
  confirmIntake(at: string): Promise<void> // idempotent
  // Throws unless status is CORRECTIONS_REQUESTED. Returns the new revision.
  submitRevision(input: { deck: Partial<Deck>; changedFields: string[] }): Promise<number>
}

// ledgerType and rearSetbackFt are left out on purpose. The demo needs them to reach
// review empty, so the rules can return NEEDS_INFORMATION and NEEDS_HUMAN_VERIFICATION.
export function missingMinimum(p: Pick<PermitApplication, "property" | "deck" | "intake">): string[] {
  const missing: string[] = []
  if (!p.property) missing.push("property")
  for (const key of ["lengthFt", "widthFt", "maxHeightIn", "attached"] as const) {
    if (p.deck[key] === null) missing.push(`deck.${key}`)
  }
  const guardApplies = p.deck.maxHeightIn !== null && p.deck.maxHeightIn > 30
  const guardAnswered = p.deck.guardHeightIn !== null || p.intake.unknownFields.includes("deck.guardHeightIn")
  if (guardApplies && !guardAnswered) missing.push("deck.guardHeightIn")
  return missing
}

// Rules that do not rerun keep their finding from the earlier revision.
export function currentFindings(findings: Finding[]): Finding[] {
  const latest = new Map<string, Finding>()
  for (const finding of findings) {
    const seen = latest.get(finding.ruleId)
    if (!seen || finding.revision >= seen.revision) latest.set(finding.ruleId, finding)
  }
  return [...latest.values()]
}

// Office side: findings that keep a permit out of PRE_REVIEW_COMPLETE. The actor enforces this too.
export const blocksStamp = (f: Finding) => f.status === "CORRECTION"

// Payload by type:
//   REVIEW_REQUEST      intake to clerk   {}
//   REVISION_SUBMITTED  intake to clerk   { changedFields: string[] }
//   NEEDS_INPUT         clerk to intake   { findingIds: string[] }
// The envelope travels in both metadata and text. Receivers read metadata first,
// then JSON.parse(text), and dedupe on relayKey().
export const RelayEnvelope = z.object({
  permitId: z.string(),
  revision: z.number().int(),
  sender: RelaySender,
  type: RelayType,
  findingId: z.string().optional(),
  payload: z.record(z.string(), z.unknown()),
  timestamp: z.string(),
})
export type RelayEnvelope = z.infer<typeof RelayEnvelope>

export const permitChannel = (permitId: string) => `permit-${permitId}`
// Office side: sender is part of the key. Building and Zoning both send REVIEW_COMPLETE for the same revision,
// and without it the second one is dropped as a duplicate.
export const relayKey = (e: Pick<RelayEnvelope, "permitId" | "revision" | "sender" | "type" | "findingId">) =>
  `${e.permitId}:${e.revision}:${e.sender}:${e.type}:${e.findingId ?? "-"}`
