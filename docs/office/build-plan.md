# stamped — Kris's side: the office

You are building **the office half** of stamped at Haunted Hacks (SF, Oct 31 2026). Submission is at **16:00 PDT**. A teammate is building the applicant half in parallel (Intake chat agent, San Jose GIS lookup, applicant screen, draft packet). The two halves meet only through `apps/api/src/contracts.ts`. **Never change that file without saying so.**

**Product in one line:** a permit office run by AI agents. A homeowner describes a backyard deck; Building, Zoning and Clerk agents review it against real San Jose rules, coordinate over Agent Relay, write findings to one durable record, and hand back a corrected, submission-ready packet. A human still makes the official decision.

**Hard rules**
- Agents **talk** on Agent Relay and **record decisions** in the PermitActor. Relay is never a database. Screens read only the actor.
- The **Clerk is the only agent that changes status.** Building and Zoning only append findings.
- Rules are deterministic (`rules.ts`). The LLM may rephrase a finding's `reason` into plain English; it never decides PASS/CORRECTION.
- Never show "APPROVED", a city seal, or a permit number. The final state is `PRE_REVIEW_COMPLETE`.
- No raw JSON on screen. No secrets in code (`OPENAI_API_KEY`, `RELAY_WORKSPACE_KEY` from env).

## Repo layout (three folders, no monorepo tooling)

```
stamped/
  apps/web/          React + Vite. The review office screen (Kris) and applicant screen (teammate).
  apps/api/          Node/TypeScript. Routes, rules, Relay agents. Contracts live here.
  services/actors/   Terse Durable Actors service. PermitActor.
```

Already written (use as-is): `apps/api/src/contracts.ts`, `apps/api/src/rules.ts`.

## Read the docs before writing code (10 minutes, not more)

- Durable Actors README + examples: https://github.com/TerseAI/durable-actors — confirm the current names for persisted fields (`@Persisted`), reentrancy, `onConnect` / `onMessage` / `broadcast`, and how a client gets an actor by id (`actors.Permit.get(id)`).
- Agent Relay TypeScript SDK: https://agentrelay.com/docs/typescript-sdk — confirm how to join a workspace (`RELAY_WORKSPACE_KEY`), register an agent, post to a channel, and subscribe. Use `@agent-relay/sdk` in the product. The CLI (`agent-relay@next`) is only for coding sessions.
- If a doc contradicts this file, the doc wins. Note the difference in `NOTES.md`.

## Build order (each step has an acceptance test; do not start the next until it passes)

### Step 1 — PermitActor (target 12:45)
`services/actors/src/Permit.ts`, one actor instance per permit id.

Persisted state = `PermitApplication` from contracts. Methods:
- `init(app: PermitApplication)` — sets state if empty.
- `get()` — returns state.
- `confirmFields(patch: Partial<Deck> & { property?: Partial<Property> }, actor)` — validates with Zod, merges, appends `FIELD_CONFIRMED` events. Only allowed while status is `INTAKE`, `READY_FOR_REVIEW` or `CORRECTIONS_REQUESTED`.
- `setStatus(to: Status, by: "clerk", why: string)` — rejects unless `by === "clerk"` and `ALLOWED_TRANSITIONS[current].includes(to)`. Appends `STATUS_CHANGED` event with `from`/`to`.
- `addFinding(f: Finding)` — validates; rejects if `f.revision !== state.revision`; replaces an existing finding with the same `ruleId` for the same revision (so reruns update in place); appends `FINDING_ADDED`.
- `bumpRevision(by: "clerk")` — `revision += 1`, keeps old findings (they carry their revision number).
- After every mutation: `broadcast(JSON.stringify(state))` to connected sockets.

Acceptance: a script creates the actor with `DEMO_APPLICATION`, calls `setStatus("IN_REVIEW", "building", ...)` → rejected; `setStatus("IN_REVIEW", "clerk", ...)` → ok; restart the actor service; `get()` still returns the state with the event. Two sockets connected both receive the broadcast.

### Step 2 — Rules wired to the actor (target 13:00)
`apps/api/src/review.ts`:
- `runReview(permitId)` — loads state, runs `BUILDING_RULES` then `ZONING_RULES` with `runRule`, calls `addFinding` for each, returns the findings.
- `runRevise(permitId, patch)` — `confirmFields(patch)`, `bumpRevision`, computes affected rules via `FIELD_TO_RULES`, reruns only those.

Acceptance: on `DEMO_APPLICATION` the four findings are PASS / CORRECTION / NEEDS_INFORMATION / NEEDS_HUMAN_VERIFICATION exactly as the comment at the bottom of `rules.ts` says. After `runRevise(id, { guardHeightIn: 42 })` only `CRC-GUARD-01` reruns and becomes PASS.

### Step 3 — Agents on Agent Relay (target 13:45)
`apps/api/src/agents/{clerk,building,zoning}.ts`. One Relay channel per permit: `permit-<id>`. Every message is a `RelayEnvelope` (contracts) serialized as JSON text.

- **Clerk** on `POST /api/permits/:id/review`: `setStatus(IN_REVIEW)`, posts `REVIEW_REQUEST` to the channel, waits for `REVIEW_COMPLETE` from both building and zoning, then: any CORRECTION or NEEDS_INFORMATION → `setStatus(CORRECTIONS_REQUESTED)` and posts `NEEDS_INPUT` with the list for the Intake agent; otherwise → `setStatus(PRE_REVIEW_COMPLETE)`.
- **Building** subscribes; on `REVIEW_REQUEST` for its revision: runs `BUILDING_RULES`, `addFinding` each, posts one `FINDING` message per finding (payload = finding), then `REVIEW_COMPLETE`. Before posting, ask OpenAI (one short call, `gpt-4o-mini` or whatever key allows) to rewrite `reason` in plain English for a homeowner, max 25 words. If the call fails, post the original reason. Never let the model change `status`.
- **Zoning** same, with `ZONING_RULES`. If a CORRECTION arrives from Building that mentions `deck.attached` or dimensions, Zoning posts one line "@building noted, setback verification unchanged" so the channel shows coordination.
- **Idempotency:** ignore any message whose `revision` is not the actor's current revision; ignore duplicates by `findingId`.
- On `POST /api/permits/:id/revise`: Clerk `bumpRevision`, `setStatus(REVISED)` then `setStatus(IN_REVIEW)`, posts `REVISION_SUBMITTED` with the changed fields; Building/Zoning rerun only `FIELD_TO_RULES[field]`.

Acceptance: hit `/review` on the demo permit → channel shows REVIEW_REQUEST, 3 FINDING from building, 1 FINDING from zoning, 2 REVIEW_COMPLETE, 1 NEEDS_INPUT; actor status is `CORRECTIONS_REQUESTED` with 4 findings. Hit `/revise` with `{ "guardHeightIn": 42 }` → one new FINDING (PASS) at revision 2; status back to `CORRECTIONS_REQUESTED` (ledger still missing) — then `/revise` with `{ "ledgerType": "through_bolts" }` → status `PRE_REVIEW_COMPLETE`.

### Step 4 — API routes (target 14:00)
`apps/api/src/server.ts` (Express or Hono):
```
POST /api/permits                 → creates actor from DEMO_APPLICATION (teammate replaces with intake later)
GET  /api/permits/:id             → actor state
POST /api/permits/:id/review      → Clerk flow
POST /api/permits/:id/revise      → Clerk flow with patch (body validated with Deck.partial())
GET  /api/permits/:id/events      → WebSocket proxy to the actor's broadcast (or SSE)
GET  /api/permits/:id/relay       → last 50 Relay messages for the channel (for the office screen feed)
```
CORS open for localhost. Acceptance: `curl` the full loop: create → review → revise → revise → state is `PRE_REVIEW_COMPLETE`.

### Step 5 — Review office screen (target 15:20, including polish)
`apps/web/src/office/OfficeScreen.tsx`, route `/office/:id`. Reads the actor via the events socket; reads the Relay feed via `/relay` polling every 2 s. Shows:
1. Header: permit id, address, "Residential deck", status badge.
2. Status stepper: INTAKE → READY → IN REVIEW → CORRECTIONS → REVISED → PRE-REVIEW COMPLETE; current step highlighted, past steps checked.
3. Checklist: one row per rule (`SJ-PERMIT-01`, `CRC-GUARD-01`, `SJ-DETAIL-01`, `SJ-ZONING-01`) with a pill: `Reviewing…` until a finding for the current revision exists, then PASS (green) / CORRECTION (red) / NEEDS INFO (amber) / NEEDS HUMAN VERIFICATION (amber). Expanding a row shows `reason`, `observed`, `required`, and a link with `sourceLabel`.
4. Live Relay feed: one line per message, color per sender (clerk, building, zoning, intake), newest at bottom, auto-scroll.
5. Audit timeline from `events`.
Design: one accent color, one font pairing, consistent cards. Animate the pill flip (200 ms). No JSON anywhere. Works at 1280 px wide on the demo laptop.

Acceptance: run the API loop while the screen is open; every pill flips live without refresh; the Relay feed shows the conversation; the stepper reaches PRE-REVIEW COMPLETE.

### Step 6 — Supabase (only if steps 1–5 are done, 15 minutes max)
Create a `rules` table with the four rule ids, thresholds and source URLs; `rules.ts` reads thresholds from it at startup with the current constants as fallback. Then the "scales to every permit type in every city" sentence is true.

## Demo data
`DEMO_APPLICATION` in contracts: 770 Lincoln Ave, San Jose (verify zoning via GIS; replace `R-1-8` with the real value), 16 × 12 ft, 36 in high, attached, guard 36 in, setback 4 ft, ledger not described.

## When you are stuck
- Relay SDK unclear → implement the agents against an in-process event bus with the same envelope, keep the Relay client as a thin adapter, and come back to it. The demo needs the channel visible, so do not skip Relay entirely.
- Actor service unclear → confirm with the Terse team in the room; they are judging this track.
- Behind at 14:00 → make Zoning a static NEEDS_HUMAN_VERIFICATION and move on.

## Definition of done for this half
Full loop works from curl and on the office screen, live. Status, findings and events survive an actor restart. Clerk is the only status writer (proven by a rejected call). Relay channel shows the three agents coordinating. Nothing on screen says APPROVED.
