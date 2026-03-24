#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { CheckVersion } from "@hooks/hooks/SessionFraming/CheckVersion/CheckVersion.contract";

if (import.meta.main) {
  runHook(CheckVersion).catch((e) => {
    process.stderr.write(`[hook] fatal: ${e instanceof Error ? e.message : e}\n`);
    process.exit(0);
  });
}
