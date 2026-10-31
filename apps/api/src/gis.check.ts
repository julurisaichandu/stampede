import assert from "node:assert/strict"
import { lookup, parseZoning } from "./gis.ts"

const NOBLE = "14630 Noble Ave, San Jose"
const BROKEN_BASES = {
  "dead host": "https://geo.invalid/server/rest/services",
  "200 with error body": "https://geo.sanjoseca.gov/server/rest/services/nope",
}

const cases: [string, () => Promise<void>][] = [
  [
    "Noble Ave is matched with the real parcel",
    async () => {
      const r = await lookup(NOBLE)
      assert.equal(r.status, "matched")
      assert.equal(r.source, "live")
      assert.equal(r.property?.apn, "59531001")
      assert.equal(r.property?.parcelId, "103252")
      assert.equal(r.property?.zoningBase, "R-1-8")
      assert.equal(r.property?.zoningOverlay, null)
      assert.equal(r.property?.lookupConfidence, 100)
      assert.ok(r.property!.lng < 0 && r.property!.lat > 0, "lat and lng are not swapped")
    },
  ],
  ["Cupertino is out_of_city", async () => assert.equal((await lookup("10600 N Tantau Ave Cupertino")).status, "out_of_city")],
  ["gibberish is not_found", async () => assert.equal((await lookup("asdf qwerty zzzz")).status, "not_found")],
  [
    "StreetName under 90 is not_found",
    async () => assert.equal((await lookup("1600 Amphitheatre Pkwy Mountain View")).status, "not_found"),
  ],
  [
    "typo with a city lists both streets, never auto-picks",
    async () => {
      const r = await lookup("200 E Santa Clarra St, San Jose")
      assert.equal(r.status, "needs_confirm")
      assert.equal(r.property, null)
      assert.deepEqual(r.candidates.map((c) => c.address.slice(0, 5)).toSorted(), ["200 E", "200 W"])
      assert.ok(r.candidates.every((c) => c.score >= 90 && c.apn === null))
    },
  ],
  [
    "bare typo: W has drifted under 90, so the decision order matches E",
    async () => {
      const r = await lookup("200 E Santa Clarra St")
      assert.equal(r.status, "matched")
      assert.match(r.property!.address, /^200 E Santa Clara St/)
    },
  ],
  [
    "picking a listed address matches and cannot loop",
    async () => {
      const list = await lookup("200 E Santa Clarra St, San Jose")
      const east = list.candidates.find((c) => c.address.startsWith("200 E"))!
      const r = await lookup(east.address, { apn: null })
      assert.equal(r.status, "matched")
      assert.equal(r.property?.apn, "46724117")
    },
  ],
  [
    "200 W needs a parcel choice, then the pick matches, and a forged APN does not",
    async () => {
      const list = await lookup("200 W Santa Clara St")
      assert.equal(list.status, "needs_confirm")
      assert.ok(list.candidates.length > 1, "buffer found neighbours")
      assert.ok(list.candidates.every((c) => /^\d{8}$/.test(c.apn ?? "")))
      console.log("  parcels", list.candidates.map((c) => `${c.apn} ${c.zoning}`).join(", "))

      const first = list.candidates[0]
      const picked = await lookup(first.address, { apn: first.apn })
      assert.equal(picked.status, "matched")
      assert.equal(picked.property?.apn, first.apn)
      assert.equal(picked.property?.zoning, first.zoning)

      const forged = await lookup(first.address, { apn: "59531001" })
      assert.equal(forged.status, "needs_confirm")
      assert.equal(forged.property, null)
    },
  ],
  [
    "parseZoning",
    async () => {
      assert.deepEqual(parseZoning("R-1-8(PD)"), { base: "R-1-8", overlay: "PD" })
      assert.deepEqual(parseZoning("R-1-8"), { base: "R-1-8", overlay: null })
      assert.deepEqual(parseZoning(null), { base: null, overlay: null })
    },
  ],
]

for (const [how, base] of Object.entries(BROKEN_BASES)) {
  cases.push([
    `city down (${how}): Noble uses the fixture, others get nothing`,
    async () => {
      process.env.GIS_BASE_URL = base
      try {
        const noble = await lookup(NOBLE)
        assert.equal(noble.status, "matched")
        assert.equal(noble.source, "fixture")
        assert.equal(noble.property?.apn, "59531001")
        assert.equal(noble.property?.source, "fixture")

        for (const other of ["200 E Santa Clara St, San Jose", "14630 Noble Ave, Cupertino", "14631 Noble Ave, San Jose"]) {
          const r = await lookup(other)
          assert.equal(r.status, "unavailable", other)
          assert.equal(r.property, null)
          assert.deepEqual(r.candidates, [])
        }
      } finally {
        delete process.env.GIS_BASE_URL
      }
    },
  ])
}

let failed = 0
for (const [name, run] of cases) {
  try {
    await run()
    console.log(`PASS ${name}`)
  } catch (e) {
    failed++
    console.log(`FAIL ${name}\n  ${(e as Error).message}`)
  }
}
console.log(`${cases.length - failed}/${cases.length} passed`)
process.exit(failed ? 1 : 0)
