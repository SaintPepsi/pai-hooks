/**
 * VoiceNotification.ts - Voice Notification Handler
 *
 * PURPOSE:
 * Sends completion messages to the voice server for TTS playback.
 * Extracts the voice line from responses and sends to Kokoro via voice server.
 *
 * Pure handler: receives pre-parsed transcript data, sends to voice server.
 * No I/O for transcript reading - that's done by orchestrator.
 */

import { join } from "path";
import { fileExists, readJson, appendFile, ensureDir } from "@hooks/core/adapters/fs";
import type { Result } from "@hooks/core/result";
import type { PaiError } from "@hooks/core/error";
import { getIdentity, type VoicePersonality } from "@hooks/lib/identity";
import { getISOTimestamp } from "@hooks/lib/time";
import { isValidVoiceCompletion, getVoiceFallback } from "@hooks/lib/output-validators";
import type { ParsedTranscript } from "@pai/Tools/TranscriptParser";

// ─── Types ───────────────────────────────────────────────────────────────────

interface NotificationPayload {
  message: string;
  title?: string;
  voice_enabled?: boolean;
  voice_id?: string;
  voice_settings?: {
    stability: number;
    similarity_boost: number;
    style: number;
    speed: number;
    use_speaker_boost: boolean;
  };
  volume?: number;
}

interface VoiceEvent {
  timestamp: string;
  session_id: string;
  event_type: "sent" | "failed" | "skipped";
  message: string;
  character_count: number;
  voice_engine: "kokoro";
  voice_id: string;
  status_code?: number;
  error?: string;
}

interface CurrentWorkState {
  session_id: string;
  session_dir: string;
  work_dir?: string;
}

export interface VoiceNotificationDeps {
  fileExists: (path: string) => boolean;
  readJson: <T = unknown>(path: string) => Result<T, PaiError>;
  appendFile: (path: string, content: string) => Result<void, PaiError>;
  ensureDir: (path: string) => Result<void, PaiError>;
  getIdentity: typeof getIdentity;
  getTimestamp: typeof getISOTimestamp;
  isValidVoiceCompletion: typeof isValidVoiceCompletion;
  getVoiceFallback: typeof getVoiceFallback;
  fetch: typeof globalThis.fetch;
  baseDir: string;
  stderr: (msg: string) => void;
}

// ─── Pure Logic ──────────────────────────────────────────────────────────────

function getActiveWorkDir(
  sessionId: string,
  deps: VoiceNotificationDeps,
): string | null {
  const stateFile = join(deps.baseDir, "MEMORY", "STATE", `current-work-${sessionId}.json`);
  const result = deps.readJson<CurrentWorkState>(stateFile);
  if (!result.ok) return null;

  const dirName = result.value.session_dir || result.value.work_dir;
  if (!dirName) return null;

  const workPath = join(deps.baseDir, "MEMORY", "WORK", dirName);
  if (!deps.fileExists(workPath)) return null;

  return workPath;
}

function logVoiceEvent(
  event: VoiceEvent,
  sessionId: string,
  deps: VoiceNotificationDeps,
): void {
  const line = JSON.stringify(event) + "\n";

  const voiceDir = join(deps.baseDir, "MEMORY", "VOICE");
  deps.ensureDir(voiceDir);
  const logPath = join(voiceDir, "voice-events.jsonl");
  deps.appendFile(logPath, line);

  const workDir = getActiveWorkDir(sessionId, deps);
  if (workDir) {
    deps.appendFile(join(workDir, "voice.jsonl"), line);
  }
}

async function sendNotification(
  payload: NotificationPayload,
  sessionId: string,
  deps: VoiceNotificationDeps,
): Promise<void> {
  const identity = deps.getIdentity();
  const voiceId = payload.voice_id || identity.mainDAVoiceID;

  const baseEvent: Omit<VoiceEvent, "event_type" | "status_code" | "error"> = {
    timestamp: deps.getTimestamp(),
    session_id: sessionId,
    message: payload.message,
    character_count: payload.message.length,
    voice_engine: "kokoro",
    voice_id: voiceId,
  };

  const response = await deps.fetch("http://localhost:8888/notify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(3000),
  }).catch((error: unknown) => {
    deps.stderr(`[Voice] Failed to send: ${error instanceof Error ? error.message : String(error)}`);
    logVoiceEvent(
      { ...baseEvent, event_type: "failed", error: error instanceof Error ? error.message : String(error) },
      sessionId,
      deps,
    );
    return null;
  });

  if (!response) return;

  if (!response.ok) {
    deps.stderr(`[Voice] Server error: ${response.statusText}`);
    logVoiceEvent(
      { ...baseEvent, event_type: "failed", status_code: response.status, error: response.statusText },
      sessionId,
      deps,
    );
  } else {
    logVoiceEvent(
      { ...baseEvent, event_type: "sent", status_code: response.status },
      sessionId,
      deps,
    );
  }
}

// ─── Default Deps ────────────────────────────────────────────────────────────

const BASE_DIR = process.env.PAI_DIR || join(process.env.HOME!, ".claude");

const defaultDeps: VoiceNotificationDeps = {
  fileExists,
  readJson,
  appendFile,
  ensureDir,
  getIdentity,
  getTimestamp: getISOTimestamp,
  isValidVoiceCompletion,
  getVoiceFallback,
  fetch: globalThis.fetch,
  baseDir: BASE_DIR,
  stderr: (msg) => process.stderr.write(msg + "\n"),
};

// ─── Exported Handler ────────────────────────────────────────────────────────

/**
 * Handle voice notification with pre-parsed transcript data.
 * Uses Kokoro TTS via the voice server.
 */
export async function handleVoice(
  parsed: ParsedTranscript,
  sessionId: string,
  deps: VoiceNotificationDeps = defaultDeps,
): Promise<void> {
  let voiceCompletion = parsed.voiceCompletion;

  if (!deps.isValidVoiceCompletion(voiceCompletion)) {
    deps.stderr(`[Voice] Invalid completion: "${voiceCompletion.slice(0, 50)}..."`);
    voiceCompletion = deps.getVoiceFallback();
  }

  if (!voiceCompletion || voiceCompletion.length < 5) {
    deps.stderr("[Voice] Skipping - message too short or empty");
    return;
  }

  const identity = deps.getIdentity();
  const voiceId = identity.mainDAVoiceID;

  const payload: NotificationPayload = {
    message: voiceCompletion,
    title: `${identity.name} says`,
    voice_enabled: true,
    voice_id: voiceId,
  };

  await sendNotification(payload, sessionId, deps);
}
