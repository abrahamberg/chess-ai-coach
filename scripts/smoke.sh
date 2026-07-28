#!/usr/bin/env bash
# Task 7.2 end-to-end smoke test: brings up the dev-parity compose stack with
# AUTH_MODE=dev-stub and LLM_FAKE=1, then exercises the real flow through the
# real services (no mocks except the LLM itself): import a PGN -> poll the
# analysis until it's ready -> create a coaching session.
#
# Usage: scripts/smoke.sh [--keep-up]
#   --keep-up   leave the compose stack running after the test (default: torn down)
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

API_URL="http://localhost:3000"
KEEP_UP=0
[[ "${1:-}" == "--keep-up" ]] && KEEP_UP=1

log() { echo "[smoke] $*"; }
fail() { echo "[smoke] FAIL: $*" >&2; exit 1; }

cleanup() {
  if [[ "$KEEP_UP" -eq 0 ]]; then
    log "tearing down compose stack"
    LLM_FAKE=1 AUTH_MODE=dev-stub docker compose down >/dev/null 2>&1 || true
  else
    log "leaving compose stack up (--keep-up)"
  fi
}
trap cleanup EXIT

log "starting postgres, engine, migrate, api, worker (LLM_FAKE=1, AUTH_MODE=dev-stub)"
LLM_FAKE=1 AUTH_MODE=dev-stub docker compose up -d --build postgres engine migrate api worker

log "waiting for api /readyz"
for _ in $(seq 1 60); do
  if curl -fsS "$API_URL/readyz" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
curl -fsS "$API_URL/readyz" >/dev/null || fail "api never became ready"
log "api is ready"

PGN='[Event "Smoke test"]
[White "daniel"]
[Black "Marta"]
[Result "1-0"]

1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0'

log "importing a PGN"
IMPORT_BODY=$(jq -n --arg pgn "$PGN" '{pgn: $pgn, source: "paste", userColor: "white"}')
IMPORT_RESPONSE=$(curl -fsS -X POST "$API_URL/api/games" \
  -H 'content-type: application/json' \
  -d "$IMPORT_BODY") || fail "POST /api/games failed"

GAME_ID=$(echo "$IMPORT_RESPONSE" | jq -r '.gameId')
[[ "$GAME_ID" != "null" && -n "$GAME_ID" ]] || fail "no gameId in import response: $IMPORT_RESPONSE"
log "imported game $GAME_ID"

log "polling analysis status until ready"
STATUS="queued"
for _ in $(seq 1 60); do
  GAME=$(curl -fsS "$API_URL/api/games/$GAME_ID") || fail "GET /api/games/$GAME_ID failed"
  STATUS=$(echo "$GAME" | jq -r '.analysisStatus')
  [[ "$STATUS" == "ready" ]] && break
  [[ "$STATUS" == "failed" ]] && fail "analysis failed: $GAME"
  sleep 1
done
[[ "$STATUS" == "ready" ]] || fail "analysis never became ready (last status: $STATUS)"
log "analysis is ready"

log "creating a coaching session"
SESSION_BODY=$(jq -n --arg gameId "$GAME_ID" '{gameId: $gameId}')
SESSION_RESPONSE=$(curl -fsS -X POST "$API_URL/api/sessions" \
  -H 'content-type: application/json' \
  -d "$SESSION_BODY") || fail "POST /api/sessions failed"

SESSION_ID=$(echo "$SESSION_RESPONSE" | jq -r '.id')
[[ "$SESSION_ID" != "null" && -n "$SESSION_ID" ]] || fail "no session id in response: $SESSION_RESPONSE"
log "created session $SESSION_ID"

MESSAGES=$(curl -fsS "$API_URL/api/sessions/$SESSION_ID" | jq '.messages | length')
[[ "$MESSAGES" -gt 0 ]] || fail "session has no opening message"
log "session has $MESSAGES message(s) — coach opener present"

log "sending a chat message to exercise the LLM_FAKE stream"
CHAT_BODY=$(jq -n '{content: "hi coach"}')
CHAT_RESPONSE=$(curl -fsS -X POST "$API_URL/api/sessions/$SESSION_ID/messages" \
  -H 'content-type: application/json' \
  -d "$CHAT_BODY") || fail "POST /api/sessions/$SESSION_ID/messages failed"
[[ -n "$CHAT_RESPONSE" ]] || fail "empty stream from LLM_FAKE session turn"
echo "$CHAT_RESPONSE" | grep -qi "canned" || fail "LLM_FAKE canned reply not found in stream: $CHAT_RESPONSE"
log "coach turn streamed the canned LLM_FAKE reply"

log "PASS: import -> analysis ready -> session created -> chat turn, end to end"
