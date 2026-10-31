import { useRef, type ChangeEvent } from 'react'
import { MAX_PLAN_BYTES, PLAN_TYPES } from '../../../api/src/api-types.ts'
import './plan.css'

const ACCEPTED: readonly string[] = PLAN_TYPES

export function PlanAttach({
  onPick,
  onProblem,
  disabled,
}: {
  onPick: (file: File) => void
  onProblem: (message: string | null) => void
  disabled: boolean
}) {
  const input = useRef<HTMLInputElement>(null)

  function onChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!ACCEPTED.includes(file.type)) return onProblem('Send your plan as a PDF, PNG, JPEG or WebP.')
    if (!file.size) return onProblem('That file is empty. Choose your plan again.')
    if (file.size > MAX_PLAN_BYTES) return onProblem('That file is over 10 MB. Send a smaller copy, or only the deck pages.')
    onProblem(null)
    onPick(file)
  }

  return (
    <>
      <input ref={input} type="file" accept={PLAN_TYPES.join(',')} hidden onChange={onChange} />
      <button
        className="btn plan-attach"
        type="button"
        aria-label="Upload plans"
        disabled={disabled}
        onClick={() => input.current?.click()}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M13.5 7.5 8 13a3.5 3.5 0 0 1-5-5l6-6a2.3 2.3 0 0 1 3.3 3.3L6.8 10.8a1.2 1.2 0 0 1-1.7-1.7L10 4.3"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="plan-attach-label">Upload plans</span>
      </button>
    </>
  )
}

export function PlanChip({ name, onRemove }: { name: string; onRemove: () => void }) {
  return (
    <div className="plan-chip">
      <span className="plan-chip-name" title={name}>
        {name}
      </span>
      <button className="plan-chip-remove" type="button" aria-label={`Remove ${name}`} onClick={onRemove}>
        Remove
      </button>
    </div>
  )
}
