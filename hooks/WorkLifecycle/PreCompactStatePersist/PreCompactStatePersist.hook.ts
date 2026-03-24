#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { PreCompactStatePersist } from "@hooks/hooks/WorkLifecycle/PreCompactStatePersist/PreCompactStatePersist.contract";

if (import.meta.main) {
  runHook(PreCompactStatePersist).catch((e) => {
    process.stderr.write(`[hook] fatal: ${e instanceof Error ? e.message : e}\n`);
    process.exit(0);
  });
}
