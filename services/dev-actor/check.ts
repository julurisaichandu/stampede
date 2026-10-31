// With dev running, from apps/api:
//   npx tsx --env-file=.env ../../services/dev-actor/check.ts          prints a permit id
//   restart dev, then the same command with that id, to prove state survived.
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { setTimeout as sleep } from "node:timers/promises"
import { emptyPermit, type Finding, type Property } from "../../apps/api/contracts.ts"
import { actors } from "../../apps/api/generated/index.js"
import { permitActor } from "../../apps/api/src/actor.ts"

const AT = "2026-10-31T13:00:00.000Z"
const property: Property = {
  address: "14630 Noble Ave",
  lat: 37.4,
  lng: -121.8,
  apn: "59531001",
  parcelId: "1",
  zoning: "R-1-8",
  zoningBase: "R-1-8",
  zoningOverlay: null,
  rezoningFile: null,
  lookupConfidence: 100,
  source: "fixture",
  fetchedAt: AT,
}
const finding: Finding = {
  findingId: "f1",
  ruleId: "CRC-GUARD-01",
  reviewer: "building",
  revision: 1,
  status: "CORRECTION",
  field: "deck.guardHeightIn",
  observed: 36,
  required: "42 in",
  reason: "r",
  citation: "c",
  sourceUrl: "u",
  evidence: [],
  humanReviewNeeded: false,
}

async function connect(id: string, role: "viewer" | "clerk") {
  const { websocketUrl } = await actors.PermitActor.prepareWebsocket({ actorId: id, metadata: { role } })
  const socket = new WebSocket(websocketUrl)
  const frames: any[] = []
  socket.addEventListener("message", (e) => frames.push(JSON.parse(String(e.data))))
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true })
    socket.addEventListener("error", reject, { once: true })
  })
  return { frames, send: (m: actors.PermitActor.Incoming) => socket.send(JSON.stringify(m)), close: () => socket.close() }
}

async function until(test: () => boolean | Promise<boolean>, what: string) {
  for (let i = 0; i < 100; i++) {
    if (await test()) return
    await sleep(20)
  }
  assert.fail(`timed out waiting for ${what}`)
}

const survivor = process.argv[2]
if (survivor) {
  const p = await permitActor(survivor).read()
  assert.equal(p.status, "CORRECTIONS_REQUESTED")
  assert.equal(p.revision, 2)
  assert.equal(p.deck.guardHeightIn, 42)
  assert.equal(p.property?.apn, "59531001")
  assert.equal(p.chat.length, 1)
  assert.equal(p.findings.length, 1)
  assert.equal(p.revisions.length, 1)
  assert.equal(p.events.length, 3)
  console.log("ok state survived the restart")
  process.exit(0)
}

const id = randomUUID()
const actor = permitActor(id)
const { id: _, ...defaults } = emptyPermit(id)
assert.deepEqual(await actor.read(), defaults)
console.log("ok new id reads default state")

await actor.appendChat({ role: "user", content: "hello", at: AT })
await actor.setProperty(property)
await actor.applyIntakePatch({ deck: { lengthFt: 16, guardHeightIn: 36 }, missingFields: ["deck.widthFt"], unknownFields: ["deck.ledgerType"] })
await actor.applyIntakePatch({ deck: { widthFt: 12 }, missingFields: [], unknownFields: ["deck.ledgerType"] })
let p = await actor.read()
assert.equal(p.chat.length, 1)
assert.equal(p.property?.apn, "59531001")
assert.deepEqual([p.deck.lengthFt, p.deck.widthFt, p.deck.guardHeightIn, p.deck.ledgerType], [16, 12, 36, null])
assert.deepEqual(p.intake.unknownFields, ["deck.ledgerType"])
console.log("ok appendChat, setProperty and applyIntakePatch write and merge")

assert.equal((actor as any).setStatus, undefined)
await assert.rejects(actor.submitRevision({ deck: {}, changedFields: [] }), /no corrections requested/)
console.log("ok no status RPC, and submitRevision throws in INTAKE")

const viewer = await connect(id, "viewer")
await until(() => viewer.frames.some((f) => f.type === "state"), "viewer state frame")
console.log("  first frame:", viewer.frames[0].type, Object.keys(viewer.frames[0]).join(","))
viewer.send({ type: "status", to: "PRE_REVIEW_COMPLETE", why: "x", at: AT })
viewer.send({ type: "freeze", at: AT })
viewer.send({ type: "finding", finding })
viewer.send({ type: "relayLog", entry: { at: AT, sender: "clerk", type: "FINDING", revision: 1, text: "x" } })
await until(() => viewer.frames.filter((f) => f.type === "denied").length === 4, "four denied frames")
p = await actor.read()
assert.equal(p.status, "INTAKE")
assert.deepEqual([p.revisions, p.findings, p.relayLog, p.events], [[], [], [], []])
console.log("ok viewer socket denied on all four clerk writes, nothing changed")

await actor.confirmIntake(AT)
await until(() => viewer.frames.some((f) => f.type === "state_update"), "state_update after confirm")
console.log("  update frame:", JSON.stringify(viewer.frames.find((f) => f.type === "state_update")).slice(0, 140))
const afterConfirm = viewer.frames.length
await actor.confirmIntake("2030-01-01T00:00:00.000Z")
await sleep(300)
assert.equal(viewer.frames.length, afterConfirm)
p = await actor.read()
assert.equal(p.intake.confirmedAt, AT)
assert.equal(p.intake.complete, true)
console.log("ok second confirmIntake made no write: no frame, confirmedAt unchanged")

await assert.rejects(actor.setProperty(property), /locked/)
await assert.rejects(actor.applyIntakePatch({ deck: {}, missingFields: [], unknownFields: [] }), /locked/)
console.log("ok setProperty and applyIntakePatch throw once confirmed")

const clerk = await connect(id, "clerk")
clerk.send({ type: "status", to: "READY_FOR_REVIEW", why: "confirmed", at: AT })
clerk.send({ type: "freeze", at: AT })
clerk.send({ type: "freeze", at: "2030-01-01T00:00:00.000Z" })
clerk.send({ type: "status", to: "IN_REVIEW", why: "frozen", at: AT })
clerk.send({ type: "finding", finding })
clerk.send({ type: "finding", finding })
clerk.send({ type: "relayLog", entry: { at: AT, sender: "clerk", type: "FINDING", revision: 1, text: "one line" } })
clerk.send({ type: "status", to: "CORRECTIONS_REQUESTED", why: "guard low", at: AT })
await until(async () => (await actor.read()).status === "CORRECTIONS_REQUESTED", "clerk status")
p = await actor.read()
assert.equal(clerk.frames.filter((f) => f.type === "denied").length, 0)
assert.deepEqual(p.events.map((e) => e.to), ["READY_FOR_REVIEW", "IN_REVIEW", "CORRECTIONS_REQUESTED"])
assert.deepEqual(p.events[2], { at: AT, who: "clerk", why: "guard low", from: "IN_REVIEW", to: "CORRECTIONS_REQUESTED" })
assert.deepEqual(p.revisions, [{ revision: 1, deck: p.deck, frozenAt: AT }])
assert.equal(p.findings.length, 1)
assert.equal(p.relayLog.length, 1)
console.log("ok clerk socket moved status with why, froze once, kept one copy of a repeated finding")

assert.equal(await actor.submitRevision({ deck: { guardHeightIn: 42 }, changedFields: ["deck.guardHeightIn"] }), 2)
p = await actor.read()
assert.equal(p.revision, 2)
assert.equal(p.deck.guardHeightIn, 42)
assert.equal(p.deck.lengthFt, 16)
assert.equal(p.revisions[0].deck.guardHeightIn, 36)
console.log("ok submitRevision merged, returned 2, frozen copy untouched")

viewer.close()
clerk.close()
console.log(id)
