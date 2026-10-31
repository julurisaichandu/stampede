import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'
import type { Deck, PermitApplication } from '../../../api/contracts.ts'
import { firstTurns } from '../lib/firstTurn.ts'
import { MatchCard } from './MatchCard.tsx'
import './Sheet.css'

type Row = { label: string; value: string | null; span: number; field?: string }

const CHAR_MS = 42
const ROW_GAP_MS = 110

const yesNo = (value: boolean | null) => (value === null ? null : value ? 'Attached' : 'Freestanding')
const withUnit = (value: number | null, unit: string) => (value === null ? null : `${value} ${unit}`)

function deckRows(deck: Deck): Row[] {
  const area = deck.lengthFt !== null && deck.widthFt !== null ? Math.round(deck.lengthFt * deck.widthFt * 100) / 100 : null
  return [
    { label: 'Length', value: withUnit(deck.lengthFt, 'ft'), span: 2, field: 'deck.lengthFt' },
    { label: 'Width', value: withUnit(deck.widthFt, 'ft'), span: 2, field: 'deck.widthFt' },
    { label: 'Area', value: withUnit(area, 'sq ft'), span: 2 },
    { label: 'Height above grade', value: withUnit(deck.maxHeightIn, 'in'), span: 3, field: 'deck.maxHeightIn' },
    { label: 'Attached', value: yesNo(deck.attached), span: 3, field: 'deck.attached' },
    { label: 'Ledger', value: deck.ledgerType, span: 2, field: 'deck.ledgerType' },
    { label: 'Rear setback', value: withUnit(deck.rearSetbackFt, 'ft'), span: 2, field: 'deck.rearSetbackFt' },
    { label: 'Railing height', value: withUnit(deck.guardHeightIn, 'in'), span: 2, field: 'deck.guardHeightIn' },
  ]
}

// The queue is shared across a sheet's rows, so values that arrive together type one after another.
function useTyped(value: string | null, queue: RefObject<number>) {
  const [shown, setShown] = useState(value)
  const [passes, setPasses] = useState(0)
  const last = useRef(value)

  useEffect(() => {
    if (value === last.current) return
    last.current = value
    if (value === null || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(value)
      return
    }
    const now = performance.now()
    const start = Math.max(now, queue.current)
    queue.current = start + value.length * CHAR_MS + ROW_GAP_MS
    let ticker: ReturnType<typeof setInterval> | undefined
    const wait = setTimeout(() => {
      let typed = 0
      setPasses((count) => count + 1)
      setShown('')
      ticker = setInterval(() => {
        typed += 1
        setShown(value.slice(0, typed))
        if (typed >= value.length) clearInterval(ticker)
      }, CHAR_MS)
    }, start - now)
    return () => {
      clearTimeout(wait)
      clearInterval(ticker)
    }
  }, [value, queue])

  return { shown, passes, typing: shown !== null && shown !== value }
}

function Cell({ row, unsure, queue }: { row: Row; unsure: boolean; queue: RefObject<number> }) {
  const { shown, passes, typing } = useTyped(row.value, queue)
  return (
    <div className="sheet-cell" style={{ '--span': row.span } as CSSProperties}>
      <dt>{row.label}</dt>
      <dd>
        {shown === null ? (
          <>
            <span className="sheet-unknown">UNKNOWN</span>
            {unsure ? <span className="sheet-unsure">you weren’t sure</span> : null}
          </>
        ) : (
          <span key={passes} className={passes > 0 ? 'sheet-value is-fresh' : 'sheet-value'}>
            {shown}
            {typing ? <i className="sheet-caret" aria-hidden="true" /> : null}
          </span>
        )}
      </dd>
    </div>
  )
}

function Revision({ value }: { value: number }) {
  const [first] = useState(value)
  return (
    <span className="label num sheet-revision">
      Revision{' '}
      <span key={value} className={value === first ? undefined : 'sheet-tick'}>
        {value}
      </span>
    </span>
  )
}

function SheetBody({ permit, specimen }: { permit: PermitApplication; specimen: boolean }) {
  const { property, deck, intake, revision } = permit
  const queue = useRef(0)
  const [baseline] = useState(property?.parcelId)
  const propertyRows: Row[] = [
    { label: 'Site address', value: null, span: 6 },
    { label: 'APN', value: null, span: 3 },
    { label: 'Zoning', value: null, span: 3 },
  ]

  return (
    <article className="sheet" aria-label={specimen ? 'A blank application sheet' : 'Your application sheet'}>
      <header className="sheet-head">
        <span className="label">Residential deck · Pre-review</span>
        <Revision value={revision} />
      </header>
      <h2 className="sheet-title">Application sheet</h2>

      <p className="sheet-part">
        <b>Part I</b> Property, from the city’s records
      </p>
      {property ? (
        <MatchCard key={property.parcelId} property={property} drop={property.parcelId !== baseline} />
      ) : (
        <dl className="sheet-grid">
          {propertyRows.map((row) => (
            <Cell key={row.label} row={row} unsure={false} queue={queue} />
          ))}
        </dl>
      )}

      <p className="sheet-part">
        <b>Part II</b> Deck, in your words
      </p>
      <dl className="sheet-grid">
        {deckRows(deck).map((row) => (
          <Cell
            key={row.label}
            row={row}
            unsure={row.field !== undefined && intake.unknownFields.includes(row.field)}
            queue={queue}
          />
        ))}
      </dl>

      <footer className="sheet-foot">
        <p>Filled in only from what you say and what the city’s records show. Nothing is guessed.</p>
        <div className="sheet-stamp-box">
          <span>Pre-review stamp</span>
        </div>
      </footer>
    </article>
  )
}

// Workspace paints an empty permit until the first state frame, and a real file always has chat.
// Remounting at that moment makes the loaded values the baseline, so a refresh types nothing.
// The tab that just created the file skips the remount, so its first answers always type in.
export function Sheet({ permit, specimen = false }: { permit: PermitApplication; specimen?: boolean }) {
  const loaded = permit.chat.length > 0 && !firstTurns.has(permit.id)
  return <SheetBody key={loaded ? 'loaded' : 'blank'} permit={permit} specimen={specimen} />
}
