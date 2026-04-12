/**
 * Manifest Validator Tests — TDD test suite.
 *
 * Validates that the manifest validator correctly detects:
 * - Valid manifests (no diagnostics)
 * - Error handling for missing/malformed files
 */

import { describe, expect, it } from "bun:test";
import { dirname, resolve } from "node:path";
import { type ValidationReport, type ValidatorDeps, validate } from "@hooks/cli/core/validator";
import {
  fileExists as adapterFileExists,
  readFile as adapterReadFile,
  readJson as adapterReadJson,
} from "@hooks/core/adapters/fs";
import { ErrorCode, ResultError } from "@hooks/core/error";
import { err, ok, type Result } from "@hooks/core/result";

// ─── Helpers ────────────────────────────────────────────────────────────────

const FIXTURES = resolve(import.meta.dir, "../../test-fixtures/manifests");

function fixtureContract(name: string): string {
  return resolve(FIXTURES, `${name}-contract.ts`);
}

function fixtureManifest(name: string): string {
  return resolve(FIXTURES, `${name}-hook.json`);
}

/** Build real deps that read from disk via adapters (no try-catch). */
function makeDeps(overrides: Partial<ValidatorDeps> = {}): ValidatorDeps {
  return {
    readFile: adapterReadFile,
    readJson: adapterReadJson,
    fileExists: adapterFileExists,
    dirname,
    resolve,
    stderr: () => {},
    ...overrides,
  };
}

function expectOk(result: Result<ValidationReport, ResultError>): ValidationReport {
  if (!result.ok) {
    throw new Error(`Expected ok, got err: ${result.error.message}`);
  }
  return result.value;
}

// ─── Valid Manifest ─────────────────────────────────────────────────────────

describe("validate", () => {
  describe("valid manifest", () => {
    it("passes with no diagnostics when deps match imports", () => {
      const result = validate(fixtureContract("valid"), fixtureManifest("valid"), makeDeps());

      const report = expectOk(result);
      expect(report.valid).toBe(true);
      expect(report.diagnostics).toHaveLength(0);
      expect(report.hookName).toBe("ValidHook");
    });
  });

  // ─── Error Handling ───────────────────────────────────────────────────

  describe("error handling", () => {
    it("returns err when contract file cannot be read", () => {
      const deps = makeDeps({
        readFile: (path: string) => {
          if (path.endsWith(".ts")) {
            return err(new ResultError(ErrorCode.FileNotFound, `Not found: ${path}`));
          }
          return ok("{}");
        },
      });

      const result = validate("/fake/missing.ts", "/fake/hook.json", deps);
      expect(result.ok).toBe(false);
    });

    it("returns err with JSON_PARSE_FAILED when manifest contains malformed JSON", () => {
      const deps = makeDeps({
        readFile: (path: string) => {
          if (path.endsWith(".ts")) return ok('import { ok } from "@hooks/core/result";');
          return err(new ResultError(ErrorCode.FileNotFound, `Not found: ${path}`));
        },
        readJson: () => err(new ResultError(ErrorCode.JsonParseFailed, "Invalid JSON")),
      });

      const result = validate("/fake/contract.ts", "/fake/hook.json", deps);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(ErrorCode.JsonParseFailed);
      }
    });

    it("reports CONTRACT_MISSING when contract file does not exist", () => {
      const deps = makeDeps({
        fileExists: (path: string) => !path.endsWith(".contract.ts"),
        readJson: () =>
          ok({
            name: "TestHook",
            group: "TestGroup",
            event: "PreToolUse",
            description: "test",
            schemaVersion: 1,
            tags: [],
            presets: [],
            deps: [],
          }),
        readFile: () => ok('import { ok } from "@hooks/core/result";'),
      });

      const result = validate("/fake/TestHook.contract.ts", "/fake/hook.json", deps);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.valid).toBe(false);
        expect(result.value.diagnostics.some((d) => d.code === "CONTRACT_MISSING")).toBe(true);
      }
    });

    it("returns err when manifest file cannot be read", () => {
      const deps = makeDeps({
        readFile: (_path: string) => ok('import { ok } from "@hooks/core/result";'),
        readJson: (path: string) =>
          err(new ResultError(ErrorCode.FileNotFound, `Not found: ${path}`)),
      });

      const result = validate("/fake/contract.ts", "/fake/missing.json", deps);
      expect(result.ok).toBe(false);
    });
  });
});
