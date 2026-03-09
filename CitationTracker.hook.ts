#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { CitationTracker } from "@hooks/contracts/CitationEnforcement";

if (import.meta.main) {
  runHook(CitationTracker).catch(() => {
    process.exit(0);
  });
}
