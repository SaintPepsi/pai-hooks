#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { ProtectedBranchGuard } from "@hooks/contracts/ProtectedBranchGuard";

if (import.meta.main) {
  runHook(ProtectedBranchGuard).catch(() => {
    process.exit(0);
  });
}
