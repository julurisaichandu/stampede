#!/usr/bin/env bash
# Runs stampede on one Linux server and restarts anything that exits.
# The public port is 5173.
set -u
cd "$(dirname "$0")/.."
export PATH="$HOME/.bun/bin:$PATH"
mkdir -p .dev-logs

# First boot only. Needs OPENAI_API_KEY in the environment. Relay gets its own workspace here.
if [ ! -f apps/api/.env ]; then
  secret=$(head -c 32 /dev/urandom | base64 | tr -d '/+=')
  printf 'OPENAI_API_KEY=%s\nDURABLE_ACTORS_SECRET=%s\n' "$OPENAI_API_KEY" "$secret" > apps/api/.env
  echo "DURABLE_ACTORS_SECRET=$secret" > services/actors/.env
  (cd apps/api && npm run -s relay:register)
fi

keep() {
  local name="$1" dir="$2"
  shift 2
  (cd "$dir" && while true; do "$@" >> "../../.dev-logs/$name.log" 2>&1; echo "$name exited" >> "../../.dev-logs/$name.log"; sleep 2; done) &
}

until_open() {
  for _ in $(seq 1 300); do
    (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null && return 0
    sleep 0.2
  done
  echo "port $1 did not open" >&2
  return 1
}

keep actors services/actors bunx durable-actors dev --no-watch
until_open 7100
keep api apps/api node_modules/.bin/tsx --env-file=.env src/server.ts
until_open 8787
keep agents apps/api node_modules/.bin/tsx --env-file=.env src/agents/index.ts
keep web apps/web node_modules/.bin/vite preview --host 0.0.0.0 --port 5173 --strictPort
wait
