// stampede — the review office screen (/office/:id). Reads only the PermitActor: live state over a viewer socket,
// the agents' conversation from relayLog, the audit trail from events. Never raw JSON, never an approval or a seal.
// Styled as the reviewer's desk, in the applicant side's paper-and-ink tokens. Classes are o- prefixed and scoped to
// .office so they never collide with the applicant screens' .stepper, .finding or .pill.
import { useEffect, useRef, useState } from "react"

import { blocksStamp, currentFindings, type Finding, type PermitApplication, type PermitStatus, type RelayLogEntry } from "../../../api/contracts.ts"
import { ALL_RULES, affectedRules, changedFields, type RuleId } from "../../../api/src/rules.ts"
import { NotFound } from "../applicant/NotFound.tsx"
import { usePermit } from "../lib/usePermit.ts"
import "./office.css"

type PermitState = Omit<PermitApplication, "id">
type Connection = "connecting" | "live" | "reconnecting"

const STEPS: [PermitStatus, string][] = [
  ["INTAKE", "Intake"],
  ["READY_FOR_REVIEW", "Ready"],
  ["IN_REVIEW", "In review"],
  ["CORRECTIONS_REQUESTED", "Corrections"],
  ["REVISED", "Revised"],
  ["PRE_REVIEW_COMPLETE", "Pre-review complete"],
]
const STATUS_LABEL = Object.fromEntries(STEPS) as Record<PermitStatus, string>

const RULES: Record<RuleId, { title: string; reviewer: string }> = {
  "SJ-PERMIT-01": { title: "Is a building permit required?", reviewer: "Building" },
  "CRC-GUARD-01": { title: "Guard height", reviewer: "Building" },
  "SJ-DETAIL-01": { title: "Ledger connection to the house", reviewer: "Building" },
  "SJ-ZONING-01": { title: "Rear setback", reviewer: "Zoning" },
}

type Pill = Finding["status"] | "REVIEWING" | "WAITING"
const PILL: Record<Pill, string> = {
  PASS: "Pass",
  CORRECTION: "Correction",
  NEEDS_INFORMATION: "Needs info",
  NEEDS_HUMAN_VERIFICATION: "Needs human verification",
  REVIEWING: "Reviewing…",
  WAITING: "Waiting",
}

const AGENT: Record<RelayLogEntry["sender"], { name: string; role: string }> = {
  intake: { name: "Intake", role: "Homeowner's agent" },
  clerk: { name: "Clerk", role: "Moves the file" },
  building: { name: "Building", role: "Building code" },
  zoning: { name: "Zoning", role: "Zoning code" },
}
const MESSAGE: Record<RelayLogEntry["type"], string> = {
  REVIEW_REQUEST: "Review request",
  FINDING: "Finding",
  NEEDS_INPUT: "Needs input",
  REVISION_SUBMITTED: "Revision",
  REVIEW_COMPLETE: "Review complete",
  PACKET_READY: "Packet",
}

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
const shown = (v: string | number | boolean) => (v === true ? "Yes" : v === false ? "No" : String(v))
const titleOf = (f: Finding) => RULES[f.ruleId as RuleId]?.title ?? f.ruleId

export function OfficeScreen({ permitId }: { permitId: string }) {
  const { permit: state, connected, missing } = usePermit(permitId)
  const connection: Connection = connected ? "live" : state ? "reconnecting" : "connecting"
  if (missing) return <NotFound />
  if (!state) {
    return (
      <div className="office">
        <p className="o-loading">Opening application {permitId}…</p>
      </div>
    )
  }
  return (
    <div className="office">
      <Header permitId={permitId} state={state} connection={connection} />
      <Stepper state={state} />
      <Outcome state={state} />
      <main className="o-grid">
        <section className="o-card o-check" aria-label="Review checklist">
          <Checklist state={state} />
        </section>
        <section className="o-card o-feed" aria-label="Agent Relay conversation">
          <Feed permitId={permitId} state={state} />
        </section>
        <section className="o-card o-trail" aria-label="Audit trail">
          <Timeline state={state} />
        </section>
      </main>
    </div>
  )
}

function Header({ permitId, state, connection }: { permitId: string; state: PermitState; connection: Connection }) {
  const d = state.deck
  const facts = [
    "Residential deck",
    d.lengthFt != null && d.widthFt != null ? `${d.lengthFt} × ${d.widthFt} ft` : null,
    d.maxHeightIn != null ? `${d.maxHeightIn} in above grade` : null,
    d.attached == null ? null : d.attached ? "Attached" : "Freestanding",
    `Application ${permitId}`,
  ].filter(Boolean)
  return (
    <header className="o-head">
      <div>
        <p className="o-tag">San Jose · Review office · Agents at work</p>
        <h1 className="o-title">{state.property?.address ?? "Address not confirmed yet"}</h1>
        <p className="o-meta">
          {facts.join(" · ")}
          {state.property?.source === "fixture" && <span className="o-cached">Demo cached data</span>}
        </p>
      </div>
      <div className="o-head-side">
        <span className="o-status" data-status={state.status} key={state.status}>
          {STATUS_LABEL[state.status]}
        </span>
        <span className="o-rev">Revision {state.revision}</span>
        <span className="o-live" data-connection={connection}>
          {connection === "live" ? "Live" : connection === "connecting" ? "Connecting" : "Reconnecting"}
        </span>
      </div>
    </header>
  )
}

function Stepper({ state }: { state: PermitState }) {
  const reached = new Set<PermitStatus>(["INTAKE", ...state.events.flatMap((e) => (e.to ? [e.to] : []))])
  return (
    <ol className="o-steps">
      {STEPS.map(([status, label]) => {
        const current = status === state.status
        const done = (reached.has(status) && !current) || (current && status === "PRE_REVIEW_COMPLETE")
        return (
          <li key={status} className={done ? "is-done" : undefined} aria-current={current ? "step" : undefined}>
            <span className="o-mark">{done ? "✓" : ""}</span>
            {label}
          </li>
        )
      })}
    </ol>
  )
}

/** One line on where things stand, when there is something to say. */
function Outcome({ state }: { state: PermitState }) {
  const current = currentFindings(state.findings)
  if (state.status === "PRE_REVIEW_COMPLETE") {
    const carried = current.filter((f) => f.status !== "PASS")
    return (
      <p className="o-outcome" data-tone="done">
        <b>Pre-review complete</b>
        The packet is ready to submit to the City of San Jose, where a City reviewer makes the official decision.
        {carried.length > 0 && ` Carried into the packet: ${carried.map(titleOf).join(", ")}.`}
      </p>
    )
  }
  if (state.status === "CORRECTIONS_REQUESTED") {
    const open = current.filter(blocksStamp)
    return (
      <p className="o-outcome" data-tone="wait">
        <b>Waiting for the homeowner</b>
        {open.map(titleOf).join(" and ")} {open.length === 1 ? "needs" : "need"} attention.
      </p>
    )
  }
  if (state.status === "IN_REVIEW") {
    return (
      <p className="o-outcome" data-tone="busy">
        <b>Under review</b>
        Building and Zoning are checking revision {state.revision} against the code.
      </p>
    )
  }
  return null
}

function CardHead({ part, title, aside }: { part: string; title: string; aside?: string }) {
  return (
    <div className="o-card-head">
      <h2>
        <b>{part}</b>
        {title}
      </h2>
      {aside && <span title={aside}>{aside}</span>}
    </div>
  )
}

function Checklist({ state }: { state: PermitState }) {
  const [open, setOpen] = useState<RuleId | null>(null)
  const latest = new Map(currentFindings(state.findings).map((f) => [f.ruleId, f]))
  // Rules being (re)checked right now: all of them on revision 1, then only those whose fields changed.
  const due = new Set<RuleId>(state.status === "IN_REVIEW" ? (state.revision === 1 ? ALL_RULES : affectedRules(changedFields(state))) : [])
  const passed = ALL_RULES.filter((r) => latest.get(r)?.status === "PASS").length

  return (
    <>
      <CardHead part="Part I" title="Review checklist" aside={`${passed} of ${ALL_RULES.length} pass`} />
      <ul className="o-rules">
        {ALL_RULES.map((ruleId) => {
          const f = latest.get(ruleId)
          const pill: Pill = due.has(ruleId) && f?.revision !== state.revision ? "REVIEWING" : (f?.status ?? "WAITING")
          const expanded = open === ruleId && f != null
          return (
            <li key={ruleId} className="o-rule" data-open={expanded || undefined}>
              <button className="o-rule-head" onClick={() => setOpen(expanded ? null : ruleId)} aria-expanded={expanded} disabled={!f}>
                <span className="o-rule-id">{ruleId}</span>
                <span className="o-rule-title">
                  {RULES[ruleId].title}
                  <small>{RULES[ruleId].reviewer} reviewer</small>
                </span>
                <span key={pill} className="o-pill" data-status={pill}>
                  {PILL[pill]}
                </span>
              </button>
              {expanded && <FindingDetail f={f} />}
            </li>
          )
        })}
      </ul>
      <p className="o-hint">Click a rule to see the reason, the measurements and the code section.</p>
    </>
  )
}

function FindingDetail({ f }: { f: Finding }) {
  return (
    <div className="o-detail">
      <p className="o-reason">{f.reason}</p>
      <dl>
        {f.observed != null && (
          <div>
            <dt>Observed</dt>
            <dd>{shown(f.observed)}</dd>
          </div>
        )}
        {f.required && (
          <div>
            <dt>Required</dt>
            <dd>{f.required}</dd>
          </div>
        )}
        <div>
          <dt>Checked on</dt>
          <dd>Revision {f.revision}</dd>
        </div>
      </dl>
      {f.evidence.length > 0 && (
        <ul className="o-evidence">
          {f.evidence.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      <a className="o-source" href={f.sourceUrl} target="_blank" rel="noreferrer">
        {f.citation} ↗
      </a>
      {f.humanReviewNeeded && <p className="o-note">A City planner has to verify this item.</p>}
    </div>
  )
}

function Feed({ permitId, state }: { permitId: string; state: PermitState }) {
  const log = state.relayLog
  const list = useRef<HTMLOListElement>(null)
  const working = state.status === "IN_REVIEW" || state.status === "READY_FOR_REVIEW" || state.status === "REVISED"
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" })
  }, [log.length, working])
  return (
    <>
      <CardHead part="Part II" title="Agent Relay" aside={`#permit-${permitId}`} />
      <ul className="o-cast">
        {(Object.keys(AGENT) as RelayLogEntry["sender"][]).map((a) => (
          <li key={a} data-agent={a}>
            <span className="o-avatar">{AGENT[a].name[0]}</span>
            {AGENT[a].name}
          </li>
        ))}
      </ul>
      {log.length === 0 ? (
        <p className="o-empty">No messages yet. The agents start talking when the homeowner runs the pre-review.</p>
      ) : (
        <ol className="o-msgs" ref={list}>
          {log.map((l, i) => (
            <li key={i} className="o-msg" data-agent={l.sender}>
              <span className="o-avatar" title={AGENT[l.sender].role}>
                {AGENT[l.sender].name[0]}
              </span>
              <div className="o-bubble">
                <div className="o-msg-meta">
                  <b>{AGENT[l.sender].name}</b>
                  <span>{MESSAGE[l.type]}</span>
                  <time>{clock(l.at)}</time>
                </div>
                <p>{l.text}</p>
              </div>
            </li>
          ))}
          {working && (
            <li className="o-msg o-typing" aria-label="Agents are working">
              <span className="o-avatar">…</span>
              <div className="o-bubble">
                <i />
                <i />
                <i />
              </div>
            </li>
          )}
        </ol>
      )}
    </>
  )
}

function Timeline({ state }: { state: PermitState }) {
  return (
    <>
      <CardHead part="Part III" title="Audit trail" aside={`${state.events.length} entries`} />
      {state.events.length === 0 ? (
        <p className="o-empty">Nothing recorded yet.</p>
      ) : (
        <ol className="o-events">
          {state.events.map((e, i) => (
            <li key={i}>
              <time>{clock(e.at)}</time>
              <span className="o-who">{e.who}</span>
              <span className="o-why">{e.why}</span>
              {e.from && e.to && (
                <span className="o-move">
                  {STATUS_LABEL[e.from]} → {STATUS_LABEL[e.to]}
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
    </>
  )
}
