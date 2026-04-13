/**
 * Tests for lib/prd-template.ts — PRD filename, ID, and template generation.
 *
 * Date-dependent functions are tested with regex patterns rather than exact
 * strings, since the generated values depend on the current date at test time.
 */

import { describe, expect, it } from "bun:test";
import {
  generatePRDFilename,
  generatePRDId,
  generatePRDTemplate,
} from "@hooks/lib/prd-template";

// ─── generatePRDFilename ─────────────────────────────────────────────────────

describe("generatePRDFilename", () => {
  it("matches the pattern PRD-YYYYMMDD-{slug}.md", () => {
    const result = generatePRDFilename("my-feature");
    expect(result).toMatch(/^PRD-\d{8}-my-feature\.md$/);
  });

  it("includes the slug verbatim", () => {
    const slug = "add-user-auth";
    const result = generatePRDFilename(slug);
    expect(result).toContain(slug);
  });

  it("ends with .md extension", () => {
    expect(generatePRDFilename("test")).toEndWith(".md");
  });

  it("starts with PRD-", () => {
    expect(generatePRDFilename("test")).toStartWith("PRD-");
  });

  it("date portion is 8 digits (YYYYMMDD)", () => {
    const filename = generatePRDFilename("slug");
    const dateMatch = filename.match(/^PRD-(\d{8})-/);
    expect(dateMatch).not.toBeNull();
    const datePart = dateMatch![1];
    expect(datePart).toHaveLength(8);
    // Year should be 4 digits starting with 20xx
    expect(datePart.slice(0, 4)).toMatch(/^20\d{2}$/);
    // Month should be 01-12
    const month = parseInt(datePart.slice(4, 6), 10);
    expect(month).toBeGreaterThanOrEqual(1);
    expect(month).toBeLessThanOrEqual(12);
    // Day should be 01-31
    const day = parseInt(datePart.slice(6, 8), 10);
    expect(day).toBeGreaterThanOrEqual(1);
    expect(day).toBeLessThanOrEqual(31);
  });

  it("handles slug with hyphens", () => {
    const result = generatePRDFilename("fix-broken-pipeline");
    expect(result).toContain("fix-broken-pipeline");
  });
});

// ─── generatePRDId ───────────────────────────────────────────────────────────

describe("generatePRDId", () => {
  it("matches the pattern PRD-YYYYMMDD-{slug}", () => {
    const result = generatePRDId("my-feature");
    expect(result).toMatch(/^PRD-\d{8}-my-feature$/);
  });

  it("does NOT end with .md", () => {
    expect(generatePRDId("test")).not.toEndWith(".md");
  });

  it("includes the slug verbatim", () => {
    const slug = "refactor-pipeline";
    const result = generatePRDId(slug);
    expect(result).toContain(slug);
  });

  it("starts with PRD-", () => {
    expect(generatePRDId("test")).toStartWith("PRD-");
  });

  it("generatePRDFilename and generatePRDId share the same date+slug stem", () => {
    const slug = "consistency-check";
    const id = generatePRDId(slug);
    const filename = generatePRDFilename(slug);
    // filename = id + ".md"
    expect(filename).toBe(`${id}.md`);
  });
});

// ─── generatePRDTemplate ─────────────────────────────────────────────────────

describe("generatePRDTemplate", () => {
  const baseOpts = {
    title: "Add OAuth Login",
    slug: "add-oauth-login",
  };

  it("includes the title as an H1 heading", () => {
    const result = generatePRDTemplate(baseOpts);
    expect(result).toContain("# Add OAuth Login");
  });

  it("includes the generated PRD id in frontmatter", () => {
    const result = generatePRDTemplate(baseOpts);
    expect(result).toMatch(/^id: PRD-\d{8}-add-oauth-login$/m);
  });

  it("contains required frontmatter fields", () => {
    const result = generatePRDTemplate(baseOpts);
    expect(result).toContain("prd: true");
    expect(result).toContain("status: DRAFT");
    expect(result).toContain("iteration: 0");
    expect(result).toContain("maxIterations: 128");
    expect(result).toContain("loopStatus: null");
  });

  it("defaults effort_level to Standard when not provided", () => {
    const result = generatePRDTemplate(baseOpts);
    expect(result).toContain("effort_level: Standard");
  });

  it("uses provided effortLevel", () => {
    const result = generatePRDTemplate({ ...baseOpts, effortLevel: "Extended" });
    expect(result).toContain("effort_level: Extended");
  });

  it("defaults mode to interactive when not provided", () => {
    const result = generatePRDTemplate(baseOpts);
    expect(result).toContain("mode: interactive");
  });

  it("uses provided mode", () => {
    const result = generatePRDTemplate({ ...baseOpts, mode: "loop" });
    expect(result).toContain("mode: loop");
  });

  it("uses today's local date for created and updated fields", () => {
    const result = generatePRDTemplate(baseOpts);
    // Use local date to match implementation (avoids timezone issues with toISOString)
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const today = `${year}-${month}-${day}`;
    expect(result).toContain(`created: ${today}`);
    expect(result).toContain(`updated: ${today}`);
  });

  it("includes default problem space placeholder when no prompt given", () => {
    const result = generatePRDTemplate(baseOpts);
    expect(result).toContain("_To be populated during OBSERVE phase._");
  });

  it("includes prompt content when provided", () => {
    const result = generatePRDTemplate({ ...baseOpts, prompt: "Users need OAuth login support." });
    expect(result).toContain("Users need OAuth login support.");
  });

  it("truncates prompt to 500 characters", () => {
    // Use a unique sentinel character sequence unlikely to appear in the template itself
    const sentinel = "ZZZZ";
    const longPrompt = sentinel.repeat(150); // 600 chars total
    const result = generatePRDTemplate({ ...baseOpts, prompt: longPrompt });
    // The embedded portion must be <=500 chars — count sentinel repetitions: max 500/4 = 125
    const sentinelCount = (result.match(/ZZZZ/g) || []).length;
    expect(sentinelCount).toBeLessThanOrEqual(125);
  });

  it("includes all required section headers", () => {
    const result = generatePRDTemplate(baseOpts);
    expect(result).toContain("## STATUS");
    expect(result).toContain("## CONTEXT");
    expect(result).toContain("## PLAN");
    expect(result).toContain("## IDEAL STATE CRITERIA");
    expect(result).toContain("## DECISIONS");
    expect(result).toContain("## LOG");
  });

  it("starts with YAML frontmatter delimiter", () => {
    const result = generatePRDTemplate(baseOpts);
    expect(result.trimStart()).toStartWith("---");
  });
});
