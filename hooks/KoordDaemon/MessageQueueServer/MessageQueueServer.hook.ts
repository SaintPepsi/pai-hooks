#!/usr/bin/env bun
/**
 * MessageQueueServer.hook.ts — Thin shim
 *
 * All business logic lives in MessageQueueServer.contract.ts.
 * Spawns message queue HTTP server on session start.
 */

import { runHook } from "@hooks/core/runner";
import { MessageQueueServer } from "@hooks/hooks/KoordDaemon/MessageQueueServer/MessageQueueServer.contract";

if (import.meta.main) {
  runHook(MessageQueueServer).catch((e) => {
    process.stderr.write(`[hook] fatal: ${e instanceof Error ? e.message : e}\n`);
    process.exit(0);
  });
}
