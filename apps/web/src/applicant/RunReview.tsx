import { useState } from 'react'
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

export function RunReview({
  permit,
  busy = false,
  error = null,
  onRun,
}: {
  permit: PermitApplication
  busy?: boolean
  error?: string | null
  onRun: () => void
}) {
  // The POST can resolve before the status frame lands, so the click itself holds Reviewing.
  const [clicked, setClicked] = useState(false)
  if (clicked && error) setClicked(false)

  const { status } = permit
  // Revision 2 onward goes through chat, so the button never comes back after corrections.
  if (status === 'CORRECTIONS_REQUESTED' || status === 'PRE_REVIEW_COMPLETE' || permit.revision > 1) return null

  const run = () => {
    setClicked(true)
    onRun()
  }

  const reviewing = status !== 'INTAKE' || busy || (clicked && !error)
  const missing = missingMinimum(permit)
  const label = reviewing
    ? 'Reviewing…'
    : missing.length > 0
      ? `Still needed: ${missing.map((field) => PLAIN[field] ?? field).join(', ')}`
      : 'Run pre-review'

  return (
    <div className="run-review" aria-live="polite">
      <button
        className={reviewing ? 'btn btn-primary run-review-btn is-reviewing' : 'btn btn-primary run-review-btn'}
        type="button"
        disabled={reviewing || missing.length > 0}
        onClick={run}
      >
        {label}
      </button>
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
