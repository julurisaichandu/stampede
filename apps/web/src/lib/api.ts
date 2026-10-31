import type {
  ChatResponse,
  CreatePermitResponse,
  LookupRequest,
  LookupResponse,
  PlanRequest,
  ReviewOk,
} from '../../../api/src/api-types.ts'

export class ApiError extends Error {
  status: number
  retryable: boolean
  body: unknown

  constructor(input: { status: number; retryable: boolean; message: string; body: unknown }) {
    super(input.message)
    this.status = input.status
    this.retryable = input.retryable
    this.body = input.body
  }
}

const UNREACHABLE = "We can't reach stampede right now. Check your connection and try again."
const TOO_SLOW = 'stampede is taking too long to answer. Try again in a moment.'

// The server's slowest honest paths: chat is model plus GIS, review is a channel open plus a Relay post.
const CHAT_TIMEOUT_MS = 45_000
const REVIEW_TIMEOUT_MS = 90_000
// A plan read can run about 100 seconds, so the client outlasts it and hears the server's own answer.
const PLAN_TIMEOUT_MS = 120_000

async function post<T>(path: string, body?: unknown, timeoutMs = CHAT_TIMEOUT_MS): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (failure) {
    const slow = failure instanceof DOMException && failure.name === 'TimeoutError'
    throw new ApiError({ status: 0, retryable: true, message: slow ? TOO_SLOW : UNREACHABLE, body: null })
  }
  const data: unknown = await res.json().catch(() => null)
  if (res.ok) return data as T
  const fields = (data ?? {}) as { error?: string; question?: string; retryable?: boolean }
  throw new ApiError({
    status: res.status,
    retryable: fields.retryable ?? res.status >= 500,
    message: fields.question ?? fields.error ?? UNREACHABLE,
    body: data,
  })
}

const permitPath = (id: string, route: string) => `/api/permits/${encodeURIComponent(id)}/${route}`

export const createPermit = () => post<CreatePermitResponse>('/api/permits')
export const sendChat = (id: string, text: string) => post<ChatResponse>(permitPath(id, 'chat'), { text })

function readBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = () =>
      reject(new ApiError({ status: 0, retryable: false, message: "We couldn't read that file. Attach it again.", body: null }))
    reader.readAsDataURL(file)
  })
}

export async function sendPlan(id: string, file: File, note: string) {
  const body: PlanRequest = { name: file.name, data: await readBase64(file), note }
  return post<ChatResponse>(permitPath(id, 'plan'), body, PLAN_TIMEOUT_MS)
}

export const chooseCandidate = (id: string, body: LookupRequest) =>
  post<LookupResponse>(permitPath(id, 'lookup'), body)
export const runReview = (id: string) => post<ReviewOk>(permitPath(id, 'review'), undefined, REVIEW_TIMEOUT_MS)
