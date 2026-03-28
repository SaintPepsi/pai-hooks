# MessageQueue Hook — Manual Test Plan

## Prerequisites

- `bun` installed
- Repo cloned with dependencies installed (`bun install`)
- A terminal with at least 3 tabs/panes (server, watcher, curl)

---

## Test 1: Server Standalone — Start & Health Check

**Steps:**
```bash
# Terminal 1: Start the server
bun scripts/mq-server.ts --session test-manual-001

# Terminal 2: Verify
cat /tmp/pai-mq/test-manual-001/port        # Should print a port number
cat /tmp/pai-mq/test-manual-001/pid          # Should print a PID
curl http://localhost:$(cat /tmp/pai-mq/test-manual-001/port)/health
```

**Expected:**
- Server prints `[mq-server] Listening on port XXXXX for session test-man...`
- `/health` returns `ok` with status 200
- `port` and `pid` files exist

**Cleanup:** `kill $(cat /tmp/pai-mq/test-manual-001/pid); rm -rf /tmp/pai-mq/test-manual-001`

---

## Test 2: Server — POST /message & Queue Layout

**Steps:**
```bash
# Terminal 1: Start server
bun scripts/mq-server.ts --session test-manual-002

# Terminal 2: Post messages
PORT=$(cat /tmp/pai-mq/test-manual-002/port)

curl -X POST http://localhost:$PORT/message \
  -H "Content-Type: application/json" \
  -d '{"from":"koord-daemon","body":"Deploy to staging"}'

curl -X POST http://localhost:$PORT/message \
  -H "Content-Type: application/json" \
  -d '{"from":"user","body":"Run the full test suite"}'

# Verify queue files
cat /tmp/pai-mq/test-manual-002/messages/0.json
cat /tmp/pai-mq/test-manual-002/messages/1.json

# Check status endpoint
curl http://localhost:$PORT/status
```

**Expected:**
- First POST returns `{"queued":true,"index":0}`
- Second POST returns `{"queued":true,"index":1}`
- `0.json` contains `{"index":0,"ts":"...","from":"koord-daemon","body":"Deploy to staging"}`
- `1.json` contains `{"index":1,"ts":"...","from":"user","body":"Run the full test suite"}`
- `/status` returns `{"messageCount":2,"cursor":0,"pending":2}`

**Cleanup:** `kill $(cat /tmp/pai-mq/test-manual-002/pid); rm -rf /tmp/pai-mq/test-manual-002`

---

## Test 3: Server — Invalid JSON Body

**Steps:**
```bash
PORT=$(cat /tmp/pai-mq/test-manual-002/port)
curl -X POST http://localhost:$PORT/message \
  -H "Content-Type: application/json" \
  -d 'not json at all'
```

**Expected:**
- Returns 400 with `{"error":"invalid JSON body"}`
- No file created in `messages/`

---

## Test 4: Watcher — Blocks Until Message Arrives

**Steps:**
```bash
# Terminal 1: Start server
bun scripts/mq-server.ts --session test-manual-003

# Terminal 2: Start watcher (will block)
bun scripts/mq-watcher.ts --session test-manual-003

# Terminal 3: Wait 3 seconds, then post a message
sleep 3
PORT=$(cat /tmp/pai-mq/test-manual-003/port)
curl -X POST http://localhost:$PORT/message \
  -H "Content-Type: application/json" \
  -d '{"from":"koord","body":"Hello from the daemon!"}'
```

**Expected:**
- Terminal 2 prints `[mq-watcher] Watching for message 0 (session test-man...)`
- Terminal 2 blocks for ~3 seconds
- After the POST, Terminal 2 immediately outputs the message JSON to stdout and exits 0
- `cursor` file now contains `1`

**Verify:** `cat /tmp/pai-mq/test-manual-003/cursor` → `1`

**Cleanup:** `kill $(cat /tmp/pai-mq/test-manual-003/pid); rm -rf /tmp/pai-mq/test-manual-003`

---

## Test 5: Watcher — Cursor Advances Across Multiple Runs

**Steps:**
```bash
# Terminal 1: Start server
bun scripts/mq-server.ts --session test-manual-004
PORT=$(cat /tmp/pai-mq/test-manual-004/port)

# Pre-queue 3 messages
curl -s -X POST http://localhost:$PORT/message -H "Content-Type: application/json" -d '{"body":"msg-0"}'
curl -s -X POST http://localhost:$PORT/message -H "Content-Type: application/json" -d '{"body":"msg-1"}'
curl -s -X POST http://localhost:$PORT/message -H "Content-Type: application/json" -d '{"body":"msg-2"}'

# Terminal 2: Run watcher 3 times sequentially
bun scripts/mq-watcher.ts --session test-manual-004
echo "---"
bun scripts/mq-watcher.ts --session test-manual-004
echo "---"
bun scripts/mq-watcher.ts --session test-manual-004
```

**Expected:**
- First run outputs `msg-0`, exits 0, cursor → 1
- Second run outputs `msg-1`, exits 0, cursor → 2
- Third run outputs `msg-2`, exits 0, cursor → 3

**Cleanup:** `kill $(cat /tmp/pai-mq/test-manual-004/pid); rm -rf /tmp/pai-mq/test-manual-004`

---

## Test 6: Watcher — Timeout with No Messages

**Steps:**
```bash
# Start watcher with short timeout (no server, no messages)
bun scripts/mq-watcher.ts --session test-manual-005 --timeout 3
echo "Exit code: $?"
```

**Expected:**
- Watcher prints `[mq-watcher] Watching for message 0 ...`
- After ~3 seconds, prints `[mq-watcher] Timeout after 3s — no message`
- Exit code: `1`

**Cleanup:** `rm -rf /tmp/pai-mq/test-manual-005`

---

## Test 7: Watcher — Missing --session Flag

**Steps:**
```bash
bun scripts/mq-watcher.ts
echo "Exit code: $?"
```

**Expected:**
- Prints `[mq-watcher] --session <session_id> is required`
- Exit code: `2`

---

## Test 8: Server — Missing --session Flag

**Steps:**
```bash
bun scripts/mq-server.ts
echo "Exit code: $?"
```

**Expected:**
- Prints `[mq-server] --session <session_id> is required`
- Exit code: `1`

---

## Test 9: Full Loop Simulation (Server → Watcher → Relay)

This simulates the real Claude Code loop without needing an active session.

**Steps:**
```bash
# Terminal 1: Start server
bun scripts/mq-server.ts --session loop-test-001

# Terminal 2: Simulate the loop
PORT=$(cat /tmp/pai-mq/loop-test-001/port)

for i in 1 2 3; do
  echo "=== Loop iteration $i ==="

  # Start watcher in background, capture output
  bun scripts/mq-watcher.ts --session loop-test-001 --timeout 10 > /tmp/mq-output.txt &
  WATCHER_PID=$!

  # Simulate Koord daemon pushing a message after 1 second
  sleep 1
  curl -s -X POST http://localhost:$PORT/message \
    -H "Content-Type: application/json" \
    -d "{\"from\":\"koord\",\"body\":\"Task $i: check status\"}"

  # Wait for watcher to exit
  wait $WATCHER_PID
  echo "Watcher exit code: $?"

  # Show what the agent would see
  echo "Message received:"
  cat /tmp/mq-output.txt
  echo ""
done
```

**Expected:**
- Each iteration: watcher blocks → message arrives → watcher exits 0
- Output shows incrementing message indices (0, 1, 2)
- Each message body matches what was POSTed
- Cursor file increments: 1, 2, 3

**Cleanup:** `kill $(cat /tmp/pai-mq/loop-test-001/pid); rm -rf /tmp/pai-mq/loop-test-001 /tmp/mq-output.txt`

---

## Test 10: MessageQueueServer Hook — Contract Tests via `bun test`

**Steps:**
```bash
bun test hooks/KoordDaemon/MessageQueue.test.ts
```

**Expected:**
- 21 tests pass, 0 failures
- Covers: path helpers, server activation gates, relay detection, message parsing, timeout handling, respawn directives

---

## Test 11: MessageQueueRelay Hook — Simulated PostToolUse Input

Manually run the hook shim with mocked stdin to verify output format.

**Steps:**
```bash
# Simulate a watcher Bash command completing with a message
echo '{"session_id":"test-session","tool_name":"Bash","tool_input":{"command":"bun scripts/mq-watcher.ts --session test-session"},"tool_response":"{\"from\":\"koord\",\"body\":\"Please review PR #42\"}"}' \
  | bun hooks/KoordDaemon/MessageQueueRelay/MessageQueueRelay.hook.ts
```

**Expected:**
- Stdout contains JSON with `hookSpecificOutput.additionalContext` including:
  - "New Message Received"
  - "Please review PR #42"
  - "from koord"
  - Respawn directive with `--session test-session`

---

## Test 12: MessageQueueRelay — Non-Watcher Bash Passthrough

**Steps:**
```bash
echo '{"session_id":"test","tool_name":"Bash","tool_input":{"command":"ls -la"},"tool_response":"total 0"}' \
  | bun hooks/KoordDaemon/MessageQueueRelay/MessageQueueRelay.hook.ts
```

**Expected:**
- Stdout: `{"continue":true}` (no additional context injected)

---

## Test 13: No Regressions

**Steps:**
```bash
bun test hooks/KoordDaemon/
```

**Expected:**
- 72 tests pass across all 3 test files (existing + new)
- 0 failures
- Existing SessionIdRegister, AgentSpawnTracker, AgentCompleteTracker, AgentPrepromptInjector tests unaffected

---

## Edge Cases to Verify

| # | Scenario | Expected |
|---|----------|----------|
| E1 | Two watchers for same session simultaneously | Both poll, first one to grab cursor wins, second blocks until next message |
| E2 | Server killed while watcher running | Watcher continues polling disk — existing queued messages still delivered |
| E3 | Message posted before watcher starts | Watcher picks up message immediately on start (cursor 0 → file 0.json exists) |
| E4 | Very large message body (>1MB) | Server writes it, watcher reads and outputs it — no truncation |
| E5 | Queue dir deleted mid-session | Watcher recreates `messages/` dir via `mkdirSync({recursive: true})`, resumes polling |
