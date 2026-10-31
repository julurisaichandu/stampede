import type { PermitStatus } from '../../../api/contracts.ts'
import './review.css'

const STEPS = ['Upload or describe', 'Pre-review', 'Make changes', 'Pre-review complete']

const STEP_OF: Record<PermitStatus, number> = {
  INTAKE: 0,
  READY_FOR_REVIEW: 1,
  IN_REVIEW: 1,
  CORRECTIONS_REQUESTED: 2,
  REVISED: 1,
  PRE_REVIEW_COMPLETE: 3,
}

export function Stepper({ status, reviewing = false }: { status: PermitStatus; reviewing?: boolean }) {
  const current = status === 'INTAKE' && reviewing ? 1 : STEP_OF[status]
  const complete = status === 'PRE_REVIEW_COMPLETE'
  return (
    <ol className="stepper" aria-label="Progress">
      {STEPS.map((step, index) => (
        <li key={step} className={index < current || complete ? 'is-done' : ''} aria-current={index === current ? 'step' : undefined}>
          <span className="stepper-mark num" aria-hidden="true">
            {index < current || complete ? '✓' : index + 1}
          </span>
          {step}
        </li>
      ))}
    </ol>
  )
}
