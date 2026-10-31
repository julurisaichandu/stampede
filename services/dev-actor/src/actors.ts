import { Actor, type ActorSocket, Emittable, Persisted } from "durable-actors"
import {
  emptyPermit,
  type ApplicantActorApi,
  type ChatMessage,
  type Deck,
  type Finding,
  type FrozenRevision,
  type Intake,
  type PermitEvent,
  type PermitStatus,
  type Property,
  type RelayLogEntry,
} from "../../../apps/api/contracts.ts"

type Metadata = { role: "viewer" | "clerk" }
type Incoming =
  | { type: "status"; to: PermitStatus; why: string; at: string }
  | { type: "freeze"; at: string }
  | { type: "finding"; finding: Finding }
  | { type: "relayLog"; entry: RelayLogEntry }
type Outgoing = { type: "denied"; reason: string }
type Socket = ActorSocket<Metadata, Outgoing>

const empty = emptyPermit("")

// A module function, because any method on the class is callable over RPC.
function assertDraftOpen(status: PermitStatus, intake: Intake) {
  if (status !== "INTAKE" || intake.complete) throw new Error("draft is locked")
}

export class PermitActor extends Actor<Metadata, Incoming, Outgoing> implements ApplicantActorApi {
  @Persisted @Emittable status: PermitStatus = empty.status
  @Persisted @Emittable revision = empty.revision
  @Persisted @Emittable property: Property | null = empty.property
  @Persisted @Emittable deck: Deck = empty.deck
  @Persisted @Emittable intake: Intake = empty.intake
  @Persisted @Emittable chat: ChatMessage[] = []
  @Persisted @Emittable revisions: FrozenRevision[] = []
  @Persisted @Emittable findings: Finding[] = []
  @Persisted @Emittable events: PermitEvent[] = []
  @Persisted @Emittable relayLog: RelayLogEntry[] = []

  async read() {
    return {
      status: this.status,
      revision: this.revision,
      property: this.property,
      deck: this.deck,
      intake: this.intake,
      chat: this.chat,
      revisions: this.revisions,
      findings: this.findings,
      events: this.events,
      relayLog: this.relayLog,
    }
  }

  async appendChat(message: ChatMessage) {
    this.chat = [...this.chat, message]
  }

  async setProperty(property: Property) {
    assertDraftOpen(this.status, this.intake)
    this.property = property
  }

  async applyIntakePatch(input: { deck: Partial<Deck>; missingFields: string[]; unknownFields: string[] }) {
    assertDraftOpen(this.status, this.intake)
    this.deck = { ...this.deck, ...input.deck }
    this.intake = { ...this.intake, missingFields: input.missingFields, unknownFields: input.unknownFields }
  }

  async confirmIntake(at: string) {
    if (this.intake.complete) return
    this.intake = { ...this.intake, complete: true, confirmedAt: at }
  }

  async submitRevision(input: { deck: Partial<Deck>; changedFields: string[] }) {
    if (this.status !== "CORRECTIONS_REQUESTED") throw new Error("no corrections requested")
    this.deck = { ...this.deck, ...input.deck }
    this.revision += 1
    return this.revision
  }

  // Status has no RPC. socket.metadata is signed into the grant by the backend.
  async onMessage(socket: Socket, message: Incoming) {
    if (socket.metadata?.role !== "clerk") {
      socket.send({ type: "denied", reason: "only clerk writes here" })
      return
    }
    switch (message.type) {
      case "status":
        if (message.to === this.status) return
        this.events = [
          ...this.events,
          { at: message.at, who: "clerk", why: message.why, from: this.status, to: message.to },
        ]
        this.status = message.to
        return
      case "freeze":
        if (this.revisions.some((r) => r.revision === this.revision)) return
        this.revisions = [...this.revisions, { revision: this.revision, deck: this.deck, frozenAt: message.at }]
        return
      case "finding":
        if (this.findings.some((f) => f.findingId === message.finding.findingId)) return
        this.findings = [...this.findings, message.finding]
        return
      case "relayLog":
        this.relayLog = [...this.relayLog, message.entry]
        return
    }
  }
}
