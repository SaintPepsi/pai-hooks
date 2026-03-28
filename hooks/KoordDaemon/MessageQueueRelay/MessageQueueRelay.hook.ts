#!/usr/bin/env bun
/**
 * MessageQueueRelay.hook.ts — Thin shim
 *
 * All business logic lives in MessageQueueRelay.contract.ts.
 * Detects mq-watcher completion and relays messages to the agent.
 */

import { runHook } from "@hooks/core/runner";
import { MessageQueueRelay } from "@hooks/hooks/KoordDaemon/MessageQueueRelay/MessageQueueRelay.contract";

if (import.meta.main) {
  runHook(MessageQueueRelay).catch((e) => {
    process.stderr.write(`[hook] fatal: ${e instanceof Error ? e.message : e}\n`);
    process.exit(0);
  });
}
