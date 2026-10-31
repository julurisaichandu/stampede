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

// JSON, not multipart: a cross-site form can post multipart with no preflight. Files never reach the actor.
export const MAX_PLAN_BYTES = 10 * 1024 * 1024
export const PLAN_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp"] as const
export type PlanType = (typeof PLAN_TYPES)[number]
export type PlanRequest = { name: string; data: string; note: string } // data is base64 with no "data:" prefix
export const planLine = (name: string, note: string) =>
  [`Attached plan: ${name.trim().replace(/\s+/g, " ")}`, note].filter(Boolean).join("\n")

export type LookupRequest = { address: string; apn: string | null }
export type LookupResponse = { reply: string; lookup: GisLookup }
export type ReviewOk = { status: PermitStatus }
export type ReviewBlocked = { missing: string[]; question: string } // HTTP 422
export type ApiFailure = { error: string; retryable: boolean }
export type SocketGrant = { websocketUrl: string }
