// Loads apps/api/.env before anything reads it. Import this first in every agent entrypoint (Node does not load .env).
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"

const file = fileURLToPath(new URL("../../.env", import.meta.url))
if (existsSync(file)) process.loadEnvFile(file)
