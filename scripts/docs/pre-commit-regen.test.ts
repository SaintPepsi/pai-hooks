import { describe, expect, it } from "bun:test";
import { matchesDocPattern } from "@hooks/scripts/docs/pre-commit-regen";

describe("pre-commit-regen pattern matching", () => {
  it("matches doc.md in hook directories", () => {
    expect(
      matchesDocPattern("hooks/CodingStandards/TypeStrictness/doc.md"),
    ).toBe(true);
  });

  it("matches IDEA.md in hook directories", () => {
    expect(
      matchesDocPattern(
        "hooks/DuplicationDetection/DuplicationChecker/IDEA.md",
      ),
    ).toBe(true);
  });

  it("matches template.ts", () => {
    expect(matchesDocPattern("scripts/docs/template.ts")).toBe(true);
  });

  it("matches style.css", () => {
    expect(matchesDocPattern("scripts/docs/style.css")).toBe(true);
  });

  it("matches render.ts", () => {
    expect(matchesDocPattern("scripts/docs/render.ts")).toBe(true);
  });

  it("rejects contract files", () => {
    expect(
      matchesDocPattern(
        "hooks/CodingStandards/TypeStrictness/TypeStrictness.contract.ts",
      ),
    ).toBe(false);
  });

  it("rejects test files", () => {
    expect(
      matchesDocPattern(
        "hooks/CodingStandards/TypeStrictness/TypeStrictness.test.ts",
      ),
    ).toBe(false);
  });

  it("rejects unrelated markdown", () => {
    expect(matchesDocPattern("README.md")).toBe(false);
  });
});
