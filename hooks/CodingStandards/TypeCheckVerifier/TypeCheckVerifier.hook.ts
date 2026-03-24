#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { TypeCheckVerifier } from "@hooks/hooks/CodingStandards/TypeCheckVerifier/TypeCheckVerifier.contract";

if (import.meta.main) {
  runHook(TypeCheckVerifier).catch(() => {
    process.exit(0);
  });
}
