/**
 * Manifest Validator Tests — TDD test suite.
 *
 * Validates that the manifest validator correctly detects:
 * - Valid manifests (no diagnostics)
 * - Missing deps (contract imports something manifest doesn't declare)
 * - Ghost deps (manifest declares something contract doesn't import)
 * - Type-only imports (excluded from dep counting)
 * - Missing shared files on disk
 * - Sibling hook imports ignored
 */

import { describe, it, expect } from "bun:test";
import { resolve } from "path";
import { validate, type ValidatorDeps, type ValidationReport } from "./validator";
import { ok, err, type Result } from "@hooks/core/result";
import { PaiError, ErrorCode } from "@hooks/core/error";
import {
  readFile as adapterReadFile,
  fileExists as adapterFileExists,
} from "@hooks/core/adapters/fs";

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
    fileExists: adapterFileExists,
    stderr: () => {},
    ...overrides,
  };
}

function expectOk(result: Result<ValidationReport, PaiError>): ValidationReport {
  if (!result.ok) {
    throw new Error(`Expected ok, got err: ${result.error.message}`);
  }
  return result.value;
}

// ─── Valid Manifest ─────────────────────────────────────────────────────────

describe("validate", () => {
  describe("valid manifest", () => {
    it("passes with no diagnostics when deps match imports", () => {
      const result = validate(
        fixtureContract("valid"),
        fixtureManifest("valid"),
        makeDeps(),
      );

      const report = expectOk(result);
      expect(report.valid).toBe(true);
      expect(report.diagnostics).toHaveLength(0);
      expect(report.hookName).toBe("ValidHook");
    });
  });

  // ─── Missing Dep ────────────────────────────────────────────────────────

  describe("missing dep detection", () => {
    it("detects MANIFEST_MISSING_DEP when contract imports undeclared dep", () => {
      const result = validate(
        fixtureContract("missing-dep"),
        fixtureManifest("missing-dep"),
        makeDeps(),
      );

      const report = expectOk(result);
      expect(report.valid).toBe(false);
      expect(report.diagnostics.length).toBeGreaterThanOrEqual(1);

      const missing = report.diagnostics.find(
        (d) => d.code === "MANIFEST_MISSING_DEP" && d.dep === "lib/paths",
      );
      expect(missing).toBeDefined();
    });
  });

  // ─── Ghost Dep ──────────────────────────────────────────────────────────

  describe("ghost dep detection", () => {
    it("detects MANIFEST_GHOST_DEP when manifest declares unused dep", () => {
      const result = validate(
        fixtureContract("ghost-dep"),
        fixtureManifest("ghost-dep"),
        makeDeps(),
      );

      const report = expectOk(result);
      expect(report.valid).toBe(false);
      expect(report.diagnostics.length).toBeGreaterThanOrEqual(1);

      const ghost = report.diagnostics.find(
        (d) => d.code === "MANIFEST_GHOST_DEP" && d.dep === "lib/identity",
      );
      expect(ghost).toBeDefined();
    });
  });

  // ─── Type-Only Imports ──────────────────────────────────────────────────

  describe("type-only imports", () => {
    it("excludes import type statements from dep counting", () => {
      const result = validate(
        fixtureContract("type-only"),
        fixtureManifest("type-only"),
        makeDeps(),
      );

      const report = expectOk(result);
      // core/error is type-only import, not in manifest deps — should be valid
      expect(report.valid).toBe(true);
      expect(report.diagnostics).toHaveLength(0);
    });
  });

  // ─── Missing Shared File ───────────────────────────────────────────────

  describe("missing shared file", () => {
    it("detects MANIFEST_SHARED_MISSING when shared file does not exist on disk", () => {
      const result = validate(
        fixtureContract("shared-missing"),
        fixtureManifest("shared-missing"),
        makeDeps(),
      );

      const report = expectOk(result);
      expect(report.valid).toBe(false);
      expect(report.diagnostics.length).toBeGreaterThanOrEqual(1);

      const sharedMissing = report.diagnostics.find(
        (d) => d.code === "MANIFEST_SHARED_MISSING" && d.dep === "nonexistent.shared.ts",
      );
      expect(sharedMissing).toBeDefined();
    });
  });

  // ─── Sibling Hook Imports Ignored ─────────────────────────────────────

  describe("sibling hook imports ignored", () => {
    it("does not count @hooks/hooks/* imports as deps", () => {
      const contractContent = [
        'import { ok, type Result } from "@hooks/core/result";',
        'import type { PaiError } from "@hooks/core/error";',
        'import { someHelper } from "@hooks/hooks/SomeGroup/SomeHook/shared";',
        "",
        "export function execute(): Result<string, PaiError> {",
        '  return ok("test");',
        "}",
      ].join("\n");

      const manifestContent = JSON.stringify({
        name: "SiblingTest",
        group: "TestGroup",
        event: "PreToolUse",
        description: "Test sibling imports ignored",
        schemaVersion: 1,
        deps: { core: ["result"], lib: [], adapters: [], shared: false },
        tags: [],
        presets: [],
      });

      const deps = makeDeps({
        readFile: (path: string) => {
          if (path.endsWith(".ts")) return ok(contractContent);
          if (path.endsWith(".json")) return ok(manifestContent);
          return err(new PaiError(ErrorCode.FileNotFound, `Not found: ${path}`));
        },
      });

      const result = validate("/fake/contract.ts", "/fake/hook.json", deps);
      const report = expectOk(result);
      expect(report.valid).toBe(true);
      expect(report.diagnostics).toHaveLength(0);
    });
  });

  // ─── Multi-line Import Parsing ────────────────────────────────────────

  describe("multi-line import parsing", () => {
    it("correctly parses imports split across multiple lines", () => {
      const contractContent = [
        "import {",
        "  ok,",
        "  err,",
        "  type Result,",
        '} from "@hooks/core/result";',
        'import { readFile } from "@hooks/core/adapters/fs";',
        "",
        "export function execute(): Result<string, unknown> {",
        '  return ok("multi-line");',
        "}",
      ].join("\n");

      const manifestContent = JSON.stringify({
        name: "MultiLineTest",
        group: "TestGroup",
        event: "PreToolUse",
        description: "Test multi-line imports",
        schemaVersion: 1,
        deps: { core: ["result"], lib: [], adapters: ["fs"], shared: false },
        tags: [],
        presets: [],
      });

      const deps = makeDeps({
        readFile: (path: string) => {
          if (path.endsWith(".ts")) return ok(contractContent);
          if (path.endsWith(".json")) return ok(manifestContent);
          return err(new PaiError(ErrorCode.FileNotFound, `Not found: ${path}`));
        },
      });

      const result = validate("/fake/contract.ts", "/fake/hook.json", deps);
      const report = expectOk(result);
      expect(report.valid).toBe(true);
      expect(report.diagnostics).toHaveLength(0);
    });
  });

  // ─── Error Handling ───────────────────────────────────────────────────

  describe("error handling", () => {
    it("returns err when contract file cannot be read", () => {
      const deps = makeDeps({
        readFile: (path: string) => {
          if (path.endsWith(".ts")) {
            return err(new PaiError(ErrorCode.FileNotFound, `Not found: ${path}`));
          }
          return ok("{}");
        },
      });

      const result = validate("/fake/missing.ts", "/fake/hook.json", deps);
      expect(result.ok).toBe(false);
    });

    it("returns err when manifest file cannot be read", () => {
      const deps = makeDeps({
        readFile: (path: string) => {
          if (path.endsWith(".json")) {
            return err(new PaiError(ErrorCode.FileNotFound, `Not found: ${path}`));
          }
          return ok('import { ok } from "@hooks/core/result";');
        },
      });

      const result = validate("/fake/contract.ts", "/fake/missing.json", deps);
      expect(result.ok).toBe(false);
    });
  });
});
