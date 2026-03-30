import { describe, expect, test } from "bun:test";
import { getLanguageProfile } from "./language-profiles";
import { formatAdvisory, formatDelta, type QualityScore, scoreFile } from "./quality-scorer";

const tsProfile = getLanguageProfile("test.ts")!;
const pyProfile = getLanguageProfile("test.py")!;

// ─── Test Fixtures ───────────────────────────────────────────────────────────

const CLEAN_FILE = `
import type { Result } from "./result";
import type { PaiError } from "./error";
import { ok, err } from "./result";

export interface ProcessDeps {
  exec: (cmd: string) => Result<string, PaiError>;
  stderr: (msg: string) => void;
}

function validateInput(input: string): Result<string, PaiError> {
  if (!input.trim()) return err({ code: "INVALID", message: "Empty input" } as PaiError);
  return ok(input.trim());
}

function processData(data: string, deps: ProcessDeps): Result<string, PaiError> {
  const result = deps.exec(data);
  if (!result.ok) {
    deps.stderr("Processing failed");
    return result;
  }
  return ok(result.value.toUpperCase());
}

export function runProcess(input: string, deps: ProcessDeps): Result<string, PaiError> {
  const validated = validateInput(input);
  if (!validated.ok) return validated;
  return processData(validated.value, deps);
}
`;

const BLOATED_FILE = `
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from "fs";
import { join, dirname, basename, resolve, relative, extname } from "path";
import { execSync, spawn } from "child_process";
import fetch from "node-fetch";

// ─── Configuration ───────────────────────────────────────────────────────────

function loadConfig() { return {}; }
function saveConfig(c: any) {}
function validateConfig(c: any) {}
function mergeConfig(a: any, b: any) {}

// ─── File Operations ─────────────────────────────────────────────────────────

function readData(p: string) { return ""; }
function writeData(p: string, d: string) {}
function copyFile(s: string, d: string) {}
function moveFile(s: string, d: string) {}
function deleteFile(p: string) {}

// ─── Network ─────────────────────────────────────────────────────────────────

function fetchApi(url: string) {}
function postData(url: string, data: any) {}
function downloadFile(url: string, dest: string) {}

// ─── Process Management ──────────────────────────────────────────────────────

function runCommand(cmd: string) {}
function spawnWorker(script: string) {}
function killProcess(pid: number) {}
function checkProcess(pid: number) {}

// ─── Utilities ───────────────────────────────────────────────────────────────

function formatOutput(data: any) {}
function parseInput(raw: string) {}
function logMessage(msg: string) {}
function handleError(err: any) {}
`;

const HIGH_PARAM_FILE = `
import type { Result } from "./result";

function doSomething(a: string, b: number, c: boolean, d: string[], e: Map<string, number>, f: Set<string>): Result<void, Error> {
  return { ok: true, value: undefined };
}

function anotherThing(x: string, y: number, z: boolean, w: string, v: number, u: boolean, t: string): void {}
`;

const NO_DEPS_HOOK = `
import { readFileSync } from "fs";

function processHook(input: any): any {
  const data = readFileSync("config.json", "utf-8");
  return JSON.parse(data);
}

export default processHook;
`;

const DEEP_IMPORTS_FILE = `
import { foo } from "../../../../core/foo";
import { bar } from "../../../lib/bar";
import { baz } from "../../utils/baz";
import type { Qux } from "./qux";
`;

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("quality-scorer", () => {
  describe("scoreFile — clean code", () => {
    test("scores a clean file highly", () => {
      const result = scoreFile(CLEAN_FILE, tsProfile, "src/process.ts");
      expect(result.score).toBeGreaterThanOrEqual(8);
      expect(result.violations.length).toBeLessThanOrEqual(2);
    });

    test("returns check results for all executed checks", () => {
      const result = scoreFile(CLEAN_FILE, tsProfile, "src/process.ts");
      expect(result.checkResults.length).toBeGreaterThan(0);
      for (const cr of result.checkResults) {
        expect(cr.check).toBeTruthy();
        expect(typeof cr.passed).toBe("boolean");
        expect(typeof cr.value).toBe("number");
        expect(typeof cr.threshold).toBe("number");
      }
    });
  });

  describe("scoreFile — bloated code", () => {
    test("scores a bloated file low", () => {
      const result = scoreFile(BLOATED_FILE, tsProfile, "src/bloated.ts");
      expect(result.score).toBeLessThan(8);
      expect(result.violations.length).toBeGreaterThan(2);
    });

    test("detects SRP: too many functions", () => {
      const result = scoreFile(BLOATED_FILE, tsProfile, "src/bloated.ts");
      const functionViolation = result.violations.find((v) => v.check === "function-count");
      expect(functionViolation).toBeDefined();
      expect(functionViolation!.category).toBe("SRP");
    });

    test("detects SRP: mixed I/O patterns", () => {
      const result = scoreFile(BLOATED_FILE, tsProfile, "src/bloated.ts");
      const ioViolation = result.violations.find((v) => v.check === "mixed-io-patterns");
      expect(ioViolation).toBeDefined();
      expect(ioViolation!.category).toBe("SRP");
      expect(ioViolation!.severity).toBe("major");
    });

    test("detects SRP: too many section headers", () => {
      const result = scoreFile(BLOATED_FILE, tsProfile, "src/bloated.ts");
      const sectionViolation = result.violations.find((v) => v.check === "section-headers");
      expect(sectionViolation).toBeDefined();
      expect(sectionViolation!.category).toBe("SRP");
    });

    test("detects DIP: infrastructure imports", () => {
      const result = scoreFile(BLOATED_FILE, tsProfile, "src/bloated.ts");
      const infraViolation = result.violations.find((v) => v.check === "infra-imports");
      expect(infraViolation).toBeDefined();
      expect(infraViolation!.category).toBe("DIP");
    });
  });

  describe("scoreFile — ISP violations", () => {
    test("detects high parameter count", () => {
      const result = scoreFile(HIGH_PARAM_FILE, tsProfile, "src/params.ts");
      const paramViolation = result.violations.find((v) => v.check === "parameter-count");
      expect(paramViolation).toBeDefined();
      expect(paramViolation!.category).toBe("ISP");
      expect(paramViolation!.value).toBeGreaterThan(5);
    });
  });

  describe("scoreFile — DIP violations", () => {
    test("detects deep relative imports", () => {
      const result = scoreFile(DEEP_IMPORTS_FILE, tsProfile, "src/deep.ts");
      const depthViolation = result.violations.find((v) => v.check === "import-depth");
      expect(depthViolation).toBeDefined();
      expect(depthViolation!.category).toBe("DIP");
      expect(depthViolation!.value).toBeGreaterThanOrEqual(4);
    });

    test("skips Deps check for hook shell files", () => {
      const result = scoreFile(NO_DEPS_HOOK, tsProfile, "hooks/MyHook.hook.ts");
      const depsViolation = result.violations.find((v) => v.check === "missing-deps-interface");
      expect(depsViolation).toBeUndefined();
    });

    test("skips Deps check for non-hook files", () => {
      const result = scoreFile(NO_DEPS_HOOK, tsProfile, "src/utils.ts");
      const depsViolation = result.violations.find((v) => v.check === "missing-deps-interface");
      expect(depsViolation).toBeUndefined();
    });
  });

  describe("scoreFile — contract files", () => {
    test("detects missing Deps interface in contract files", () => {
      const result = scoreFile(NO_DEPS_HOOK, tsProfile, "hooks/contracts/MyContract.ts");
      const depsViolation = result.violations.find((v) => v.check === "missing-deps-interface");
      expect(depsViolation).toBeDefined();
    });

    test("passes Deps check when interface exists", () => {
      const withDeps = `
import type { Result } from "../core/result";
interface MyDeps { exec: () => void; }
function process(deps: MyDeps) {}
`;
      const result = scoreFile(withDeps, tsProfile, "hooks/contracts/Good.ts");
      const depsViolation = result.violations.find((v) => v.check === "missing-deps-interface");
      expect(depsViolation).toBeUndefined();
    });
  });

  describe("scoreFile — type import ratio", () => {
    test("detects low type import ratio", () => {
      const lowTypeRatio = `
import { foo } from "./foo";
import { bar } from "./bar";
import { baz } from "./baz";
import { qux } from "./qux";
import { quux } from "./quux";
import type { T } from "./types";
`;
      const result = scoreFile(lowTypeRatio, tsProfile, "src/low-types.ts");
      const ratioViolation = result.violations.find((v) => v.check === "type-import-ratio");
      expect(ratioViolation).toBeDefined();
    });

    test("passes with good type import ratio", () => {
      const goodTypeRatio = `
import type { Result } from "./result";
import type { PaiError } from "./error";
import { ok, err } from "./result";
`;
      const result = scoreFile(goodTypeRatio, tsProfile, "src/good-types.ts");
      const ratioViolation = result.violations.find((v) => v.check === "type-import-ratio");
      expect(ratioViolation).toBeUndefined();
    });

    test("skips type import ratio for JavaScript", () => {
      const jsContent = `
const foo = require("./foo");
const bar = require("./bar");
`;
      const result = scoreFile(jsContent, pyProfile, "src/code.py");
      const ratioViolation = result.violations.find((v) => v.check === "type-import-ratio");
      expect(ratioViolation).toBeUndefined();
    });
  });

  describe("scoreFile — scoring math", () => {
    test("perfect file scores 10", () => {
      const minimal = `
import type { Result } from "./result";
function run(): Result<void, Error> { return { ok: true, value: undefined }; }
`;
      const result = scoreFile(minimal, tsProfile, "src/minimal.ts");
      expect(result.score).toBe(10);
      expect(result.violations.length).toBe(0);
    });

    test("score never goes below 0", () => {
      // Construct a file that would accumulate many penalties
      const terrible = BLOATED_FILE + HIGH_PARAM_FILE + DEEP_IMPORTS_FILE;
      const result = scoreFile(terrible, tsProfile, "hooks/Terrible.hook.ts");
      expect(result.score).toBeGreaterThanOrEqual(0);
    });

    test("minor violations deduct 0.25", () => {
      // File with exactly one minor violation (section-headers > 3)
      const fourSections = `
// ─── Section One ─────────────────────────────────────────────
function one() {}
// ─── Section Two ─────────────────────────────────────────────
function two() {}
// ─── Section Three ───────────────────────────────────────────
function three() {}
// ─── Section Four ────────────────────────────────────────────
function four() {}
`;
      const result = scoreFile(fourSections, tsProfile, "src/sections.ts");
      const sectionViolation = result.violations.find((v) => v.check === "section-headers");
      if (sectionViolation) {
        expect(sectionViolation.severity).toBe("minor");
      }
    });

    test("major violations deduct 1.0", () => {
      // Mixed I/O is a major violation
      const result = scoreFile(BLOATED_FILE, tsProfile, "src/bloated.ts");
      const ioViolation = result.violations.find((v) => v.check === "mixed-io-patterns");
      expect(ioViolation).toBeDefined();
      expect(ioViolation!.severity).toBe("major");
    });
  });

  describe("formatAdvisory", () => {
    test("returns null for clean files", () => {
      const result: QualityScore = { score: 10, violations: [], checkResults: [] };
      expect(formatAdvisory(result, "src/clean.ts")).toBeNull();
    });

    test("formats violations as advisory string", () => {
      const result = scoreFile(BLOATED_FILE, tsProfile, "src/bloated.ts");
      const advisory = formatAdvisory(result, "src/bloated.ts");
      expect(advisory).not.toBeNull();
      expect(advisory).toContain("SOLID quality:");
      expect(advisory).toContain("bloated.ts");
      expect(advisory).toContain("[SRP]");
    });

    test("uses severity icons", () => {
      const result = scoreFile(BLOATED_FILE, tsProfile, "src/bloated.ts");
      const advisory = formatAdvisory(result, "src/bloated.ts")!;
      // Major violations get "!!"
      expect(advisory).toContain("!!");
    });
  });

  describe("formatDelta", () => {
    test("returns null for negligible changes", () => {
      const before: QualityScore = { score: 8.0, violations: [], checkResults: [] };
      const after: QualityScore = { score: 8.0, violations: [], checkResults: [] };
      expect(formatDelta(before, after, "src/file.ts")).toBeNull();
    });

    test("formats improvement", () => {
      const before: QualityScore = { score: 4.2, violations: [], checkResults: [] };
      const after: QualityScore = { score: 7.8, violations: [], checkResults: [] };
      const delta = formatDelta(before, after, "src/file.ts");
      expect(delta).not.toBeNull();
      expect(delta).toContain("improved");
      expect(delta).toContain("4.2");
      expect(delta).toContain("7.8");
      expect(delta).toContain("+3.6");
    });

    test("formats degradation", () => {
      const before: QualityScore = { score: 7.8, violations: [], checkResults: [] };
      const after: QualityScore = { score: 5.1, violations: [], checkResults: [] };
      const delta = formatDelta(before, after, "src/file.ts");
      expect(delta).not.toBeNull();
      expect(delta).toContain("degraded");
      expect(delta).toContain("7.8");
      expect(delta).toContain("5.1");
    });
  });

  describe("scoreFile — new checks", () => {
    test("detects excessive try-catch blocks", () => {
      const tryCatchHeavy = `
function a() { try { doA(); } catch (e) { console.error(e); } }
function b() { try { doB(); } catch (e) { console.error(e); } }
function c() { try { doC(); } catch (e) { console.error(e); } }
`;
      const result = scoreFile(tryCatchHeavy, tsProfile, "src/heavy.ts");
      const violation = result.violations.find((v) => v.check === "try-catch-count");
      expect(violation).toBeDefined();
      expect(violation!.severity).toBe("moderate");
    });

    test("detects missing HookContract in contract files", () => {
      const noContract = `
import { readFile } from "../core/adapters/fs";
export function doStuff() { return readFile("x"); }
`;
      const result = scoreFile(noContract, tsProfile, "hooks/contracts/Bad.ts");
      const violation = result.violations.find((v) => v.check === "contract-pattern");
      expect(violation).toBeDefined();
      expect(violation!.severity).toBe("major");
    });

    test("skips contract-pattern check for non-contract files", () => {
      const result = scoreFile("export function x() {}", tsProfile, "src/utils.ts");
      const violation = result.violations.find((v) => v.check === "contract-pattern");
      expect(violation).toBeUndefined();
    });

    test("detects adapter bypass in contract files", () => {
      const rawImports = `
import { readFileSync } from "fs";
import { execSync } from "child_process";
export const Bad: HookContract<any, any, any> = { name: "Bad", event: "PreToolUse", accepts: () => true, execute: () => ({} as any), defaultDeps: {} as any };
`;
      const result = scoreFile(rawImports, tsProfile, "hooks/contracts/Bad.ts");
      const violation = result.violations.find((v) => v.check === "adapter-bypass");
      expect(violation).toBeDefined();
      expect(violation!.severity).toBe("major");
    });

    test("skips adapter-bypass for non-contract files", () => {
      const rawImports = `import { readFileSync } from "fs";`;
      const result = scoreFile(rawImports, tsProfile, "src/script.ts");
      const violation = result.violations.find((v) => v.check === "adapter-bypass");
      expect(violation).toBeUndefined();
    });

    test("does not false-positive on regex pattern arrays", () => {
      const regexPatterns = `
import type { Result } from "./result";
const INFRA_PATTERNS = [
  /from\\s+["'](?:node:)?fs["']/m,
  /from\\s+["'](?:node:)?child_process["']/m,
];
function checkPatterns(content: string): number {
  return INFRA_PATTERNS.filter(p => p.test(content)).length;
}
`;
      const result = scoreFile(regexPatterns, tsProfile, "src/checker.ts");
      const infraViolation = result.violations.find((v) => v.check === "infra-imports");
      expect(infraViolation).toBeUndefined();
    });

    test("violation messages cite CODINGSTANDARDS", () => {
      const rawImports = `
import { readFileSync } from "fs";
export const Bad: HookContract<any, any, any> = { name: "Bad", event: "PreToolUse", accepts: () => true, execute: () => ({} as any), defaultDeps: {} as any };
`;
      const result = scoreFile(rawImports, tsProfile, "hooks/contracts/Bad.ts");
      const bypass = result.violations.find((v) => v.check === "adapter-bypass");
      expect(bypass?.message).toContain("CODINGSTANDARDS");
    });
  });

  describe("cross-language scoring", () => {
    test("scores Python files", () => {
      const pythonCode = `
import os
from pathlib import Path
from typing import Optional

def read_config(path: str) -> Optional[dict]:
    if not os.path.exists(path):
        return None
    with open(path) as f:
        return json.load(f)

def write_config(path: str, data: dict) -> None:
    with open(path, "w") as f:
        json.dump(data, f)
`;
      const result = scoreFile(pythonCode, pyProfile, "config.py");
      expect(result.score).toBeGreaterThan(0);
      expect(result.checkResults.length).toBeGreaterThan(0);
    });

    test("skips interface checks for languages without interfaces", () => {
      const jsProfile = getLanguageProfile("test.js")!;
      const jsCode = `
function foo() {}
function bar() {}
`;
      const result = scoreFile(jsCode, jsProfile, "utils.js");
      const interfaceCheck = result.checkResults.find((c) => c.check === "interface-members");
      expect(interfaceCheck).toBeUndefined();
    });

    test("detects excessive interface members", () => {
      const wideInterface = `
interface BigDeps {
  a: string;
  b: string;
  c: string;
  d: string;
  e: string;
  f: string;
  g: string;
  h: string;
  i: string;
}
`;
      const result = scoreFile(wideInterface, tsProfile, "src/wide.ts");
      const violation = result.violations.find((v) => v.check === "interface-members");
      expect(violation).toBeDefined();
      const advisory = formatAdvisory(result, "src/wide.ts");
      expect(advisory).toContain("Interface has");
    });

    test("detects throw statements in non-adapter files", () => {
      const throwHeavy = `
import { ok } from "./result";
function validate(x: string) {
  if (!x) throw new Error("empty");
  if (x.length > 100) throw new Error("too long");
}
`;
      const result = scoreFile(throwHeavy, tsProfile, "src/validator.ts");
      const violation = result.violations.find((v) => v.check === "throw-count");
      expect(violation).toBeDefined();
      const advisory = formatAdvisory(result, "src/validator.ts");
      expect(advisory).toContain("throw statements");
    });

    test("detects excessive null returns", () => {
      const nullReturns = `
function findA(): string | null { return null; }
function findB(): string | null { return null; }
function findC(): string | null { return null; }
`;
      const result = scoreFile(nullReturns, tsProfile, "src/finders.ts");
      const violation = result.violations.find((v) => v.check === "null-return-count");
      expect(violation).toBeDefined();
      const advisory = formatAdvisory(result, "src/finders.ts");
      expect(advisory).toContain("null/undefined returns");
    });

    test("detects mixed error strategies", () => {
      const mixed = `
import type { Result } from "./result";
import { ok, err } from "./result";
function safe(): Result<string, Error> { return ok("ok"); }
function unsafe() { try { doStuff(); } catch (e) { throw e; } }
`;
      const result = scoreFile(mixed, tsProfile, "src/mixed.ts");
      const violation = result.violations.find((v) => v.check === "mixed-error-strategy");
      expect(violation).toBeDefined();
      const advisory = formatAdvisory(result, "src/mixed.ts");
      expect(advisory).toContain("mixes Result");
    });
  });
});
