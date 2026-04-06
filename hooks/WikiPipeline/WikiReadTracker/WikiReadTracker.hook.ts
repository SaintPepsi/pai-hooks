#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { WikiReadTracker } from "@hooks/hooks/WikiPipeline/WikiReadTracker/WikiReadTracker.contract";

if (import.meta.main) {
  runHook(WikiReadTracker).catch((e) => {
    process.stderr.write(`[hook] fatal: ${e instanceof Error ? e.message : e}\n`);
    process.exit(0);
  });
}
