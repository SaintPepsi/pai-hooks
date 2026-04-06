#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { WikiContextInjector } from "@hooks/hooks/WikiPipeline/WikiContextInjector/WikiContextInjector.contract";

if (import.meta.main) {
  runHook(WikiContextInjector).catch((e) => {
    process.stderr.write(`[hook] fatal: ${e instanceof Error ? e.message : e}\n`);
    process.exit(0);
  });
}
