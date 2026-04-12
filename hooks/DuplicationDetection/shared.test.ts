import { describe, expect, test } from "bun:test";
import {
  findIndexPath,
  getArtifactsDir,
  isPrimitiveReturn,
  normalizeParam,
  normalizeReturn,
  PROJECT_MARKERS,
  projectHash,
} from "@hooks/hooks/DuplicationDetection/shared";

describe("projectHash", () => {
  test("returns 8-character hex string", () => {
    const hash = projectHash("/Users/test/project");
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
  });

  test("is deterministic — same input gives same output", () => {
    const a = projectHash("/Users/test/project");
    const b = projectHash("/Users/test/project");
    expect(a).toBe(b);
  });

  test("different paths produce different hashes", () => {
    const a = projectHash("/Users/test/project-a");
    const b = projectHash("/Users/test/project-b");
    expect(a).not.toBe(b);
  });
});

describe("PROJECT_MARKERS", () => {
  test("includes .git as first entry", () => {
    expect(PROJECT_MARKERS[0]).toBe(".git");
  });

  test("includes package.json", () => {
    expect(PROJECT_MARKERS).toContain("package.json");
  });

  test("includes composer.json", () => {
    expect(PROJECT_MARKERS).toContain("composer.json");
  });
});

describe("getArtifactsDir", () => {
  test("returns path under /tmp/pai/duplication/", () => {
    const dir = getArtifactsDir("/Users/test/project", "main");
    expect(dir.startsWith("/tmp/pai/duplication/")).toBe(true);
  });

  test("includes project hash followed by branch segment", () => {
    const hash = projectHash("/Users/test/project");
    const dir = getArtifactsDir("/Users/test/project", "main");
    expect(dir).toBe(`/tmp/pai/duplication/${hash}/main`);
  });

  test("is deterministic for same project root and branch", () => {
    const a = getArtifactsDir("/some/path", "main");
    const b = getArtifactsDir("/some/path", "main");
    expect(a).toBe(b);
  });

  test("different project roots get different directories", () => {
    const a = getArtifactsDir("/project/alpha", "main");
    const b = getArtifactsDir("/project/beta", "main");
    expect(a).not.toBe(b);
  });

  test("with branch 'main' includes '/main' in path", () => {
    const dir = getArtifactsDir("/some/project", "main");
    expect(dir).toContain("/main");
  });

  test("with null branch uses '/default'", () => {
    const dir = getArtifactsDir("/some/project", null);
    expect(dir).toContain("/default");
  });

  test("with undefined branch uses '/default'", () => {
    const dir = getArtifactsDir("/some/project", undefined);
    expect(dir).toContain("/default");
  });

  test("with 'feat/my-feature' sanitizes to 'feat-my-feature'", () => {
    const dir = getArtifactsDir("/some/project", "feat/my-feature");
    expect(dir).toContain("/feat-my-feature");
  });
});

describe("findIndexPath", () => {
  test("finds index when input is a directory", () => {
    const projectRoot = "/tmp/test-project";
    // Match /tmp/pai/duplication/{hash}/{branch}/index.json regardless of branch name
    const mockDeps = {
      readFile: () => null,
      exists: (path: string) =>
        path.includes("/tmp/pai/duplication/") && path.endsWith("/index.json"),
    };

    const result = findIndexPath(projectRoot, mockDeps);
    expect(result).not.toBeNull();
    expect(result).toContain("index.json");
  });

  test("finds index when input is a file path", () => {
    const mockDeps = {
      readFile: () => null,
      exists: (path: string) => {
        // Match /tmp/pai/duplication/{hash}/{branch}/index.json regardless of branch name
        return path.includes("/tmp/pai/duplication/") && path.endsWith("/index.json");
      },
    };

    const result = findIndexPath("/tmp/test-project/src/foo.ts", mockDeps);
    expect(result).not.toBeNull();
    expect(result).toContain("index.json");
  });

  test("returns null when no index exists anywhere", () => {
    const mockDeps = {
      readFile: () => null,
      exists: () => false,
    };

    const result = findIndexPath("/tmp/test-project/src/foo.ts", mockDeps);
    expect(result).toBeNull();
  });

  test("finds legacy index location as fallback", () => {
    const mockDeps = {
      readFile: () => null,
      exists: (path: string) => path === "/tmp/test-project/.claude/.duplication-index.json",
    };

    const result = findIndexPath("/tmp/test-project/src/foo.ts", mockDeps);
    expect(result).toBe("/tmp/test-project/.claude/.duplication-index.json");
  });
});

describe("normalizeParam", () => {
  test("replaces Partial<ConcreteType> with Partial<*>", () => {
    expect(normalizeParam("Partial<SessionSummaryDeps>")).toBe("Partial<*>");
  });
  test("replaces Record<K,V> with Record<*,*>", () => {
    expect(normalizeParam("Record<string,unknown>")).toBe("Record<*,*>");
  });
  test("leaves primitive types unchanged", () => {
    expect(normalizeParam("string")).toBe("string");
    expect(normalizeParam("number")).toBe("number");
  });
  test("handles empty string", () => {
    expect(normalizeParam("")).toBe("");
  });
  test("handles compound params", () => {
    expect(normalizeParam("Partial<FooDeps>,string")).toBe("Partial<*>,string");
  });
});

describe("normalizeReturn", () => {
  test("replaces *Deps suffix with *Deps", () => {
    expect(normalizeReturn("SessionSummaryDeps")).toBe("*Deps");
    expect(normalizeReturn("CanaryHookDeps")).toBe("*Deps");
  });
  test("replaces *Input suffix with *Input", () => {
    expect(normalizeReturn("ToolHookInput")).toBe("*Input");
    expect(normalizeReturn("SessionEndInput")).toBe("*Input");
  });
  test("replaces *Output suffix with *Output", () => {
    expect(normalizeReturn("SyncHookJSONOutput")).toBe("*Output");
    expect(normalizeReturn("AsyncHookJSONOutput")).toBe("*Output");
  });
  test("leaves primitive types unchanged", () => {
    expect(normalizeReturn("string")).toBe("string");
    expect(normalizeReturn("void")).toBe("void");
    expect(normalizeReturn("number")).toBe("number");
  });
  test("handles empty string", () => {
    expect(normalizeReturn("")).toBe("");
  });
});

describe("isPrimitiveReturn", () => {
  test("returns true for string, void, number, boolean", () => {
    expect(isPrimitiveReturn("string")).toBe(true);
    expect(isPrimitiveReturn("void")).toBe(true);
    expect(isPrimitiveReturn("number")).toBe(true);
    expect(isPrimitiveReturn("boolean")).toBe(true);
  });
  test("returns true for empty string", () => {
    expect(isPrimitiveReturn("")).toBe(true);
  });
  test("returns true for common non-domain types", () => {
    expect(isPrimitiveReturn("{object}")).toBe(true);
    expect(isPrimitiveReturn("string|null")).toBe(true);
  });
  test("returns false for domain types", () => {
    expect(isPrimitiveReturn("*Deps")).toBe(false);
    expect(isPrimitiveReturn("*Input")).toBe(false);
    expect(isPrimitiveReturn("*Output")).toBe(false);
    expect(isPrimitiveReturn("ToolHookInput")).toBe(false);
    expect(isPrimitiveReturn("Promise<void>")).toBe(false);
  });
});
