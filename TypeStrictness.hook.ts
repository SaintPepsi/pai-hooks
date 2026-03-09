#!/usr/bin/env bun
import { runHook } from "./core/runner";
import { TypeStrictness } from "./contracts/TypeStrictness";

if (import.meta.main) {
  runHook(TypeStrictness).catch(() => {
    process.exit(0);
  });
}
