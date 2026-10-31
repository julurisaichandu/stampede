import type { ApplicantActorApi } from "../contracts.ts"
import { actors } from "../generated/index.js"

export const permitActor = (id: string): ApplicantActorApi => actors.PermitActor.get(id)
