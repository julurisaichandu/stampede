import { useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import type { ChatMessage, PermitStatus } from '../../../api/contracts.ts'
import { PlanAttach, PlanChip } from './PlanAttach.tsx'
import './workspace.css'
import './chat.css'

// Same words as GREETING in apps/api/src/server.ts. Shown before the first socket frame so the
// homeowner's first bubble already sits at its final index and neither remounts nor moves.
const GREETING = "Upload your plans and I'll read them. No plans yet? Tell me about the deck you want to build, starting with the address."

// The server opens with its acknowledgement, so the sentence can sit anywhere in the reply.
const REVISION = /Revision \d+ submitted\.?/

const PLAN_LABEL = 'Attached plan: '

function AssistantText({ content }: { content: string }) {
  const revision = REVISION.exec(content)
  if (!revision) return <p className="voice">{content}</p>
  const before = content.slice(0, revision.index).trim()
  const after = content.slice(revision.index + revision[0].length).trim()
  return (
    <>
      {before ? <p className="voice">{before}</p> : null}
      <p className="chat-revision">{revision[0].replace(/\.$/, '')}</p>
      {after ? <p className="voice">{after}</p> : null}
    </>
  )
}

// One paragraph, because .msg--user styles only its first child as the bubble.
function UserText({ content }: { content: string }) {
  if (!content.startsWith(PLAN_LABEL)) return <p>{content}</p>
  const [label, ...rest] = content.split('\n')
  return (
    <p>
      <span className="msg-plan">{label}</span>
      {rest.join('\n')}
    </p>
  )
}

export function Chat({
  chat,
  status,
  permitId,
  pendingText,
  error,
  loading,
  typing,
  sending,
  pointer,
  onSend,
  onSendPlan,
  onRetry,
}: {
  chat: ChatMessage[]
  status?: PermitStatus
  permitId?: string
  pendingText: string | null
  error: string | null
  loading: boolean
  typing: boolean
  sending: boolean
  pointer: string | null
  onSend: (text: string) => void
  onSendPlan: (file: File, note: string) => void
  onRetry: () => void
}) {
  const [draft, setDraft] = useState('')
  const [plan, setPlan] = useState<File | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const log = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)

  const lines: Pick<ChatMessage, 'role' | 'content'>[] = pendingText
    ? [...(chat.length ? chat : [{ role: 'assistant' as const, content: GREETING }]), { role: 'user', content: pendingText }]
    : chat
  const firstAssistant = lines.findIndex((line) => line.role === 'assistant')
  const done = status === 'PRE_REVIEW_COMPLETE' && !!permitId
  const attachable = !status || status === 'INTAKE' || status === 'CORRECTIONS_REQUESTED'

  useLayoutEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight })
  }, [lines.length, typing, error, pointer, done])

  function send() {
    input.current?.focus()
    const text = draft.trim()
    if (sending || (!text && !plan)) return
    setDraft('')
    setProblem(null)
    if (!plan) return onSend(text)
    setPlan(null)
    onSendPlan(plan, text)
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    send()
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      send()
    }
  }

  return (
    <>
      <div className="chat-log" ref={log} role="log" aria-live="polite" aria-label="Conversation">
        {lines.length === 0 ? (
          <div className={loading ? 'msg chat-idle' : 'msg'}>
            <p className="label">Intake</p>
            <p className="voice">{loading ? 'Opening your file…' : GREETING}</p>
          </div>
        ) : null}

        {lines.map((line, index) =>
          line.role === 'user' ? (
            <div key={index} className="msg msg--user">
              <UserText content={line.content} />
              {error && line.content === pendingText && index === lines.length - 1 ? (
                <p className="msg-unsent label">Not sent</p>
              ) : null}
            </div>
          ) : (
            <div key={index} className="msg">
              {index === firstAssistant ? <p className="label">Intake</p> : null}
              <AssistantText content={line.content} />
            </div>
          ),
        )}

        {typing ? (
          <div className="msg">
            <p className="chat-typing">
              <i aria-hidden="true" />
              <i aria-hidden="true" />
              <i aria-hidden="true" />
              <span className="sr-only">stampede is writing</span>
            </p>
          </div>
        ) : null}

        {pointer && !typing ? <p className="chat-pointer label">{pointer}</p> : null}

        {error ? (
          <div className="chat-error" role="alert">
            <p className="notice">{error}</p>
            <button
              className="btn"
              type="button"
              onClick={() => {
                onRetry()
                input.current?.focus()
              }}
            >
              Try again
            </button>
          </div>
        ) : null}
      </div>

      {done ? (
        <div className="chat-closing">
          <p>Your pre-review is complete. Your draft packet is ready.</p>
          {/* Worded apart from the sheet's "Open your draft packet" so that link stays unique. */}
          <a className="btn" href={`/permits/${encodeURIComponent(permitId)}/packet`}>
            Go to the packet
          </a>
        </div>
      ) : null}

      {problem ? (
        <p className="notice plan-problem" role="alert">
          {problem}
        </p>
      ) : null}

      {/* The field stays editable during a turn: send() holds the draft, so typing ahead is never lost. */}
      <form className={`chat-composer card vt-composer${sending ? ' is-sending' : ''}`} onSubmit={onSubmit}>
        {plan ? (
          <PlanChip
            name={plan.name}
            onRemove={() => {
              setPlan(null)
              input.current?.focus()
            }}
          />
        ) : null}
        {attachable ? <PlanAttach onPick={setPlan} onProblem={setProblem} disabled={sending} /> : null}
        <textarea
          ref={input}
          aria-label="Your message"
          placeholder={done ? 'Ask a question' : attachable ? 'Reply here, or upload your plans' : 'Reply here'}
          rows={1}
          maxLength={2000}
          value={draft}
          autoFocus
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <button className="btn btn-primary" type="submit" disabled={sending || (!draft.trim() && !plan)}>
          Send
        </button>
      </form>
    </>
  )
}
