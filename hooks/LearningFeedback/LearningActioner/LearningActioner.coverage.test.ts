import { describe, it, expect } from "bun:test";
import { buildAgentPrompt } from "@hooks/contracts/LearningActioner";

describe("buildAgentPrompt", () => {
  const baseDir = "/home/testuser/.claude";

  it("returns a string containing the baseDir", () => {
    const prompt = buildAgentPrompt(baseDir);
    expect(typeof prompt).toBe("string");
    expect(prompt).toContain(baseDir);
  });

  it("includes WORKING DIRECTORY with baseDir", () => {
    const prompt = buildAgentPrompt(baseDir);
    expect(prompt).toContain(`WORKING DIRECTORY: ${baseDir}`);
  });

  it("references all learning source files", () => {
    const prompt = buildAgentPrompt(baseDir);
    expect(prompt).toContain("algorithm-reflections.jsonl");
    expect(prompt).toContain("ratings.jsonl");
    expect(prompt).toContain("quality-violations.jsonl");
  });

  it("references learning directories", () => {
    const prompt = buildAgentPrompt(baseDir);
    expect(prompt).toContain("MEMORY/LEARNING/ALGORITHM/");
    expect(prompt).toContain("MEMORY/LEARNING/SYSTEM/");
    expect(prompt).toContain("MEMORY/LEARNING/QUALITY/");
  });

  it("includes proposals output directory with baseDir", () => {
    const prompt = buildAgentPrompt(baseDir);
    expect(prompt).toContain(`${baseDir}/MEMORY/LEARNING/PROPOSALS/pending/`);
  });

  it("describes the proposal file format sections", () => {
    const prompt = buildAgentPrompt(baseDir);
    expect(prompt).toContain("## What was learned");
    expect(prompt).toContain("## Proposed change");
    expect(prompt).toContain("## Rationale");
  });

  it("lists all valid proposal categories", () => {
    const prompt = buildAgentPrompt(baseDir);
    const categories = ["steering-rule", "memory", "hook", "skill", "workflow"];
    for (const cat of categories) {
      expect(prompt).toContain(cat);
    }
  });

  it("includes priority levels in frontmatter template", () => {
    const prompt = buildAgentPrompt(baseDir);
    expect(prompt).toContain("low | medium | high");
  });

  it("mentions existing proposals directories to avoid duplicates", () => {
    const prompt = buildAgentPrompt(baseDir);
    expect(prompt).toContain("pending/");
    expect(prompt).toContain("applied/");
    expect(prompt).toContain("rejected/");
  });

  it("includes filename format specification", () => {
    const prompt = buildAgentPrompt(baseDir);
    expect(prompt).toContain("{YYYYMMDD}-{HHMMSS}-{slug}.md");
  });

  it("adapts paths when given a different baseDir", () => {
    const customDir = "/opt/custom/pai";
    const prompt = buildAgentPrompt(customDir);
    expect(prompt).toContain(`WORKING DIRECTORY: ${customDir}`);
    expect(prompt).toContain(`${customDir}/MEMORY/LEARNING/PROPOSALS/pending/`);
    expect(prompt).not.toContain(baseDir);
  });
});
