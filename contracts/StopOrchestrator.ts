/**
 * StopOrchestrator Contract — Single entry point for Stop event handlers.
 *
 * Reads and parses the transcript ONCE, then distributes to handlers:
 * - VoiceNotification, TabState, RebuildSkill, AlgorithmEnrichment
 *
 * Voice only fires for main terminal sessions (not subagents).
 */

import type { HookContract } from "@hooks/core/contract";
import type { StopInput } from "@hooks/core/types/hook-inputs";
import type { SilentOutput } from "@hooks/core/types/hook-outputs";
import { ok, type Result } from "@hooks/core/result";
import type { PaiError } from "@hooks/core/error";
import { parseTranscript } from "@pai/Tools/TranscriptParser";
import { handleVoice } from "@hooks/handlers/VoiceNotification";
import { handleTabState } from "@hooks/handlers/TabState";
import { handleRebuildSkill } from "@hooks/handlers/RebuildSkill";
import { handleAlgorithmEnrichment } from "@hooks/handlers/AlgorithmEnrichment";
import { fileExists } from "@hooks/core/adapters/fs";
import { join } from "path";
import { homedir } from "os";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface StopOrchestratorDeps {
  parseTranscript: typeof parseTranscript;
  handleVoice: typeof handleVoice;
  handleTabState: typeof handleTabState;
  handleRebuildSkill: typeof handleRebuildSkill;
  handleAlgorithmEnrichment: typeof handleAlgorithmEnrichment;
  isMainSession: (sessionId: string) => boolean;
  delay: (ms: number) => Promise<void>;
  stderr: (msg: string) => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function defaultIsMainSession(sessionId: string): boolean {
  const paiDir = process.env.PAI_DIR || join(homedir(), ".claude");
  const kittySessionsDir = join(paiDir, "MEMORY", "STATE", "kitty-sessions");
  if (!fileExists(kittySessionsDir)) return true;
  return fileExists(join(kittySessionsDir, `${sessionId}.json`));
}

// ─── Contract ────────────────────────────────────────────────────────────────

const defaultDeps: StopOrchestratorDeps = {
  parseTranscript,
  handleVoice,
  handleTabState,
  handleRebuildSkill,
  handleAlgorithmEnrichment,
  isMainSession: defaultIsMainSession,
  delay: (ms) => new Promise((r) => setTimeout(r, ms)),
  stderr: (msg) => process.stderr.write(msg + "\n"),
};

export const StopOrchestrator: HookContract<
  StopInput,
  SilentOutput,
  StopOrchestratorDeps
> = {
  name: "StopOrchestrator",
  event: "Stop",

  accepts(input: StopInput): boolean {
    return !!input.transcript_path;
  },

  async execute(
    input: StopInput,
    deps: StopOrchestratorDeps,
  ): Promise<Result<SilentOutput, PaiError>> {
    // Wait for transcript to be fully written
    await deps.delay(150);

    const parsed = deps.parseTranscript(input.transcript_path!);
    const voiceEnabled = deps.isMainSession(input.session_id);

    if (voiceEnabled) {
      deps.stderr(`[StopOrchestrator] Voice ON (main session): ${parsed.plainCompletion.slice(0, 50)}...`);
    } else {
      deps.stderr("[StopOrchestrator] Voice OFF (not main session)");
    }

    const handlers: Promise<void>[] = [
      deps.handleTabState(parsed, input.session_id),
      deps.handleRebuildSkill(),
      deps.handleAlgorithmEnrichment(parsed, input.session_id),
    ];
    const handlerNames = ["TabState", "RebuildSkill", "AlgorithmEnrichment"];

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

    return ok({ type: "silent" });
  },

  defaultDeps,
};
