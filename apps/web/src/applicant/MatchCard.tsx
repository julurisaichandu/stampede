import type { Property } from '../../../api/contracts.ts'

const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

export function MatchCard({ property, drop = false }: { property: Property; drop?: boolean }) {
  const { address, apn, zoning, zoningOverlay, lookupConfidence, source, fetchedAt } = property
  return (
    <section className={drop ? 'match card match--drop' : 'match card'} aria-label="City record">
      <header className="match-head">
        <span className="label">City record</span>
        {zoningOverlay ? <span className="chip">{zoningOverlay} overlay</span> : null}
      </header>
      <p className="match-address">{address}</p>
      <dl className="match-facts">
        <div>
          <dt className="label">APN</dt>
          <dd>{apn}</dd>
        </div>
        <div>
          <dt className="label">Zoning</dt>
          <dd>{zoning ?? 'UNKNOWN'}</dd>
        </div>
        <div>
          <dt className="label">Match score</dt>
          <dd>{lookupConfidence}</dd>
        </div>
      </dl>
      <p className="match-source">
        {source === 'fixture' ? <span className="chip">demo cached data</span> : 'geo.sanjoseca.gov'} · {clock(fetchedAt)}
      </p>
    </section>
  )
}
