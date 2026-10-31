Stand-in for Kris's PermitActor, so the applicant side can run before `services/actors` lands. It has the contract's fields and `ApplicantActorApi`, and it is not the real office.
Run: `npm install` in `apps/api` first, because the actor imports `contracts.ts` and its zod. Then `bun install`, put the same `DURABLE_ACTORS_SECRET` as `apps/api/.env` in `.env`, then `bunx durable-actors dev` (port 7100).
After an actor change, with dev running: `bunx durable-actors generate --out-dir ../../apps/api/generated`.
