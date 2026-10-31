import type {
  ChatResponse,
  CreatePermitResponse,
  LookupRequest,
  LookupResponse,
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

const UNREACHABLE = "We can't reach stamp right now. Check your connection and try again."

async function post<T>(path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    })
  } catch {
    throw new ApiError({ status: 0, retryable: true, message: UNREACHABLE, body: null })
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
export const chooseCandidate = (id: string, body: LookupRequest) =>
  post<LookupResponse>(permitPath(id, 'lookup'), body)
export const runReview = (id: string) => post<ReviewOk>(permitPath(id, 'review'))
