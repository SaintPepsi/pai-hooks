#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { ProtectedBranchGuard } from "@hooks/hooks/GitSafety/ProtectedBranchGuard/ProtectedBranchGuard.contract";

if (import.meta.main) {
  runHook(ProtectedBranchGuard).catch(() => {
    process.exit(0);
  });
}
