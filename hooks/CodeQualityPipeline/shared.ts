/**
 * CodeQualityPipeline shared types — BaselineEntry and BaselineStore.
 *
 * Shared across CodeQualityBaseline, CodeQualityGuard, and SessionQualityReport.
 * All three hooks read/write quality-baselines-{sessionId}.json using these types.
 */

import type { QualityScore } from "@hooks/core/quality-scorer";

// ─── Shared Types ─────────────────────────────────────────────────────────────

export interface BaselineEntry {
  score: number;
  violations: number;
  checkResults?: QualityScore["checkResults"];
  timestamp: string;
}

export interface BaselineStore {
  [filePath: string]: BaselineEntry;
}
