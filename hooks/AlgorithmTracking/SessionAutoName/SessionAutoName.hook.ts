#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { SessionAutoName } from "@hooks/hooks/AlgorithmTracking/SessionAutoName/SessionAutoName.contract";

if (import.meta.main) {
  runHook(SessionAutoName).catch(() => {
    process.exit(0);
  });
}
