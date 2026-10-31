#!/usr/bin/env bash
# Starts the actors, the API and the web app. Ctrl-C stops all three.
# `scripts/dev.sh` runs the office agents on Agent Relay. Needs the RELAY_ keys in apps/api/.env.
# `scripts/dev.sh local` runs the same agents inside the API, with no Relay keys.
set -u
cd "$(dirname "$0")/.."
export PATH="$HOME/.bun/bin:$PATH"
mkdir -p .dev-logs
if [ "${1:-}" = "local" ]; then
  export OFFICE_LOCAL=1
elif ! grep -q '^RELAY_WORKSPACE_KEY=.' apps/api/.env 2>/dev/null; then
  echo "No Relay keys in apps/api/.env. Run scripts/dev.sh local, or (cd apps/api && npm run relay:register)." >&2
  exit 1
fi

for port in 7100 8787 5173; do
  if nc -z localhost "$port" 2>/dev/null; then
    echo "Port $port is already in use. Stop that process first." >&2
    exit 1
  fi
done

pids=()
stop() {
  if [ ${#pids[@]} -gt 0 ]; then kill "${pids[@]}" 2>/dev/null; fi
  wait 2>/dev/null
}
trap stop EXIT
trap 'exit 0' INT TERM

wait_for() {
  local name="$1" port="$2"
  for _ in $(seq 1 150); do
    if nc -z localhost "$port" 2>/dev/null; then
      echo "  $name ready on $port"
      return 0
    fi
    sleep 0.2
  done
  echo "$name did not start. See .dev-logs/$name.log" >&2
  exit 1
}

(cd services/actors && exec bunx durable-actors dev) > .dev-logs/actors.log 2>&1 &
pids+=($!)
wait_for actors 7100

(cd apps/api && exec node_modules/.bin/tsx --env-file-if-exists=.env src/server.ts) > .dev-logs/api.log 2>&1 &
pids+=($!)
wait_for api 8787

if [ -z "${OFFICE_LOCAL:-}" ]; then
  (cd apps/api && exec node_modules/.bin/tsx --env-file-if-exists=.env src/agents/index.ts) > .dev-logs/agents.log 2>&1 &
  pids+=($!)
fi

(cd apps/web && exec node_modules/.bin/vite --port 5173 --strictPort) > .dev-logs/web.log 2>&1 &
pids+=($!)
wait_for web 5173

echo "stamp is running at http://localhost:5173"
wait
