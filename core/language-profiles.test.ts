import { describe, test, expect } from "bun:test";
import {
  getLanguageProfile,
  isScorableFile,
  getAllProfiles,
} from "./language-profiles";

describe("language-profiles", () => {
  describe("getLanguageProfile", () => {
    test("returns TypeScript profile for .ts files", () => {
      const profile = getLanguageProfile("src/hooks/core/runner.ts");
      expect(profile).not.toBeNull();
      expect(profile!.name).toBe("TypeScript");
    });

    test("returns TypeScript profile for .tsx files", () => {
      const profile = getLanguageProfile("components/App.tsx");
      expect(profile).not.toBeNull();
      expect(profile!.name).toBe("TypeScript");
    });

    test("returns JavaScript profile for .js files", () => {
      const profile = getLanguageProfile("lib/utils.js");
      expect(profile).not.toBeNull();
      expect(profile!.name).toBe("JavaScript");
    });

    test("returns Python profile for .py files", () => {
      const profile = getLanguageProfile("scripts/deploy.py");
      expect(profile).not.toBeNull();
      expect(profile!.name).toBe("Python");
    });

    test("returns Go profile for .go files", () => {
      const profile = getLanguageProfile("main.go");
      expect(profile).not.toBeNull();
      expect(profile!.name).toBe("Go");
    });

    test("returns Rust profile for .rs files", () => {
      const profile = getLanguageProfile("src/lib.rs");
      expect(profile).not.toBeNull();
      expect(profile!.name).toBe("Rust");
    });

    test("returns Java profile for .java files", () => {
      const profile = getLanguageProfile("App.java");
      expect(profile).not.toBeNull();
      expect(profile!.name).toBe("Java");
    });

    test("returns Ruby profile for .rb files", () => {
      const profile = getLanguageProfile("app.rb");
      expect(profile).not.toBeNull();
      expect(profile!.name).toBe("Ruby");
    });

    test("returns PHP profile for .php files", () => {
      const profile = getLanguageProfile("index.php");
      expect(profile).not.toBeNull();
      expect(profile!.name).toBe("PHP");
    });

    test("returns Swift profile for .swift files", () => {
      const profile = getLanguageProfile("ViewController.swift");
      expect(profile).not.toBeNull();
      expect(profile!.name).toBe("Swift");
    });

    test("returns C# profile for .cs files", () => {
      const profile = getLanguageProfile("Program.cs");
      expect(profile).not.toBeNull();
      expect(profile!.name).toBe("C#");
    });

    test("returns null for JSON files", () => {
      expect(getLanguageProfile("package.json")).toBeNull();
    });

    test("returns null for YAML files", () => {
      expect(getLanguageProfile("config.yaml")).toBeNull();
      expect(getLanguageProfile("config.yml")).toBeNull();
    });

    test("returns null for markdown files", () => {
      expect(getLanguageProfile("README.md")).toBeNull();
    });

    test("returns null for CSS files", () => {
      expect(getLanguageProfile("styles.css")).toBeNull();
    });

    test("returns null for HTML files", () => {
      expect(getLanguageProfile("index.html")).toBeNull();
    });

    test("returns null for lock files", () => {
      expect(getLanguageProfile("bun.lock")).toBeNull();
    });

    test("returns null for .d.ts declaration files", () => {
      expect(getLanguageProfile("types.d.ts")).toBeNull();
    });

    test("returns null for files with no extension", () => {
      expect(getLanguageProfile("Makefile")).toBeNull();
    });

    test("returns null for unknown extensions", () => {
      expect(getLanguageProfile("data.parquet")).toBeNull();
    });

    test("returns null for vite.config.ts", () => {
      expect(getLanguageProfile("vite.config.ts")).toBeNull();
    });

    test("returns null for vite.config.ts in nested paths", () => {
      expect(getLanguageProfile("/home/user/project/vite.config.ts")).toBeNull();
    });

    test("returns null for vite config variant extensions", () => {
      expect(getLanguageProfile("vite.config.js")).toBeNull();
      expect(getLanguageProfile("vite.config.mts")).toBeNull();
      expect(getLanguageProfile("vite.config.mjs")).toBeNull();
    });
  });

  describe("isScorableFile", () => {
    test("returns true for source code files", () => {
      expect(isScorableFile("app.ts")).toBe(true);
      expect(isScorableFile("app.py")).toBe(true);
      expect(isScorableFile("app.go")).toBe(true);
    });

    test("returns false for non-source files", () => {
      expect(isScorableFile("config.json")).toBe(false);
      expect(isScorableFile("README.md")).toBe(false);
      expect(isScorableFile("styles.css")).toBe(false);
    });
  });

  describe("getAllProfiles", () => {
    test("returns at least 10 profiles", () => {
      const profiles = getAllProfiles();
      expect(profiles.length).toBeGreaterThanOrEqual(10);
    });

    test("every profile has required fields", () => {
      for (const profile of getAllProfiles()) {
        expect(profile.name).toBeTruthy();
        expect(profile.extensions.length).toBeGreaterThan(0);
        expect(profile.commentPrefix).toBeTruthy();
        expect(profile.functionPattern).toBeInstanceOf(RegExp);
        expect(profile.importPattern).toBeInstanceOf(RegExp);
      }
    });

    test("no duplicate extensions across profiles", () => {
      const seen = new Set<string>();
      for (const profile of getAllProfiles()) {
        for (const ext of profile.extensions) {
          expect(seen.has(ext)).toBe(false);
          seen.add(ext);
        }
      }
    });
  });

  describe("TypeScript profile patterns", () => {
    const profile = getLanguageProfile("test.ts")!;

    test("matches function declarations", () => {
      const content = `
export function foo() {}
async function bar() {}
const baz = () => {}
const qux = async (x: number) => {}
function helper() {}
`;
      const matches = content.match(profile.functionPattern);
      expect(matches).not.toBeNull();
      expect(matches!.length).toBeGreaterThanOrEqual(3);
    });

    test("matches import statements", () => {
      const content = `
import { foo } from "./bar";
import type { Baz } from "./qux";
import * as path from "path";
`;
      const imports = content.match(profile.importPattern);
      expect(imports).not.toBeNull();
      expect(imports!.length).toBe(3);
    });

    test("matches type imports", () => {
      const content = `
import { foo } from "./bar";
import type { Baz } from "./qux";
import type { Result } from "./result";
`;
      const typeImports = content.match(profile.typeImportPattern!);
      expect(typeImports).not.toBeNull();
      expect(typeImports!.length).toBe(2);
    });

    test("matches interface declarations", () => {
      const content = `
export interface FooDeps {
  bar: string;
}
interface InternalState {
  count: number;
}
`;
      const interfaces = content.match(profile.interfacePattern!);
      expect(interfaces).not.toBeNull();
      expect(interfaces!.length).toBe(2);
    });
  });

  describe("Python profile patterns", () => {
    const profile = getLanguageProfile("test.py")!;

    test("matches function declarations", () => {
      const content = `
def foo():
    pass
async def bar():
    pass
def helper(x, y):
    return x + y
`;
      const matches = content.match(profile.functionPattern);
      expect(matches).not.toBeNull();
      expect(matches!.length).toBe(3);
    });

    test("matches import statements", () => {
      const content = `
import os
from pathlib import Path
from typing import Optional
`;
      const imports = content.match(profile.importPattern);
      expect(imports).not.toBeNull();
      expect(imports!.length).toBe(3);
    });
  });
});
