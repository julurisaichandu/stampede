import type { ChatResponse } from '../../../api/src/api-types.ts'

export type FirstTurn = { text: string; reply: Promise<ChatResponse> }

// The landing page sends the first message, and the workspace picks it up here.
// Reading never mutates, so React StrictMode's second mount sees the same turn and nothing sends twice.
export const firstTurns = new Map<string, FirstTurn>()
