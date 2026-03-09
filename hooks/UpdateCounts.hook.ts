#!/usr/bin/env bun
import { runHook } from "./core/runner";
import { UpdateCounts } from "./contracts/UpdateCounts";

if (import.meta.main) {
  runHook(UpdateCounts).catch(() => {
    process.exit(0);
  });
}
