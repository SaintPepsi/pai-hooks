#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { ExecutionEvidenceVerifier } from "@hooks/contracts/ExecutionEvidenceVerifier";

if (import.meta.main) {
  runHook(ExecutionEvidenceVerifier).catch(() => {
    process.exit(0);
  });
}
