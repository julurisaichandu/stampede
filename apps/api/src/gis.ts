import { readFile } from "node:fs/promises"
import { z } from "zod"
import type { Property } from "../contracts.ts"
import type { GisCandidate, GisLookup } from "./api-types.ts"

const DEFAULT_BASE = "https://geo.sanjoseca.gov/server/rest/services"
const PATHS = {
  geocode: "Locators/DPW_CSJLocator/GeocodeServer/findAddressCandidates",
  parcel: "PLN/PLN_Geocortex_Public_PRD/MapServer/49/query",
  zoning: "OPN/OPN_OpenDataService/MapServer/401/query",
}
type Call = keyof typeof PATHS
type Read = (call: Call, params: Record<string, string>) => Promise<unknown>

const MIN_SCORE = 90
const ACCEPTED_TYPES = ["PointAddress", "StreetAddress"]
const NOBLE = /^14630 noble ave(nue)?\.?(,? san jos[eé])?(,? (ca|california))?(,? 95132)?$/i

// A broken service answers HTTP 200 with an `error` body, so these parses are also the failure check.
const GeocodeBody = z.object({
  candidates: z.array(
    z.object({
      address: z.string(),
      score: z.number(),
      location: z.object({ x: z.number(), y: z.number() }),
      attributes: z.looseObject({ Addr_type: z.string(), City: z.string() }),
    }),
  ),
})
const ParcelBody = z.object({
  features: z.array(
    z.object({ attributes: z.looseObject({ APN: z.string().nullable(), PARCELID: z.string().nullable() }) }),
  ),
})
const ZoningBody = z.object({
  features: z.array(
    z.object({ attributes: z.looseObject({ ZONING: z.string().nullable(), REZONINGFILE: z.string().nullable() }) }),
  ),
})
type Hit = z.infer<typeof GeocodeBody>["candidates"][number]
type Parcel = z.infer<typeof ParcelBody>["features"][number]["attributes"]
type Zone = z.infer<typeof ZoningBody>["features"][number]["attributes"]

const live: Read = async (call, params) => {
  const base = process.env.GIS_BASE_URL || DEFAULT_BASE
  const res = await fetch(`${base}/${PATHS[call]}?${new URLSearchParams({ ...params, f: "json" })}`, {
    signal: AbortSignal.timeout(4_000),
  })
  if (!res.ok) throw new Error(`${call} HTTP ${res.status}`)
  return res.json()
}

const fixture: Read = async (call) =>
  JSON.parse(await readFile(new URL(`../fixtures/noble-house.${call}.json`, import.meta.url), "utf8"))

export function parseZoning(raw: string | null): { base: string | null; overlay: string | null } {
  const match = raw?.trim().match(/^([^()]+?)\s*(?:\(([^()]+)\))?$/)
  return { base: match?.[1] ?? null, overlay: match?.[2] ?? null }
}

const sameAddress = (a: string, b: string) => a.trim().replace(/\s+/g, " ").toLowerCase() === b.toLowerCase()

async function queryPoint(read: Read, hit: Hit, buffered: boolean) {
  const params = {
    geometry: `${hit.location.x},${hit.location.y}`,
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "*",
    returnGeometry: "false",
    ...(buffered ? { distance: "15", units: "esriSRUnit_Meter" } : {}),
  }
  const [parcel, zoning] = await Promise.all([read("parcel", params), read("zoning", params)])
  return {
    parcels: ParcelBody.parse(parcel).features.map((f) => f.attributes),
    zones: ZoningBody.parse(zoning).features.map((f) => f.attributes),
  }
}

const onlyValue = <T>(values: T[]) => (new Set(values).size === 1 ? values[0] : null)

function toProperty(hit: Hit, parcel: Parcel, zones: Zone[], source: GisLookup["source"], fetchedAt: string): Property {
  const zoning = onlyValue(zones.map((z) => z.ZONING))
  const { base, overlay } = parseZoning(zoning)
  return {
    address: hit.address,
    lat: hit.location.y,
    lng: hit.location.x,
    apn: parcel.APN!,
    parcelId: parcel.PARCELID ?? "",
    zoning,
    zoningBase: base,
    zoningOverlay: overlay,
    rezoningFile: onlyValue(zones.map((z) => z.REZONINGFILE)),
    lookupConfidence: hit.score,
    source,
    fetchedAt,
  }
}

function toCandidate(hit: Hit, parcel?: Parcel, zoning: string | null = null): GisCandidate {
  return {
    address: hit.address,
    score: hit.score,
    addrType: hit.attributes.Addr_type,
    lat: hit.location.y,
    lng: hit.location.x,
    apn: parcel?.APN ?? null,
    parcelId: parcel?.PARCELID ?? null,
    zoning,
  }
}

async function resolve(
  read: Read,
  source: GisLookup["source"],
  address: string,
  pick?: { apn: string | null },
): Promise<GisLookup> {
  const fetchedAt = new Date().toISOString()
  const result = (status: GisLookup["status"], property: Property | null = null, candidates: GisCandidate[] = []) => ({
    status,
    source,
    fetchedAt,
    property,
    candidates,
  })

  const body = GeocodeBody.parse(
    await read("geocode", { SingleLine: address, outFields: "*", outSR: "4326" }),
  )
  const exact = body.candidates.filter((c) => sameAddress(address, c.address))
  const found = (exact.length ? exact : body.candidates)
    .filter((c) => ACCEPTED_TYPES.includes(c.attributes.Addr_type))
    .toSorted((a, b) => b.score - a.score)

  const best = found[0]
  if (!best || best.score < MIN_SCORE) return result("not_found")
  if (best.attributes.City !== "San Jose") return result("out_of_city")

  const listed = found.filter((c) => c.score >= MIN_SCORE && c.attributes.City === "San Jose")
  if (listed.length > 1) return result("needs_confirm", null, listed.map((c) => toCandidate(c)))

  const point = await queryPoint(read, best, false)
  const [parcel] = point.parcels
  if (!pick?.apn && point.parcels.length === 1 && parcel.APN && point.zones.length === 1) {
    return result("matched", toProperty(best, parcel, point.zones, source, fetchedAt))
  }

  const near = await queryPoint(read, best, true)
  const picked = near.parcels.find((p) => p.APN !== null && p.APN === pick?.apn)
  if (picked) return result("matched", toProperty(best, picked, near.zones, source, fetchedAt))

  const parcels = [...new Map(near.parcels.filter((p) => p.APN).map((p) => [p.APN, p])).values()]
  if (!parcels.length) return result("not_found")
  const zoning = onlyValue(near.zones.map((z) => z.ZONING))
  return result("needs_confirm", null, parcels.map((p) => toCandidate(best, p, zoning)))
}

export async function lookup(address: string, pick?: { apn: string | null }): Promise<GisLookup> {
  try {
    return await resolve(live, "live", address, pick)
  } catch (e) {
    console.warn(`city GIS failed: ${e instanceof z.ZodError ? "unexpected response" : (e as Error).message}`)
    if (NOBLE.test(address.trim().replace(/\s+/g, " "))) return resolve(fixture, "fixture", address, pick)
    return { status: "unavailable", source: "live", fetchedAt: new Date().toISOString(), property: null, candidates: [] }
  }
}
