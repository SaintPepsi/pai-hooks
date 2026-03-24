#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { ProtectedBranchGuard } from "@hooks/hooks/GitSafety/ProtectedBranchGuard/ProtectedBranchGuard.contract";

if (import.meta.main) {
  runHook(ProtectedBranchGuard).catch((e) => {
    process.stderr.write(`[hook] fatal: ${e instanceof Error ? e.message : e}\n`);
    process.exit(0);
  });
}
