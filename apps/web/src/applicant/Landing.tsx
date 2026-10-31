import { useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { emptyPermit } from '../../../api/contracts.ts'
import { ApiError, createPermit, sendChat } from '../lib/api.ts'
import { firstTurns } from '../lib/firstTurn.ts'
import { morphTo } from '../lib/nav.ts'
import { Sheet } from './Sheet.tsx'
import './Landing.css'

// No-break spaces keep the address whole when text-wrap balances the placeholder.
const PLACEHOLDER = 'I want a backyard deck at 14630\u00A0Noble\u00A0Ave, San\u00A0Jose, about 16 by 12 feet.'

export default function Landing() {
  const [text, setText] = useState('')
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const blank = useMemo(() => emptyPermit('specimen'), [])

  async function start() {
    if (opening) return
    const words = text.trim()
    if (!words) {
      setError('Describe your deck first, in your own words.')
      input.current?.focus()
      return
    }
    setOpening(true)
    setError(null)
    try {
      const { id } = await createPermit()
      const reply = sendChat(id, words)
      reply.catch(() => {}) // The workspace reports this one. It only needs to never go unhandled.
      firstTurns.set(id, { text: words, reply })
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
            Describe your deck. We pull your parcel from the city’s own records, check it against the real code, and
            hand you a corrected draft packet in minutes.
          </p>

          <form className="landing-composer card vt-composer" onSubmit={onSubmit}>
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
