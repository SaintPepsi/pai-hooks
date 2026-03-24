#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { ExecutionEvidenceVerifier } from "@hooks/hooks/ExecutionEvidence/ExecutionEvidenceVerifier/ExecutionEvidenceVerifier.contract";

if (import.meta.main) {
  runHook(ExecutionEvidenceVerifier).catch(() => {
    process.exit(0);
  });
}
