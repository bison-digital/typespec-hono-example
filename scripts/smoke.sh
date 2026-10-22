#!/usr/bin/env bash
# **The worker, served, answering what a real client sends.** Generating, typechecking and bundling
# prove the output compiles; none of them sends a request. typespec-http-zod 0.31.0 compiled, typed
# and bundled here and refused every create body leaving out a server-assigned read-only id, which
# the OpenAPI 3.0 document this example publishes accepts. Each line below is one request and the
# status the document says it gets.
set -euo pipefail

port=8799
log="$(mktemp)"
WRANGLER_SEND_METRICS=false pnpm exec wrangler dev --port "$port" --ip 127.0.0.1 > "$log" 2>&1 &
server=$!
trap 'kill "$server" 2>/dev/null || true' EXIT
for _ in $(seq 1 90); do
  grep -q "Ready on" "$log" && break
  kill -0 "$server" 2>/dev/null || { cat "$log"; exit 1; }
  sleep 1
done
grep -q "Ready on" "$log" || { cat "$log"; exit 1; }

base="http://127.0.0.1:$port/api/v1"
failed=0
expect() {
  local want="$1" label="$2"
  shift 2
  local body status
  body="$(mktemp)"
  status="$(curl -s -o "$body" -w '%{http_code}' "$@")"
  if [ "$status" = "$want" ]; then
    echo "ok   $status $label"
  else
    echo "FAIL $status (wanted $want) $label: $(cat "$body")"
    failed=1
  fi
}

auth=(-H "authorization: Bearer smoke" -H "content-type: application/json")
expect 200 "GET /health" "$base/health"
expect 201 "POST /payees without its read-only id" -X POST "${auth[@]}" --data '{"name":"Rent"}' "$base/payees"
expect 400 "POST /payees without its name" -X POST "${auth[@]}" --data '{}' "$base/payees"
expect 400 "POST /payees naming the prototype" -X POST "${auth[@]}" --data '{"__proto__":{},"name":"Rent"}' "$base/payees"
expect 401 "POST /payees with no credentials" -X POST -H "content-type: application/json" --data '{"name":"Rent"}' "$base/payees"
exit "$failed"
