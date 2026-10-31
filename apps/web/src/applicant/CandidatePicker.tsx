import type { GisCandidate, GisLookup } from '../../../api/src/api-types.ts'
import './Sheet.css'

export function CandidatePicker({
  lookup,
  busy = false,
  onChoose,
}: {
  lookup: GisLookup | null
  busy?: boolean
  onChoose: (candidate: GisCandidate) => void
}) {
  if (lookup?.status !== 'needs_confirm') return null
  return (
    <section className="picker card" aria-label="Choose your address">
      <h3 className="picker-title">Which one is yours?</h3>
      <div className="picker-list">
        {lookup.candidates.map((candidate) => (
          <button
            key={`${candidate.address}${candidate.apn}`}
            className="picker-option"
            type="button"
            disabled={busy}
            onClick={() => onChoose(candidate)}
          >
            <span className="picker-address">{candidate.address}</span>
            {candidate.apn || candidate.zoning ? (
              <span className="picker-meta">
                {candidate.apn ? <span>APN {candidate.apn}</span> : null}
                {candidate.zoning ? <span>Zoning {candidate.zoning}</span> : null}
              </span>
            ) : null}
          </button>
        ))}
      </div>
    </section>
  )
}
