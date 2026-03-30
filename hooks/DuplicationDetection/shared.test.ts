import { describe, expect, test } from "bun:test";
import { getArtifactsDir, projectHash } from "@hooks/hooks/DuplicationDetection/shared";

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

describe("getArtifactsDir", () => {
  test("returns path under /tmp/pai/duplication/", () => {
    const dir = getArtifactsDir("/Users/test/project");
    expect(dir.startsWith("/tmp/pai/duplication/")).toBe(true);
  });

  test("includes project hash as final path segment", () => {
    const hash = projectHash("/Users/test/project");
    const dir = getArtifactsDir("/Users/test/project");
    expect(dir).toBe(`/tmp/pai/duplication/${hash}`);
  });

  test("is deterministic for same project root", () => {
    const a = getArtifactsDir("/some/path");
    const b = getArtifactsDir("/some/path");
    expect(a).toBe(b);
  });

  test("different project roots get different directories", () => {
    const a = getArtifactsDir("/project/alpha");
    const b = getArtifactsDir("/project/beta");
    expect(a).not.toBe(b);
  });
});
