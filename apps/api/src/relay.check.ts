// With dev running, from apps/api: npx tsx --env-file=.env src/relay.check.ts
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { setTimeout as sleep } from "node:timers/promises"
import { currentFindings, type PermitStatus, type RelayEnvelope } from "../contracts.ts"
import { permitActor } from "./actor.ts"
import { deliver, onNeedsInput, openPermitChannel, post, relayMode } from "./relay.ts"

for (const key of ["RELAY_WORKSPACE_KEY", "RELAY_INTAKE_TOKEN", "RELAY_BASE_URL", "FAKE_OFFICE"]) delete process.env[key]

const heard: RelayEnvelope[] = []
const stop = onNeedsInput((e) => void heard.push(e))

async function waitFor(id: string, status: PermitStatus, seconds = 15) {
  for (let i = 0; i < seconds * 20; i++) {
    if ((await permitActor(id).read()).status === status) return
    await sleep(50)
  }
  assert.fail(`never reached ${status}, at ${(await permitActor(id).read()).status}`)
}

async function readyPermit() {
  const id = randomUUID()
  const actor = permitActor(id)
  await actor.setProperty({
    address: "14630 Noble Ave",
    lat: 37.4,
    lng: -121.8,
    apn: "59531001",
    parcelId: "1",
    zoning: "R-1-8(PD)",
    zoningBase: "R-1-8",
    zoningOverlay: "PD",
    rezoningFile: null,
    lookupConfidence: 100,
    source: "fixture",
    fetchedAt: new Date().toISOString(),
  })
  await actor.applyIntakePatch({
    deck: { lengthFt: 16, widthFt: 12, maxHeightIn: 36, attached: true, guardHeightIn: 36 },
    missingFields: [],
    unknownFields: [],
  })
  await actor.confirmIntake(new Date().toISOString())
  return { id, actor }
}

assert.equal(relayMode(), "off")
assert.equal(await post({ permitId: "x", revision: 1, type: "REVIEW_REQUEST", payload: {} }), false)
assert.equal(await post({ permitId: "x", revision: 1, type: "REVIEW_REQUEST", payload: {} }), false)
console.log("ok off mode: post returns false")

process.env.FAKE_OFFICE = "1"
assert.equal(relayMode(), "fake")
{
  const { id, actor } = await readyPermit()
  const start = Date.now()
  const request = { permitId: id, revision: 1, type: "REVIEW_REQUEST", payload: {} } as const
  assert.equal(await post(request), true)
  assert.equal(await post(request), true)
  assert.ok(Date.now() - start < 500, "post must not wait for the office run")

  let seen = 0
  const arrivals: number[] = []
  for (let i = 0; i < 400 && (await actor.read()).status !== "CORRECTIONS_REQUESTED"; i++) {
    const count = (await actor.read()).findings.length
    if (count > seen) arrivals.push(Date.now())
    seen = count
    await sleep(25)
  }
  await waitFor(id, "CORRECTIONS_REQUESTED")
  await sleep(200)
  let p = await actor.read()
  assert.deepEqual(
    p.findings.map((f) => [f.ruleId, f.status]),
    [
      ["SJ-PERMIT-01", "PASS"],
      ["CRC-GUARD-01", "CORRECTION"],
      ["SJ-DETAIL-01", "NEEDS_INFORMATION"],
      ["SJ-ZONING-01", "NEEDS_HUMAN_VERIFICATION"],
    ],
  )
  assert.deepEqual(p.events.map((e) => e.to), ["READY_FOR_REVIEW", "IN_REVIEW", "CORRECTIONS_REQUESTED"])
  assert.deepEqual(p.revisions.map((r) => r.revision), [1])
  assert.ok(p.findings[3].humanReviewNeeded)
  assert.match(p.findings[3].reason, /Overlay PD/)
  const gaps = arrivals.slice(1).map((t, i) => t - arrivals[i])
  assert.ok(gaps.every((g) => g > 700 && g < 1200), `gaps ${gaps}`)
  console.log("ok review ran once, four findings in order, gaps ms:", gaps.join(","))

  assert.equal(heard.length, 1)
  assert.deepEqual(heard[0].payload.findingIds, [p.findings[1].findingId])
  assert.equal(heard[0].sender, "clerk")
  console.log("ok NEEDS_INPUT came back through the same handler, once")

  assert.equal(await actor.submitRevision({ deck: { guardHeightIn: 40 }, changedFields: ["deck.guardHeightIn"] }), 2)
  await post({ permitId: id, revision: 2, type: "REVISION_SUBMITTED", payload: { changedFields: ["deck.guardHeightIn"] } })
  await waitFor(id, "REVISED")
  await waitFor(id, "CORRECTIONS_REQUESTED")
  await sleep(200)
  assert.equal(heard.length, 2)
  assert.equal(heard[1].revision, 2)
  console.log("ok a revision that stays under 42 goes back to corrections")

  assert.equal(await actor.submitRevision({ deck: { guardHeightIn: 42 }, changedFields: ["deck.guardHeightIn"] }), 3)
  await post({ permitId: id, revision: 3, type: "REVISION_SUBMITTED", payload: { changedFields: ["deck.guardHeightIn"] } })
  await waitFor(id, "PRE_REVIEW_COMPLETE")
  await sleep(200)
  p = await actor.read()
  assert.equal(p.relayLog.at(-1)?.type, "REVIEW_COMPLETE")
  assert.deepEqual(
    currentFindings(p.findings).map((f) => [f.ruleId, f.status, f.revision]),
    [
      ["SJ-PERMIT-01", "PASS", 1],
      ["CRC-GUARD-01", "PASS", 3],
      ["SJ-DETAIL-01", "NEEDS_INFORMATION", 1],
      ["SJ-ZONING-01", "NEEDS_HUMAN_VERIFICATION", 1],
    ],
  )
  assert.equal(p.findings.length, 6)
  assert.deepEqual(p.revisions.map((r) => [r.revision, r.deck.guardHeightIn]), [[1, 36], [2, 40], [3, 42]])
  assert.equal(heard.length, 2)
  console.log("ok only the guard rule reran, the rest kept revision 1, reached PRE_REVIEW_COMPLETE")
  for (const entry of p.relayLog) assert.doesNotMatch(entry.text, /[{}]|approved/i)
  console.log("  relay log:", p.relayLog.map((entry) => `${entry.sender}/${entry.type}`).join(" "))
}

{
  const needs = (revision: number, permitId = "dedupe"): RelayEnvelope => ({
    permitId,
    revision,
    sender: "clerk",
    type: "NEEDS_INPUT",
    payload: { findingIds: [] },
    timestamp: new Date().toISOString(),
  })
  heard.length = 0
  await deliver(needs(2))
  await deliver(needs(2))
  await deliver(needs(1))
  assert.deepEqual(heard.map((e) => e.revision), [2])
  const flaky = onNeedsInput(() => {
    throw new Error("expected failure in check")
  })
  await deliver(needs(3))
  flaky()
  await deliver(needs(3))
  assert.deepEqual(heard.map((e) => e.revision), [2, 3, 3])
  console.log("ok listener dedupes by relayKey, drops a stale revision, and redelivers after a handler failure")
}
stop()

// A stub Relay over HTTP, so the real SDK path runs without a key. The stream socket is not stubbed.
delete process.env.FAKE_OFFICE
process.env.RELAY_POST_TIMEOUT_MS = "4000"
let hangMe = 1
let hangSend = 1
let createReply: "conflict" | "broken" | "ok" = "broken"
const sends: { key: string | undefined; path: string; body: any }[] = []
const creates: string[] = []
let invites = 0
let failInvite = 0
const stub = createServer(async (req, res) => {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk)
  const reply = (data: unknown) => {
    res.setHeader("content-type", "application/json")
    res.end(JSON.stringify({ ok: true, data }))
  }
  if (process.env.STUB_LOG) console.log("  stub", req.method, req.url)
  if (req.url === "/v1/agent") {
    if (hangMe-- > 0) return
    return reply({ id: "agent_1", name: "intake", status: "online", type: "agent", created_at: new Date().toISOString() })
  }
  if (req.method === "POST" && /\/channels\/[^/]+\/messages$/.test(req.url ?? "")) {
    const body = JSON.parse(Buffer.concat(chunks).toString())
    sends.push({ key: req.headers["idempotency-key"] as string | undefined, path: req.url!, body })
    if (hangSend-- > 0) return
    return reply({ id: "msg_1", channel_id: "c", channel_name: "permit-1", agent_id: "agent_1", agent_name: "intake", text: body.text, created_at: new Date().toISOString() })
  }
  if (req.method === "POST" && /invite/.test(req.url ?? "")) {
    invites++
    if (failInvite-- > 0) {
      res.statusCode = 403
      res.setHeader("content-type", "application/json")
      return res.end(JSON.stringify({ ok: false, error: { code: "forbidden", message: "forbidden" } }))
    }
  }
  if (req.method === "POST" && req.url === "/v1/channels") {
    creates.push(createReply)
    if (createReply !== "ok") {
      const [status, code] = createReply === "conflict" ? [409, "name_conflict"] : [403, "forbidden"]
      res.statusCode = status
      res.setHeader("content-type", "application/json")
      return res.end(JSON.stringify({ ok: false, error: { code, message: code } }))
    }
  }
  reply({})
})
await new Promise<void>((resolve) => stub.listen(0, "127.0.0.1", resolve))
process.env.RELAY_WORKSPACE_KEY = "rk_live_stub"
process.env.RELAY_INTAKE_TOKEN = "at_live_stub"
process.env.RELAY_BASE_URL = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`
assert.equal(relayMode(), "real")

const message = { permitId: "1", revision: 1, type: "REVIEW_REQUEST", payload: {} } as const
const timed = async () => {
  const start = Date.now()
  const result = await post(message)
  return [result, Date.now() - start] as const
}
const [first, firstMs] = await timed()
assert.equal(first, false)
assert.ok(firstMs >= 3900 && firstMs < 4600, `reconnect bound ${firstMs}`)
console.log("ok a hung reconnect fails the post in", firstMs, "ms")
const [second, secondMs] = await timed()
assert.equal(second, false)
assert.ok(secondMs >= 3900 && secondMs < 4600, `send bound ${secondMs}`)
console.log("ok reconnect recovered after failing, then a hung send fails the post in", secondMs, "ms")
const [third] = await timed()
assert.equal(third, true)
assert.equal(sends.length, 2)
assert.equal(sends[0].key, "1:1:REVIEW_REQUEST:-")
assert.equal(sends[1].key, sends[0].key)
assert.equal(sends[1].path, "/v1/channels/permit-1/messages")
assert.equal(sends[1].body.data.sender, "intake")
assert.equal(sends[1].body.data.permitId, "1")
assert.equal(JSON.parse(sends[1].body.text).type, "REVIEW_REQUEST")
console.log("ok retry sent the same idempotency key:", sends[1].key)

await assert.rejects(openPermitChannel("1"), (err: any) => err.code === "unauthorized")
createReply = "conflict"
await openPermitChannel("1")
createReply = "ok"
await openPermitChannel("1")
assert.deepEqual(creates, ["broken", "conflict"])
console.log("ok open rethrows other errors, a failed open retries, name_conflict is tolerated, success is memoized")

createReply = "conflict"
failInvite = 2
invites = 0
await assert.rejects(openPermitChannel("2"))
assert.equal(invites, 2, "one invite plus one retry, then give up")
failInvite = 0
await openPermitChannel("2")
assert.equal(invites - 2, 3)
console.log("ok an invite failing twice rejects the open, and the next open invites all three again")

failInvite = 1
invites = 0
await openPermitChannel("3")
assert.equal(invites, 4)
console.log("ok one failed invite is retried and the open succeeds")

stub.closeAllConnections()
stub.close()
console.log("ok real SDK path ran against the stub")
process.exit(0)
