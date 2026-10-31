import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { EMPTY_DECK, emptyPermit, type Property } from "../../contracts.ts"
import type { GisLookup, PlanType } from "../api-types.ts"
import type { IntakeResult } from "./extract.ts"
import { planMime, readPlanTurn, toPlanTurn } from "./plan.ts"
import type { IntakeTurn } from "./schema.ts"
import { composeReply, homeownerWords, toTurn } from "./turn.ts"

const noSlot = { status: "not_mentioned" as const, value: null, confidence: 1 }
const stated = <T,>(value: T, confidence = 1) => ({ status: "stated" as const, value, confidence })
const read = (deck: Partial<IntakeTurn["deck"]> = {}, over: Partial<IntakeTurn> = {}): IntakeResult => ({
  ok: true,
  turn: {
    intent: "provide_project_details",
    reply: "This is a site plan for an attached backyard deck.",
    address: noSlot,
    deck: {
      lengthFt: noSlot,
      widthFt: noSlot,
      maxHeightIn: noSlot,
      attached: noSlot,
      ledgerType: noSlot,
      rearSetbackFt: noSlot,
      guardHeightIn: noSlot,
      servesExitDoor: noSlot,
      servesDoorLanding: noSlot,
      ...deck,
    },
    ...over,
  },
})
const okTurn = (result: IntakeResult, fileAddress: string | null = null) => {
  const turn = toPlanTurn(result, fileAddress)
  assert.ok(turn.ok)
  return turn
}
const b64 = (bytes: number[] | string) => Buffer.from(bytes as string).toString("base64")
const PARCEL = "14630 NOBLE AVE, SAN JOSE, CA"

const cases: [string, () => void | Promise<void>][] = [
  [
    "planMime goes by the bytes",
    () => {
      assert.equal(planMime(b64("%PDF-1.7 rest")), "application/pdf")
      assert.equal(planMime(b64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])), "image/png")
      assert.equal(planMime(b64([0xff, 0xd8, 0xff, 0xe0, 0])), "image/jpeg")
      assert.equal(planMime(b64("RIFF\x10\x00\x00\x00WEBPVP8 ")), "image/webp")
      assert.equal(planMime(b64("\x00\x00\x00\x18ftypheic\x00\x00")), null, "HEIC")
      assert.equal(planMime(b64("RIFF\x10\x00\x00\x00WAVEfmt ")), null, "RIFF that is not WebP")
      assert.equal(planMime(b64("just some text")), null)
    },
  ],
  [
    "numbers are saved though the homeowner never typed them",
    () => {
      const turn = okTurn(read({ lengthFt: stated(16), widthFt: stated(12), attached: stated(true) }))
      assert.deepEqual(turn.facts.deck, { lengthFt: 16, widthFt: 12, attached: true })
      assert.deepEqual(turn.facts.invalid, [])
      assert.equal(turn.readback, "From your plan I read: 16 ft long, 12 ft wide, and attached to the house. Tell me if any of that is wrong.")
    },
  ],
  [
    "low confidence is dropped",
    () => {
      const turn = okTurn(
        read({ lengthFt: stated(16, 0.69), widthFt: stated(12, 0.7) }, { address: stated("14630 Noble Ave", 0.5) }),
      )
      assert.deepEqual(turn.facts.deck, { widthFt: 12 })
      assert.equal(turn.facts.address, null)
    },
  ],
  [
    "a file can't say the homeowner doesn't know",
    () => {
      const turn = okTurn(read({ lengthFt: { status: "user_unknown", value: null, confidence: 1 } }))
      assert.deepEqual(turn.facts.unknown, [])
      assert.equal(turn.readback, "I couldn't read any deck measurements from it.")
    },
  ],
  [
    "off topic saves nothing",
    () => {
      const turn = okTurn(read({ lengthFt: stated(16) }, { intent: "off_topic", address: stated("1 Main St") }))
      assert.deepEqual(turn.facts, { address: null, deck: {}, unknown: [], invalid: [] })
      assert.equal(turn.readback, undefined)
      assert.match(turn.ack, /didn't save anything/)
    },
  ],
  [
    "a confirmed parcel is kept",
    () => {
      const other = okTurn(read({}, { address: stated("99 Elm St, San Jose") }), PARCEL)
      assert.equal(other.facts.address, null)
      assert.match(other.ack, new RegExp(`The plan shows 99 Elm St, San Jose, but your file has ${PARCEL}, so I kept your file's address\\. Tell me if that's wrong\\.$`))
      const same = okTurn(read({}, { address: stated("14630 Noble Avenue") }), PARCEL)
      assert.equal(same.facts.address, null)
      assert.doesNotMatch(same.ack, /kept your file/)
    },
  ],
  [
    "the readback survives a failed lookup",
    () => {
      const turn = okTurn(read({ lengthFt: stated(16) }, { address: stated("1 Nowhere Rd") }))
      const lookup: GisLookup = { status: "not_found", source: "live", fetchedAt: "2026-10-31T12:00:00Z", property: null, candidates: [] }
      const reply = composeReply({ turn, lookup, permit: emptyPermit("x"), outcome: "applied" })
      assert.match(reply, /From your plan I read: 16 ft long\./)
      assert.match(reply, /couldn't find that address/)
      assert.doesNotMatch(reply, /site plan/)
    },
  ],
  [
    "the readback goes out with a revision, and stays out of the invalid corrections branch",
    () => {
      const permit = { ...emptyPermit("x"), status: "CORRECTIONS_REQUESTED" as const, revision: 2 }
      const saved = okTurn(read({ guardHeightIn: stated(42) }))
      const sent = composeReply({ turn: saved, lookup: null, permit, outcome: "revision_submitted" })
      assert.match(sent, /railing\. Tell me if any of that is wrong\. Revision 2 submitted\./)
      const bad = okTurn(read({ guardHeightIn: stated(900) }))
      const refused = composeReply({ turn: bad, lookup: null, permit, outcome: "none" })
      assert.doesNotMatch(refused, /From your plan|couldn't read any/)
      assert.match(refused, /I didn't save anything from this plan\.$/)
    },
  ],
  [
    "confirming a readback isn't refused, but an invented number still is",
    () => {
      const words = homeownerWords([
        { role: "assistant", content: "From your plan I read: 16 ft long. Tell me if any of that is wrong." },
        { role: "assistant", content: "How tall will the railing be, 99 inches?" },
        { role: "user", content: "yes that's right" },
      ])
      const confirmed = toTurn(read({ lengthFt: stated(16) }), words)
      assert.ok(confirmed.ok)
      assert.deepEqual(confirmed.facts.deck, { lengthFt: 16 })
      const invented = toTurn(read({ guardHeightIn: stated(99) }), words)
      assert.ok(invented.ok)
      assert.deepEqual(invented.facts.invalid, ["deck.guardHeightIn"])
    },
  ],
  [
    "a verdict in the model reply is replaced",
    () => {
      const turn = okTurn(read({}, { reply: "This deck is approved." }))
      assert.doesNotMatch(turn.ack, /approved/)
      assert.match(turn.ack, /reviewers/)
    },
  ],
  [
    "an out-of-range value lands in invalid",
    () => {
      const turn = okTurn(read({ lengthFt: stated(5000), widthFt: stated(12) }))
      assert.deepEqual(turn.facts.invalid, ["deck.lengthFt"])
      assert.deepEqual(turn.facts.deck, { widthFt: 12 })
      assert.match(turn.ack, /I can't use that value for the length/)
    },
  ],
  [
    "a failed read gets plan wording",
    () => {
      const reply = (reason: Extract<IntakeResult, { ok: false }>["reason"]) => {
        const turn = toPlanTurn({ ok: false, reason }, null)
        assert.ok(!turn.ok)
        return turn.reply
      }
      assert.match(reply("unreadable"), /couldn't open that file/)
      assert.match(reply("incomplete"), /just the page/)
      assert.match(reply("busy"), /handling a lot/)
    },
  ],
  ...(
    [
      ["sample-deck-plan.pdf", "application/pdf"],
      ["sample-deck-plan.png", "image/png"],
    ] as [string, PlanType][]
  ).map(([file, mime]): [string, () => Promise<void>] => [
    `live: readPlanTurn reads ${file}`,
    async () => {
      const base64 = (await readFile(new URL(`../../../../input/${file}`, import.meta.url))).toString("base64")
      assert.equal(planMime(base64), mime)
      const started = performance.now()
      const turn = await readPlanTurn({ mime, base64 }, "", null)
      console.log(`  ${Math.round(performance.now() - started)}ms`)
      assert.ok(turn.ok, JSON.stringify(turn))
      console.log(`  ${turn.ack} ${turn.readback}`)
      const { deck, address } = turn.facts
      assert.equal(deck.lengthFt, 16)
      assert.equal(deck.widthFt, 12)
      assert.equal(deck.maxHeightIn, 36)
      assert.equal(deck.attached, true)
      assert.equal(deck.guardHeightIn, 36)
      assert.equal(deck.rearSetbackFt, 18)
      assert.ok(deck.ledgerType)
      assert.match(address ?? "", /14630 Noble/i)
    },
  ]),
]

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
