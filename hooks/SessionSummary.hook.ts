#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { SessionSummary } from "@hooks/contracts/SessionSummary";

if (import.meta.main) {
  runHook(SessionSummary).catch(() => {
    process.exit(0);
  });
}
