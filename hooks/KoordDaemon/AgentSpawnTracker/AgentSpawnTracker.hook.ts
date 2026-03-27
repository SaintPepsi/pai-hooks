#!/usr/bin/env bun
/**
 * AgentSpawnTracker.hook.ts — Thin shim
 *
 * All business logic lives in hooks/KoordDaemon/AgentSpawnTracker/AgentSpawnTracker.contract.ts.
 * Notifies the Koord daemon when a background agent is spawned.
 */

import { runHook } from "@hooks/core/runner";
import { AgentSpawnTracker } from "@hooks/hooks/KoordDaemon/AgentSpawnTracker/AgentSpawnTracker.contract";

if (import.meta.main) {
  runHook(AgentSpawnTracker).catch((e) => {
    process.stderr.write(`[hook] fatal: ${e instanceof Error ? e.message : e}\n`);
    process.exit(0);
  });
}
