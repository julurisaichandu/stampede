// stamped — review runner. Applies the deterministic rules to a frozen revision and records findings.
// No LLM and no status changes here: status moves only through the Clerk's socket (clerk-socket.ts).
import { actors } from "../generated/index.js"
import { blocksStamp, currentFindings, type Finding, type PermitApplication } from "../contracts.ts"
import { type RuleId, runRule } from "./rules.ts"

export { affectedRules, changedFields } from "./rules.ts"

type PermitState = Omit<PermitApplication, "id">

/** Runs the given rules against the frozen deck of the current revision and records each finding. */
export async function runRules(permitId: string, ruleIds: readonly RuleId[]): Promise<Finding[]> {
  const permit = actors.Permit.get(permitId)
  const state = await permit.read()
  const frozen = state.revisions.find((r) => r.revision === state.revision)
  if (!frozen) throw new Error(`Revision ${state.revision} of ${permitId} has not been frozen by the Clerk`)
  const input = { permitId, revision: state.revision, deck: frozen.deck, property: state.property }
  const findings = ruleIds.map((ruleId) => runRule(ruleId, input))
  for (const f of findings) await permit.addFinding(f)
  return findings
}

/** The Clerk's call once both reviewers report: any open CORRECTION or NEEDS_INFORMATION sends it back. */
export function decide(state: PermitState): "CORRECTIONS_REQUESTED" | "PRE_REVIEW_COMPLETE" {
  return currentFindings(state.findings).some(blocksStamp) ? "CORRECTIONS_REQUESTED" : "PRE_REVIEW_COMPLETE"
}
