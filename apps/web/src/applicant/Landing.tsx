import { useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { emptyPermit } from '../../../api/contracts.ts'
import { planLine } from '../../../api/src/api-types.ts'
import { ApiError, createPermit, sendChat, sendPlan } from '../lib/api.ts'
import { firstTurns } from '../lib/firstTurn.ts'
import { morphTo } from '../lib/nav.ts'
import { PlanAttach, PlanChip } from './PlanAttach.tsx'
import { Sheet } from './Sheet.tsx'
import './Landing.css'

// No-break spaces keep the address whole when text-wrap balances the placeholder.
const PLACEHOLDER = 'Or describe it: a backyard deck at 14630\u00A0Noble\u00A0Ave, San\u00A0Jose, about 16 by 12 feet.'

export default function Landing() {
  const [text, setText] = useState('')
  const [plan, setPlan] = useState<File | null>(null)
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const blank = useMemo(() => emptyPermit('specimen'), [])

  async function start() {
    if (opening) return
    const words = text.trim()
    if (!words && !plan) {
      setError('Upload your plans or describe your deck first.')
      input.current?.focus()
      return
    }
    setOpening(true)
    setError(null)
    try {
      const { id } = await createPermit()
      const send = () => (plan ? sendPlan(id, plan, words) : sendChat(id, words))
      const reply = send()
      reply.catch(() => {}) // The workspace reports this one. It only needs to never go unhandled.
      firstTurns.set(id, { text: plan ? planLine(plan.name, words) : words, typed: !plan, send, reply })
      morphTo(`/permits/${id}`)
    } catch (failure) {
      setOpening(false)
      setError(failure instanceof ApiError && failure.status !== 0
        ? "We couldn't open your file. Your description is still here, so try again in a moment."
        : "We can't reach stampede right now. Your description is still here, so try again in a moment.")
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      start()
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    start()
  }

  return (
    <div className="landing">
      <svg className="landing-defs" aria-hidden="true">
        <filter id="ink-edge">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="4" />
          <feDisplacementMap in="SourceGraphic" scale="0.9" />
        </filter>
      </svg>

      <header className="landing-bar">
        <span className="wordmark">stampede</span>
      </header>

      <main className="landing-main">
        <section className="landing-copy">
          <p className="landing-tag">San Jose · Backyard decks · Pre-review</p>

          <h1 className="landing-hero">
            <span>Run the city’s</span>
            <span>
              review <em>before</em>
            </span>
            <span>you submit.</span>
          </h1>

          <p className="landing-lede">
            Upload your plans or describe your deck. We pull your parcel from the city’s own records, check it against the real code, and
            hand you a corrected draft packet in minutes.
          </p>

          <form className="landing-composer card vt-composer" onSubmit={onSubmit}>
            {plan ? (
              <PlanChip
                name={plan.name}
                onRemove={() => {
                  setPlan(null)
                  input.current?.focus()
                }}
              />
            ) : null}
            <textarea
              ref={input}
              className="landing-input"
              aria-label="Describe your deck"
              placeholder={PLACEHOLDER}
              value={text}
              maxLength={2000}
              rows={2}
              autoFocus
              onChange={(event) => setText(event.target.value)}
              onKeyDown={onKeyDown}
            />
            <div className="landing-actions">
              <PlanAttach onPick={setPlan} onProblem={setError} disabled={opening} />
              <button className="btn btn-primary landing-submit" type="submit" disabled={opening}>
                {opening ? 'Opening your file…' : 'Start my pre-review'}
              </button>
            </div>
          </form>

          {error ? (
            <p className="landing-note notice" role="alert">
              {error}
            </p>
          ) : (
            <p className="landing-note">
              stampede is a pre-review. It files nothing, and the City of San José still issues your permit.
            </p>
          )}
        </section>

        <aside className="landing-sheet" aria-hidden="true">
          <div className="landing-stack">
            <div className="vt-sheet">
              <Sheet permit={blank} specimen />
            </div>
          </div>
        </aside>
      </main>
    </div>
  )
}
