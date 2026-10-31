import { useEffect, useRef, useState, type AnimationEvent } from 'react'
import { currentFindings, type Finding, type PermitApplication } from '../../../api/contracts.ts'
import { findingCopy, httpUrl, RULES, RULE_ORDER, STATUS_PILL } from './copy.ts'
import './review.css'

function Block({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <p className="label">{label}</p>
      <p className="finding-text">{text}</p>
    </div>
  )
}

// submitRevision leaves the status alone, so the recheck starts when the revision outruns the last
// frozen one. A correction carried over a revision that did not touch it stops rechecking once frozen.
function rechecking(finding: Finding, permit: PermitApplication) {
  if (finding.status !== 'CORRECTION' || finding.revision >= permit.revision) return false
  const unfrozen = permit.revision > (permit.revisions.at(-1)?.revision ?? 0)
  return unfrozen || permit.status === 'REVISED' || permit.status === 'IN_REVIEW'
}

function Result({ finding, permit, recheck }: { finding: Finding; permit: PermitApplication; recheck: boolean }) {
  const copy = findingCopy(finding, permit)
  const href = httpUrl(finding.sourceUrl)
  const { tone, label } = recheck ? { tone: 'reviewing', label: 'Rechecking…' } : STATUS_PILL[finding.status]
  return (
    <>
      <FindingHead title={copy.title} tone={tone} pill={label} />
      <div className="finding-body">
        {copy.note ? <Block label="What this means" text={copy.note} /> : null}
        {copy.wrong ? <Block label="What's wrong" text={copy.wrong} /> : null}
        {copy.change ? <Block label="What to change" text={copy.change} /> : null}
      </div>
      <footer className="finding-foot">
        {href ? (
          <a className="mono" href={href} target="_blank" rel="noreferrer">
            {finding.citation}
          </a>
        ) : (
          <span className="mono">{finding.citation}</span>
        )}
        <span className="finding-meta label">
          {finding.revision < permit.revision ? <span>From revision {finding.revision}</span> : null}
          <span>{finding.reviewer === 'zoning' ? 'ZONING' : 'BUILDING'}</span>
        </span>
      </footer>
    </>
  )
}

function FindingHead({ title, tone, pill }: { title: string; tone: string; pill: string }) {
  return (
    <header className="finding-head">
      <h3>{title}</h3>
      <span className={`pill pill--${tone}`}>{pill}</span>
    </header>
  )
}

// The swap happens edge-on, so the card's height change is never seen. A slot mounts holding
// whatever is already there, which is why a refresh does not flip.
function Slot({ ruleId, finding, permit }: { ruleId: string; finding?: Finding; permit: PermitApplication }) {
  const [shown, setShown] = useState(finding)
  const [landing, setLanding] = useState(false)
  const slot = useRef<HTMLDivElement>(null)

  const changed = finding?.status !== shown?.status
  const face = changed ? shown : finding
  const flip = landing ? 'finding--in' : changed ? 'finding--out' : ''
  const recheck = face ? rechecking(face, permit) : false
  const edge = face && !recheck ? `status-${STATUS_PILL[face.status].tone}` : ''

  useEffect(() => {
    if (!landing) return
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    slot.current?.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' })
  }, [landing])

  function onAnimationEnd(event: AnimationEvent<HTMLElement>) {
    if (event.target !== event.currentTarget) return
    if (event.animationName === 'finding-out') {
      setShown(finding)
      setLanding(true)
    } else if (event.animationName === 'finding-in') {
      setLanding(false)
    }
  }

  return (
    <div className="finding-slot" ref={slot} data-rule={ruleId}>
      <article
        className={`finding card ${edge} ${recheck ? 'finding--rechecking' : ''} ${flip}`}
        onAnimationEnd={onAnimationEnd}
      >
        {face ? (
          <Result finding={face} permit={permit} recheck={recheck} />
        ) : (
          <>
            <FindingHead title={RULES[ruleId]?.label ?? 'Reviewer note'} tone="reviewing" pill="Reviewing…" />
            <p className="finding-meta label">{RULES[ruleId]?.reviewer === 'zoning' ? 'ZONING' : 'BUILDING'}</p>
          </>
        )}
      </article>
    </div>
  )
}

export function Findings({ permit, reviewing = false }: { permit: PermitApplication; reviewing?: boolean }) {
  const sending = permit.status === 'INTAKE'
  if (sending && !reviewing) return null

  const current = currentFindings(permit.findings)
  const ruleIds = [...RULE_ORDER, ...current.map((finding) => finding.ruleId).filter((id) => !RULE_ORDER.includes(id))]

  return (
    <section className="findings" aria-label="Findings" aria-live="polite">
      <h2>What the reviewers found</h2>
      {sending ? <p className="finding-text">Sending your file to the reviewers…</p> : null}
      {ruleIds.map((ruleId) => (
        <Slot key={ruleId} ruleId={ruleId} finding={current.find((finding) => finding.ruleId === ruleId)} permit={permit} />
      ))}
    </section>
  )
}
