#!/usr/bin/env bun
import { runHook } from "./core/runner";
import { IntegrityCheck } from "./contracts/IntegrityCheck";

if (import.meta.main) {
  runHook(IntegrityCheck).catch(() => {
    process.exit(0);
  });
}
