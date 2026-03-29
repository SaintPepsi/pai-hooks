#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { IssueCreateGate } from "@hooks/hooks/GitSafety/IssueCreateGate/IssueCreateGate.contract";

if (import.meta.main) {
  runHook(IssueCreateGate).catch((e) => {
    process.stderr.write(`[hook] fatal: ${e instanceof Error ? e.message : e}\n`);
    process.exit(0);
  });
}
