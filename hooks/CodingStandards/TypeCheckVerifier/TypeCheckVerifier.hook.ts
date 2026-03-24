#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { TypeCheckVerifier } from "@hooks/contracts/TypeCheckVerifier";

if (import.meta.main) {
  runHook(TypeCheckVerifier).catch(() => {
    process.exit(0);
  });
}
