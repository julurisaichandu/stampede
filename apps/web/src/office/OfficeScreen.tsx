// stampede — the review office screen (/office/:id). Reads only the PermitActor: live state over a viewer socket,
// the agents' conversation from relayLog, the audit trail from events. Never raw JSON, never an approval or a seal.
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
  PASS: "PASS",
  CORRECTION: "CORRECTION",
  NEEDS_INFORMATION: "NEEDS INFO",
  NEEDS_HUMAN_VERIFICATION: "NEEDS HUMAN VERIFICATION",
  REVIEWING: "Reviewing…",
  WAITING: "Waiting",
}

const SENDER: Record<RelayLogEntry["sender"], string> = { intake: "Intake", clerk: "Clerk", building: "Building", zoning: "Zoning" }
const MESSAGE: Record<RelayLogEntry["type"], string> = {
  REVIEW_REQUEST: "review request",
  FINDING: "finding",
  NEEDS_INPUT: "needs input",
  REVISION_SUBMITTED: "revision",
  REVIEW_COMPLETE: "review complete",
  PACKET_READY: "packet",
}

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
const shown = (v: string | number | boolean) => (v === true ? "Yes" : v === false ? "No" : String(v))

export function OfficeScreen({ permitId }: { permitId: string }) {
  const { permit: state, connected, missing } = usePermit(permitId)
  const connection: Connection = connected ? "live" : state ? "reconnecting" : "connecting"
  if (missing) return <NotFound />
  if (!state) {
    return (
      <div className="office">
        <div className="card loading">Connecting to application {permitId}…</div>
      </div>
    )
  }
  return (
    <div className="office">
      <Header permitId={permitId} state={state} connection={connection} />
      <Stepper state={state} />
      <Outcome state={state} />
      <main className="office-grid">
        <section className="card checklist-card">
          <Checklist state={state} />
        </section>
        <section className="card feed-card">
          <Feed log={state.relayLog} />
        </section>
        <section className="card timeline-card">
          <Timeline state={state} />
        </section>
      </main>
    </div>
  )
}

function Header({ permitId, state, connection }: { permitId: string; state: PermitState; connection: Connection }) {
  const d = state.deck
  const facts = [
    d.lengthFt != null && d.widthFt != null ? `${d.lengthFt} × ${d.widthFt} ft` : null,
    d.maxHeightIn != null ? `${d.maxHeightIn} in above grade` : null,
    d.attached == null ? null : d.attached ? "attached" : "freestanding",
  ].filter(Boolean)
  return (
    <header className="office-header">
      <div>
        <p className="eyebrow">stampede · San Jose pre-review office</p>
        <h1>{state.property?.address ?? "Address not confirmed yet"}</h1>
        <p className="sub">
          Residential deck{facts.length > 0 && ` · ${facts.join(" · ")}`} · Application {permitId}
          {state.property?.source === "fixture" && <span className="tag">demo cached data</span>}
        </p>
      </div>
      <div className="header-right">
        <span className={`badge badge-${state.status}`}>{STATUS_LABEL[state.status]}</span>
        <span className="revision">Revision {state.revision}</span>
        <span className={`conn conn-${connection}`}>{connection === "live" ? "Live" : connection === "connecting" ? "Connecting…" : "Reconnecting…"}</span>
      </div>
    </header>
  )
}

function Stepper({ state }: { state: PermitState }) {
  const reached = new Set<PermitStatus>(["INTAKE", ...state.events.flatMap((e) => (e.to ? [e.to] : []))])
  return (
    <ol className="stepper">
      {STEPS.map(([status, label]) => {
        const current = status === state.status
        const done = (reached.has(status) && !current) || (current && status === "PRE_REVIEW_COMPLETE")
        return (
          <li key={status} className={[current && "current", done && "done"].filter(Boolean).join(" ")}>
            <span className="dot">{done ? "✓" : ""}</span>
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
      <p className="outcome outcome-done">
        Pre-review complete: the packet is ready to submit to the City of San Jose, where a City reviewer makes the official decision.
        {carried.length > 0 && ` Carried into the packet: ${carried.map((f) => RULES[f.ruleId as RuleId]?.title ?? f.ruleId).join(", ")}.`}
      </p>
    )
  }
  if (state.status === "CORRECTIONS_REQUESTED") {
    const open = current.filter(blocksStamp)
    return (
      <p className="outcome outcome-wait">
        Waiting for the homeowner: {open.map((f) => RULES[f.ruleId as RuleId]?.title ?? f.ruleId).join(" and ")} {open.length === 1 ? "needs" : "need"} attention.
      </p>
    )
  }
  return null
}

function Checklist({ state }: { state: PermitState }) {
  const [open, setOpen] = useState<RuleId | null>(null)
  const latest = new Map(currentFindings(state.findings).map((f) => [f.ruleId, f]))
  // Rules being (re)checked right now: all of them on revision 1, then only those whose fields changed.
  const due = new Set<RuleId>(state.status === "IN_REVIEW" ? (state.revision === 1 ? ALL_RULES : affectedRules(changedFields(state))) : [])

  return (
    <>
      <h2>Review checklist</h2>
      <ul className="checklist">
        {ALL_RULES.map((ruleId) => {
          const f = latest.get(ruleId)
          const pill: Pill = due.has(ruleId) && f?.revision !== state.revision ? "REVIEWING" : (f?.status ?? "WAITING")
          const expanded = open === ruleId && f != null
          return (
            <li key={ruleId} className={`rule${expanded ? " open" : ""}`}>
              <button className="rule-head" onClick={() => setOpen(expanded ? null : ruleId)} aria-expanded={expanded} disabled={!f}>
                <span className="rule-id">{ruleId}</span>
                <span className="rule-title">
                  {RULES[ruleId].title}
                  <small>{RULES[ruleId].reviewer}</small>
                </span>
                <span key={pill} className={`pill pill-${pill}`}>
                  {PILL[pill]}
                </span>
              </button>
              {expanded && <FindingDetail f={f} />}
            </li>
          )
        })}
      </ul>
    </>
  )
}

function FindingDetail({ f }: { f: Finding }) {
  return (
    <div className="finding">
      <p className="reason">{f.reason}</p>
      <dl>
        {f.observed != null && (
          <>
            <dt>Observed</dt>
            <dd>{shown(f.observed)}</dd>
          </>
        )}
        {f.required && (
          <>
            <dt>Required</dt>
            <dd>{f.required}</dd>
          </>
        )}
        <dt>Checked on</dt>
        <dd>Revision {f.revision}</dd>
      </dl>
      {f.evidence.length > 0 && (
        <ul className="evidence">
          {f.evidence.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      <a className="source" href={f.sourceUrl} target="_blank" rel="noreferrer">
        {f.citation} ↗
      </a>
      {f.humanReviewNeeded && <p className="note">A City planner has to verify this item.</p>}
    </div>
  )
}

function Feed({ log }: { log: RelayLogEntry[] }) {
  const list = useRef<HTMLOListElement>(null)
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" })
  }, [log.length])
  return (
    <>
      <h2>
        Agent Relay <small>what the agents are saying</small>
      </h2>
      {log.length === 0 ? (
        <p className="empty">No messages yet.</p>
      ) : (
        <ol className="feed" ref={list}>
          {log.map((l, i) => (
            <li key={i} className={`msg from-${l.sender}`}>
              <div className="msg-meta">
                <span className="sender">{SENDER[l.sender]}</span>
                <span className="type">{MESSAGE[l.type]}</span>
                <time>{clock(l.at)}</time>
              </div>
              <p>{l.text}</p>
            </li>
          ))}
        </ol>
      )}
    </>
  )
}

function Timeline({ state }: { state: PermitState }) {
  return (
    <>
      <h2>Audit trail</h2>
      {state.events.length === 0 ? (
        <p className="empty">Nothing recorded yet.</p>
      ) : (
        <ol className="timeline">
          {state.events.map((e, i) => (
            <li key={i}>
              <time>{clock(e.at)}</time>
              <span className="who">{e.who.charAt(0).toUpperCase() + e.who.slice(1)}</span>
              <span className="why">{e.why}</span>
              {e.from && e.to && (
                <span className="move">
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
