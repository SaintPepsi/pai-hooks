/**
 * Central Identity Loader
 * Single source of truth for DA (Digital Assistant) and Principal identity
 *
 * Reads from settings.json - the programmatic way, not markdown parsing.
 * All hooks and tools should import from here.
 */

import { fileExists as adapterFileExists, readJson } from "@hooks/core/adapters/fs";
import type { PaiError } from "@hooks/core/error";
import type { Result } from "@hooks/core/result";
import { join } from "path";

// ─── Voice Types ────────────────────────────────────────────────────────────

export interface VoiceProsody {
  stability: number;
  similarity_boost: number;
  style: number;
  speed: number;
  use_speaker_boost: boolean;
}

export interface VoicePersonality {
  baseVoice: string;
  enthusiasm: number;
  energy: number;
  expressiveness: number;
  resilience: number;
  composure: number;
  optimism: number;
  warmth: number;
  formality: number;
  directness: number;
  precision: number;
  curiosity: number;
  playfulness: number;
}

// ─── Voice Config (what lives under voices.main in settings) ────────────────

export interface VoiceConfig extends Partial<VoiceProsody> {
  voiceId?: string;
}

// ─── DA Identity Config (what lives under daidentity in settings.json) ──────

export interface DAIdentityConfig {
  name?: string;
  fullName?: string;
  displayName?: string;
  mainDAVoiceID?: string;
  color?: string;
  voices?: Record<string, VoiceConfig>;
  personality?: VoicePersonality;
}

// ─── Public Types ───────────────────────────────────────────────────────────

export interface Identity {
  name: string;
  fullName: string;
  displayName: string;
  mainDAVoiceID: string;
  color: string;
  voice?: VoiceProsody;
  personality?: VoicePersonality;
}

export interface Principal {
  name: string;
  pronunciation: string;
  timezone: string;
}

export interface Settings {
  daidentity?: DAIdentityConfig;
  principal?: Partial<Principal>;
  env?: Record<string, string>;
}

// ─── Deps Interface ─────────────────────────────────────────────────────────

export interface IdentityDeps {
  settingsPath: string;
  readJson: (path: string) => Result<Settings, PaiError>;
  fileExists: (path: string) => boolean;
}

// ─── Defaults ───────────────────────────────────────────────────────────────

const DEFAULT_IDENTITY: Identity = {
  name: "PAI",
  fullName: "Personal AI",
  displayName: "PAI",
  mainDAVoiceID: "",
  color: "#3B82F6",
};

const DEFAULT_PRINCIPAL: Principal = {
  name: "User",
  pronunciation: "",
  timezone: "UTC",
};

const defaultDeps: IdentityDeps = {
  settingsPath: join(process.env.HOME ?? "", ".claude/settings.json"),
  readJson: (path: string) => readJson<Settings>(path),
  fileExists: adapterFileExists,
};

// ─── Cache ──────────────────────────────────────────────────────────────────

let cachedSettings: Settings | null = null;

/**
 * Load settings.json (cached). Uses Result from fs adapter — no try-catch.
 */
function loadSettings(deps: IdentityDeps): Settings {
  if (cachedSettings) return cachedSettings;

  if (!deps.fileExists(deps.settingsPath)) {
    cachedSettings = {};
    return cachedSettings;
  }

  const result = deps.readJson(deps.settingsPath);
  if (!result.ok) {
    cachedSettings = {};
    return cachedSettings;
  }

  cachedSettings = result.value;
  return cachedSettings;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Extract VoiceProsody from a VoiceConfig, returning undefined if any
 * required field is missing. No type casts needed — we validate each field.
 */
function extractProsody(config: VoiceConfig | undefined): VoiceProsody | undefined {
  if (!config) return undefined;
  const { stability, similarity_boost, style, speed, use_speaker_boost } = config;
  if (
    stability === undefined ||
    similarity_boost === undefined ||
    style === undefined ||
    speed === undefined ||
    use_speaker_boost === undefined
  ) {
    return undefined;
  }
  return { stability, similarity_boost, style, speed, use_speaker_boost };
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Get DA (Digital Assistant) identity from settings.json
 */
export function getIdentity(deps: IdentityDeps = defaultDeps): Identity {
  const settings = loadSettings(deps);
  const daidentity: DAIdentityConfig = settings.daidentity ?? {};

  const voices = daidentity.voices ?? {};
  const voiceConfig = voices.main;

  return {
    name: daidentity.name ?? DEFAULT_IDENTITY.name,
    fullName: daidentity.fullName ?? daidentity.name ?? DEFAULT_IDENTITY.fullName,
    displayName: daidentity.displayName ?? daidentity.name ?? DEFAULT_IDENTITY.displayName,
    mainDAVoiceID:
      voiceConfig?.voiceId ?? daidentity.mainDAVoiceID ?? DEFAULT_IDENTITY.mainDAVoiceID,
    color: daidentity.color ?? DEFAULT_IDENTITY.color,
    voice: extractProsody(voiceConfig),
    personality: daidentity.personality,
  };
}

/**
 * Get Principal (human owner) identity from settings.json
 */
export function getPrincipal(deps: IdentityDeps = defaultDeps): Principal {
  const settings = loadSettings(deps);
  const principal = settings.principal ?? {};

  return {
    name: principal.name ?? DEFAULT_PRINCIPAL.name,
    pronunciation: principal.pronunciation ?? DEFAULT_PRINCIPAL.pronunciation,
    timezone: principal.timezone ?? DEFAULT_PRINCIPAL.timezone,
  };
}

/**
 * Clear cache (useful for testing or when settings.json changes)
 */
export function clearCache(): void {
  cachedSettings = null;
}

/**
 * Get just the DA name (convenience function)
 */
export function getDAName(deps: IdentityDeps = defaultDeps): string {
  return getIdentity(deps).name;
}

/**
 * Get just the Principal name (convenience function)
 */
export function getPrincipalName(deps: IdentityDeps = defaultDeps): string {
  return getPrincipal(deps).name;
}

/**
 * Get just the voice ID (convenience function)
 */
export function getVoiceId(deps: IdentityDeps = defaultDeps): string {
  return getIdentity(deps).mainDAVoiceID;
}

/**
 * Get the full settings object (for advanced use)
 */
export function getSettings(deps: IdentityDeps = defaultDeps): Settings {
  return loadSettings(deps);
}

/**
 * Get the default identity (for documentation/testing)
 */
export function getDefaultIdentity(): Identity {
  return { ...DEFAULT_IDENTITY };
}

/**
 * Get the default principal (for documentation/testing)
 */
export function getDefaultPrincipal(): Principal {
  return { ...DEFAULT_PRINCIPAL };
}

/**
 * Get voice prosody settings (convenience function) - legacy ElevenLabs
 */
export function getVoiceProsody(deps: IdentityDeps = defaultDeps): VoiceProsody | undefined {
  return getIdentity(deps).voice;
}

/**
 * Get voice personality settings (convenience function) - Qwen3-TTS
 */
export function getVoicePersonality(
  deps: IdentityDeps = defaultDeps,
): VoicePersonality | undefined {
  return getIdentity(deps).personality;
}
