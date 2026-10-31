// HTTP surface between apps/web and apps/api. Not part of the Kris contract.
import type { PermitStatus, Property } from "../contracts.ts"

export type GisCandidate = {
  address: string
  score: number
  addrType: string
  lat: number
  lng: number
  apn: string | null // set only for parcels from the 15 m buffer retry
  parcelId: string | null
  zoning: string | null
}

export type GisLookup = {
  status: "matched" | "needs_confirm" | "out_of_city" | "not_found" | "unavailable"
  source: "live" | "fixture"
  fetchedAt: string
  property: Property | null // set only when status is matched
  candidates: GisCandidate[] // set only when status is needs_confirm
}

// Candidates live only in these responses because the actor has no field for them.
export type CreatePermitResponse = { id: string }
export type ChatRequest = { text: string }
export type ChatResponse = { reply: string; lookup: GisLookup | null }
export type LookupRequest = { address: string; apn: string | null }
export type LookupResponse = { reply: string; lookup: GisLookup }
export type ReviewOk = { status: PermitStatus }
export type ReviewBlocked = { missing: string[]; question: string } // HTTP 422
export type ApiFailure = { error: string; retryable: boolean }
export type SocketGrant = { websocketUrl: string }
