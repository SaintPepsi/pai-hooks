#!/usr/bin/env bun
import { runHook } from "./core/runner";
import { SessionSummary } from "./contracts/SessionSummary";

if (import.meta.main) {
  runHook(SessionSummary).catch(() => {
    process.exit(0);
  });
}
