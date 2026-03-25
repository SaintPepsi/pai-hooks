/**
 * Validator Integration Tests — validate hand-written manifests against real contracts.
 *
 * Runs the bidirectional validator against all 5 hand-written hook.json files
 * and their corresponding real contract files. This proves the manifests are
 * correct and the validator works against real-world import patterns.
 */

import { describe, it, expect } from "bun:test";
import { resolve } from "path";
import { validate, type ValidatorDeps, type ValidationReport } from "./validator";
import {
  readFile as adapterReadFile,
  fileExists as adapterFileExists,
} from "@hooks/core/adapters/fs";
import type { Result } from "@hooks/core/result";
import type { PaiError } from "@hooks/core/error";

// ─── Helpers ────────────────────────────────────────────────────────────────

const HOOKS_DIR = resolve(import.meta.dir, "../../hooks");

const realDeps: ValidatorDeps = {
  readFile: adapterReadFile,
  fileExists: adapterFileExists,
  stderr: () => {},
};

function expectValid(result: Result<ValidationReport, PaiError>, hookName: string): void {
  if (!result.ok) {
    throw new Error(`Validator error for ${hookName}: ${result.error.message}`);
  }

  const report = result.value;
  if (!report.valid) {
    const details = report.diagnostics
      .map((d) => `  ${d.code}: ${d.dep} — ${d.message}`)
      .join("\n");
    throw new Error(`${hookName} manifest invalid:\n${details}`);
  }

  expect(report.valid).toBe(true);
  expect(report.diagnostics).toHaveLength(0);
}

// ─── Integration Tests ──────────────────────────────────────────────────────

describe("manifest integration — real hooks", () => {
  it("DestructiveDeleteGuard: zero-lib manifest validates", () => {
    const contract = resolve(HOOKS_DIR, "GitSafety/DestructiveDeleteGuard/DestructiveDeleteGuard.contract.ts");
    const manifest = resolve(HOOKS_DIR, "GitSafety/DestructiveDeleteGuard/hook.json");
    expectValid(validate(contract, manifest, realDeps), "DestructiveDeleteGuard");
  });

  it("AlgorithmTracker: multi-lib manifest validates", () => {
    const contract = resolve(HOOKS_DIR, "AlgorithmTracking/AlgorithmTracker/AlgorithmTracker.contract.ts");
    const manifest = resolve(HOOKS_DIR, "AlgorithmTracking/AlgorithmTracker/hook.json");
    expectValid(validate(contract, manifest, realDeps), "AlgorithmTracker");
  });

  it("CronFire: shared.ts manifest validates", () => {
    const contract = resolve(HOOKS_DIR, "CronStatusLine/CronFire/CronFire.contract.ts");
    const manifest = resolve(HOOKS_DIR, "CronStatusLine/CronFire/hook.json");
    expectValid(validate(contract, manifest, realDeps), "CronFire");
  });

  it("VoiceGate: fs-adapter manifest validates", () => {
    const contract = resolve(HOOKS_DIR, "VoiceGate/VoiceGate/VoiceGate.contract.ts");
    const manifest = resolve(HOOKS_DIR, "VoiceGate/VoiceGate/hook.json");
    expectValid(validate(contract, manifest, realDeps), "VoiceGate");
  });

  it("CitationEnforcement: named-shared manifest validates", () => {
    const contract = resolve(HOOKS_DIR, "ObligationStateMachines/CitationEnforcement/CitationEnforcement.contract.ts");
    const manifest = resolve(HOOKS_DIR, "ObligationStateMachines/CitationEnforcement/hook.json");
    expectValid(validate(contract, manifest, realDeps), "CitationEnforcement");
  });
});
