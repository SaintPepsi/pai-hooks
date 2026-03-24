#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { SessionSummary } from "@hooks/hooks/WorkLifecycle/SessionSummary/SessionSummary.contract";

if (import.meta.main) {
  runHook(SessionSummary).catch((e) => {
    process.stderr.write(`[hook] fatal: ${e instanceof Error ? e.message : e}\n`);
    process.exit(0);
  });
}
