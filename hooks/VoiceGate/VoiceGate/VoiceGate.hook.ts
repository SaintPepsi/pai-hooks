#!/usr/bin/env bun
/**
 * VoiceGate.hook.ts — Thin shim (SOLID+ROP migration)
 *
 * All business logic lives in contracts/VoiceGate.ts.
 * This file is the hook entry point that settings.json references.
 */

import { runHook } from "@hooks/core/runner";
import { VoiceGate } from "@hooks/hooks/VoiceGate/VoiceGate/VoiceGate.contract";

if (import.meta.main) {
  runHook(VoiceGate).catch(() => {

    process.exit(0);
  });
}
