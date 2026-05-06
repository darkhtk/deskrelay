#!/usr/bin/env bash
# verify-g-hook.sh — drives the PreToolUse approval round-trip end-to-end:
#   subscribe SSE → simulate (creates pending) → extract id → respond
#   with allow → original simulate returns the decision.

set -uo pipefail
: "${SITE:?SITE is required, e.g. http://127.0.0.1:8787}"
TOKEN="${SITE_TOKEN:-$(cat /tmp/c5-token 2>/dev/null)}"
DEVICE_ID="${DEVICE_ID:?DEVICE_ID is required}"
SPACE="claude.approvals:default"
SPACE_ENC=$(printf '%s' "$SPACE" | python -c 'import urllib.parse,sys; print(urllib.parse.quote(sys.stdin.read()))')

OUT_DIR="$(mktemp -d)"
trap 'rm -rf "$OUT_DIR"; jobs -p | xargs -r kill 2>/dev/null' EXIT

echo "1. opening SSE subscription..."
curl -sN --max-time 30 \
  "$SITE/api/devices/$DEVICE_ID/events/spaces/$SPACE_ENC/stream" \
  -H "Authorization: Bearer $TOKEN" -H "Accept: text/event-stream" \
  > "$OUT_DIR/sse.log" 2>&1 &
SSE_PID=$!
sleep 1

echo "2. firing simulate-approval (waits for decision)..."
SIM_OUT="$OUT_DIR/sim.log"
curl -s --max-time 10 -X POST \
  "$SITE/api/devices/$DEVICE_ID/approvals/simulate" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"tool_name":"Bash","tool_input":{"command":"echo hi"},"session_id":"verify"}' \
  > "$SIM_OUT" 2>&1 &
SIM_PID=$!

echo "3. waiting for pending event in SSE..."
APPROVAL_ID=""
for _ in 1 2 3 4 5 6 7 8 9 10; do
  sleep 0.5
  APPROVAL_ID=$(grep -oE '"id":"apr_[A-Za-z0-9_]+' "$OUT_DIR/sse.log" | head -1 | cut -d'"' -f4)
  if [[ -n "$APPROVAL_ID" ]]; then break; fi
done
if [[ -z "$APPROVAL_ID" ]]; then
  echo "❌ no pending event arrived"; cat "$OUT_DIR/sse.log"; exit 1
fi
echo "   got approval id: $APPROVAL_ID"

echo "4. posting allow response..."
RESP_OUT=$(curl -s -X POST \
  "$SITE/api/devices/$DEVICE_ID/approvals/respond" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"id\":\"$APPROVAL_ID\",\"decision\":\"allow\"}")
echo "   respond → $RESP_OUT"

echo "5. waiting for simulate to return..."
wait $SIM_PID 2>/dev/null
SIM_BODY=$(cat "$SIM_OUT")
echo "   simulate body → $SIM_BODY"

if echo "$SIM_BODY" | grep -q '"decision":"approve"'; then
  echo "✅ end-to-end approve flow verified"
elif echo "$SIM_BODY" | grep -q '"continue":true'; then
  echo "✅ end-to-end approve flow verified (continue=true)"
else
  echo "❌ unexpected simulate response"; exit 1
fi
