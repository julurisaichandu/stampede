import { useEffect, useRef, useState } from 'react'
import { currentFindings, type Finding, type PermitApplication } from '../../../api/contracts.ts'
import './stamp.css'

// Preloaded so the bold face is ready before the slam, not swapped in mid-flight.
void document.fonts?.load("700 40px 'IBM Plex Mono'")

const OPEN_ITEM_WORDS: Record<string, string> = {
  'SJ-DETAIL-01': 'Show how the deck connects to the house. Your plans need framing, footing and ledger details.',
  'SJ-ZONING-01': 'Check your rear setback with a City planner. We could not verify the rule for this parcel.',
}

export function openItems(permit: PermitApplication): Finding[] {
  return currentFindings(permit.findings).filter(
    (finding) => finding.status === 'NEEDS_INFORMATION' || finding.status === 'NEEDS_HUMAN_VERIFICATION',
  )
}

export const openItemWords = (finding: Finding) => OPEN_ITEM_WORDS[finding.ruleId] ?? finding.reason

export function Stamp({ permit }: { permit: PermitApplication }) {
  const done = permit.status === 'PRE_REVIEW_COMPLETE'
  // Workspace shows emptyPermit (INTAKE) until the first frame, so a refresh reads INTAKE then
  // complete. Only a status seen after intake proves the homeowner watched the review finish.
  const [watched, setWatched] = useState(false)
  if (!watched && !done && permit.status !== 'INTAKE') setWatched(true)

  const slam = done && watched
  const stamp = useRef<HTMLDivElement>(null)

  // They are usually down at the findings when the last card flips.
  useEffect(() => {
    if (!slam) return
    const calm = matchMedia('(prefers-reduced-motion: reduce)').matches
    stamp.current?.scrollIntoView({ block: 'center', behavior: calm ? 'auto' : 'smooth' })
  }, [slam])

  if (!done) return null
  return (
    <>
      <svg className="stamp-defs" aria-hidden="true" width="0" height="0">
        <filter id="stamp-ink" x="-6%" y="-10%" width="112%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="3" seed="7" result="wobble" />
          <feDisplacementMap in="SourceGraphic" in2="wobble" scale="3.5" xChannelSelector="R" yChannelSelector="G" result="rough" />
          <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" seed="11" />
          <feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -6 4.6" result="voids" />
          <feComposite in="rough" in2="voids" operator="in" />
        </filter>
      </svg>
      <div ref={stamp} className={slam ? 'stamp stamp--slam' : 'stamp'}>
        <span>PRE-REVIEW</span> <span>COMPLETE</span>
      </div>
    </>
  )
}

export function PacketCard({ permit }: { permit: PermitApplication }) {
  if (permit.status !== 'PRE_REVIEW_COMPLETE') return null
  const open = openItems(permit)
  return (
    <section className="card packet-card" aria-label="Your draft packet">
      <a className="btn btn-primary packet-card-open" href={`/permits/${encodeURIComponent(permit.id)}/packet`}>
        Open your draft packet
      </a>
      {open.length > 0 ? (
        <>
          <h3 className="label">Still open, and it travels with the packet</h3>
          <ul className="packet-card-items">
            {open.map((finding) => (
              <li key={finding.findingId}>{openItemWords(finding)}</li>
            ))}
          </ul>
        </>
      ) : (
        <p className="packet-card-clear">The review left nothing open. The packet lists the city forms you still need.</p>
      )}
    </section>
  )
}
