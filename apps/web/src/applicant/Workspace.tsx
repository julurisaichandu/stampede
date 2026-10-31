import { useEffect, useRef, useState } from 'react'
import { emptyPermit, type PermitApplication } from '../../../api/contracts.ts'
import type { GisCandidate, GisLookup } from '../../../api/src/api-types.ts'
import { ApiError, chooseCandidate, runReview, sendChat } from '../lib/api.ts'
import { firstTurns } from '../lib/firstTurn.ts'
import { usePermit } from '../lib/usePermit.ts'
import { CandidatePicker } from './CandidatePicker.tsx'
import { Chat } from './Chat.tsx'
import { Findings } from './Findings.tsx'
import { NotFound } from './NotFound.tsx'
import { RunReview } from './RunReview.tsx'
import { Sheet } from './Sheet.tsx'
import { PacketCard, Stamp } from './Stamp.tsx'
import { Stepper } from './Stepper.tsx'
import './workspace.css'

const TURN_FAILED = "That didn't go through. Your message is safe here, so try again."
const MAX_MESSAGE = 2000
const REVIEW_FAILED = "The reviewers couldn't be reached. Nothing was lost, so try again."

// Status 0 and the 422 question are already plain English. The server's other errors may not be.
function plain(failure: unknown, fallback: string) {
  return failure instanceof ApiError && (failure.status === 0 || failure.status === 422) ? failure.message : fallback
}

const POINTERS: Partial<Record<GisLookup['status'], string>> = {
  needs_confirm: 'Choose your address in the file',
  out_of_city: 'Outside San José city limits',
  not_found: 'No match on the city map',
  unavailable: 'City records unavailable right now',
}

const ANNOUNCED: Partial<Record<PermitApplication['status'], string>> = {
  READY_FOR_REVIEW: 'The reviewers have your file.',
  IN_REVIEW: 'The reviewers have your file.',
  CORRECTIONS_REQUESTED: 'The reviewers found something to change. The findings are in your file.',
  REVISED: 'Your revision is with the reviewers.',
  PRE_REVIEW_COMPLETE: 'Your pre-review is complete. Your draft packet is ready.',
}

const noop = () => {}

export function WorkspaceView({
  permit,
  connected = true,
  stalled = false,
  lookup = null,
  pendingText = null,
  error = null,
  loading = false,
  typing = false,
  sending = false,
  reviewing = false,
  reviewError = null,
  onSend = noop,
  onRetry = noop,
  onChoose = noop,
  onRun = noop,
}: {
  permit: PermitApplication
  connected?: boolean
  stalled?: boolean
  lookup?: GisLookup | null
  pendingText?: string | null
  error?: string | null
  loading?: boolean
  typing?: boolean
  sending?: boolean
  reviewing?: boolean
  reviewError?: string | null
  onSend?: (text: string) => void
  onRetry?: () => void
  onChoose?: (candidate: GisCandidate) => void
  onRun?: () => void
}) {
  const street = permit.property?.address.split(',')[0]
  const openLookup = permit.status === 'INTAKE' && !permit.property ? lookup : null
  const picking = openLookup?.status === 'needs_confirm'

  const sheetRef = useRef<HTMLDivElement>(null)
  const pickerRef = useRef<HTMLDivElement>(null)
  const findingsRef = useRef<HTMLDivElement>(null)
  const lastStatus = useRef(permit.status)
  const lastRevision = useRef(permit.revision)

  useEffect(() => {
    if (picking) pickerRef.current?.scrollIntoView({ block: 'nearest' })
  }, [picking])

  // The findings sit below the fold, and the revision tick, the re-type and the stamp all land
  // above it, so the file follows the review.
  useEffect(() => {
    const from = lastStatus.current
    const revised = permit.revision > lastRevision.current
    lastStatus.current = permit.status
    lastRevision.current = permit.revision
    const moved = from !== permit.status
    if (revised || (moved && permit.status === 'PRE_REVIEW_COMPLETE')) sheetRef.current?.scrollIntoView({ block: 'start' })
    else if (moved && from === 'INTAKE') findingsRef.current?.scrollIntoView({ block: 'start' })
  }, [permit.status, permit.revision])

  // The picker and the run button unmount with focus on them, and the next step is always chat.
  // Desktop only: on a phone this would raise the keyboard over what just changed.
  useEffect(() => {
    if (document.activeElement !== document.body || !matchMedia('(min-width: 960px)').matches) return
    document.querySelector<HTMLElement>('.chat-composer textarea')?.focus({ preventScroll: true })
  }, [picking, permit.status])

  return (
    <main className="workspace">
      <h1 className="sr-only">Your deck file</h1>
      <p className="sr-only" role="status">
        {ANNOUNCED[permit.status] ?? ''}
      </p>
      <header className="workspace-bar">
        <a className="wordmark" href="/">
          stamp
        </a>
        <p className="workspace-project">
          Residential deck
          {street ? <span> · {street}</span> : null}
        </p>
        {connected ? null : (
          <p className="workspace-reconnect" role="status">
            Reconnecting…
          </p>
        )}
        <div className="workspace-steps">
          <Stepper status={permit.status} />
        </div>
      </header>

      <div className="workspace-cols">
        <section className="workspace-chat" aria-label="Chat">
          {stalled ? (
            <p className="chat-error workspace-stalled notice" role="alert">
              We can't open your file right now. It's saved, and we'll keep trying.
            </p>
          ) : null}
          <Chat
            chat={permit.chat}
            pendingText={pendingText}
            error={error}
            loading={loading}
            typing={typing}
            sending={sending}
            pointer={openLookup ? (POINTERS[openLookup.status] ?? null) : null}
            onSend={onSend}
            onRetry={onRetry}
          />
        </section>

        <section className="workspace-file" aria-label="Your file">
          <div className="sheet-stack vt-sheet" ref={sheetRef}>
            <Sheet permit={permit} />
            <Stamp permit={permit} />
          </div>
          {/* The sticky button would sit on top of the picker, and it cannot run until an address is chosen. */}
          {picking ? (
            <div ref={pickerRef}>
              <CandidatePicker lookup={openLookup} busy={sending} onChoose={onChoose} />
            </div>
          ) : (
            <RunReview permit={permit} busy={reviewing} error={reviewError} onRun={onRun} />
          )}
          <PacketCard permit={permit} />
          <div className="workspace-findings" ref={findingsRef}>
            <Findings permit={permit} />
          </div>
        </section>
      </div>
    </main>
  )
}

type Turn = {
  text: string
  base: number // chat length when sent, so a repeated sentence still counts as new
  inFlight: boolean
  error: string | null
  typed: boolean // the homeowner's own words, not a picked address
  send: () => Promise<{ lookup: GisLookup | null }>
}

export default function Workspace({ id }: { id: string }) {
  const { permit, connected, missing, stalled } = usePermit(id)
  const [lookup, setLookup] = useState<GisLookup | null>(null)
  const [reviewing, setReviewing] = useState(false)
  const [reviewError, setReviewError] = useState<string | null>(null)
  const [turn, setTurn] = useState<Turn | null>(() => {
    const first = firstTurns.get(id)
    if (!first) return null
    return { text: first.text, base: 0, inFlight: true, error: null, typed: true, send: () => sendChat(id, first.text) }
  })

  async function track(reply: Promise<{ lookup: GisLookup | null }>) {
    try {
      const { lookup: found } = await reply
      setLookup((prev) => found ?? (prev?.status === 'needs_confirm' ? prev : null))
      setTurn((prev) => prev && { ...prev, inFlight: false })
    } catch (failure) {
      setTurn((prev) => prev && { ...prev, inFlight: false, error: plain(failure, TURN_FAILED) })
    }
  }

  function begin(text: string, typed: boolean, send: Turn['send']) {
    setTurn({ text, base: permit?.chat.length ?? 0, inFlight: true, error: null, typed, send })
    track(send())
  }

  useEffect(() => {
    const first = firstTurns.get(id)
    if (first) track(first.reply)
  }, [id])

  async function run() {
    setReviewing(true)
    setReviewError(null)
    try {
      await runReview(id)
    } catch (failure) {
      setReviewing(false)
      setReviewError(plain(failure, REVIEW_FAILED))
    }
  }

  if (missing) return <NotFound />

  // Any user line past base is this turn: only one runs at a time, and a picked address is reworded by the server.
  const since = turn ? (permit?.chat ?? []).slice(turn.base) : []
  const userAt = since.findIndex((message) => message.role === 'user')
  const answered = userAt >= 0 && since.slice(userAt).some((message) => message.role === 'assistant')

  // A line that never reached the server exists only in this turn, so it travels with the next one.
  function sendTyped(text: string) {
    const held = turn?.typed && turn.error && userAt < 0 ? turn.text : null
    if (!held) return begin(text, true, () => sendChat(id, text))
    const both = `${held}\n${text}`
    begin(both, true, () =>
      both.length <= MAX_MESSAGE ? sendChat(id, both) : sendChat(id, held).then(() => sendChat(id, text)),
    )
  }

  // Render the full shell on the first frame, even with no state yet. The landing morph
  // needs .vt-composer and .vt-sheet in the new DOM, so a loading screen here breaks it.
  return (
    <WorkspaceView
      permit={permit ?? emptyPermit(id)}
      connected={connected || (!permit && !stalled)}
      stalled={!permit && stalled}
      lookup={lookup}
      pendingText={turn && userAt < 0 ? turn.text : null}
      error={turn?.error ?? null}
      loading={!permit}
      typing={!!turn && !turn.error && !answered}
      sending={turn?.inFlight ?? false}
      reviewing={reviewing}
      reviewError={reviewError}
      onSend={sendTyped}
      onRetry={() => turn && begin(turn.text, turn.typed, turn.send)}
      onChoose={(candidate) =>
        begin(candidate.address, false, () => chooseCandidate(id, { address: candidate.address, apn: candidate.apn }))
      }
      onRun={run}
    />
  )
}
