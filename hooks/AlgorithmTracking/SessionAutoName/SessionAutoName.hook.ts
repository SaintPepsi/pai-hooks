#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { SessionAutoName } from "@hooks/contracts/SessionAutoName";

if (import.meta.main) {
  runHook(SessionAutoName).catch(() => {
    process.exit(0);
  });
}
