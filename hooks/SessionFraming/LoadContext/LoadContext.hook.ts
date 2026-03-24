#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { LoadContext } from "@hooks/hooks/SessionFraming/LoadContext/LoadContext.contract";

if (import.meta.main) {
  runHook(LoadContext).catch((e) => {
    process.stderr.write(`[hook] fatal: ${e instanceof Error ? e.message : e}\n`);
    process.exit(0);
  });
}
