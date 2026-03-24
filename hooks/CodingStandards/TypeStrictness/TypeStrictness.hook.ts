#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { TypeStrictness } from "@hooks/hooks/CodingStandards/TypeStrictness/TypeStrictness.contract";

if (import.meta.main) {
  runHook(TypeStrictness).catch((e) => {
    process.stderr.write(`[hook] fatal: ${e instanceof Error ? e.message : e}\n`);
    process.exit(0);
  });
}
