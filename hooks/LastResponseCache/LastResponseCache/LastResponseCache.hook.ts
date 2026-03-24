#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { LastResponseCache } from "@hooks/hooks/LastResponseCache/LastResponseCache/LastResponseCache.contract";

if (import.meta.main) {
  runHook(LastResponseCache).catch((e) => {
    process.stderr.write(`[hook] fatal: ${e instanceof Error ? e.message : e}\n`);
    process.exit(0);
  });
}
