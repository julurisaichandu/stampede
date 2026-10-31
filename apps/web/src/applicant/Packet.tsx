import { currentFindings, type Finding, type PermitApplication } from '../../../api/contracts.ts'
import { usePermit } from '../lib/usePermit.ts'
import { findingCopy, RULES, STATUS_PILL } from './copy.ts'
import { NotFound } from './NotFound.tsx'
import { openItemWords, openItems } from './Stamp.tsx'
import './packet.css'

const BANNER = 'UNOFFICIAL DRAFT — NOT FILED WITH THE CITY'

// Each URL is the one the city's Decks page links. Form 351 changed once, so re-check before relying on these.
const FORMS = [
  {
    name: 'Project Plans (Form 352)',
    note: 'Draw your plan set from the Plan Set Instructions.',
    url: 'https://www.sanjoseca.gov/home/showpublisheddocument/107050/638593203745800000',
  },
  {
    name: 'Building Permit Application (Form 310)',
    url: 'https://www.sanjoseca.gov/home/showpublisheddocument/25915/638350368936670000',
  },
  {
    name: 'Submittal Checklist (Form 351)',
    note: 'Under Project Scope, check "Other" and enter "Deck".',
    url: 'https://www.sanjoseca.gov/home/showpublisheddocument/107046/638576746001800000',
  },
]

const SJPERMITS = 'https://www.sjpermits.org/'

const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })

function measure(value: number | null, unit: string) {
  return value === null ? null : `${value} ${unit}`
}

function Value({ value, unsure }: { value: string | null; unsure?: boolean }) {
  if (value !== null) return <dd className="num">{value}</dd>
  return (
    <dd className="packet-unknown">
      UNKNOWN{unsure ? <span> you weren't sure</span> : null}
    </dd>
  )
}

function ProjectSummary({ permit }: { permit: PermitApplication }) {
  const { deck, intake } = permit
  const area = deck.lengthFt !== null && deck.widthFt !== null ? deck.lengthFt * deck.widthFt : null
  const attached = deck.attached === null ? null : deck.attached ? 'Yes' : 'No'
  const rows: [string, string | null, string?][] = [
    ['Length', measure(deck.lengthFt, 'ft'), 'deck.lengthFt'],
    ['Width', measure(deck.widthFt, 'ft'), 'deck.widthFt'],
    ['Area', measure(area, 'sq ft')],
    ['Height above grade', measure(deck.maxHeightIn, 'in'), 'deck.maxHeightIn'],
    ['Attached to the house', attached, 'deck.attached'],
    ['Ledger', deck.ledgerType, 'deck.ledgerType'],
    ['Rear setback', measure(deck.rearSetbackFt, 'ft'), 'deck.rearSetbackFt'],
    ['Railing height', measure(deck.guardHeightIn, 'in'), 'deck.guardHeightIn'],
  ]
  return (
    <dl className="packet-form">
      {rows.map(([label, value, field]) => (
        <div key={label}>
          <dt className="label">{label}</dt>
          <Value value={value} unsure={field ? intake.unknownFields.includes(field) : false} />
        </div>
      ))}
    </dl>
  )
}

function PropertyRecord({ property }: { property: NonNullable<PermitApplication['property']> }) {
  return (
    <dl className="packet-form">
      <div className="packet-form-wide">
        <dt className="label">Address</dt>
        <dd>{property.address}</dd>
      </div>
      <div>
        <dt className="label">APN</dt>
        <dd className="mono num">{property.apn}</dd>
      </div>
      <div>
        <dt className="label">Zoning</dt>
        <dd className="mono">
          {property.zoning ?? 'UNKNOWN'}
          {property.zoningOverlay ? <span className="chip">{property.zoningOverlay} overlay</span> : null}
        </dd>
      </div>
      <div className="packet-form-wide">
        <dt className="label">Source</dt>
        <dd className="mono packet-source">
          {property.source === 'fixture' ? <span className="chip">demo cached data</span> : 'geo.sanjoseca.gov'} ·{' '}
          {dateTime(property.fetchedAt)}
        </dd>
      </div>
    </dl>
  )
}

function FindingEntry({ finding, permit }: { finding: Finding; permit: PermitApplication }) {
  const { title, note, wrong, change } = findingCopy(finding, permit)
  const pill = STATUS_PILL[finding.status]
  return (
    <li className="packet-finding">
      <div className="packet-finding-head">
        <h3>{title}</h3>
        <span className={`pill pill--${pill.tone}`}>{pill.label}</span>
      </div>
      {[note, wrong, change].filter(Boolean).map((line) => (
        <p key={line}>{line}</p>
      ))}
      <p className="packet-cite">
        {finding.citation}
        <span>
          {finding.reviewer === 'building' ? 'Building' : 'Zoning'} reviewer · revision {finding.revision}
        </span>
      </p>
      <a className="packet-url" href={finding.sourceUrl}>
        {finding.sourceUrl}
      </a>
    </li>
  )
}

export function PacketView({ permit }: { permit: PermitApplication }) {
  const fileHref = `/permits/${encodeURIComponent(permit.id)}`

  if (permit.status !== 'PRE_REVIEW_COMPLETE') {
    return (
      <main className="empty-screen">
        <h1>Your draft packet isn't ready yet</h1>
        <p>It opens once the pre-review has no corrections left.</p>
        <a className="btn btn-primary" href={fileHref}>
          Back to your file
        </a>
      </main>
    )
  }

  const street = permit.property?.address.split(',')[0]
  const finishedAt = permit.events.at(-1)?.at
  const open = openItems(permit)

  return (
    <main className="packet">
      <header className="packet-toolbar">
        <a className="wordmark" href="/">
          stamp
        </a>
        <a className="packet-back" href={fileHref}>
          Back to your file
        </a>
        <button className="btn btn-primary" type="button" onClick={() => window.print()}>
          Print
        </button>
      </header>

      <article className="packet-doc">
        <div className="packet-watermark" aria-hidden="true">
          UNOFFICIAL DRAFT
        </div>
        <p className="packet-banner">{BANNER}</p>

        <header className="packet-title">
          <div>
            <p className="label">Pre-review · San José</p>
            <h1>Draft permit packet</h1>
            <p className="packet-project">Residential deck{street ? ` · ${street}` : ''}</p>
          </div>
          <dl className="packet-meta">
            <div>
              <dt className="label">Revision</dt>
              <dd className="mono num">{permit.revision}</dd>
            </div>
            {finishedAt ? (
              <div>
                <dt className="label">Pre-review finished</dt>
                <dd className="mono num">{dateTime(finishedAt)}</dd>
              </div>
            ) : null}
          </dl>
        </header>

        <section>
          <h2>Project summary</h2>
          <ProjectSummary permit={permit} />
        </section>

        {permit.property ? (
          <section>
            <h2>Property</h2>
            <PropertyRecord property={permit.property} />
          </section>
        ) : null}

        <section>
          <h2>Findings</h2>
          <ul className="packet-findings">
            {currentFindings(permit.findings).map((finding) => (
              <FindingEntry key={finding.findingId} finding={finding} permit={permit} />
            ))}
          </ul>
        </section>

        <section>
          <h2>Still required</h2>
          <ul className="packet-checklist">
            {open.map((finding) => (
              <li key={finding.findingId}>
                <strong>{RULES[finding.ruleId]?.label ?? 'Open item'}</strong>
                <span>{openItemWords(finding)}</span>
              </li>
            ))}
            {FORMS.map((form) => (
              <li key={form.name}>
                <strong>{form.name}</strong>
                {form.note ? <span>{form.note}</span> : null}
                <a className="packet-url" href={form.url}>
                  {form.url}
                </a>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2>How to file</h2>
          <ol className="packet-steps">
            <li>
              Apply at SJPermits, <a href={SJPERMITS}>{SJPERMITS}</a>, and choose the Standard Plan Review Service.
            </li>
            <li>SJPermits emails you the steps to create an SJePlans account.</li>
            <li>Upload your documents through SJePlans.</li>
            <li>A City plan reviewer sends comments back to you through SJePlans.</li>
          </ol>
        </section>

        <p className="packet-foot">stamp is a pre-review. It files nothing, and the City of San José still issues your permit.</p>
      </article>
    </main>
  )
}

export default function Packet({ id }: { id: string }) {
  const { permit, missing } = usePermit(id)
  if (missing) return <NotFound />
  if (!permit) {
    return (
      <main className="empty-screen">
        <p>Opening your packet…</p>
      </main>
    )
  }
  return <PacketView permit={permit} />
}
