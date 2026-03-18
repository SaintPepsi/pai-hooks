#!/usr/bin/env bun
/**
 * AgentTrackerPost.hook.ts — Thin shim
 *
 * All business logic lives in contracts/AgentTracker.ts.
 * Decrements active agent count when Agent (Task) tool completes.
 */

import { runHook } from "@hooks/core/runner";
import { AgentTrackerPost } from "@hooks/contracts/AgentTracker";

if (import.meta.main) {
  runHook(AgentTrackerPost).catch(() => {
    process.exit(0);
  });
}
