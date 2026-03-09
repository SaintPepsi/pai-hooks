#!/usr/bin/env bun
/**
 * HookExecutePermission.hook.ts — Thin shim (SOLID+ROP migration)
 *
 * All business logic lives in contracts/HookExecutePermission.ts.
 * This file is the hook entry point that settings.json references.
 */

import { runHook } from "./core/runner";
import { HookExecutePermission } from "./contracts/HookExecutePermission";

if (import.meta.main) {
  runHook(HookExecutePermission).catch(() => {

    process.exit(0);
  });
}
