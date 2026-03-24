#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { TypeCheckVerifier } from "@hooks/hooks/CodingStandards/TypeCheckVerifier/TypeCheckVerifier.contract";

if (import.meta.main) {
  runHook(TypeCheckVerifier).catch((e) => {
    process.stderr.write(`[hook] fatal: ${e instanceof Error ? e.message : e}\n`);
    process.exit(0);
  });
}
