#!/usr/bin/env bash
# Starts the actors, the API and the web app. Ctrl-C stops all three.
# `scripts/dev.sh fake` runs the fake office instead of real Relay agents.
# ACTORS_DIR=services/actors scripts/dev.sh uses Kris's actor.
set -u
cd "$(dirname "$0")/.."
export PATH="$HOME/.bun/bin:$PATH"
ACTORS_DIR="${ACTORS_DIR:-services/dev-actor}"
mkdir -p .dev-logs
if [ "${1:-}" = "fake" ]; then export FAKE_OFFICE=1; fi

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

(cd "$ACTORS_DIR" && exec bunx durable-actors dev) > .dev-logs/actors.log 2>&1 &
pids+=($!)
wait_for actors 7100

(cd apps/api && exec node_modules/.bin/tsx --env-file-if-exists=.env src/server.ts) > .dev-logs/api.log 2>&1 &
pids+=($!)
wait_for api 8787

(cd apps/web && exec node_modules/.bin/vite --port 5173 --strictPort) > .dev-logs/web.log 2>&1 &
pids+=($!)
wait_for web 5173

echo "stamp is running at http://localhost:5173"
wait
