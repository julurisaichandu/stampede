// stamped — Clerk agent, the only status writer. Moves the permit over its signed socket, asks Building and Zoning
// for a review, and decides once both report. Talks on Relay; every decision lands in the PermitActor.
import { actors } from "../../generated/index.js"
import { openStatusSocket } from "../clerk-socket.ts"
import { blocksStamp, currentFindings, type PermitStatus } from "../../contracts.ts"
import { changedFields, decide } from "../review.ts"
import { connect } from "./relay.ts"

async function setStatus(permitId: string, to: PermitStatus, why: string): Promise<void> {
  const socket = await openStatusSocket(permitId, "clerk")
  try {
    await socket.setStatus(to, why)
  } finally {
    socket.close()
  }
}

export async function startClerk(): Promise<void> {
  const clerk = await connect("clerk")

  async function startReview(permitId: string, why: string): Promise<void> {
    await setStatus(permitId, "IN_REVIEW", why)
    const state = await actors.Permit.get(permitId).read()
    const fields = changedFields(state)
    await clerk.send(
      { permitId, revision: state.revision, type: "REVIEW_REQUEST", payload: fields.length ? { changedFields: fields } : {} },
      fields.length
        ? `Revision ${state.revision} frozen with ${fields.join(", ")} changed. Building and Zoning, please recheck.`
        : `Revision ${state.revision} frozen. Building and Zoning, please review.`,
    )
  }

  // Both reviewers log REVIEW_COMPLETE in the actor before posting it, so the record says who has finished.
  async function decideIfDone(permitId: string): Promise<void> {
    const state = await actors.Permit.get(permitId).read()
    if (state.status !== "IN_REVIEW") return
    const finished = (who: "building" | "zoning") =>
      state.relayLog.some((l) => l.type === "REVIEW_COMPLETE" && l.revision === state.revision && l.sender === who)
    if (!finished("building") || !finished("zoning")) return

    const current = currentFindings(state.findings)
    if (decide(state) === "CORRECTIONS_REQUESTED") {
      const open = current.filter(blocksStamp)
      const names = open.map((f) => f.ruleId).join(" and ")
      await setStatus(permitId, "CORRECTIONS_REQUESTED", `Open items: ${names}`)
      await clerk.send(
        { permitId, revision: state.revision, type: "NEEDS_INPUT", payload: { findingIds: open.map((f) => f.findingId) } },
        `Sent back to the homeowner: ${names} ${open.length === 1 ? "needs" : "need"} attention.`,
      )
    } else {
      const planner = current.filter((f) => f.status !== "PASS").map((f) => f.ruleId)
      await setStatus(permitId, "PRE_REVIEW_COMPLETE", planner.length ? `No open corrections; ${planner.join(", ")} carries into the packet` : "No open items")
      await clerk.send(
        { permitId, revision: state.revision, type: "REVIEW_COMPLETE", payload: { status: "PRE_REVIEW_COMPLETE" } },
        `Pre-review complete.${planner.length ? ` ${planner.join(", ")} carries into the packet.` : ""}`,
      )
    }
  }

  clerk.on(async (e) => {
    const state = await actors.Permit.get(e.permitId).read()
    if (e.revision !== state.revision) return // stale: an older revision's message
    if (e.type === "REVIEW_REQUEST" && e.sender === "intake" && state.status === "INTAKE") {
      await setStatus(e.permitId, "READY_FOR_REVIEW", "Homeowner confirmed the application; revision 1 frozen")
      await startReview(e.permitId, "Starting pre-review")
    } else if (e.type === "REVISION_SUBMITTED" && e.sender === "intake" && state.status === "CORRECTIONS_REQUESTED") {
      await setStatus(e.permitId, "REVISED", `Revision ${e.revision} submitted and frozen`)
      await startReview(e.permitId, `Reviewing revision ${e.revision}`)
    } else if (e.type === "REVIEW_COMPLETE" && (e.sender === "building" || e.sender === "zoning")) {
      await decideIfDone(e.permitId)
    }
  })
}
