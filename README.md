# stampede

stampede runs the city's review before you submit.

A San Jose homeowner describes a backyard deck in chat. stampede reads the address, pulls the real parcel and zoning from the city's GIS, and hands the application to three review agents. They check it against the adopted code, talk over Agent Relay, and write their findings to one durable record. The homeowner fixes corrections in the same chat and leaves with a draft packet.

stampede files nothing. The packet is marked UNOFFICIAL DRAFT — NOT FILED WITH THE CITY, the stamp reads PRE-REVIEW COMPLETE, and a person at the city still makes the decision.

Built at Haunted Hacks, Real-Time AI Edition, on October 31, 2026.

## The demo loop

1. The homeowner types "I want a backyard deck at 14630 Noble Ave, San Jose, about 16 by 12 feet." The application fills in, and a match card shows APN 59531001 and zoning R-1-8 from `geo.sanjoseca.gov`.
2. The homeowner answers "attached, about 36 inches high, railing 36 inches." and clicks **Run pre-review**.
3. Findings arrive one at a time: PASS for the permit trigger, CORRECTION for the railing (36 in against the 42 in in 2025 CRC R321.1.2), NEEDS INFORMATION for the ledger, and NEEDS HUMAN VERIFICATION for the rear setback.
4. The chat explains the fix. The homeowner types "I'll make the railing 42 inches." Revision 2 goes out, only the railing rule reruns, and CORRECTION flips to PASS.
5. PRE-REVIEW COMPLETE lands on the file with a link to the draft packet, which lists the citations, the open items, the forms still required, and how to file at SJPermits.

14630 Noble Ave is the Noble House Neighborhood Center. It is a public site standing in for a home, so no family's house goes on stage.

## How the pieces fit

| Piece | Job |
| --- | --- |
| Durable Actors | One `PermitActor` per application holds the only record. Both screens read it over a WebSocket. |
| Agent Relay | One channel per permit carries the messages between Intake, Clerk, Building, and Zoning. |
| OpenAI | Extracts facts from chat with structured output and explains findings in plain English. |
| San Jose GIS | Supplies the address match, parcel, APN, and zoning. |

Deterministic rules decide every finding. The model explains them and never decides. The intake schema has no status field, so chat text cannot move a permit. Clerk is the only status writer, and it writes over a signed socket that a browser grant cannot open.

## Run it

You need Node 24 and Bun 1.4.2 or newer. Install the dependencies:

```sh
curl -fsSL https://bun.sh/install | bash
(cd apps/api && npm install)
(cd apps/web && npm install)
(cd services/actors && bun install)
```

Create `apps/api/.env`, and put the same `DURABLE_ACTORS_SECRET` in `services/actors/.env`:

```sh
OPENAI_API_KEY=...
DURABLE_ACTORS_SECRET=...
```

Register the Relay agents once. This creates a hosted workspace and saves its keys to `apps/api/.env`:

```sh
(cd apps/api && npm run relay:register)
```

Start everything, then open http://localhost:5173. The review office for a permit is at `/office/<permit id>`, the id in the applicant URL:

```sh
scripts/dev.sh
```

`scripts/dev.sh local` runs the same Clerk, Building, and Zoning agents inside the API with no Relay keys. Use it if Relay is down.

If `scripts/dev.sh` says the actors did not start, check `services/actors/.env` and `apps/api/.env`. Older copies of the example files set port 7111. Both must use 7100.

After you change the actor's methods, run this with the actor running:

```sh
(cd services/actors && bunx durable-actors generate --out-dir ../../apps/api/generated)
```

## Try it

The `input` folder has everything for a run:

- `input/customer-chat.txt` has the exact lines to type. Only the customer types. The officer screen has no input.
- `input/expected-output.md` shows what the customer and officer screens should show at each step.
- `input/try-these-too.txt` tests what stampede refuses to do.

## What stampede refuses to do

- It never invents a permit number, a city seal, or a city sign-off.
- It never fills in a missing value. A value the homeowner does not know stays UNKNOWN.
- It never auto-picks a parcel. When the city returns more than one match, the homeowner chooses.
- It shows "demo cached data" if the city GIS is down and the demo address falls back to its recorded response. Any other address gets an honest failure message.
- It returns NEEDS HUMAN VERIFICATION with the missing source when a rule cannot be verified. stampede states no rear setback for an attached deck, because the source was not verified.
