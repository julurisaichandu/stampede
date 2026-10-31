// Office loop without Relay, against the running actor service (after `bun run generate`):
//   npm run accept                    → intake, review, one revision, PRE_REVIEW_COMPLETE
//   restart the actor service, then
//   npm run accept -- --after-restart → the same permit is still stamped, with its record intact
import { readFileSync, writeFileSync } from "node:fs"

import { actors } from "../generated/index.js"
import { relayKey, type FindingStatus, type PermitStatus, type Property } from "../contracts.ts"
import { openStatusSocket } from "../src/clerk-socket.ts"
import { affectedRules, changedFields, decide, runRules } from "../src/review.ts"
import { ALL_RULES, type RuleId } from "../src/rules.ts"

const ID_FILE = new URL("../.accept-id", import.meta.url)

// Test-only property. The applicant side fills the real one from the San Jose GIS lookup.
const PROPERTY: Property = {
  address: "770 Lincoln Ave, San Jose, CA 95126",
  lat: 0,
  lng: 0,
  apn: "00000000",
  parcelId: "test",
  zoning: "R-1-8",
  zoningBase: "R-1-8",
  zoningOverlay: null,
  rezoningFile: null,
  lookupConfidence: 100,
  source: "fixture",
  fetchedAt: new Date().toISOString(),
}

const EXPECTED: Record<RuleId, FindingStatus> = {
  "SJ-PERMIT-01": "PASS",
  "CRC-GUARD-01": "CORRECTION",
  "SJ-DETAIL-01": "NEEDS_INFORMATION",
  "SJ-ZONING-01": "NEEDS_HUMAN_VERIFICATION",
}

function check(ok: boolean, label: string) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`)
  if (!ok) process.exitCode = 1
}

async function rejects(call: Promise<unknown>): Promise<boolean> {
  try {
    await call
    return false
  } catch {
    return true
  }
}

async function until(done: () => boolean, ms = 5000): Promise<boolean> {
  const end = Date.now() + ms
  while (!done() && Date.now() < end) await new Promise((r) => setTimeout(r, 50))
  return done()
}

if (process.argv.includes("--after-restart")) {
  const id = readFileSync(ID_FILE, "utf8").trim()
  const s = await actors.Permit.get(id).read()
  check(s.status === "PRE_REVIEW_COMPLETE", `${id} is still PRE_REVIEW_COMPLETE after restart`)
  check(
    s.revisions.length === 2 && s.findings.length === 5 && s.relayLog.length === 1 && s.events.length > 0,
    `record intact: ${s.revisions.length} frozen revisions, ${s.findings.length} findings, ${s.relayLog.length} relay line, ${s.events.length} events`,
  )
  process.exit()
}

const id = `flow-${Date.now()}`
const permit = actors.Permit.get(id)

// A viewer socket, like the office screen, watches status change live through the state frames.
const statuses = new Set<PermitStatus>()
const { websocketUrl } = await actors.Permit.prepareWebsocket({ actorId: id, metadata: { role: "viewer" } })
const viewer = new WebSocket(websocketUrl)
viewer.addEventListener("message", (e) => {
  const m = JSON.parse(String(e.data))
  const status = m.type === "state" ? m.state?.status : m.type === "state_update" ? m.changes?.status : undefined
  if (status) statuses.add(status)
})

// Applicant side: intake fills the draft and confirms it.
await permit.setProperty(PROPERTY)
await permit.applyIntakePatch({
  deck: { lengthFt: 16, widthFt: 12, maxHeightIn: 36, attached: true, guardHeightIn: 36 },
  missingFields: [],
  unknownFields: [],
})
await permit.confirmIntake(new Date().toISOString())
check(
  await rejects(permit.applyIntakePatch({ deck: { lengthFt: 20 }, missingFields: [], unknownFields: [] })),
  "draft is locked after confirmIntake",
)

const clerk = await openStatusSocket(id, "clerk")
const building = await openStatusSocket(id, "building")
check(await rejects(building.setStatus("READY_FOR_REVIEW", "Building tries to start review")), "building cannot change status")
check(await rejects(clerk.setStatus("IN_REVIEW", "Skipping a step")), "clerk cannot skip INTAKE → IN_REVIEW")

// Revision 1: freeze, full review.
await clerk.setStatus("READY_FOR_REVIEW", "Intake confirmed")
await clerk.setStatus("IN_REVIEW", "Starting pre-review")
const first = await runRules(id, ALL_RULES)
for (const [ruleId, status] of Object.entries(EXPECTED)) {
  const got = first.find((f) => f.ruleId === ruleId)?.status
  check(got === status, `${ruleId} → ${got ?? "missing"}`)
}
check(await rejects(clerk.setStatus("PRE_REVIEW_COMPLETE", "Stamping early")), "actor refuses to stamp with open items")
check(decide(await permit.read()) === "CORRECTIONS_REQUESTED", "clerk decides CORRECTIONS_REQUESTED")
await clerk.setStatus("CORRECTIONS_REQUESTED", "Guard is too low; ledger connection missing")

async function rerun(why: string) {
  await clerk.setStatus("REVISED", why)
  await clerk.setStatus("IN_REVIEW", "Reviewing the revision")
  const fields = changedFields(await permit.read())
  return { fields, findings: await runRules(id, affectedRules(fields)) }
}
const summary = (fs: { ruleId: string; status: string }[]) => fs.map((f) => `${f.ruleId} → ${f.status}`).join(", ")

// Revision 2: guard raised to 42 in.
check((await permit.submitRevision({ deck: { guardHeightIn: 42 }, changedFields: ["deck.guardHeightIn"] })) === 2, "submitRevision opens revision 2")
check(
  await rejects(permit.submitRevision({ deck: { guardHeightIn: 44 }, changedFields: ["deck.guardHeightIn"] })),
  "a second submit before the Clerk freezes is refused",
)
const rev2 = await rerun("Guard height revised")
check(rev2.fields.join() === "deck.guardHeightIn", `revision 2 changed: ${rev2.fields.join(", ")}`)
check(rev2.findings.length === 1 && rev2.findings[0]?.ruleId === "CRC-GUARD-01" && rev2.findings[0].status === "PASS", `revision 2 reran only ${summary(rev2.findings)}`)
check(decide(await permit.read()) === "PRE_REVIEW_COMPLETE", "ledger and setback carry into the packet, so the Clerk can stamp")
await clerk.setStatus("PRE_REVIEW_COMPLETE", "Pre-review complete; open items carry into the packet")

// Relay delivers at least once: the actor logs and handles each relayKey once.
const key = relayKey({ permitId: id, revision: 2, sender: "zoning", type: "REVIEW_COMPLETE" })
const entry = { at: new Date().toISOString(), sender: "zoning", type: "REVIEW_COMPLETE", revision: 2, text: "Zoning finished revision 2." } as const
check((await permit.logRelay(key, entry)) && !(await permit.logRelay(key, entry)), "a redelivered message is logged once")
check((await permit.claim("clerk", key)) && !(await permit.claim("clerk", key)), "a redelivered message is handled once")

const final = await permit.read()
check(final.status === "PRE_REVIEW_COMPLETE" && final.revision === 2 && final.revisions.length === 2, `final: ${final.status}, revision ${final.revision}, ${final.revisions.length} frozen`)
const all: PermitStatus[] = ["INTAKE", "READY_FOR_REVIEW", "IN_REVIEW", "CORRECTIONS_REQUESTED", "REVISED", "PRE_REVIEW_COMPLETE"]
check(await until(() => all.every((s) => statuses.has(s))), `viewer socket saw ${[...statuses].join(" → ")}`)

for (const s of [clerk, building]) s.close()
viewer.close()
writeFileSync(ID_FILE, id)
console.log("\nNow restart the actor service, then run: npm run accept -- --after-restart")
