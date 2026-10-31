import { Actor, type ActorSocket, Emittable, Persisted } from "durable-actors"

export type Role = "applicant" | "building" | "zoning" | "clerk" | "viewer"
export type Status = "draft" | "submitted" | "in_review" | "corrections" | "approved"
export type ChatMessage = { role: "user" | "assistant"; content: string; at: number }
export type Deck = Record<string, string | number | boolean | null>

type Metadata = { role: Role }
type Incoming = { type: "setStatus"; status: Status }
type Outgoing = { type: "event"; event: string; revision: number } | { type: "denied"; reason: string }
type Socket = ActorSocket<Metadata, Outgoing>

export class PermitActor extends Actor<Metadata, Incoming, Outgoing> {
    @Persisted @Emittable status: Status = "draft"
    @Persisted @Emittable chat: ChatMessage[] = []
    @Persisted @Emittable deck: Deck = {}
    @Persisted @Emittable revision = 0

    async read() {
        return { id: this.id, status: this.status, chat: this.chat, deck: this.deck, revision: this.revision }
    }

    async appendChat(message: ChatMessage): Promise<number> {
        // Reassign: this.chat.push() is NOT persisted.
        this.chat = [...this.chat, message]
        this.broadcast({ type: "event", event: "chat", revision: this.revision })
        return this.chat.length
    }

    async patchDeck(patch: Deck): Promise<number> {
        this.deck = { ...this.deck, ...patch }
        this.revision += 1
        this.broadcast({ type: "event", event: "deck", revision: this.revision })
        return this.revision
    }

    // Status has no public RPC. socket.metadata is signed into the grant by the backend.
    async onMessage(socket: Socket, message: Incoming): Promise<void> {
        if (socket.metadata.role !== "clerk") {
            socket.send({ type: "denied", reason: "only clerk writes status" })
            return
        }
        this.status = message.status
        this.broadcast({ type: "event", event: "status", revision: this.revision })
    }
}
