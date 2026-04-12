/**
 * Effect Schema for security patterns configuration.
 *
 * Single source of truth for the shape of patterns.json.
 * Used by SecurityValidator (load + validate) and hardening-mcp (read + write).
 */

import { safeJsonParse } from "@hooks/core/adapters/json";
import { Schema } from "effect";

// ─── Pattern entry ────────────────────────────────────────────────────────

export const PatternEntry = Schema.Struct({
  pattern: Schema.String,
  reason: Schema.String,
  regex: Schema.optional(Schema.Boolean),
  group: Schema.optional(Schema.String),
});

export type PatternEntry = typeof PatternEntry.Type;

// ─── Bash patterns ────────────────────────────────────────────────────────

export const BashPatterns = Schema.Struct({
  blocked: Schema.mutable(Schema.Array(PatternEntry)),
  confirm: Schema.mutable(Schema.Array(PatternEntry)),
  alert: Schema.mutable(Schema.Array(PatternEntry)),
});

export type BashPatterns = typeof BashPatterns.Type;

// ─── Path patterns ────────────────────────────────────────────────────────

export const PathPatterns = Schema.Struct({
  zeroAccess: Schema.mutable(Schema.Array(Schema.String)),
  readOnly: Schema.mutable(Schema.Array(Schema.String)),
  confirmWrite: Schema.mutable(Schema.Array(Schema.String)),
  noDelete: Schema.mutable(Schema.Array(Schema.String)),
});

export type PathPatterns = typeof PathPatterns.Type;

// ─── Philosophy ───────────────────────────────────────────────────────────

export const Philosophy = Schema.Struct({
  mode: Schema.String,
  principle: Schema.String,
});

// ─── Project rule ─────────────────────────────────────────────────────────

const ProjectRule = Schema.Struct({
  action: Schema.String,
  reason: Schema.String,
});

const ProjectConfig = Schema.Struct({
  path: Schema.String,
  rules: Schema.mutable(Schema.Array(ProjectRule)),
});

// ─── Root config ──────────────────────────────────────────────────────────

export const PatternsConfig = Schema.Struct({
  version: Schema.String,
  philosophy: Philosophy,
  bash: BashPatterns,
  paths: PathPatterns,
  projects: Schema.Record({ key: Schema.String, value: ProjectConfig }),
});

export type PatternsConfig = typeof PatternsConfig.Type;

// ─── Decoder ──────────────────────────────────────────────────────────────

const decode = Schema.decodeUnknownEither(PatternsConfig);

/**
 * Parse and validate a JSON string against the PatternsConfig schema.
 * Returns the validated config or null on failure.
 */
export function decodePatternsConfig(json: string): PatternsConfig | null {
  const parsed = safeJsonParse(json);
  if (!parsed.ok) return null;

  const result = decode(parsed.value);
  if (result._tag === "Right") return result.right;
  return null;
}
