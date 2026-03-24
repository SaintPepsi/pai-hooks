#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { ExecutionEvidenceVerifier } from "@hooks/hooks/ExecutionEvidence/ExecutionEvidenceVerifier/ExecutionEvidenceVerifier.contract";

if (import.meta.main) {
  runHook(ExecutionEvidenceVerifier).catch((e) => {
    process.stderr.write(`[hook] fatal: ${e instanceof Error ? e.message : e}\n`);
    process.exit(0);
  });
}
