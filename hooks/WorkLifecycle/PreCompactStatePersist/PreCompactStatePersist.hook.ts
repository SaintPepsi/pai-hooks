#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { PreCompactStatePersist } from "@hooks/hooks/WorkLifecycle/PreCompactStatePersist/PreCompactStatePersist.contract";

if (import.meta.main) {
  runHook(PreCompactStatePersist).catch(() => {
    process.exit(0);
  });
}
