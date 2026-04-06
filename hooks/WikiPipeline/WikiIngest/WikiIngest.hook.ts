#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { WikiIngest } from "@hooks/hooks/WikiPipeline/WikiIngest/WikiIngest.contract";

if (import.meta.main) {
  runHook(WikiIngest).catch((e) => {
    process.stderr.write(`[hook] fatal: ${e instanceof Error ? e.message : e}\n`);
    process.exit(0);
  });
}
