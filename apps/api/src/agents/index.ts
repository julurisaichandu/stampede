// Starts the office agents (Clerk, Building, Zoning) in one Node process: npm run agents
import "./env.ts"

import { startClerk } from "./clerk.ts"
import { startReviewer } from "./reviewer.ts"

await Promise.all([startClerk(), startReviewer("building"), startReviewer("zoning")])
console.log("clerk, building and zoning are listening on Agent Relay")
