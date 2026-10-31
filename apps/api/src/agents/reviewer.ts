// stampede — Building and Zoning agents. On the Clerk's REVIEW_REQUEST they run their rules on the frozen revision,
// record each finding in the PermitActor, post it on Relay, then report REVIEW_COMPLETE. They never change status.
import { actors } from "../../generated/index.js"
import { Finding } from "../../contracts.ts"
import { affectedRules, changedFields, runRules } from "../review.ts"
import { BUILDING_RULES, FIELD_TO_RULES, ZONING_RULES, type RuleId } from "../rules.ts"
import { explain } from "./explain.ts"
import { connect } from "./relay.ts"

const SCOPE: Record<"building" | "zoning", readonly RuleId[]> = { building: BUILDING_RULES, zoning: ZONING_RULES }
const TITLE = { building: "Building", zoning: "Zoning" }

export async function startReviewer(name: "building" | "zoning"): Promise<void> {
  const me = await connect(name)
  const mine = SCOPE[name]

  me.on(async (e) => {
    const state = await actors.Permit.get(e.permitId).read()
    if (e.revision !== state.revision || state.status !== "IN_REVIEW") return // stale or late

    if (e.type === "REVIEW_REQUEST" && e.sender === "clerk") {
      // Revision 1 gets every rule; later revisions only the rules whose fields changed between frozen copies.
      const due = state.revision === 1 ? [...mine] : affectedRules(changedFields(state)).filter((r) => mine.includes(r))
      // Findings land in the actor first. Each Relay post takes seconds, so post them together, then report completion.
      const findings = await runRules(e.permitId, due)
      await Promise.all(
        findings.map(async (f) =>
          me.send({ permitId: e.permitId, revision: f.revision, type: "FINDING", findingId: f.findingId, payload: f }, await explain(f)),
        ),
      )
      await me.send(
        { permitId: e.permitId, revision: state.revision, type: "REVIEW_COMPLETE", payload: { findingIds: findings.map((f) => f.findingId) } },
        findings.length
          ? `${TITLE[name]} finished revision ${state.revision} with ${findings.length} finding${findings.length === 1 ? "" : "s"}.`
          : `${TITLE[name]} finished revision ${state.revision}: nothing in its scope changed.`,
      )
      return
    }

    // Coordination you can see in the channel: Zoning acknowledges Building's corrections and says whether they touch the setback.
    const finding = Finding.safeParse(e.payload)
    if (name === "zoning" && e.type === "FINDING" && e.sender === "building" && finding.success && finding.data.status === "CORRECTION") {
      const touchesSetback = (FIELD_TO_RULES[finding.data.field] ?? []).some((r) => mine.includes(r))
      await me.say(
        e.permitId,
        touchesSetback
          ? `@building noted the ${finding.data.field} correction; I will recheck the rear setback when it changes.`
          : "@building noted, setback verification unchanged.",
      )
    }
  })
}
