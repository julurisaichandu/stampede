// stamped — PermitActor. One instance per permit id (the actor id); the single durable record agents write decisions to.
// Relay is for talking. This is for remembering. Screens read only this.
import { Actor, type ActorSocket, Emittable, Persisted } from "durable-actors"

import {
  ALLOWED_TRANSITIONS,
  ChatMessage,
  Deck,
  Finding,
  Property,
  RelayLogEntry,
  blocksStamp,
  currentFindings,
  emptyPermit,
  missingMinimum,
  type FrozenRevision,
  type Intake,
  type PermitApplication,
  type PermitEvent,
  type PermitStatus,
} from "../../../apps/api/contracts.ts"

// Signed into the socket grant by the backend. Only the Clerk's grant may carry role "clerk".
export type Role = "applicant" | "clerk" | "building" | "zoning" | "viewer"
type Metadata = { role: Role }
type Incoming = { type: "setStatus"; to: PermitStatus; why: string; requestId: string }
type Outgoing =
  | { type: "ack"; requestId: string; status: PermitStatus }
  | { type: "denied"; requestId: string; reason: string }
type Socket = ActorSocket<Metadata, Outgoing>

const EMPTY = emptyPermit("")
const DeckPatch = Deck.partial().strict()
const now = () => new Date().toISOString()

export class Permit extends Actor<Metadata, Incoming, Outgoing> {
  // One field per contract key, same names, so the socket's state frame already has the contract's shape.
  // @Persisted saves on assignment only: always reassign, never push or mutate in place.
  @Persisted @Emittable status: PermitStatus = EMPTY.status
  @Persisted @Emittable revision: number = EMPTY.revision
  @Persisted @Emittable property: Property | null = EMPTY.property
  @Persisted @Emittable deck: Deck = EMPTY.deck
  @Persisted @Emittable intake: Intake = EMPTY.intake
  @Persisted @Emittable chat: ChatMessage[] = EMPTY.chat
  @Persisted @Emittable revisions: FrozenRevision[] = EMPTY.revisions
  @Persisted @Emittable findings: Finding[] = EMPTY.findings
  @Persisted @Emittable events: PermitEvent[] = EMPTY.events
  @Persisted @Emittable relayLog: RelayLogEntry[] = EMPTY.relayLog
  // Relay delivers at least once. Keys already logged or handled live here so dedupe survives restarts.
  @Persisted private seen: string[] = []

  // ---------- Applicant side ----------

  async read(): Promise<Omit<PermitApplication, "id">> {
    const { status, revision, property, deck, intake, chat, revisions, findings, events, relayLog } = this
    return { status, revision, property, deck, intake, chat, revisions, findings, events, relayLog }
  }

  async appendChat(message: ChatMessage): Promise<void> {
    this.chat = [...this.chat, ChatMessage.parse(message)]
  }

  async setProperty(property: Property): Promise<void> {
    this.#assertDraftOpen()
    this.property = Property.parse(property)
  }

  async applyIntakePatch(input: { deck: Partial<Deck>; missingFields: string[]; unknownFields: string[] }): Promise<void> {
    this.#assertDraftOpen()
    this.deck = { ...this.deck, ...DeckPatch.parse(input.deck) }
    this.intake = { ...this.intake, missingFields: input.missingFields, unknownFields: input.unknownFields }
  }

  /** Locks the draft. Idempotent. */
  async confirmIntake(at: string): Promise<void> {
    if (this.intake.complete) return
    this.#assertDraftOpen()
    const missing = missingMinimum(this)
    if (missing.length) throw new Error(`Cannot confirm yet; missing ${missing.join(", ")}`)
    this.intake = { ...this.intake, complete: true, confirmedAt: at }
    this.#event("intake", "Homeowner confirmed the application", null, null)
  }

  /** Opens the next revision. One submit per round: the Clerk must freeze it before another is accepted. */
  async submitRevision(input: { deck: Partial<Deck>; changedFields: string[] }): Promise<number> {
    if (this.status !== "CORRECTIONS_REQUESTED") throw new Error(`Revisions open only at CORRECTIONS_REQUESTED, not ${this.status}`)
    if (this.revisions.at(-1)?.revision !== this.revision) throw new Error(`Revision ${this.revision} is already submitted`)
    this.deck = { ...this.deck, ...DeckPatch.parse(input.deck) }
    this.revision = this.revision + 1
    this.#event("intake", `Revision ${this.revision} submitted: ${input.changedFields.join(", ")}`, null, null)
    return this.revision
  }

  // ---------- Office side ----------

  /** Building and Zoning record findings for the revision under review. A rerun of a rule replaces it in place. */
  async addFinding(f: Finding): Promise<void> {
    const finding = Finding.parse(f)
    if (this.status !== "IN_REVIEW") throw new Error(`Findings are recorded only IN_REVIEW, not ${this.status}`)
    if (finding.revision !== this.revision) {
      throw new Error(`Finding ${finding.findingId} is for revision ${finding.revision}; permit is at ${this.revision}`)
    }
    const i = this.findings.findIndex((x) => x.ruleId === finding.ruleId && x.revision === finding.revision)
    this.findings = i === -1 ? [...this.findings, finding] : this.findings.map((x, j) => (j === i ? finding : x))
  }

  /** One human sentence per Relay message, logged once per relayKey however often it is delivered. */
  async logRelay(key: string, entry: RelayLogEntry): Promise<boolean> {
    if (!this.#firstTime(`log:${key}`)) return false
    this.relayLog = [...this.relayLog, RelayLogEntry.parse(entry)]
    return true
  }

  /** A receiver claims a Relay message before acting on it. True only the first time for that receiver. */
  async claim(receiver: RelayLogEntry["sender"], key: string): Promise<boolean> {
    return this.#firstTime(`${receiver}:${key}`)
  }

  /** Status has no RPC. It moves only here, over a socket whose signed metadata says role "clerk". */
  async onMessage(socket: Socket, message: Incoming): Promise<void> {
    const deny = (reason: string) => socket.send({ type: "denied", requestId: message.requestId, reason })
    if (socket.metadata.role !== "clerk") {
      return deny(`Only the clerk changes status; ${socket.metadata.role} tried ${this.status} → ${message.to}`)
    }
    if (!ALLOWED_TRANSITIONS[this.status]?.includes(message.to)) return deny(`Cannot move from ${this.status} to ${message.to}`)
    if (message.to === "READY_FOR_REVIEW" && !this.intake.complete) return deny("Intake is not confirmed")
    if (message.to === "PRE_REVIEW_COMPLETE") {
      if (!this.findings.some((f) => f.revision === this.revision)) return deny(`Revision ${this.revision} has not been reviewed`)
      const open = currentFindings(this.findings).filter(blocksStamp)
      if (open.length) return deny(`Open items block the stamp: ${open.map((f) => f.ruleId).join(", ")}`)
    }
    const from = this.status
    // Each freeze is the copy the rules read: revision 1 at READY_FOR_REVIEW, later ones at REVISED.
    if (message.to === "READY_FOR_REVIEW" || message.to === "REVISED") this.#freeze()
    this.status = message.to
    this.#event("clerk", message.why, from, message.to)
    socket.send({ type: "ack", requestId: message.requestId, status: this.status })
  }

  // Helpers use #private: the runtime treats every prototype method as a callable actor method and requires it async.

  #assertDraftOpen(): void {
    if (this.status !== "INTAKE" || this.intake.complete) throw new Error("The application is confirmed and locked")
  }

  #freeze(): void {
    const frozen: FrozenRevision = { revision: this.revision, deck: this.deck, frozenAt: now() }
    this.revisions = [...this.revisions.filter((r) => r.revision !== this.revision), frozen]
  }

  #event(who: string, why: string, from: PermitStatus | null, to: PermitStatus | null): void {
    this.events = [...this.events, { at: now(), who, why, from, to }]
  }

  #firstTime(key: string): boolean {
    if (this.seen.includes(key)) return false
    this.seen = [...this.seen, key]
    return true
  }
}
