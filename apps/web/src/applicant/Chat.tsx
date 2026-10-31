import { useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import type { ChatMessage } from '../../../api/contracts.ts'
import './workspace.css'

// The server opens with its acknowledgement, so the sentence can sit anywhere in the reply.
const REVISION = /Revision \d+ submitted\.?/

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

export function Chat({
  chat,
  pendingText,
  error,
  loading,
  typing,
  sending,
  pointer,
  onSend,
  onRetry,
}: {
  chat: ChatMessage[]
  pendingText: string | null
  error: string | null
  loading: boolean
  typing: boolean
  sending: boolean
  pointer: string | null
  onSend: (text: string) => void
  onRetry: () => void
}) {
  const [draft, setDraft] = useState('')
  const log = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)

  const lines: Pick<ChatMessage, 'role' | 'content'>[] = pendingText
    ? [...chat, { role: 'user', content: pendingText }]
    : chat

  useLayoutEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight })
  }, [lines.length, typing, error, pointer])

  function send() {
    input.current?.focus()
    const text = draft.trim()
    if (sending || !text) return
    setDraft('')
    onSend(text)
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
            <p className="voice">{loading ? 'Opening your file…' : 'Tell me about the deck you want to build.'}</p>
          </div>
        ) : null}

        {lines.map((line, index) =>
          line.role === 'user' ? (
            <div key={index} className="msg msg--user">
              <p>{line.content}</p>
              {error && line.content === pendingText && index === lines.length - 1 ? (
                <p className="msg-unsent label">Not sent</p>
              ) : null}
            </div>
          ) : (
            <div key={index} className="msg">
              <p className="label">Intake</p>
              <AssistantText content={line.content} />
            </div>
          ),
        )}

        {typing ? (
          <div className="msg">
            <p className="label">Intake</p>
            <p className="chat-typing">
              <i aria-hidden="true" />
              <i aria-hidden="true" />
              <i aria-hidden="true" />
              <span className="sr-only">stamp is writing</span>
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

      {/* The field stays editable during a turn: send() holds the draft, so typing ahead is never lost. */}
      <form className={`chat-composer card vt-composer${sending ? ' is-sending' : ''}`} onSubmit={onSubmit}>
        <textarea
          ref={input}
          aria-label="Your message"
          placeholder="Reply here"
          rows={1}
          maxLength={2000}
          value={draft}
          autoFocus
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <button className="btn btn-primary" type="submit" disabled={sending || !draft.trim()}>
          Send
        </button>
      </form>
    </>
  )
}
