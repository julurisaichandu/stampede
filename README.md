# Permit Office

**Haunted Hacks · Oct 31, 2026 · Team brief**

A city permit office run by AI agents. A homeowner's agent applies for a deck permit; the city's reviewer agents check it against the real building code, talk to each other, send corrections, and move the case to a human official for sign-off. Weeks of back-and-forth happen in minutes.

Hacking 11:00 – 16:00 · Submit on Devpost by 16:00 · Built with Durable Actors + Agent Relay

## 1. The problem, in one minute

Getting a permit for a residential deck is slow because of **correction rounds**. The city reviews your plans, finds problems, sends a correction letter; you fix them and resubmit; the review starts again.

| City | First review | Each correction round |
| --- | --- | --- |
| Santa Barbara (city's own published targets) | 5–30 business days | +10 business days |
| Los Angeles, standard plan check | 15–30 business days | review clock can restart |

Most corrections are predictable: missing footing depth, wrong ledger attachment, railing height, deck too close to the property line, no HOA approval. An agent can catch all of these *before* a human reviewer ever opens the file.

> Y Combinator's Winter 2027 request list includes "AI for City Hall: speed up permitting, inspections, 311 and licensing." This project is a direct answer to it.

## 2. Why this can win today

- **It uses both sponsor tools for what they are best at.** Judges give bonus points for using Durable Actors and Agent Relay together.
- **It stands out.** Most teams will build coding-agent tools. A permit office looks different in the demo lineup.
- **Everyone gets it in seconds.** Nobody has to be told why permits are painful.
- **It has a YC angle.** The overall winner gets a YC interview; this idea is on YC's own list.

## 3. The two tools, and exactly what each one does

### Durable Actors (by Terse)

**Role: the permit's official file.** One actor per application. It holds the application, the review checklist, every comment and correction, and the current status.

Why an actor: only one agent or person can be inside it at a time, so two reviewers can never overwrite each other or flip the status out of order. State is saved automatically, and every connected screen updates live.

### Agent Relay (by AgentRelay)

**Role: the conversation between agents.** The applicant's agent and the city's reviewer agents talk in one channel per permit, with `@mentions`.

Why Relay: reviewers depend on each other ("if the wall moves, fire needs to re-check the exit"). Relay's public agent address lets an outside applicant agent reach the city's agents with access rules, and nothing else.

> **Simple rule for the whole build:** agents **talk** on Agent Relay, and **record decisions** in the permit actor. Relay is the discussion; the actor is the file.

## 4. The agents

| Agent | Works for | Checks | Writes to the actor |
| --- | --- | --- | --- |
| **Applicant** | The homeowner | Submits the application; answers questions; fixes and resubmits plans | Application, revisions |
| **Zoning** | The city | Setbacks from property lines, lot coverage, height | Zoning checklist item + comments |
| **Building** | The city | Footing depth, ledger attachment, joist span, guardrail height, stair rise/run | Building checklist item + comments |
| **Fire / egress** | The city | Exit paths, clearance to structures | Fire checklist item + comments |
| **Clerk** | The city | Completeness, fees, HOA approval, moves status forward | Status transitions |

Each city agent gets only the code sections it needs. A human official still signs the final approval. The agents prepare; a person decides.

## 5. How a permit moves

```text
Applicant agent ─┐
Zoning agent ────┤ discuss  ┌───────────────────┐ record ┌──────────────────────┐
Building agent ──┼─────────>│    Agent Relay    │───────>│     Permit actor     │
Fire agent ──────┘          │ #permit-2026-0412 │        │   official record    │
                            └───────────────────┘        │ one writer at a time │
                                                         └──────────┬───────────┘
                                                                    │ live updates
                                                        ┌───────────┴───────────┐
                                                        v                       v
                                                applicant screen           city screen
```

Agents discuss on Relay, write decisions to the actor, and both screens update from the actor alone.

### Status flow inside the actor

```text
submitted → in_review → corrections_needed → resubmitted → in_review → ready_for_signoff → approved
```

Only the Clerk agent can move the status. Every transition is logged with who, when and why.

## 6. What the Relay conversation looks like

| Agent | Message |
| --- | --- |
| `clerk` | New application #2026-0412: attached deck, 320 sq ft, 42 in above grade, 1240 Elm St. `@zoning` `@building` `@fire` please review. |
| `zoning` | Rear setback is 4 ft; this zone requires 5 ft for attached decks. Correction. `@building` if the deck shrinks, do your spans change? |
| `building` | Yes, I'll recheck joists after the revision. Also: ledger shows nails, code requires lag screws or through-bolts. Guardrail height is 36 in, required 42 in at this deck height. Two corrections. |
| `fire` | Exit path clear. No corrections. |
| `clerk` | Status → corrections_needed. Correction letter sent to `@applicant`. |
| `applicant` | Revised plan uploaded: rear setback 5 ft, ledger through-bolted, guardrail 42 in. Resubmitting. |
| `building` | Joist span still within table limits. Approved. |
| `clerk` | All checks passed. Status → ready_for_signoff. Waiting on human official. |

## 7. The 5-hour build

| Time | Work |
| --- | --- |
| 11:00 – 11:30 | Scaffold both tools. `npx durable-actors init`; connect Agent Relay; one shared repo. |
| 11:30 – 12:30 | **Person A:** the `Permit` actor: fields, status machine, `@Persisted` state, WebSocket broadcast. **Person B:** Relay channel per permit; agent identities; the Clerk agent posting and reading. |
| 12:30 – 13:30 | Zoning and Building agents with the prepared code rules. First end-to-end run on the sample application (over lunch). |
| 13:30 – 14:30 | Applicant agent: receives corrections, revises, resubmits. Fire agent if time allows. |
| 14:30 – 15:15 | Live screens (applicant + city) reading from the actor. Make the demo application break in exactly three places. |
| 15:15 – 15:45 | Record the backup video. Devpost write-up. Rehearse the pitch twice, out loud. |
| 15:45 – 16:00 | Submit. Do not touch code after submitting. |

> **Rule from the organizers:** all code must be written at the event. Planning, reading docs and collecting code sections beforehand is allowed. Keep prepared material as notes and data files, not code.

## 8. Bring this before 11:00

- **One city's deck rules** (Santa Barbara or Los Angeles), 8–10 sections as plain text: setbacks, footing depth, ledger attachment, joist span table, guardrail height (42 in above 30 in grade), stair rise/run, lot coverage, when HOA approval is required.
- **One sample application** as JSON: address, zone, deck size, height, attachment type, materials, drawings summary. Designed to fail three checks and pass the rest.
- **Both tools installed and hello-world tested** on both laptops, so setup does not eat the morning.
- A Devpost account, and the team registered.

## 9. The three-minute demo

1. **The problem (20s):** "A deck permit takes up to 30 business days, and every correction adds 10 more."
2. **Submit (20s):** the applicant agent files the application. The actor shows `submitted`.
3. **Review, live (90s):** the Relay channel fills: zoning flags the setback, building flags the ledger and guardrail, fire clears. Clerk sends corrections. Applicant revises. Checks turn green one by one on the city screen.
4. **Sign-off (20s):** status reaches `ready_for_signoff`. A human official clicks approve. "Thirty days became four minutes, and a person still made the final call."
5. **Why these tools (20s):** "The actor guarantees one authoritative record with no race conditions. Relay is how five agents coordinated without a human relaying messages."

Have the backup video ready on a second laptop. If the live run stalls, switch without apologizing.

## 10. Questions judges may ask

### "Would a city trust this?"

The agents only prepare the review. A licensed human official signs every approval. Cities already outsource plan review to consultants; this is a faster first pass with a full audit trail in the actor.

### "Isn't this just a chatbot?"

No. Five agents with different responsibilities coordinate on a shared case, with enforced single-writer state. That is what Durable Actors and Relay make possible.

### "Why not one big agent?"

Real reviews are split by department because each needs different expertise and accountability. Separate agents make every finding traceable to a role.

### "What's the business?"

A plan-review service cities and applicants pay for, starting with one high-volume permit type. YC listed this problem in its Winter 2027 requests.

## 11. Scope control

- One permit type (deck), one city, one sample application. No more.
- Order if time runs short: Clerk + Building first, then Zoning, then Applicant revisions, then Fire. The demo works with three agents.
- Screens are read-only views of the actor. No forms, no login, no admin panel.
- Never let the pitch depend on a feature that was not working by 15:00.
