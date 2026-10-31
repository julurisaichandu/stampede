import { useEffect, useState } from 'react'
import { missingMinimum, type PermitApplication } from '../../../api/contracts.ts'
import './Sheet.css'

const PLAIN: Record<string, string> = {
  property: 'address',
  'deck.lengthFt': 'length',
  'deck.widthFt': 'width',
  'deck.maxHeightIn': 'height',
  'deck.attached': 'attached or freestanding',
  'deck.guardHeightIn': 'railing',
}

const WAIT_MS = 30_000

export function RunReview({
  permit,
  busy = false,
  sending = false,
  error = null,
  onRun,
}: {
  permit: PermitApplication
  busy?: boolean
  sending?: boolean
  error?: string | null
  onRun: () => void
}) {
  // The POST can resolve before the status frame lands, so the click itself holds Reviewing.
  const [clicked, setClicked] = useState(false)
  const [overdue, setOverdue] = useState(false)
  if (clicked && error) setClicked(false)

  const { status } = permit
  const settled = status === 'CORRECTIONS_REQUESTED' || status === 'PRE_REVIEW_COMPLETE'
  const reviewing = !settled && (status !== 'INTAKE' || busy || (clicked && !error))
  const findingCount = permit.findings.length

  useEffect(() => {
    setOverdue(false)
    if (!reviewing) return
    const timer = setTimeout(() => setOverdue(true), WAIT_MS)
    return () => clearTimeout(timer)
  }, [reviewing, findingCount])

  if (settled) return null

  const run = () => {
    setClicked(true)
    onRun()
  }

  const missing = missingMinimum(permit)
  const label = reviewing
    ? 'Reviewing…'
    : sending
      ? 'Reading what you wrote…'
      : missing.length > 0
        ? `Still needed: ${missing.map((field) => PLAIN[field] ?? field).join(', ')}`
        : 'Run pre-review'

  // Findings open once the status moves, so until then the button stays pinned where the homeowner clicked it.
  const band = overdue ? ' run-review--overdue' : status !== 'INTAKE' ? ' run-review--inline' : ''

  return (
    <div className={`run-review${band}`} aria-live="polite">
      {/* Revision 2 onward goes through chat, so the button never comes back after corrections. */}
      {permit.revision > 1 ? null : (
        <button
          className={reviewing ? 'btn btn-primary run-review-btn is-reviewing' : 'btn btn-primary run-review-btn'}
          type="button"
          disabled={reviewing || sending || missing.length > 0}
          onClick={run}
        >
          {label}
        </button>
      )}
      {overdue ? (
        <p className="run-review-wait">
          This is taking longer than usual. Your file is safe, and the results will land here as soon as the reviewers
          finish.
        </p>
      ) : null}
      {error && !reviewing ? (
        <p className="run-review-error notice" role="alert">
          {error}{' '}
          {missing.length === 0 ? (
            <button className="run-review-retry" type="button" onClick={run}>
              Try again
            </button>
          ) : null}
        </p>
      ) : null}
    </div>
  )
}
