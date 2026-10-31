// One-time Relay setup: creates the hosted workspace if apps/api/.env has no RELAY_WORKSPACE_KEY, then registers
// the four stampede agents and saves their tokens to that file. Run under Node: npm run relay:register.
// Never prints a secret. Registration is create-only: an existing name keeps its old token (rotate it with the Relay CLI).
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { AgentRelay } from "@agent-relay/sdk"

const ENV_FILE = fileURLToPath(new URL("../.env", import.meta.url))
const AGENTS = ["intake", "clerk", "building", "zoning"] as const
// New hosted workspaces live here; their keys start with ar_ws_. The SDK reads no env vars, so pass both in code.
const HOSTED = "https://armadillo.agentrelay.com"

function save(values: Record<string, string>) {
  let text = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : ""
  for (const [key, value] of Object.entries(values)) {
    const line = new RegExp(`^${key}=.*$`, "m")
    text = line.test(text) ? text.replace(line, `${key}=${value}`) : `${text.replace(/\n?$/, "\n")}${key}=${value}\n`
  }
  writeFileSync(ENV_FILE, text)
  console.log(`saved ${Object.keys(values).join(", ")} to apps/api/.env`)
}

if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE)
let relay: AgentRelay
if (process.env.RELAY_WORKSPACE_KEY) {
  const workspaceKey = process.env.RELAY_WORKSPACE_KEY
  const baseUrl = process.env.RELAY_BASE_URL || (workspaceKey.startsWith("ar_ws_") ? HOSTED : undefined)
  relay = new AgentRelay({ workspaceKey, ...(baseUrl ? { baseUrl } : {}) })
  console.log("using the workspace key already in apps/api/.env")
} else {
  // Same call `agent-relay init --hosted` makes, without touching any coding tool's settings.
  relay = await AgentRelay.createWorkspace({ name: "stampede", baseUrl: HOSTED }).catch(() =>
    AgentRelay.createWorkspace({ name: `stampede-${Date.now().toString(36)}`, baseUrl: HOSTED }),
  )
  if (!relay.workspaceKey) throw new Error("The hosted service did not return a workspace key")
  save({ RELAY_WORKSPACE_KEY: relay.workspaceKey, RELAY_BASE_URL: HOSTED }) // saved first, so a later failure can't lose it
  console.log("created hosted workspace")
}

const tokens: Record<string, string> = {}
for (const name of AGENTS) {
  try {
    const agent = await relay.workspace.register({ name, type: "agent" })
    if (!agent.token) throw new Error("no token returned")
    tokens[`RELAY_${name.toUpperCase()}_TOKEN`] = agent.token
    console.log(`registered ${name}`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.log(`skipped ${name}: ${/conflict|409/i.test(message) ? "already registered, keeping its existing token" : message}`)
  }
}
if (Object.keys(tokens).length) save(tokens)
