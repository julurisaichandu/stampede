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

function Result({ finding, permit }: { finding: Finding; permit: PermitApplication }) {
  const copy = findingCopy(finding, permit)
  const href = httpUrl(finding.sourceUrl)
  return (
    <>
      <FindingHead title={copy.title} tone={STATUS_PILL[finding.status].tone} pill={STATUS_PILL[finding.status].label} />
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
        className={`finding card ${face ? `status-${STATUS_PILL[face.status].tone}` : ''} ${flip}`}
        onAnimationEnd={onAnimationEnd}
      >
        {face ? (
          <Result finding={face} permit={permit} />
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

export function Findings({ permit }: { permit: PermitApplication }) {
  if (permit.status === 'INTAKE') return null

  const current = currentFindings(permit.findings)
  const ruleIds = [...RULE_ORDER, ...current.map((finding) => finding.ruleId).filter((id) => !RULE_ORDER.includes(id))]

  return (
    <section className="findings" aria-label="Findings" aria-live="polite">
      <h2>What the reviewers found</h2>
      {ruleIds.map((ruleId) => (
        <Slot key={ruleId} ruleId={ruleId} finding={current.find((finding) => finding.ruleId === ruleId)} permit={permit} />
      ))}
    </section>
  )
}
