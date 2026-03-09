#!/usr/bin/env bun
/**
 * VoiceGate.hook.ts — Thin shim (SOLID+ROP migration)
 *
 * All business logic lives in contracts/VoiceGate.ts.
 * This file is the hook entry point that settings.json references.
 */

import { runHook } from "./core/runner";
import { VoiceGate } from "./contracts/VoiceGate";

if (import.meta.main) {
  runHook(VoiceGate).catch(() => {

    process.exit(0);
  });
}
