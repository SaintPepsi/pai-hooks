/**
 * IntegrityCheck Contract — System and doc cross-ref integrity at session end.
 *
 * Parses the transcript once, then distributes to two independent handlers:
 * 1. System integrity — detects PAI system file changes
 * 2. Doc cross-ref integrity — detects authoritative doc drift
 */

import type { HookContract } from "../core/contract";
import type { SessionEndInput } from "../core/types/hook-inputs";
import type { SilentOutput } from "../core/types/hook-outputs";
import { ok, type Result } from "../core/result";
import type { PaiError } from "../core/error";
import { parseTranscript } from "../../PAI/Tools/TranscriptParser";
import { handleSystemIntegrity } from "../handlers/SystemIntegrity";
import { handleDocCrossRefIntegrity } from "../handlers/DocCrossRefIntegrity";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface IntegrityCheckDeps {
  parseTranscript: typeof parseTranscript;
  handleSystemIntegrity: typeof handleSystemIntegrity;
  handleDocCrossRefIntegrity: typeof handleDocCrossRefIntegrity;
  stderr: (msg: string) => void;
}

// ─── Contract ────────────────────────────────────────────────────────────────

const defaultDeps: IntegrityCheckDeps = {
  parseTranscript,
  handleSystemIntegrity,
  handleDocCrossRefIntegrity,
  stderr: (msg) => process.stderr.write(msg + "\n"),
};

export const IntegrityCheck: HookContract<
  SessionEndInput,
  SilentOutput,
  IntegrityCheckDeps
> = {
  name: "IntegrityCheck",
  event: "SessionEnd",

  accepts(input: SessionEndInput): boolean {
    return !!input.transcript_path;
  },

  async execute(
    input: SessionEndInput,
    deps: IntegrityCheckDeps,
  ): Promise<Result<SilentOutput, PaiError>> {
    const parsed = deps.parseTranscript(input.transcript_path!);

    const results = await Promise.allSettled([
      deps.handleSystemIntegrity(parsed, input as any),
      deps.handleDocCrossRefIntegrity(parsed, input as any),
    ]);

    for (const r of results) {
      if (r.status === "rejected") {
        deps.stderr(`[IntegrityCheck] Handler failed: ${r.reason}`);
      }
    }

    return ok({ type: "silent" });
  },

  defaultDeps,
};
