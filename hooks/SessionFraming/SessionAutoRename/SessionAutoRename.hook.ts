#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { SessionAutoRename } from "@hooks/hooks/SessionFraming/SessionAutoRename/SessionAutoRename.contract";

if (import.meta.main) {
  runHook(SessionAutoRename).catch((e) => {
    process.stderr.write(`[hook] fatal: ${e instanceof Error ? e.message : e}\n`);
    process.exit(0);
  });
}
