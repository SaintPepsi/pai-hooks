/**
 * StopOrchestrator Contract — Single entry point for Stop event handlers.
 *
 * Reads and parses the transcript ONCE, then distributes to handlers:
 * - VoiceNotification, RebuildSkill, AlgorithmEnrichment
 *
 * Voice only fires for main terminal sessions (not subagents).
 */

import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import type { AsyncHookContract } from "@hooks/core/contract";
import type { ResultError } from "@hooks/core/error";
import { ok, type Result } from "@hooks/core/result";
import type { StopInput } from "@hooks/core/types/hook-inputs";
import { handleAlgorithmEnrichment } from "@hooks/handlers/AlgorithmEnrichment";
import { handleRebuildSkill } from "@hooks/handlers/RebuildSkill";
import { handleVoice } from "@hooks/handlers/VoiceNotification";
import { defaultStderr, getPaiDir } from "@hooks/lib/paths";
import { parseTranscript } from "@pai/Tools/TranscriptParser";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface StopOrchestratorDeps {
  parseTranscript: typeof parseTranscript;
  handleVoice: typeof handleVoice;
  handleRebuildSkill: typeof handleRebuildSkill;
  handleAlgorithmEnrichment: typeof handleAlgorithmEnrichment;
  isMainSession: (sessionId: string) => boolean;
  delay: (ms: number) => Promise<void>;
  baseDir: string;
  stderr: (msg: string) => void;
}

// ─── Contract ────────────────────────────────────────────────────────────────

const defaultDeps: StopOrchestratorDeps = {
  parseTranscript,
  handleVoice,
  handleRebuildSkill,
  handleAlgorithmEnrichment,
  isMainSession: () => true,
  delay: (ms) => new Promise((r) => setTimeout(r, ms)),
  baseDir: getPaiDir(),
  stderr: defaultStderr,
};

export const StopOrchestrator: AsyncHookContract<StopInput, StopOrchestratorDeps> = {
  name: "StopOrchestrator",
  event: "Stop",

  accepts(input: StopInput): boolean {
    return !!input.transcript_path;
  },

  async execute(
    input: StopInput,
    deps: StopOrchestratorDeps,
  ): Promise<Result<SyncHookJSONOutput, ResultError>> {
    // Wait for transcript to be fully written
    await deps.delay(150);

    const parsed = deps.parseTranscript(input.transcript_path!);
    const voiceEnabled = deps.isMainSession(input.session_id);

    if (voiceEnabled) {
      deps.stderr(
        `[StopOrchestrator] Voice ON (main session): ${parsed.plainCompletion.slice(0, 50)}...`,
      );
    } else {
      deps.stderr("[StopOrchestrator] Voice OFF (not main session)");
    }

    const handlers: Promise<void>[] = [
      deps.handleRebuildSkill(),
      deps.handleAlgorithmEnrichment(parsed, input.session_id),
    ];
    const handlerNames = ["RebuildSkill", "AlgorithmEnrichment"];

    if (voiceEnabled) {
      handlers.unshift(deps.handleVoice(parsed, input.session_id));
      handlerNames.unshift("Voice");
    }

    const results = await Promise.allSettled(handlers);

    results.forEach((result, index) => {
      if (result.status === "rejected") {
        deps.stderr(`[StopOrchestrator] ${handlerNames[index]} handler failed: ${result.reason}`);
      }
    });

    return ok({});
  },

  defaultDeps,
};
