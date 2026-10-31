// stampede — review runner. Applies the deterministic rules to a frozen revision and records findings.
// No LLM and no status changes here: status moves only through the Clerk's socket (clerk-socket.ts).
import { setTimeout as sleep } from "node:timers/promises"

import { actors } from "../generated/index.js"
import { blocksStamp, currentFindings, type Finding, type PermitApplication } from "../contracts.ts"
import { type RuleId, runRule } from "./rules.ts"

export { affectedRules, changedFields } from "./rules.ts"

type PermitState = Omit<PermitApplication, "id">

// Rules finish in microseconds. The gap lets each card land on its own for the homeowner.
const FINDING_GAP_MS = 800

/** Runs the given rules against the frozen deck of the current revision and records each finding. */
export async function runRules(permitId: string, ruleIds: readonly RuleId[]): Promise<Finding[]> {
  const permit = actors.Permit.get(permitId)
  const state = await permit.read()
  const frozen = state.revisions.find((r) => r.revision === state.revision)
  if (!frozen) throw new Error(`Revision ${state.revision} of ${permitId} has not been frozen by the Clerk`)
  const input = { permitId, revision: state.revision, deck: frozen.deck, property: state.property }
  const findings = ruleIds.map((ruleId) => runRule(ruleId, input))
  for (const f of findings) {
    await permit.addFinding(f)
    await sleep(FINDING_GAP_MS)
  }
  return findings
}

/** The Clerk's call once both reviewers report: any open CORRECTION or NEEDS_INFORMATION sends it back. */
export function decide(state: PermitState): "CORRECTIONS_REQUESTED" | "PRE_REVIEW_COMPLETE" {
  return currentFindings(state.findings).some(blocksStamp) ? "CORRECTIONS_REQUESTED" : "PRE_REVIEW_COMPLETE"
}
